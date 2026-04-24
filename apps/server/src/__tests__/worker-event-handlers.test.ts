import type { AppConfig } from "@teamsland/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock @teamsland/observability（静默日志） ───
vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { PersistentQueue } from "@teamsland/queue";
import { SubagentRegistry } from "@teamsland/sidecar";
import { registerQueueConsumer } from "../event-handlers.js";

/**
 * 最小化 AppConfig，包含 worker 处理器依赖的字段
 *
 * 设置 teamChannelId 为非空值，以便 fallback 通知路径可发送 DM。
 *
 * @example
 * ```typescript
 * const config = testConfig;
 * ```
 */
const testConfig = {
  meego: {
    spaces: [],
    eventMode: "webhook",
    webhook: { host: "127.0.0.1", port: 19090, path: "/meego/webhook" },
    poll: { intervalSeconds: 60, lookbackMinutes: 5 },
    longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
    apiBaseUrl: "https://project.feishu.cn/open_api",
    pluginAccessToken: "",
  },
  lark: {
    appId: "test",
    appSecret: "test",
    bot: { historyContextCount: 20 },
    notification: { teamChannelId: "channel-test-001" },
  },
  session: { compactionTokenThreshold: 80000, sqliteJitterRangeMs: [20, 150] as [number, number], busyTimeoutMs: 5000 },
  sidecar: {
    maxConcurrentSessions: 20,
    maxRetryCount: 3,
    maxDelegateDepth: 2,
    workerTimeoutSeconds: 300,
    healthCheckTimeoutMs: 30000,
    minSwarmSuccessRatio: 0.5,
  },
  memory: { decayHalfLifeDays: 30, extractLoopMaxIterations: 3, exemptTypes: [], perTypeTtl: {} },
  storage: {
    sqliteVec: { dbPath: ":memory:", busyTimeoutMs: 5000, vectorDimensions: 512 },
    embedding: { model: "test-model", contextSize: 512 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  },
  confirmation: { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 },
  dashboard: { port: 3000, auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] } },
  repoMapping: [{ meegoProjectId: "project_xxx", repos: [{ path: "/tmp/test-repo", name: "测试仓库" }] }],
  skillRouting: { frontend_dev: ["git-tools"] },
} as AppConfig;

// ─── worker_completed 处理器 ───

