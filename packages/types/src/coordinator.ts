/**
 * Coordinator 事件类型
 *
 * 涵盖所有 Coordinator 可处理的事件来源，包括飞书、Meego、Worker 内部事件和用户查询。
 *
 * @example
 * ```typescript
 * import type { CoordinatorEventType } from "@teamsland/types";
 *
 * const t: CoordinatorEventType = "lark_mention";
 * ```
 */
export type CoordinatorEventType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_assigned"
  | "meego_issue_status_changed"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_timeout"
  | "worker_interrupted"
  | "worker_resumed"
  | "diagnosis_ready"
  | "user_query";

/**
 * Coordinator 统一事件
 *
 * 由事件映射器将各种来源的消息转换为此统一格式，供 Coordinator 消费。
 * priority 字段范围为 0（最高优先级）到 4（最低优先级）。
 *
 * @example
 * ```typescript
 * import type { CoordinatorEvent } from "@teamsland/types";
 *
 * const event: CoordinatorEvent = {
 *   type: "lark_mention",
 *   id: "msg-001",
 *   timestamp: Date.now(),
 *   priority: 1,
 *   payload: { chatId: "oc_xxx", senderId: "ou_xxx" },
 * };
 * ```
 */
export interface CoordinatorEvent {
  /** 事件类型 */
  type: CoordinatorEventType;
  /** 事件唯一 ID */
  id: string;
  /** 事件时间戳（Unix ms） */
  timestamp: number;
  /** 优先级，0 = 最高，4 = 最低 */
  priority: number;
  /** 扁平化后的事件负载 */
  payload: Record<string, unknown>;
}

/**
 * Coordinator session 状态
 *
 * 描述 Coordinator session 在其生命周期中所处的阶段。
 *
 * @example
 * ```typescript
 * import type { CoordinatorState } from "@teamsland/types";
 *
 * const state: CoordinatorState = "idle";
 * ```
 */
export type CoordinatorState = "idle" | "spawning" | "running" | "recovery" | "failed";

/**
 * 活跃 session 信息
 *
 * 记录一个正在运行的 Coordinator session 的元数据，包括进程 ID、启动时间和已处理事件。
 *
 * @example
 * ```typescript
 * import type { ActiveSession } from "@teamsland/types";
 *
 * const session: ActiveSession = {
 *   pid: 12345,
 *   sessionId: "sess-001",
 *   startedAt: Date.now(),
 *   lastActivityAt: Date.now(),
 *   processedEvents: ["evt-001", "evt-002"],
 *   chatId: "oc_xxx",
 * };
 * ```
 */
export interface ActiveSession {
  /** 进程 ID */
  pid: number;
  /** Session 唯一 ID */
  sessionId: string;
  /** 启动时间（Unix ms） */
  startedAt: number;
  /** 最后活动时间（Unix ms） */
  lastActivityAt: number;
  /** 已处理的事件 ID 列表 */
  processedEvents: string[];
  /** 关联的群聊 ID（用于 session 复用判断） */
  chatId: string | undefined;
}

/**
 * 上下文加载结果
 *
 * Coordinator 在处理事件前加载的上下文信息，包含任务状态、历史消息和相关记忆。
 *
 * @example
 * ```typescript
 * import type { CoordinatorContext } from "@teamsland/types";
 *
 * const ctx: CoordinatorContext = {
 *   taskStateSummary: "当前有 3 个进行中的任务",
 *   recentMessages: "用户：请帮我检查一下代码\n机器人：好的，正在检查",
 *   relevantMemories: "该用户偏好使用 TypeScript",
 * };
 * ```
 */
export interface CoordinatorContext {
  /** 任务状态摘要 */
  taskStateSummary: string;
  /** 近期消息记录 */
  recentMessages: string;
  /** 相关记忆条目 */
  relevantMemories: string;
}

/**
 * Coordinator 上下文加载器接口
 *
 * 根据事件内容加载处理该事件所需的上下文信息。
 *
 * @example
 * ```typescript
 * import type { CoordinatorContextLoader, CoordinatorEvent, CoordinatorContext } from "@teamsland/types";
 *
 * const loader: CoordinatorContextLoader = {
 *   async load(event: CoordinatorEvent): Promise<CoordinatorContext> {
 *     return {
 *       taskStateSummary: "无进行中任务",
 *       recentMessages: "",
 *       relevantMemories: "",
 *     };
 *   },
 * };
 * ```
 */
export interface CoordinatorContextLoader {
  /** 根据事件加载上下文 */
  load(event: CoordinatorEvent): Promise<CoordinatorContext>;
}

/**
 * Coordinator Session Manager 配置
 *
 * 控制 Coordinator session 的生命周期管理参数，包括超时、复用窗口和重试策略。
 *
 * @example
 * ```typescript
 * import type { CoordinatorSessionManagerConfig } from "@teamsland/types";
 *
 * const cfg: CoordinatorSessionManagerConfig = {
 *   workspacePath: "~/.teamsland/coordinator",
 *   sessionIdleTimeoutMs: 300_000,
 *   sessionMaxLifetimeMs: 1_800_000,
 *   sessionReuseWindowMs: 300_000,
 *   maxRecoveryRetries: 3,
 *   inferenceTimeoutMs: 60_000,
 * };
 * ```
 */
export interface CoordinatorSessionManagerConfig {
  /** 工作目录路径 */
  workspacePath: string;
  /** session 空闲超时（毫秒） */
  sessionIdleTimeoutMs: number;
  /** session 最大存活时间（毫秒） */
  sessionMaxLifetimeMs: number;
  /** 同一 chatId 连续消息复用 session 的时间窗口（毫秒） */
  sessionReuseWindowMs: number;
  /** 崩溃后最大重试次数 */
  maxRecoveryRetries: number;
  /** 单次推理超时（毫秒） */
  inferenceTimeoutMs: number;
}
