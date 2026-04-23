import type { Logger } from "@teamsland/observability";
import { describe, expect, it, vi } from "vitest";
import { ObserverController } from "../observer-controller.js";
import type { ProcessController } from "../process-controller.js";
import type { SubagentRegistry } from "../registry.js";
import type { NormalizedEntry, ReadResult, TranscriptReader, TranscriptSummary } from "../transcript-reader.js";

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockSummary(): TranscriptSummary {
  return {
    totalEntries: 42,
    toolCalls: [
      { name: "Read", timestamp: 1700000000000, isError: false },
      { name: "Edit", timestamp: 1700000001000, isError: false },
      { name: "Bash", timestamp: 1700000002000, isError: true },
    ],
    errors: [
      {
        index: 10,
        type: "tool_result",
        timestamp: 1700000002000,
        content: "Error: file not found",
        isError: true,
      } satisfies NormalizedEntry,
    ],
    lastAssistantMessage: "I encountered an error reading the file",
    durationMs: 120_000,
  };
}

function createMockReadResult(): ReadResult {
  return {
    entries: [],
    offset: 0,
    isLive: false,
  };
}

describe("ObserverController", () => {
  it("should spawn an observer worker for a target agent", async () => {
    const mockRecord = {
      agentId: "worker-001",
      pid: 12345,
      sessionId: "sess-001",
      worktreePath: "/tmp/worktree-001",
      status: "running" as const,
      taskPrompt: "Fix the login bug",
      retryCount: 0,
      createdAt: Date.now() - 60_000,
      issueId: "ISSUE-42",
    };

    const mockSummary = createMockSummary();

    const registry = {
      get: vi.fn().mockReturnValue(mockRecord),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 99999,
        sessionId: "obs-sess-001",
        stdout: new ReadableStream(),
      }),
    } as unknown as ProcessController;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/abc/sess-001.jsonl"),
      read: vi.fn().mockResolvedValue(createMockReadResult()),
      summarizeStructured: vi.fn().mockReturnValue(mockSummary),
    } as unknown as TranscriptReader;

    const controller = new ObserverController(registry, processCtrl, transcriptReader, createMockLogger());

    const result = await controller.observe({
      targetAgentId: "worker-001",
      anomalyType: "timeout",
      mode: "diagnosis",
    });

    expect(result.observerAgentId).toContain("observer-");
    expect(result.pid).toBe(99999);
    expect(result.sessionId).toBe("obs-sess-001");
    expect(registry.get).toHaveBeenCalledWith("worker-001");
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "observing",
        workerType: "observer",
        observeTargetId: "worker-001",
      }),
    );
    expect(processCtrl.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompt: expect.stringContaining("Observer"),
      }),
    );
    expect(transcriptReader.resolveTranscriptPath).toHaveBeenCalledWith("/tmp/worktree-001", "sess-001");
    expect(transcriptReader.read).toHaveBeenCalled();
    expect(transcriptReader.summarizeStructured).toHaveBeenCalled();
  });

  it("should throw if target agent not found", async () => {
    const registry = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as SubagentRegistry;

    const controller = new ObserverController(
      registry,
      {} as ProcessController,
      {} as TranscriptReader,
      createMockLogger(),
    );

    await expect(
      controller.observe({
        targetAgentId: "nonexistent",
        anomalyType: "crash",
        mode: "diagnosis",
      }),
    ).rejects.toThrow("nonexistent");
  });

  it("should use taskBrief if taskPrompt is not set", async () => {
    const mockRecord = {
      agentId: "worker-002",
      pid: 11111,
      sessionId: "sess-002",
      worktreePath: "/tmp/worktree-002",
      status: "running" as const,
      taskBrief: "Refactor auth module",
      retryCount: 0,
      createdAt: Date.now() - 30_000,
      issueId: "ISSUE-99",
    };

    const registry = {
      get: vi.fn().mockReturnValue(mockRecord),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 22222,
        sessionId: "obs-sess-002",
        stdout: new ReadableStream(),
      }),
    } as unknown as ProcessController;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/abc/sess-002.jsonl"),
      read: vi.fn().mockResolvedValue(createMockReadResult()),
      summarizeStructured: vi.fn().mockReturnValue(createMockSummary()),
    } as unknown as TranscriptReader;

    const controller = new ObserverController(registry, processCtrl, transcriptReader, createMockLogger());

    const result = await controller.observe({
      targetAgentId: "worker-002",
      anomalyType: "stuck",
      mode: "progress",
    });

    expect(result.observerAgentId).toBe("observer-obs-sess-002");
    expect(processCtrl.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompt: expect.stringContaining("Refactor auth module"),
      }),
    );
  });
});
