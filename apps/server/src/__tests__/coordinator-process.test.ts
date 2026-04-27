import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { CoordinatorContextLoader, CoordinatorEvent } from "@teamsland/types";
import type { CoordinatorPromptBuilderLike } from "../coordinator-process.js";
import { CoordinatorProcess } from "../coordinator-process.js";

function makeEvent(overrides: Partial<CoordinatorEvent> = {}): CoordinatorEvent {
  return {
    type: "lark_mention",
    id: "evt-1",
    timestamp: Date.now(),
    priority: 1,
    payload: { chatId: "oc_xxx", senderId: "ou_yyy", message: "hello" },
    ...overrides,
  };
}

/**
 * Creates a mock spawn function that supports multi-turn conversation.
 * The stdout stream stays open and emits a result for each message written to stdin.
 */
function createMockSpawnFn(resultText = "I spawned a worker") {
  return vi.fn().mockImplementation(() => {
    let messageCount = 0;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let resolveExited: ((code: number) => void) | undefined;

    const exitedPromise = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });

    const stdin = {
      write: vi.fn().mockImplementation(() => {
        messageCount++;
        const resultLine = JSON.stringify({
          type: "result",
          subtype: "success",
          result: resultText,
          session_id: "coord-s-1",
          duration_ms: 2000,
          num_turns: messageCount,
        });
        // Emit result after a small delay to simulate real CLI
        setTimeout(() => {
          if (controller) {
            controller.enqueue(new TextEncoder().encode(`${resultLine}\n`));
          }
        }, 30);
      }),
      flush: vi.fn(),
      end: vi.fn().mockImplementation(() => {
        // When stdin is closed, resolve exited so terminate() doesn't hang
        resolveExited?.(0);
      }),
    };

    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "coord-s-1" });

    const stdout = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
        // Emit init event immediately
        setTimeout(() => {
          ctrl.enqueue(new TextEncoder().encode(`${initLine}\n`));
        }, 5);
      },
    });

    const stderr = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    return {
      pid: 200,
      stdin,
      stdout,
      stderr,
      exited: exitedPromise,
      killed: false,
      kill: vi.fn(),
    };
  });
}

function createMockContextLoader(): CoordinatorContextLoader {
  return {
    load: vi.fn().mockResolvedValue({
      taskStateSummary: "无运行中 Worker",
      recentMessages: "",
      relevantMemories: "",
    }),
  };
}

function createMockPromptBuilder(): CoordinatorPromptBuilderLike {
  return {
    build: vi.fn().mockReturnValue("formatted prompt"),
  };
}

describe("CoordinatorProcess", () => {
  afterEach(() => vi.restoreAllMocks());

  it("processEvent: 真同步等待 result 后返回", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Bash(teamsland *)", "Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 20,
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader(),
      promptBuilder: createMockPromptBuilder(),
      spawnFn,
    });

    const result = await coord.processEvent(makeEvent());

    expect(result.result).toBe("I spawned a worker");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("processEvent: 连续两个事件复用同一个进程", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 20,
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader(),
      promptBuilder: createMockPromptBuilder(),
      spawnFn,
    });

    await coord.processEvent(makeEvent({ id: "evt-1" }));
    await coord.processEvent(makeEvent({ id: "evt-2" }));

    // Same process, only spawned once
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("processEvent: 事件数达上限后轮转 session", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 2, // Rotate after 2 events
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader(),
      promptBuilder: createMockPromptBuilder(),
      spawnFn,
    });

    await coord.processEvent(makeEvent({ id: "evt-1" }));
    await coord.processEvent(makeEvent({ id: "evt-2" }));
    // 3rd event should trigger new process
    await coord.processEvent(makeEvent({ id: "evt-3" }));

    // spawn called twice: initial + after rotation
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });
});
