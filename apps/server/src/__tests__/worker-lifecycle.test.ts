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

import type { AgentRecord } from "@teamsland/types";
import { WorkerLifecycleMonitor } from "../worker-lifecycle.js";

// ─── Mock Registry ───

function createMockRegistry(workers: AgentRecord[] = []) {
  return {
    allRunning: vi.fn().mockReturnValue(workers),
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    runningCount: vi.fn().mockReturnValue(workers.length),
    subscribe: vi.fn().mockReturnValue(() => {}),
    persist: vi.fn().mockResolvedValue(undefined),
    restoreOnStartup: vi.fn().mockResolvedValue(null),
    toRegistryState: vi.fn().mockReturnValue({ agents: workers, updatedAt: Date.now() }),
  };
}

// ─── Mock Queue ───

function createMockQueue() {
  return {
    enqueue: vi.fn().mockReturnValue("msg-001"),
    consume: vi.fn(),
    dequeue: vi.fn().mockReturnValue(null),
    peek: vi.fn().mockReturnValue(null),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn(),
    stats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 }),
    deadLetters: vi.fn().mockReturnValue([]),
    purgeCompleted: vi.fn().mockReturnValue(0),
    recoverTimeouts: vi.fn().mockReturnValue(0),
  };
}

// ─── Mock Logger ───

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: "info",
  };
}

// ─── Helper ───

function makeWorker(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "agent-001",
    pid: 12345,
    sessionId: "sess-001",
    issueId: "ISSUE-42",
    worktreePath: "/repos/fe/.worktrees/42",
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── 测试套件 ───

describe("WorkerLifecycleMonitor", () => {
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockQueue: ReturnType<typeof createMockQueue>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let monitor: WorkerLifecycleMonitor;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockQueue = createMockQueue();
    mockLogger = createMockLogger();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("完成检测", () => {
    it("应检测已完成的 Worker 并入队事件", () => {
      const worker = makeWorker({ agentId: "agent-done", status: "running" });
      mockRegistry = createMockRegistry([worker]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
      );

      // 第一次 check：记录初始状态
      monitor.check();
      expect(mockQueue.enqueue).not.toHaveBeenCalled();

      // Worker 变为 completed
      worker.status = "completed";
      mockRegistry.allRunning.mockReturnValue([worker]);

      // 第二次 check：检测到状态变化
      monitor.check();

      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worker_completed",
          priority: "normal",
          payload: expect.objectContaining({
            workerId: "agent-done",
          }),
        }),
      );
    });
  });

  describe("失败检测", () => {
    it("应检测失败的 Worker 并入队异常事件", () => {
      const worker = makeWorker({ agentId: "agent-fail", status: "running" });
      mockRegistry = createMockRegistry([worker]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
      );

      // 第一次 check：记录初始状态
      monitor.check();

      // Worker 变为 failed
      worker.status = "failed";
      mockRegistry.allRunning.mockReturnValue([worker]);

      // 第二次 check：检测到失败
      monitor.check();

      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worker_anomaly",
          priority: "high",
          payload: expect.objectContaining({
            workerId: "agent-fail",
            anomalyType: "crash",
          }),
        }),
      );
    });
  });

  describe("超时检测", () => {
    it("应检测运行超时的 Worker 并入队超时事件", () => {
      const timeoutMs = 5000; // 5 秒用于测试
      const worker = makeWorker({
        agentId: "agent-slow",
        status: "running",
        createdAt: Date.now() - timeoutMs - 1000, // 已超过 timeout
      });
      mockRegistry = createMockRegistry([worker]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
        timeoutMs,
      );

      monitor.check();

      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(mockQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "worker_anomaly",
          priority: "high",
          payload: expect.objectContaining({
            workerId: "agent-slow",
            anomalyType: "timeout",
          }),
        }),
      );
    });

    it("不应重复发送超时事件", () => {
      const timeoutMs = 5000;
      const worker = makeWorker({
        agentId: "agent-slow2",
        status: "running",
        createdAt: Date.now() - timeoutMs - 1000,
      });
      mockRegistry = createMockRegistry([worker]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
        timeoutMs,
      );

      // 第一次 check：发送超时
      monitor.check();
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);

      // 第二次 check：不应重复发送
      monitor.check();
      expect(mockQueue.enqueue).toHaveBeenCalledTimes(1);
    });
  });

  describe("start / stop", () => {
    it("应通过 AbortSignal 停止监控", () => {
      mockRegistry = createMockRegistry([]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
      );

      const controller = new AbortController();
      monitor.start(controller.signal);

      expect(mockLogger.info).toHaveBeenCalledWith("Worker 生命周期监控已启动");

      controller.abort();
      // 确认 abort 后不会导致错误
    });
  });

  describe("状态清理", () => {
    it("应清理已不在注册表中的 Worker 状态", () => {
      const worker = makeWorker({ agentId: "agent-gone", status: "running" });
      mockRegistry = createMockRegistry([worker]);
      monitor = new WorkerLifecycleMonitor(
        mockRegistry as unknown as import("@teamsland/sidecar").SubagentRegistry,
        mockQueue as unknown as import("@teamsland/queue").PersistentQueue,
        mockLogger as unknown as import("@teamsland/observability").Logger,
      );

      // 第一次 check：记录状态
      monitor.check();

      // Worker 从注册表消失
      mockRegistry.allRunning.mockReturnValue([]);

      // 第二次 check：应清理内部状态
      monitor.check();

      // 验证：如果 Worker 以新的 running 状态重新出现，不应误检测为状态变更
      const newWorker = makeWorker({ agentId: "agent-gone", status: "running" });
      mockRegistry.allRunning.mockReturnValue([newWorker]);
      monitor.check();

      // 不应有入队操作（因为状态已清理，不存在 "running → completed" 变化）
      expect(mockQueue.enqueue).not.toHaveBeenCalled();
    });
  });
});
