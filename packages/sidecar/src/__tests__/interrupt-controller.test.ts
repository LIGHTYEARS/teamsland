import type { Logger } from "@teamsland/observability";
import type { AgentRecord } from "@teamsland/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterruptController } from "../interrupt-controller.js";
import type { ProcessController } from "../process-controller.js";
import type { SubagentRegistry } from "../registry.js";
import type { TranscriptReader } from "../transcript-reader.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "agent-001",
    pid: 12345,
    sessionId: "sess-abc",
    issueId: "ISSUE-42",
    worktreePath: "/repos/frontend/.worktrees/req-42",
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InterruptController", () => {
  it("interrupt() 发送 SIGINT 后更新状态为 interrupted", async () => {
    const record = makeRecord();
    let isAliveCallCount = 0;

    const processCtrl = {
      isAlive: vi.fn().mockImplementation(() => {
        isAliveCallCount++;
        // 第一次调用返回 true（进程活着），第二次返回 false（SIGINT 后已退出）
        return isAliveCallCount <= 1;
      }),
      interrupt: vi.fn(),
    } as unknown as ProcessController;

    const registry = {
      get: vi.fn().mockReturnValue(record),
      persist: vi.fn().mockResolvedValue(undefined),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/test/sess-abc.jsonl"),
    } as unknown as TranscriptReader;

    const controller = new InterruptController(processCtrl, registry, transcriptReader, fakeLogger);

    const result = await controller.interrupt({
      agentId: "agent-001",
      reason: "用户手动中断",
      graceMs: 10, // 缩短等待时间以加速测试
    });

    expect(processCtrl.interrupt).toHaveBeenCalledWith(12345, false);
    expect(result.terminated).toBe(true);
    expect(result.method).toBe("sigint");
    expect(record.status).toBe("interrupted");
    expect(record.interruptReason).toBe("用户手动中断");
  });

  it("interrupt() 在宽限期后进程仍存活时发送 SIGKILL", async () => {
    const record = makeRecord();

    const processCtrl = {
      isAlive: vi.fn().mockReturnValue(true), // 始终存活
      interrupt: vi.fn(),
    } as unknown as ProcessController;

    const registry = {
      get: vi.fn().mockReturnValue(record),
      persist: vi.fn().mockResolvedValue(undefined),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/test/sess-abc.jsonl"),
    } as unknown as TranscriptReader;

    const controller = new InterruptController(processCtrl, registry, transcriptReader, fakeLogger);

    const result = await controller.interrupt({
      agentId: "agent-001",
      reason: "强制中断测试",
      graceMs: 10,
    });

    expect(processCtrl.interrupt).toHaveBeenCalledWith(12345, false); // SIGINT
    expect(processCtrl.interrupt).toHaveBeenCalledWith(12345, true); // SIGKILL
    expect(result.terminated).toBe(true);
    expect(result.method).toBe("sigkill");
    expect(record.status).toBe("interrupted");
  });

  it("interrupt() 处理已退出的进程", async () => {
    const record = makeRecord();

    const processCtrl = {
      isAlive: vi.fn().mockReturnValue(false), // 进程已退出
      interrupt: vi.fn(),
    } as unknown as ProcessController;

    const registry = {
      get: vi.fn().mockReturnValue(record),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/test/sess-abc.jsonl"),
    } as unknown as TranscriptReader;

    const controller = new InterruptController(processCtrl, registry, transcriptReader, fakeLogger);

    const result = await controller.interrupt({
      agentId: "agent-001",
      reason: "进程已退出",
    });

    expect(processCtrl.interrupt).not.toHaveBeenCalled();
    expect(result.terminated).toBe(true);
    expect(result.method).toBe("already_dead");
    expect(result.worktreePath).toBe("/repos/frontend/.worktrees/req-42");
    expect(record.status).toBe("interrupted");
    expect(record.interruptReason).toBe("进程已退出");
  });

  it("interrupt() 对未知 agentId 抛出错误", async () => {
    const processCtrl = {
      isAlive: vi.fn(),
      interrupt: vi.fn(),
    } as unknown as ProcessController;

    const registry = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as SubagentRegistry;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn(),
    } as unknown as TranscriptReader;

    const controller = new InterruptController(processCtrl, registry, transcriptReader, fakeLogger);

    await expect(controller.interrupt({ agentId: "nonexistent", reason: "测试" })).rejects.toThrow(
      "Agent 未找到: nonexistent",
    );
  });
});
