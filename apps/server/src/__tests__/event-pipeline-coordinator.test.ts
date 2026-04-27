import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { QueueMessage } from "@teamsland/queue";
import type { CoordinatorContextLoader } from "@teamsland/types";
import { toCoordinatorEvent } from "../coordinator-event-mapper.js";
import type { CoordinatorPromptBuilderLike } from "../coordinator-process.js";
import { CoordinatorProcess } from "../coordinator-process.js";

// ---------------------------------------------------------------------------
// Mock spawn factory (persistent CLI process supporting multi-turn)
// ---------------------------------------------------------------------------

function createMockSpawnFn(opts: { resultText: string; sessionId: string }) {
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
          result: opts.resultText,
          session_id: opts.sessionId,
          duration_ms: 3000,
          num_turns: messageCount,
        });
        setTimeout(() => {
          controller?.enqueue(new TextEncoder().encode(`${resultLine}\n`));
        }, 30);
      }),
      flush: vi.fn(),
      end: vi.fn().mockImplementation(() => {
        resolveExited?.(0);
      }),
    };

    const initLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: opts.sessionId,
    });

    const stdout = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
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
      pid: 300,
      stdin,
      stdout,
      stderr,
      exited: exitedPromise,
      killed: false,
      kill: vi.fn(),
    };
  });
}

function createMockContextLoader(
  overrides?: Partial<{
    taskStateSummary: string;
    recentMessages: string;
    relevantMemories: string;
  }>,
): CoordinatorContextLoader {
  return {
    load: vi.fn().mockResolvedValue({
      taskStateSummary: "",
      recentMessages: "",
      relevantMemories: "",
      ...overrides,
    }),
  };
}

function createMockPromptBuilder(): CoordinatorPromptBuilderLike {
  return {
    build: vi.fn().mockReturnValue("test prompt"),
  };
}

