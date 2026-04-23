// @teamsland/server — Worker 生命周期监控
// 监控 SubagentRegistry 中 Worker 状态变化，并将事件入队到 PersistentQueue

import type { Logger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { AgentRecord } from "@teamsland/types";

/**
 * Worker 生命周期监控器
 *
 * 定期轮询 SubagentRegistry，检测 Worker 的状态变化（完成、失败、超时），
 * 并将对应事件入队到 PersistentQueue，供 Coordinator 消费处理。
 *
 * @example
 * ```typescript
 * import { createLogger } from "@teamsland/observability";
 * import { WorkerLifecycleMonitor } from "./worker-lifecycle.js";
 *
 * const monitor = new WorkerLifecycleMonitor(registry, queue, createLogger("lifecycle"));
 * const controller = new AbortController();
 * monitor.start(controller.signal);
 * // 停止：controller.abort();
 * ```
 */
export class WorkerLifecycleMonitor {
  private readonly knownStatuses = new Map<string, string>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly registry: SubagentRegistry,
    private readonly queue: PersistentQueue,
    private readonly logger: Logger,
    private readonly workerTimeoutMs: number = 30 * 60 * 1000,
  ) {}

  /**
   * 启动监控
   *
   * 每 10 秒轮询一次 SubagentRegistry，检测 Worker 状态变化。
   * 通过 AbortSignal 控制停止。
   *
   * @param signal - 用于优雅关闭的 AbortSignal
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * monitor.start(controller.signal);
   * // 停止监控
   * controller.abort();
   * ```
   */
  start(signal: AbortSignal): void {
    this.pollTimer = setInterval(() => {
      this.check();
    }, 10_000);

    signal.addEventListener("abort", () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    });

    this.logger.info("Worker 生命周期监控已启动");
  }

  /**
   * 检查所有 Worker 的状态变化
   *
   * 内部轮询方法，比对已知状态与当前状态，
   * 触发完成/失败/超时事件的入队。
   *
   * @example
   * ```typescript
   * // 通常由 start() 内部定时器调用，也可手动调用用于测试
   * monitor.check();
   * ```
   */
  check(): void {
    const workers = this.registry.allRunning();

    for (const worker of workers) {
      this.checkWorkerTransition(worker);
    }

    this.cleanupStaleStatuses(workers);
  }

  /**
   * 检查单个 Worker 的状态变化
   *
   * 比对已知状态与当前状态，触发完成/失败/超时事件。
   *
   * @param worker - 要检查的 Worker 记录
   *
   * @example
   * ```typescript
   * // 内部方法，由 check() 调用
   * ```
   */
  private checkWorkerTransition(worker: AgentRecord): void {
    const prevStatus = this.knownStatuses.get(worker.agentId);

    // 检测状态变化：running → completed
    if (prevStatus === "running" && worker.status === "completed") {
      this.enqueueWorkerCompleted(worker);
    }

    // 检测状态变化：running → failed
    if (prevStatus === "running" && worker.status === "failed") {
      this.enqueueWorkerAnomaly(worker, "crash");
    }

    // 检测超时：运行时间过长
    this.checkWorkerTimeout(worker);

    this.knownStatuses.set(worker.agentId, worker.status);
  }

  /**
   * 检查单个 Worker 是否超时
   *
   * @param worker - 要检查的 Worker 记录
   *
   * @example
   * ```typescript
   * // 内部方法，由 checkWorkerTransition() 调用
   * ```
   */
  private checkWorkerTimeout(worker: AgentRecord): void {
    if (worker.status !== "running") return;
    if (Date.now() - worker.createdAt <= this.workerTimeoutMs) return;

    const timeoutKey = `${worker.agentId}:timeout`;
    if (this.knownStatuses.has(timeoutKey)) return;

    this.enqueueWorkerTimeout(worker);
    this.knownStatuses.set(timeoutKey, "sent");
  }

  /**
   * 清理已不在注册表中的 Worker 的已知状态
   *
   * @param currentWorkers - 当前注册表中的 Worker 列表
   *
   * @example
   * ```typescript
   * // 内部方法，由 check() 调用
   * ```
   */
  private cleanupStaleStatuses(currentWorkers: AgentRecord[]): void {
    for (const [id] of this.knownStatuses) {
      if (!id.includes(":") && !currentWorkers.some((w) => w.agentId === id)) {
        this.knownStatuses.delete(id);
        this.knownStatuses.delete(`${id}:timeout`);
      }
    }
  }

  /**
   * 入队 Worker 完成事件
   *
   * @param worker - 已完成的 Worker 记录
   *
   * @example
   * ```typescript
   * monitor.enqueueWorkerCompleted(worker);
   * ```
   */
  private enqueueWorkerCompleted(worker: AgentRecord): void {
    this.queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: worker.agentId,
        sessionId: worker.sessionId,
        issueId: worker.issueId,
        resultSummary: worker.result ?? "",
      },
      priority: "normal",
      traceId: `lifecycle-${worker.agentId}-completed`,
    });
    this.logger.info({ workerId: worker.agentId }, "Worker 完成事件已入队");
  }

  /**
   * 入队 Worker 异常事件
   *
   * @param worker - 异常的 Worker 记录
   * @param anomalyType - 异常类型
   *
   * @example
   * ```typescript
   * monitor.enqueueWorkerAnomaly(worker, "crash");
   * ```
   */
  private enqueueWorkerAnomaly(worker: AgentRecord, anomalyType: "timeout" | "error_spike" | "stuck" | "crash"): void {
    this.queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: worker.agentId,
        anomalyType,
        details: `Worker ${worker.agentId} 状态异常: ${anomalyType}`,
      },
      priority: "high",
      traceId: `lifecycle-${worker.agentId}-anomaly-${anomalyType}`,
    });
    this.logger.info({ workerId: worker.agentId, anomalyType }, "Worker 异常事件已入队");
  }

  /**
   * 入队 Worker 超时事件
   *
   * @param worker - 超时的 Worker 记录
   *
   * @example
   * ```typescript
   * monitor.enqueueWorkerTimeout(worker);
   * ```
   */
  private enqueueWorkerTimeout(worker: AgentRecord): void {
    const runningMs = Date.now() - worker.createdAt;
    this.queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: worker.agentId,
        anomalyType: "timeout",
        details: `Worker ${worker.agentId} 运行超时 (${Math.round(runningMs / 1000)}s > ${Math.round(this.workerTimeoutMs / 1000)}s)`,
      },
      priority: "high",
      traceId: `lifecycle-${worker.agentId}-timeout`,
    });
    this.logger.info({ workerId: worker.agentId, runningMs }, "Worker 超时事件已入队");
  }
}