describe("worker_completed 处理器", () => {
  let queue: PersistentQueue;
  let registry: SubagentRegistry;
  let sendDm: ReturnType<typeof vi.fn>;
  let sendGroupMessage: ReturnType<typeof vi.fn>;
  let processEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queue = new PersistentQueue({
      dbPath: ":memory:",
      busyTimeoutMs: 5000,
      visibilityTimeoutMs: 60_000,
      maxRetries: 3,
      deadLetterEnabled: true,
      pollIntervalMs: 50,
    });
    sendDm = vi.fn().mockResolvedValue(undefined);
    sendGroupMessage = vi.fn().mockResolvedValue(undefined);
    processEvent = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    queue.close();
  });

  /**
   * 初始化 registerQueueConsumer 所需的全部依赖
   *
   * @param coordinatorManager - Coordinator 管理器 mock，传 null 表示未启用
   *
   * @example
   * ```typescript
   * setup(null);
   * setup({ processEvent: vi.fn() });
   * ```
   */
  function setup(coordinatorManager: { processEvent: ReturnType<typeof vi.fn> } | null) {
    const notifier = { sendDm, sendGroupMessage };
    registry = new SubagentRegistry({
      config: testConfig.sidecar,
      notifier: notifier as never,
      registryPath: `/tmp/teamsland-test-wc-${Date.now()}.json`,
    });

    registerQueueConsumer(queue, {
      processController: { spawn: vi.fn(), interrupt: vi.fn(), isAlive: vi.fn() } as never,
      dataPlane: { processStream: vi.fn().mockResolvedValue(undefined) } as never,
      assembler: { buildInitialPrompt: vi.fn().mockResolvedValue("test") } as never,
      registry,
      worktreeManager: { create: vi.fn(), reap: vi.fn() } as never,
      notifier: notifier as never,
      larkCli: { contactSearch: vi.fn(), groupSearch: vi.fn(), sendGroupMessage: vi.fn() } as never,
      config: testConfig,
      teamId: "default",
      documentParser: { parseMarkdown: vi.fn().mockReturnValue({ title: "", sections: [], entities: [] }) } as never,
      memoryStore: null,
      extractLoop: null,
      memoryUpdater: null,
      confirmationWatcher: { watch: vi.fn().mockResolvedValue("approved") } as never,
      coordinatorManager: coordinatorManager as never,
    });
  }

  /**
   * 向注册表添加一条 Worker 记录
   *
   * @example
   * ```typescript
   * preRegisterWorker("worker-001", "sess-001", "ISSUE-42");
   * ```
   */
  function preRegisterWorker(workerId: string, sessionId: string, issueId: string) {
    registry.register({
      agentId: workerId,
      pid: 12345,
      sessionId,
      issueId,
      worktreePath: "/tmp/wt-test",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
    });
  }

  it("coordinatorManager 为 null 时，处理消息并注销 Worker（fallback 通知路径）", async () => {
    setup(null);
    preRegisterWorker("worker-done-001", "sess-done-001", "ISSUE-42");
    expect(registry.runningCount()).toBe(1);

    queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: "worker-done-001",
        sessionId: "sess-done-001",
        issueId: "ISSUE-42",
        resultSummary: "登录页面已实现",
      },
      traceId: "trace-wc-001",
    });

    await new Promise((r) => setTimeout(r, 300));

    const stats = queue.stats();
    expect(stats.completed).toBe(1);

    expect(registry.runningCount()).toBe(0);
    expect(registry.get("worker-done-001")).toBeUndefined();
  });

  it("coordinatorManager 存在时，调用 processEvent 并传入正确事件结构", async () => {
    setup({ processEvent });
    preRegisterWorker("worker-done-002", "sess-done-002", "ISSUE-43");

    queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: "worker-done-002",
        sessionId: "sess-done-002",
        issueId: "ISSUE-43",
        resultSummary: "代码重构完成",
      },
      traceId: "trace-wc-002",
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(processEvent).toHaveBeenCalledOnce();
    const event = processEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(event.type).toBe("worker_completed");
    expect(event.priority).toBe(2);
    expect(event.payload).toEqual({
      workerId: "worker-done-002",
      sessionId: "sess-done-002",
      issueId: "ISSUE-43",
      resultSummary: "代码重构完成",
    });
    expect(typeof event.id).toBe("string");
    expect(typeof event.timestamp).toBe("number");

    expect(sendDm).not.toHaveBeenCalled();
  });

  it("coordinatorManager.processEvent 抛出异常时，回退到直接通知路径", async () => {
    processEvent.mockRejectedValue(new Error("Coordinator 内部异常"));
    setup({ processEvent });
    preRegisterWorker("worker-done-003", "sess-done-003", "ISSUE-44");

    queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: "worker-done-003",
        sessionId: "sess-done-003",
        issueId: "ISSUE-44",
        resultSummary: "任务结果摘要",
      },
      traceId: "trace-wc-003",
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(processEvent).toHaveBeenCalledOnce();

    const stats = queue.stats();
    expect(stats.completed).toBe(1);

    expect(registry.get("worker-done-003")).toBeUndefined();
  });
});

// ─── worker_anomaly 处理器 ───

