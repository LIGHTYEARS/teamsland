import type { MeegoEvent } from "@teamsland/types";

/**
 * 队列消息优先级
 *
 * 消息按优先级排序消费：high > normal > low。
 *
 * @example
 * ```typescript
 * import type { QueuePriority } from "@teamsland/queue";
 *
 * const p: QueuePriority = "normal";
 * ```
 */
export type QueuePriority = "high" | "normal" | "low";

/**
 * 队列消息状态
 *
 * 消息在生命周期中经历的状态流转：
 * pending → processing → completed / failed / dead
 *
 * @example
 * ```typescript
 * import type { QueueMessageStatus } from "@teamsland/queue";
 *
 * const s: QueueMessageStatus = "pending";
 * ```
 */
export type QueueMessageStatus = "pending" | "processing" | "completed" | "failed" | "dead";

/**
 * 队列消息类型枚举
 *
 * 覆盖所有事件源和内部控制消息。
 *
 * @example
 * ```typescript
 * import type { QueueMessageType } from "@teamsland/queue";
 *
 * const t: QueueMessageType = "lark_mention";
 * ```
 */
export type QueueMessageType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_status_changed"
  | "meego_issue_assigned"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "diagnosis_ready";

/**
 * 队列消息
 *
 * 所有进入消息队列的数据必须实现此接口。
 * `payload` 是类型安全的联合类型，根据 `type` 字段区分。
 *
 * @example
 * ```typescript
 * import type { QueueMessage } from "@teamsland/queue";
 *
 * const msg: QueueMessage = {
 *   id: "msg-001",
 *   type: "lark_mention",
 *   payload: {
 *     event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *     chatId: "oc_xxx",
 *     senderId: "ou_xxx",
 *     messageId: "msg_xxx",
 *   },
 *   priority: "normal",
 *   status: "pending",
 *   retryCount: 0,
 *   maxRetries: 3,
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   scheduledAt: Date.now(),
 *   traceId: "trace-001",
 * };
 * ```
 */
export interface QueueMessage {
  /** 消息唯一 ID（UUID） */
  id: string;
  /** 消息类型 */
  type: QueueMessageType;
  /** 消息负载（JSON 序列化后存储） */
  payload: QueuePayload;
  /** 优先级 */
  priority: QueuePriority;
  /** 当前状态 */
  status: QueueMessageStatus;
  /** 已重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 创建时间（Unix ms） */
  createdAt: number;
  /** 最后更新时间（Unix ms） */
  updatedAt: number;
  /** 计划执行时间（Unix ms），支持延迟投递 */
  scheduledAt: number;
  /** 链路追踪 ID */
  traceId: string;
  /** 失败原因（最后一次） */
  lastError?: string;
}

/**
 * 消息负载联合类型
 *
 * 根据 QueueMessageType 区分具体的负载结构。
 *
 * @example
 * ```typescript
 * import type { QueuePayload } from "@teamsland/queue";
 *
 * const payload: QueuePayload = {
 *   event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *   chatId: "oc_xxx",
 *   senderId: "ou_xxx",
 *   messageId: "msg_xxx",
 * };
 * ```
 */
export type QueuePayload =
  | LarkMentionPayload
  | MeegoEventPayload
  | WorkerCompletedPayload
  | WorkerAnomalyPayload
  | DiagnosisReadyPayload;

/**
 * 飞书 @mention 事件负载
 *
 * 当用户在飞书群聊中 @机器人 时产生。
 *
 * @example
 * ```typescript
 * import type { LarkMentionPayload } from "@teamsland/queue";
 *
 * const payload: LarkMentionPayload = {
 *   event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *   chatId: "oc_xxx",
 *   senderId: "ou_xxx",
 *   messageId: "msg_xxx",
 * };
 * ```
 */
export interface LarkMentionPayload {
  /** 桥接后的 MeegoEvent */
  event: MeegoEvent;
  /** 群聊 ID */
  chatId: string;
  /** 发送者 ID */
  senderId: string;
  /** 消息 ID */
  messageId: string;
}

/**
 * Meego 事件负载
 *
 * 原始 Meego 工单事件的包装。
 *
 * @example
 * ```typescript
 * import type { MeegoEventPayload } from "@teamsland/queue";
 *
 * const payload: MeegoEventPayload = {
 *   event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 * };
 * ```
 */
export interface MeegoEventPayload {
  /** 原始 MeegoEvent */
  event: MeegoEvent;
}

/**
 * Worker 完成事件负载
 *
 * Agent Worker 正常完成任务后发出的通知。
 *
 * @example
 * ```typescript
 * import type { WorkerCompletedPayload } from "@teamsland/queue";
 *
 * const payload: WorkerCompletedPayload = {
 *   workerId: "worker-001",
 *   sessionId: "sess-001",
 *   issueId: "ISSUE-42",
 *   resultSummary: "登录页面已实现",
 * };
 * ```
 */
export interface WorkerCompletedPayload {
  /** Worker ID */
  workerId: string;
  /** Worker session ID */
  sessionId: string;
  /** 关联的任务 ID */
  issueId: string;
  /** 执行结果摘要 */
  resultSummary: string;
}

/**
 * Worker 异常事件负载
 *
 * Agent Worker 出现异常时发出的告警。
 *
 * @example
 * ```typescript
 * import type { WorkerAnomalyPayload } from "@teamsland/queue";
 *
 * const payload: WorkerAnomalyPayload = {
 *   workerId: "worker-001",
 *   anomalyType: "timeout",
 *   details: "Worker 超过 300 秒无响应",
 * };
 * ```
 */
export interface WorkerAnomalyPayload {
  /** Worker ID */
  workerId: string;
  /** 异常类型 */
  anomalyType: "timeout" | "error_spike" | "stuck" | "crash";
  /** 详情 */
  details: string;
}

/**
 * 诊断完成事件负载
 *
 * Observer Worker 对异常 Worker 的诊断报告。
 *
 * @example
 * ```typescript
 * import type { DiagnosisReadyPayload } from "@teamsland/queue";
 *
 * const payload: DiagnosisReadyPayload = {
 *   targetWorkerId: "worker-001",
 *   observerWorkerId: "observer-001",
 *   report: "Worker 陷入死循环，建议重启",
 * };
 * ```
 */
export interface DiagnosisReadyPayload {
  /** 被诊断的 Worker ID */
  targetWorkerId: string;
  /** 诊断者 Worker ID */
  observerWorkerId: string;
  /** 诊断报告 */
  report: string;
}

/**
 * 队列配置
 *
 * 控制 PersistentQueue 的行为参数。
 *
 * @example
 * ```typescript
 * import type { QueueConfig } from "@teamsland/queue";
 *
 * const config: QueueConfig = {
 *   dbPath: "data/queue.sqlite",
 *   busyTimeoutMs: 5000,
 *   visibilityTimeoutMs: 60000,
 *   maxRetries: 3,
 *   deadLetterEnabled: true,
 *   pollIntervalMs: 100,
 * };
 * ```
 */
export interface QueueConfig {
  /** SQLite 数据库文件路径 */
  dbPath: string;
  /** SQLite busy_timeout（毫秒） */
  busyTimeoutMs: number;
  /** 消息处理超时（毫秒），超时后自动 nack */
  visibilityTimeoutMs: number;
  /** 默认最大重试次数 */
  maxRetries: number;
  /** 是否启用死信队列 */
  deadLetterEnabled: boolean;
  /** 消费轮询间隔（毫秒） */
  pollIntervalMs: number;
}
