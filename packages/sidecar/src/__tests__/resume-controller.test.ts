import type { Logger } from "@teamsland/observability";
import type { AgentRecord } from "@teamsland/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaudeMdInjector } from "../claude-md-injector.js";
import type { ProcessController } from "../process-controller.js";
import type { SubagentRegistry } from "../registry.js";
import { ResumeController } from "../resume-controller.js";
import type { SkillInjector } from "../skill-injector.js";
import type { TranscriptReader, TranscriptSummary } from "../transcript-reader.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makePredecessor(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "agent-001",
    pid: 12345,
    sessionId: "sess-abc",
    issueId: "ISSUE-42",
    worktreePath: "/repos/frontend/.worktrees/req-42",
    status: "interrupted",
    retryCount: 0,
    createdAt: Date.now(),
    interruptReason: "方向偏离",
    taskPrompt: "实现登录功能",
    taskBrief: "登录功能",
    origin: { chatId: "oc_chat", messageId: "om_msg", senderId: "ou_user" },
    ...overrides,
  };
}

const fakeSummary: TranscriptSummary = {
  totalEntries: 50,
  toolCalls: [{ name: "Read", timestamp: 1700000000000, isError: false }],
  errors: [],
  lastAssistantMessage: "已读取文件内容",
  durationMs: 30000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResumeController", () => {
  it("resume() 在前任的 worktree 上启动新 Worker", async () => {
    const predecessor = makePredecessor();

    const registry = {
      get: vi.fn().mockReturnValue(predecessor),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/test/sess-abc.jsonl"),
      read: vi.fn().mockResolvedValue({ entries: [], offset: 0, isLive: false }),
      summarizeStructured: vi.fn().mockReturnValue(fakeSummary),
    } as unknown as TranscriptReader;

    const skillInjector = {
      inject: vi.fn().mockResolvedValue({ injected: ["lark-reply"], skipped: [] }),
    } as unknown as SkillInjector;

    const claudeMdInjector = {
      inject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ClaudeMdInjector;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 99999,
        sessionId: "sess-new",
        stdout: new ReadableStream(),
      }),
    } as unknown as ProcessController;

    const controller = new ResumeController(
      registry,
      transcriptReader,
      skillInjector,
      claudeMdInjector,
      processCtrl,
      fakeLogger,
    );

    const result = await controller.resume({
      predecessorId: "agent-001",
      correctionInstructions: "请改用 TypeScript",
    });

    expect(result.pid).toBe(99999);
    expect(result.worktreePath).toBe("/repos/frontend/.worktrees/req-42");
    expect(processCtrl.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: "ISSUE-42",
        worktreePath: "/repos/frontend/.worktrees/req-42",
      }),
    );
  });

  it("resume() 在提示词中包含 transcript 摘要", async () => {
    const predecessor = makePredecessor();

    const registry = {
      get: vi.fn().mockReturnValue(predecessor),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/path/to/transcript.jsonl"),
      read: vi.fn().mockResolvedValue({ entries: [], offset: 0, isLive: false }),
      summarizeStructured: vi.fn().mockReturnValue(fakeSummary),
    } as unknown as TranscriptReader;

    const skillInjector = {
      inject: vi.fn().mockResolvedValue({ injected: [], skipped: [] }),
    } as unknown as SkillInjector;

    const claudeMdInjector = {
      inject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ClaudeMdInjector;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 88888,
        sessionId: "sess-resume",
        stdout: new ReadableStream(),
      }),
    } as unknown as ProcessController;

    const controller = new ResumeController(
      registry,
      transcriptReader,
      skillInjector,
      claudeMdInjector,
      processCtrl,
      fakeLogger,
    );

    await controller.resume({
      predecessorId: "agent-001",
      correctionInstructions: "调整方向",
    });

    // 验证 spawn 的 initialPrompt 包含 transcript 摘要信息
    const spawnCall = vi.mocked(processCtrl.spawn).mock.calls[0];
    const spawnParams = spawnCall?.[0];
    expect(spawnParams?.initialPrompt).toContain("总条目数: 50");
    expect(spawnParams?.initialPrompt).toContain("Read");
    expect(spawnParams?.initialPrompt).toContain("已读取文件内容");
    expect(spawnParams?.initialPrompt).toContain("30000ms");
    expect(spawnParams?.initialPrompt).toContain("调整方向");
  });

  it("resume() 在新记录上设置 predecessorId", async () => {
    const predecessor = makePredecessor();

    const registry = {
      get: vi.fn().mockReturnValue(predecessor),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/path/to/transcript.jsonl"),
      read: vi.fn().mockResolvedValue({ entries: [], offset: 0, isLive: false }),
      summarizeStructured: vi.fn().mockReturnValue(fakeSummary),
    } as unknown as TranscriptReader;

    const skillInjector = {
      inject: vi.fn().mockResolvedValue({ injected: [], skipped: [] }),
    } as unknown as SkillInjector;

    const claudeMdInjector = {
      inject: vi.fn().mockResolvedValue(undefined),
    } as unknown as ClaudeMdInjector;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 77777,
        sessionId: "sess-new",
        stdout: new ReadableStream(),
      }),
    } as unknown as ProcessController;

    const controller = new ResumeController(
      registry,
      transcriptReader,
      skillInjector,
      claudeMdInjector,
      processCtrl,
      fakeLogger,
    );

    await controller.resume({
      predecessorId: "agent-001",
      correctionInstructions: "继续",
    });

    const registerCall = vi.mocked(registry.register).mock.calls[0];
    const newRecord = registerCall?.[0];
    expect(newRecord?.predecessorId).toBe("agent-001");
    expect(newRecord?.status).toBe("running");
    expect(newRecord?.issueId).toBe("ISSUE-42");
  });

  it("resume() 在前任非 interrupted 状态时抛出错误", async () => {
    const predecessor = makePredecessor({ status: "running" });

    const registry = {
      get: vi.fn().mockReturnValue(predecessor),
    } as unknown as SubagentRegistry;

    const transcriptReader = {} as unknown as TranscriptReader;
    const skillInjector = {} as unknown as SkillInjector;
    const claudeMdInjector = {} as unknown as ClaudeMdInjector;
    const processCtrl = {} as unknown as ProcessController;

    const controller = new ResumeController(
      registry,
      transcriptReader,
      skillInjector,
      claudeMdInjector,
      processCtrl,
      fakeLogger,
    );

    await expect(
      controller.resume({
        predecessorId: "agent-001",
        correctionInstructions: "继续",
      }),
    ).rejects.toThrow("前任 Agent 状态不是 interrupted");
  });

  it("resume() 在前任不存在时抛出错误", async () => {
    const registry = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as SubagentRegistry;

    const transcriptReader = {} as unknown as TranscriptReader;
    const skillInjector = {} as unknown as SkillInjector;
    const claudeMdInjector = {} as unknown as ClaudeMdInjector;
    const processCtrl = {} as unknown as ProcessController;

    const controller = new ResumeController(
      registry,
      transcriptReader,
      skillInjector,
      claudeMdInjector,
      processCtrl,
      fakeLogger,
    );

    await expect(
      controller.resume({
        predecessorId: "nonexistent",
        correctionInstructions: "继续",
      }),
    ).rejects.toThrow("前任 Agent 未找到: nonexistent");
  });
});
