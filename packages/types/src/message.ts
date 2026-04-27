/**
 * 团队消息类型枚举
 *
 * Agent 间通讯的消息分类。
 *
 * @example
 * ```typescript
 * import type { TeamMessageType } from "@teamsland/types";
 *
 * const msgType: TeamMessageType = "task_result";
 * ```
 */
export type TeamMessageType = "task_result" | "task_error" | "delegation" | "status_update" | "query";

/**
 * 团队消息
 *
 * Agent 间传递的结构化消息。
 *
 * @example
 * ```typescript
 * import type { TeamMessage } from "@teamsland/types";
 *
 * const msg: TeamMessage = {
 *   traceId: "trace-001",
 *   fromAgent: "agent-a",
 *   toAgent: "agent-b",
 *   type: "delegation",
 *   payload: { issueId: "ISSUE-42" },
 *   timestamp: Date.now(),
 * };
 * ```
 */
export interface TeamMessage {
  /** 链路追踪 ID */
  traceId: string;
  /** 发送方 Agent ID */
  fromAgent: string;
  /** 接收方 Agent ID */
  toAgent: string;
  /** 消息类型 */
  type: TeamMessageType;
  /** 消息负载 */
  payload: unknown;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}
