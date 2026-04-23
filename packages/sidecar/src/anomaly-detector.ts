// @teamsland/sidecar — AnomalyDetector
// Agent 异常检测器：监控子进程存活、超时等异常，并触发回调

import type { Logger } from "@teamsland/observability";
import type { SubagentRegistry } from "./registry.js";

/**
 * 异常类型枚举
 *
 * @example
 * ```typescript
 * import type { AnomalyType } from "@teamsland/sidecar";
 *
 * const t: AnomalyType = "timeout";
 * ```
 */
export type AnomalyType = "timeout" | "unexpected_exit" | "high_error_rate" | "inactive" | "progress_stall";

/**
 * 异常记录，描述检测到的 Agent 异常
 *
 * @example
 * ```typescript
 * import type { Anomaly } from "@teamsland/sidecar";
 *
 * const anomaly: Anomaly = {
 *   type: "timeout",
 *   agentId: "worker-abc123",
 *   detectedAt: Date.now(),
 *   details: "Worker 运行超过 600000ms 限制",
 * };
 * ```
 */
export interface Anomaly {
  /** 异常类型 */
  type: AnomalyType;
  /** 关联的 Agent ID */
  agentId: string;
  /** 检测到异常的时间戳（Unix 毫秒） */
  detectedAt: number;
  /** 异常详情描述 */
  details: string;
}

/**
 * AnomalyDetector 构造参数
 *
 * @example
 * ```typescript
 * import type { AnomalyDetectorOpts } from "@teamsland/sidecar";
 *
 * const opts: AnomalyDetectorOpts = {
 *   registry: subagentRegistry,
 *   workerTimeoutMs: 600_000,
 *   inactivityThresholdMs: 300_000,
 *   logger: createLogger("sidecar:anomaly"),
 * };
 * ```
 */
export interface AnomalyDetectorOpts {
  /** Agent 注册表 */
  registry: SubagentRegistry;
  /** Worker 超时时间（毫秒） */
  workerTimeoutMs: number;
  /** 不活跃阈值（毫秒），默认 300_000 (5分钟) */
  inactivityThresholdMs?: number;
  /** 日志记录器 */
  logger: Logger;
}

/** 检测轮询间隔（毫秒） */
const CHECK_INTERVAL_MS = 10_000;

/**
 * Agent 异常检测器
 *
 * 对注册表中的 Agent 进行周期性健康检测，发现异常时触发注册的回调。
 * 支持以下检测：
 * - unexpected_exit: 进程意外退出（PID 不存活但状态仍为 running）
 * - timeout: Worker 运行时间超过 workerTimeoutMs 限制
 * - high_error_rate / progress_stall: 需外部通过 reportAnomaly 上报
 *
 * @example
 * ```typescript
 * import { AnomalyDetector } from "@teamsland/sidecar";
 *
 * const detector = new AnomalyDetector({
 *   registry: subagentRegistry,
 *   workerTimeoutMs: 600_000,
 *   logger: createLogger("sidecar:anomaly"),
 * });
 *
 * detector.onAnomaly((anomaly) => {
 *   logger.warn({ anomaly }, "检测到异常");
 * });
 *
 * detector.startMonitoring("worker-abc123");
 * ```
 */
export class AnomalyDetector {
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();
  private readonly handlers: Array<(anomaly: Anomaly) => void> = [];
  private readonly knownAnomalies = new Set<string>();

  private readonly registry: SubagentRegistry;
  private readonly workerTimeoutMs: number;
  private readonly logger: Logger;

  constructor(opts: AnomalyDetectorOpts) {
    this.registry = opts.registry;
    this.workerTimeoutMs = opts.workerTimeoutMs;
    this.logger = opts.logger;
  }