describe("worker_anomaly 处理器", () => {
  let queue: PersistentQueue;
  let registry: SubagentRegistry;
  let sendDm: ReturnType<typeof vi.fn>;
  let sendGroupMessage: ReturnType<typeof vi.fn>;
  let processEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queue = new PersistentQueue({
      dbPath: ":memory:",
      busyTimeoutMs: 5000,
      visibilityTimeoutMs: 60_000,
      maxRetries: 3,
      deadLetterEnabled: true,
      pollIntervalMs: 50,
    });
    sendDm = vi.fn().mockResolvedValue(undefined);
    sendGroupMessage = vi.fn().mockResolvedValue(undefined);
    processEvent = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    queue.close();
  });

  /**
   * 初始化 registerQueueConsumer 所需的全部依赖
   *
   * @param coordinatorManager - Coordinator 管理器 mock，传 null 表示未启用
   *
   * @example
   * ```typescript
   * setup(null);
   * setup({ processEvent: vi.fn() });
   * ```
   */
  function setup(coordinatorManager: { processEvent: ReturnType<typeof vi.fn> } | null) {
    const notifier = { sendDm, sendGroupMessage };
    registry = new SubagentRegistry({
      config: testConfig.sidecar,
      notifier: notifier as never,
      registryPath: `/tmp/teamsland-test-wa-${Date.now()}.json`,
    });

    registerQueueConsumer(queue, {
      processController: { spawn: vi.fn(), interrupt: vi.fn(), isAlive: vi.fn() } as never,
      dataPlane: { processStream: vi.fn().mockResolvedValue(undefined) } as never,
      assembler: { buildInitialPrompt: vi.fn().mockResolvedValue("test") } as never,
      registry,
      worktreeManager: { create: vi.fn(), reap: vi.fn() } as never,
      notifier: notifier as never,
      larkCli: { contactSearch: vi.fn(), groupSearch: vi.fn(), sendGroupMessage: vi.fn() } as never,
      config: testConfig,
      teamId: "default",
      documentParser: { parseMarkdown: vi.fn().mockReturnValue({ title: "", sections: [], entities: [] }) } as never,
      memoryStore: null,
      extractLoop: null,
      memoryUpdater: null,
      confirmationWatcher: { watch: vi.fn().mockResolvedValue("approved") } as never,
      coordinatorManager: coordinatorManager as never,
    });
  }

  it("coordinatorManager 为 null 时，处理消息并发送 fallback 通知", async () => {
    setup(null);

    queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: "worker-err-001",
        anomalyType: "timeout" as const,
        details: "Worker 超过 300 秒无响应",
      },
      traceId: "trace-wa-001",
    });

    await new Promise((r) => setTimeout(r, 300));

    const stats = queue.stats();
    expect(stats.completed).toBe(1);

    expect(sendDm).toHaveBeenCalledOnce();
    expect(sendDm).toHaveBeenCalledWith("channel-test-001", expect.stringContaining("worker-err-001"));
    expect(sendDm).toHaveBeenCalledWith("channel-test-001", expect.stringContaining("timeout"));
  });

  it("coordinatorManager 存在时，调用 processEvent 且 priority 为 0", async () => {
    setup({ processEvent });

    queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: "worker-err-002",
        anomalyType: "error_spike" as const,
        details: "错误率突增至 50%",
      },
      traceId: "trace-wa-002",
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(processEvent).toHaveBeenCalledOnce();
    const event = processEvent.mock.calls[0][0] as Record<string, unknown>;
    expect(event.type).toBe("worker_anomaly");
    expect(event.priority).toBe(0);
    expect(event.payload).toEqual({
      workerId: "worker-err-002",
      anomalyType: "error_spike",
      details: "错误率突增至 50%",
    });
    expect(typeof event.id).toBe("string");
    expect(typeof event.timestamp).toBe("number");

    expect(sendDm).not.toHaveBeenCalled();
  });

  it("coordinatorManager.processEvent 抛出异常时，回退到直接通知", async () => {
    processEvent.mockRejectedValue(new Error("Coordinator 处理失败"));
    setup({ processEvent });

    queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: "worker-err-003",
        anomalyType: "crash" as const,
        details: "Worker 进程崩溃",
      },
      traceId: "trace-wa-003",
    });

    await new Promise((r) => setTimeout(r, 300));

    expect(processEvent).toHaveBeenCalledOnce();

    expect(sendDm).toHaveBeenCalledOnce();
    expect(sendDm).toHaveBeenCalledWith("channel-test-001", expect.stringContaining("worker-err-003"));
    expect(sendDm).toHaveBeenCalledWith("channel-test-001", expect.stringContaining("crash"));

    const stats = queue.stats();
    expect(stats.completed).toBe(1);
  });
});
