/**
 * Meego 事件类型枚举
 *
 * Meego 项目管理工具推送的事件分类。
 *
 * @example
 * ```typescript
 * import type { MeegoEventType } from "@teamsland/types";
 *
 * const eventType: MeegoEventType = "issue.created";
 * ```
 */
export type MeegoEventType = "issue.created" | "issue.status_changed" | "issue.assigned" | "sprint.started";

/**
 * Meego 事件
 *
 * 从 Meego webhook / 轮询 / 长连接接收到的原始事件数据。
 *
 * @example
 * ```typescript
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * const event: MeegoEvent = {
 *   eventId: "evt-001",
 *   issueId: "ISSUE-42",
 *   projectKey: "FE",
 *   type: "issue.created",
 *   payload: { title: "新增登录页面" },
 *   timestamp: Date.now(),
 * };
 * ```
 */
export interface MeegoEvent {
  /** 事件唯一 ID */
  eventId: string;
  /** 关联的 Issue ID */
  issueId: string;
  /** 项目标识 */
  projectKey: string;
  /** 事件类型 */
  type: MeegoEventType;
  /** 事件原始负载 */
  payload: Record<string, unknown>;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}

/**
 * 事件处理器接口
 *
 * 由 `MeegoEventBus` 调度，每种事件类型对应一个处理器实现。
 *
 * @example
 * ```typescript
 * import type { EventHandler, MeegoEvent } from "@teamsland/types";
 *
 * const handler: EventHandler = {
 *   async process(event: MeegoEvent): Promise<void> {
 *     console.log(`处理事件: ${event.type} for ${event.issueId}`);
 *   },
 * };
 * ```
 */
export interface EventHandler {
  /** 处理单个 Meego 事件 */
  process(event: MeegoEvent): Promise<void>;
}