  /**
   * 开始监控一个 Worker
   *
   * 每 10 秒检测一次指定 Agent 的健康状态：
   * 1. 进程是否存活（通过 process.kill(pid, 0) 探测）
   * 2. 运行时间是否超过 workerTimeoutMs
   *
   * @param agentId - 要监控的 Agent ID
   *
   * @example
   * ```typescript
   * detector.startMonitoring("worker-abc123");
   * ```
   */
  startMonitoring(agentId: string): void {
    if (this.intervals.has(agentId)) {
      return;
    }

    this.logger.info({ agentId }, "开始监控 Agent");

    const timer = setInterval(() => {
      this.checkAgent(agentId);
    }, CHECK_INTERVAL_MS);

    this.intervals.set(agentId, timer);
  }

  /**
   * 停止监控指定 Agent
   *
   * 清除对应的定时器并从监控列表中移除。
   *
   * @param agentId - 要停止监控的 Agent ID
   *
   * @example
   * ```typescript
   * detector.stopMonitoring("worker-abc123");
   * ```
   */
  stopMonitoring(agentId: string): void {
    const timer = this.intervals.get(agentId);
    if (timer) {
      clearInterval(timer);
      this.intervals.delete(agentId);
      this.logger.info({ agentId }, "停止监控 Agent");
    }
  }

  /**
   * 注册异常回调
   *
   * 当检测到异常或通过 reportAnomaly 上报异常时，所有注册的回调将被调用。
   *
   * @param handler - 异常回调函数
   *
   * @example
   * ```typescript
   * detector.onAnomaly((anomaly) => {
   *   console.log(`异常: ${anomaly.type} — ${anomaly.details}`);
   * });
   * ```
   */
  onAnomaly(handler: (anomaly: Anomaly) => void): void {
    this.handlers.push(handler);
  }

  /**
   * 上报外部检测到的异常
   *
   * 用于接收来自外部系统（如 DataPlane）检测到的异常。
   * 相同 agentId + type 的异常会被去重，避免重复通知。
   *
   * @param anomaly - 异常记录
   *
   * @example
   * ```typescript
   * detector.reportAnomaly({
   *   type: "high_error_rate",
   *   agentId: "worker-abc123",
   *   detectedAt: Date.now(),
   *   details: "最近 10 次工具调用中有 8 次失败",
   * });
   * ```
   */
  reportAnomaly(anomaly: Anomaly): void {
    this.emit(anomaly);
  }

  /**
   * 停止所有监控
   *
   * 清除所有定时器并清空监控列表。通常在服务关闭时调用。
   *
   * @example
   * ```typescript
   * detector.stopAll();
   * ```
   */
  stopAll(): void {
    for (const [agentId, timer] of this.intervals) {
      clearInterval(timer);
      this.logger.info({ agentId }, "停止监控 Agent（stopAll）");
    }
    this.intervals.clear();
  }

  /** 检查单个 Agent 的健康状态 */
  private checkAgent(agentId: string): void {
    const record = this.registry.get(agentId);
    if (!record) {
      this.stopMonitoring(agentId);
      return;
    }

    // 只检查 running 状态的 Agent
    if (record.status !== "running") {
      return;
    }

    // 检测 1: 进程是否存活
    if (!this.isAlive(record.pid)) {
      this.emit({
        type: "unexpected_exit",
        agentId,
        detectedAt: Date.now(),
        details: `进程 PID ${record.pid} 已退出，但状态仍为 running`,
      });
      return;
    }

    // 检测 2: 是否超时
    const elapsed = Date.now() - record.createdAt;
    if (elapsed > this.workerTimeoutMs) {
      this.emit({
        type: "timeout",
        agentId,
        detectedAt: Date.now(),
        details: `Worker 运行 ${elapsed}ms，超过 ${this.workerTimeoutMs}ms 限制`,
      });
    }
  }

  /** 探测进程是否存活 */
  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 去重并触发所有异常回调 */
  private emit(anomaly: Anomaly): void {
    const dedupKey = `${anomaly.agentId}:${anomaly.type}`;
    if (this.knownAnomalies.has(dedupKey)) {
      return;
    }
    this.knownAnomalies.add(dedupKey);

    this.logger.warn({ anomaly }, `检测到异常: ${anomaly.type}`);

    for (const handler of this.handlers) {
      handler(anomaly);
    }
  }
}