function createCoordinator(opts: {
  spawnFn: ReturnType<typeof createMockSpawnFn>;
  contextLoader: CoordinatorContextLoader;
  promptBuilder: CoordinatorPromptBuilderLike;
}) {
  return new CoordinatorProcess({
    config: {
      workspacePath: "/tmp/coord",
      systemPromptPath: "/tmp/coord/system.md",
      allowedTools: ["Read"],
      sessionMaxLifetimeMs: 30 * 60 * 1000,
      maxEventsPerSession: 20,
      resultTimeoutMs: 10_000,
    },
    contextLoader: opts.contextLoader,
    promptBuilder: opts.promptBuilder,
    spawnFn: opts.spawnFn,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("端到端集成: QueueMessage → toCoordinatorEvent → CoordinatorProcess", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lark_mention 事件经过 mapper → CoordinatorProcess → 拿到 result", async () => {
    const resultText = "已为用户 ou_yyy 在群 oc_xxx 中安排了 Worker 处理任务 ISS-1";
    const spawnFn = createMockSpawnFn({ resultText, sessionId: "coord-1" });
    const promptBuilder = createMockPromptBuilder();
    const contextLoader = createMockContextLoader();
    const coordinator = createCoordinator({ spawnFn, contextLoader, promptBuilder });

    const queueMsg: QueueMessage = {
      id: "msg-1",
      type: "lark_mention",
      payload: {
        event: {
          eventId: "meego-evt-1",
          issueId: "ISS-1",
          projectKey: "PROJ",
          type: "issue.created",
          payload: { title: "fix bug", description: "用户消息" },
          timestamp: Date.now(),
        },
        chatId: "oc_xxx",
        senderId: "ou_yyy",
        messageId: "lark-msg-1",
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "trace-1",
    };

    // Step 1: Convert to CoordinatorEvent
    const event = toCoordinatorEvent(queueMsg);
    expect(event.type).toBe("lark_mention");
    expect(event.payload.chatId).toBe("oc_xxx");
    expect(event.payload.senderId).toBe("ou_yyy");
    expect(event.payload.messageId).toBe("lark-msg-1");
    expect(event.payload.issueId).toBe("ISS-1");
    expect(event.payload.projectKey).toBe("PROJ");
    expect(event.priority).toBe(1);

    // Step 2: Process event through CoordinatorProcess (true synchronous)
    const result = await coordinator.processEvent(event);
    expect(result.type).toBe("result");
    expect(result.subtype).toBe("success");
    expect(result.result).toContain("ISS-1");

    // Step 3: Verify promptBuilder received the event correctly
    expect(promptBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lark_mention" }),
      expect.any(Object),
    );

    // Step 4: Verify contextLoader was called with the coordinator event
    expect(contextLoader.load).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lark_mention", id: "msg-1" }),
      undefined,
    );
  });

  it("worker_completed 事件携带 chatId 和 senderId 到 Coordinator", async () => {
    const resultText = "已通知用户 ou_dev 任务完成";
    const spawnFn = createMockSpawnFn({ resultText, sessionId: "coord-2" });
    const promptBuilder = createMockPromptBuilder();
    const contextLoader = createMockContextLoader({
      taskStateSummary: "Worker w-1 运行中",
    });
    const coordinator = createCoordinator({ spawnFn, contextLoader, promptBuilder });

    const queueMsg: QueueMessage = {
      id: "msg-2",
      type: "worker_completed",
      payload: {
        workerId: "w-1",
        sessionId: "s-1",
        issueId: "ISS-2",
        resultSummary: "bug fixed, PR submitted",
        chatId: "oc_team",
        senderId: "ou_dev",
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "trace-2",
    };

    // Step 1: Verify mapper extracts worker_completed fields
    const event = toCoordinatorEvent(queueMsg);
    expect(event.type).toBe("worker_completed");
    expect(event.payload.chatId).toBe("oc_team");
    expect(event.payload.senderId).toBe("ou_dev");
    expect(event.payload.workerId).toBe("w-1");
    expect(event.payload.issueId).toBe("ISS-2");
    expect(event.payload.resultSummary).toBe("bug fixed, PR submitted");
    expect(event.priority).toBe(2);

    // Step 2: Process event
    const result = await coordinator.processEvent(event);
    expect(result.type).toBe("result");
    expect(result.subtype).toBe("success");
  });

  it("meego_issue_created 事件被正确映射并处理", async () => {
    const resultText = "已创建 Worker 处理工单 FEAT-10";
    const spawnFn = createMockSpawnFn({ resultText, sessionId: "coord-3" });
    const promptBuilder = createMockPromptBuilder();
    const contextLoader = createMockContextLoader();
    const coordinator = createCoordinator({ spawnFn, contextLoader, promptBuilder });

    const queueMsg: QueueMessage = {
      id: "msg-3",
      type: "meego_issue_created",
      payload: {
        event: {
          eventId: "meego-evt-3",
          issueId: "FEAT-10",
          projectKey: "PROJ",
          type: "issue.created",
          payload: { title: "实现新功能", description: "需要前端页面" },
          timestamp: Date.now(),
        },
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "trace-3",
    };

    const event = toCoordinatorEvent(queueMsg);
    expect(event.type).toBe("meego_issue_created");
    expect(event.payload.issueId).toBe("FEAT-10");
    expect(event.payload.title).toBe("实现新功能");
    expect(event.payload.description).toBe("需要前端页面");
    expect(event.priority).toBe(3);

    const result = await coordinator.processEvent(event);
    expect(result.type).toBe("result");
    expect(result.subtype).toBe("success");
    expect(result.result).toContain("FEAT-10");
  });

  it("mapper 保留 QueueMessage.id 作为 CoordinatorEvent.id", () => {
    const queueMsg: QueueMessage = {
      id: "unique-msg-id-42",
      type: "worker_anomaly",
      payload: {
        workerId: "w-99",
        anomalyType: "timeout",
        details: "Worker 超过 300 秒无响应",
      },
      priority: "high",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      scheduledAt: 1700000000000,
      traceId: "trace-anomaly",
    };

    const event = toCoordinatorEvent(queueMsg);
    expect(event.id).toBe("unique-msg-id-42");
    expect(event.timestamp).toBe(1700000000000);
    expect(event.type).toBe("worker_anomaly");
    expect(event.priority).toBe(0); // worker_anomaly 优先级最高
    expect(event.payload.anomalyType).toBe("timeout");
  });

  it("连续两个事件复用同一个 CoordinatorProcess 会话", async () => {
    const spawnFn = createMockSpawnFn({ resultText: "done", sessionId: "coord-reuse" });
    const coordinator = createCoordinator({
      spawnFn,
      contextLoader: createMockContextLoader(),
      promptBuilder: createMockPromptBuilder(),
    });

    const msg1: QueueMessage = {
      id: "msg-seq-1",
      type: "lark_mention",
      payload: {
        event: {
          eventId: "e-1",
          issueId: "I-1",
          projectKey: "P",
          type: "issue.created",
          payload: { title: "first" },
          timestamp: Date.now(),
        },
        chatId: "oc_1",
        senderId: "ou_1",
        messageId: "m-1",
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "t-1",
    };

    const msg2: QueueMessage = {
      id: "msg-seq-2",
      type: "lark_mention",
      payload: {
        event: {
          eventId: "e-2",
          issueId: "I-2",
          projectKey: "P",
          type: "issue.created",
          payload: { title: "second" },
          timestamp: Date.now(),
        },
        chatId: "oc_2",
        senderId: "ou_2",
        messageId: "m-2",
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "t-2",
    };

    const event1 = toCoordinatorEvent(msg1);
    const event2 = toCoordinatorEvent(msg2);

    await coordinator.processEvent(event1);
    await coordinator.processEvent(event2);

    // Only one spawn — the persistent process is reused
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });
});
