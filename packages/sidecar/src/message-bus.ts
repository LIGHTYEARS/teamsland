import { randomUUID } from "node:crypto";
import type { Logger } from "@teamsland/observability";
import type { TeamMessage } from "@teamsland/types";

/**
 * 可观测消息总线
 *
 * Agent 间消息传递的透明代理层，提供两个关键能力：
 * 1. **traceId 注入**：发送时自动补全缺失的 traceId（`crypto.randomUUID()`）
 * 2. **结构化日志**：每条消息均以结构化字段记录（fromAgent、toAgent、type、traceId）
 *
 * 不修改消息的其他字段，保持格式透明。
 *
 * @example
 * ```typescript
 * import { ObservableMessageBus } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const bus = new ObservableMessageBus({
 *   logger: createLogger("sidecar:bus"),
 * });
 *
 * bus.on((msg) => {
 *   console.log("收到消息:", msg.type, "来自:", msg.fromAgent);
 * });
 *
 * bus.send({
 *   fromAgent: "orchestrator",
 *   toAgent: "agent-001",
 *   type: "delegation",
 *   payload: { issueId: "ISSUE-42" },
 *   timestamp: Date.now(),
 *   traceId: "", // 空值将被自动替换为 UUID
 * });
 * ```
 */
export class ObservableMessageBus {
  private readonly logger: Logger;
  private readonly handlers: Array<(msg: TeamMessage) => void> = [];

  constructor(opts: { logger: Logger }) {
    this.logger = opts.logger;
  }

  /**
   * 发送消息
   *
   * 若 `msg.traceId` 为空或未定义，自动生成并注入 UUID。
   * 注入后以结构化字段记录日志，再同步调用所有已注册的 handler。
   *
   * @param msg - 待发送的团队消息
   *
   * @example
   * ```typescript
   * bus.send({
   *   traceId: "", // 空值将被自动替换为 UUID
   *   fromAgent: "orchestrator",
   *   toAgent: "agent-002",
   *   type: "status_update",
   *   payload: { status: "running" },
   *   timestamp: Date.now(),
   * });
   * ```
   */
  send(msg: TeamMessage): void {
    const traced: TeamMessage = {
      ...msg,
      traceId: msg.traceId || randomUUID(),
    };

    this.logger.info(
      {
        traceId: traced.traceId,
        fromAgent: traced.fromAgent,
        toAgent: traced.toAgent,
        type: traced.type,
      },
      "消息发送",
    );

    for (const handler of this.handlers) {
      handler(traced);
    }
  }

  /**
   * 注册消息处理器
   *
   * 同一个 bus 实例可注册多个 handler，消息发送时依次调用。
   * handler 应避免抛出异常（异常会中断后续 handler 的调用）。
   *
   * @param handler - 消息处理函数
   *
   * @example
   * ```typescript
   * bus.on((msg) => {
   *   if (msg.type === "task_result") {
   *     console.log("任务完成:", msg.payload);
   *   }
   * });
   * ```
   */
  on(handler: (msg: TeamMessage) => void): void {
    this.handlers.push(handler);
  }
}
