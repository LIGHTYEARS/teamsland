import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Anomaly, AnomalyDetectorOpts } from "../anomaly-detector.js";
import { AnomalyDetector } from "../anomaly-detector.js";
import type { SubagentRegistry } from "../registry.js";

/** 创建一条 AgentRecord 的最小 mock */
function makeRecord(overrides: { agentId: string; pid: number; status?: string; createdAt?: number }) {
  return {
    agentId: overrides.agentId,
    pid: overrides.pid,
    sessionId: "sess-mock",
    issueId: "issue-mock",
    worktreePath: "/tmp/mock-worktree",
    status: overrides.status ?? "running",
    retryCount: 0,
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

function createMockRegistry(records: Map<string, ReturnType<typeof makeRecord>>): SubagentRegistry {
  return {
    get: vi.fn((agentId: string) => records.get(agentId)),
    register: vi.fn(),
    unregister: vi.fn(),
    allRunning: vi.fn(() => [...records.values()]),
    runningCount: vi.fn(() => records.size),
    subscribe: vi.fn(() => () => {}),
    persist: vi.fn(),
    restoreOnStartup: vi.fn(),
    toRegistryState: vi.fn(),
  } as unknown as SubagentRegistry;
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  } as unknown as AnomalyDetectorOpts["logger"];
}

describe("AnomalyDetector", () => {
  let detector: AnomalyDetector;
  let records: Map<string, ReturnType<typeof makeRecord>>;
  let registry: SubagentRegistry;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    records = new Map();
    registry = createMockRegistry(records);
    logger = createMockLogger();
  });

  afterEach(() => {
    detector?.stopAll();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("检测到进程意外退出 (unexpected_exit)", () => {
    const record = makeRecord({ agentId: "worker-1", pid: 99999 });
    records.set("worker-1", record);

    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler = vi.fn();
    detector.onAnomaly(handler);

    // 模拟 process.kill(pid, 0) 抛出错误 => 进程不存活
    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    });

    detector.startMonitoring("worker-1");
    vi.advanceTimersByTime(10_000);

    expect(handler).toHaveBeenCalledTimes(1);
    const anomaly: Anomaly = handler.mock.calls[0][0];
    expect(anomaly.type).toBe("unexpected_exit");
    expect(anomaly.agentId).toBe("worker-1");
    expect(anomaly.details).toContain("PID 99999");

    killSpy.mockRestore();
  });

  it("检测到 Worker 超时 (timeout)", () => {
    // 创建一个 createdAt 为 800 秒前的记录
    const record = makeRecord({
      agentId: "worker-2",
      pid: 88888,
      createdAt: Date.now() - 800_000,
    });
    records.set("worker-2", record);

    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler = vi.fn();
    detector.onAnomaly(handler);

    // 模拟进程存活
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    detector.startMonitoring("worker-2");
    vi.advanceTimersByTime(10_000);

    expect(handler).toHaveBeenCalledTimes(1);
    const anomaly: Anomaly = handler.mock.calls[0][0];
    expect(anomaly.type).toBe("timeout");
    expect(anomaly.agentId).toBe("worker-2");
    expect(anomaly.details).toContain("600000ms");

    killSpy.mockRestore();
  });

  it("stopMonitoring 清除定时器", () => {
    const record = makeRecord({ agentId: "worker-3", pid: 77777 });
    records.set("worker-3", record);

    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler = vi.fn();
    detector.onAnomaly(handler);

    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    detector.startMonitoring("worker-3");
    detector.stopMonitoring("worker-3");

    vi.advanceTimersByTime(30_000);

    // 停止监控后不应再触发回调
    expect(handler).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it("onAnomaly 回调接收检测到的异常", () => {
    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler1 = vi.fn();
    const handler2 = vi.fn();
    detector.onAnomaly(handler1);
    detector.onAnomaly(handler2);

    const anomaly: Anomaly = {
      type: "high_error_rate",
      agentId: "worker-4",
      detectedAt: Date.now(),
      details: "错误率过高",
    };

    detector.reportAnomaly(anomaly);

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledWith(anomaly);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith(anomaly);
  });

  it("reportAnomaly 对相同 agentId+type 去重", () => {
    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler = vi.fn();
    detector.onAnomaly(handler);

    const anomaly1: Anomaly = {
      type: "high_error_rate",
      agentId: "worker-5",
      detectedAt: Date.now(),
      details: "第一次报告",
    };
    const anomaly2: Anomaly = {
      type: "high_error_rate",
      agentId: "worker-5",
      detectedAt: Date.now() + 1000,
      details: "第二次报告（重复）",
    };
    const anomaly3: Anomaly = {
      type: "progress_stall",
      agentId: "worker-5",
      detectedAt: Date.now(),
      details: "不同类型，不去重",
    };

    detector.reportAnomaly(anomaly1);
    detector.reportAnomaly(anomaly2);
    detector.reportAnomaly(anomaly3);

    // 第一次和第三次应触发，第二次重复应被去重
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, anomaly1);
    expect(handler).toHaveBeenNthCalledWith(2, anomaly3);
  });

  it("stopAll 清除所有定时器", () => {
    const record1 = makeRecord({ agentId: "worker-6", pid: 66666 });
    const record2 = makeRecord({ agentId: "worker-7", pid: 55555 });
    records.set("worker-6", record1);
    records.set("worker-7", record2);

    detector = new AnomalyDetector({
      registry,
      workerTimeoutMs: 600_000,
      logger,
    });

    const handler = vi.fn();
    detector.onAnomaly(handler);

    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) throw new Error("ESRCH");
      return true;
    });

    detector.startMonitoring("worker-6");
    detector.startMonitoring("worker-7");
    detector.stopAll();

    vi.advanceTimersByTime(30_000);

    // 全部停止后不应再触发回调
    expect(handler).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });
});
