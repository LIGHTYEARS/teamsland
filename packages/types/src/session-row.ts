import type { TaskConfig } from "./task.js";

/**
 * Session 状态枚举
 *
 * 会话的生命周期状态：活跃、已压缩、已归档。
 *
 * @example
 * ```typescript
 * import type { SessionStatus } from "@teamsland/types";
 *
 * const status: SessionStatus = "active";
 * ```
 */
export type SessionStatus = "active" | "completed" | "failed" | "compacted" | "archived";

/**
 * Task 状态枚举
 *
 * 任务执行的生命周期状态。
 *
 * @example
 * ```typescript
 * import type { TaskStatus } from "@teamsland/types";
 *
 * const status: TaskStatus = "running";
 * ```
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface OriginData {
  chatId?: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  meegoIssueId?: string;
  observeTargetId?: string;
}

/**
 * Session 行记录
 *
 * 对应 SQLite sessions 表的一行数据，由 SessionDB 读取后返回。
 *
 * @example
 * ```typescript
 * import type { SessionRow } from "@teamsland/types";
 *
 * const row: SessionRow = {
 *   sessionId: "sess-001",
 *   parentSessionId: null,
 *   teamId: "team-alpha",
 *   projectId: "project_xxx",
 *   agentId: "agent-fe",
 *   status: "active",
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   contextHash: null,
 *   metadata: { source: "meego" },
 * };
 * ```
 */
export interface SessionRow {
  /** 会话唯一标识 */
  sessionId: string;
  /** 父会话 ID（compaction 产生的新会话指向旧会话） */
  parentSessionId: string | null;
  /** 所属团队 ID */
  teamId: string;
  /** 关联的项目 ID */
  projectId: string | null;
  /** 关联的 Agent ID */
  agentId: string | null;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
  /** 最后更新时间（Unix 毫秒时间戳） */
  updatedAt: number;
  /** 上下文哈希，用于检测变更 */
  contextHash: string | null;
  /** 可选扩展元数据（JSON 反序列化） */
  metadata: Record<string, unknown> | null;
  /** 会话类型 */
  sessionType: string | null;
  /** 来源标识 */
  source: string | null;
  /** 来源原始数据（JSON 反序列化） */
  originData: OriginData | null;
  /** 会话摘要 */
  summary: string | null;
  /** 消息计数 */
  messageCount: number;
}

/**
 * Message 行记录
 *
 * 对应 SQLite messages 表的一行数据。content 字段同时被 FTS5 索引。
 *
 * @example
 * ```typescript
 * import type { MessageRow } from "@teamsland/types";
 *
 * const msg: MessageRow = {
 *   id: 1,
 *   sessionId: "sess-001",
 *   role: "assistant",
 *   content: "已完成代码审查",
 *   toolName: null,
 *   traceId: "trace-abc",
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface MessageRow {
  /** 自增主键 */
  id: number;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色（user / assistant / system / tool） */
  role: string;
  /** 消息文本内容 */
  content: string;
  /** 工具调用名称（仅 role=tool 时有值） */
  toolName: string | null;
  /** 链路追踪 ID */
  traceId: string | null;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
}

/**
 * Task 行记录
 *
 * 对应 SQLite tasks 表的一行数据。subtaskDag 存储为 JSON TEXT。
 *
 * @example
 * ```typescript
 * import type { TaskRow } from "@teamsland/types";
 *
 * const task: TaskRow = {
 *   taskId: "task-001",
 *   sessionId: "sess-001",
 *   teamId: "team-alpha",
 *   meegoIssueId: "ISSUE-42",
 *   status: "pending",
 *   subtaskDag: null,
 *   createdAt: Date.now(),
 *   completedAt: null,
 * };
 * ```
 */
export interface TaskRow {
  /** 任务唯一标识 */
  taskId: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 所属团队 ID */
  teamId: string;
  /** 关联的 Meego Issue ID */
  meegoIssueId: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 子任务 DAG（JSON 反序列化） */
  subtaskDag: TaskConfig[] | null;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
  /** 完成时间（Unix 毫秒时间戳） */
  completedAt: number | null;
}

/**
 * Compaction 结果
 *
 * 执行上下文压缩后返回的结果，包含新会话 ID 和压缩摘要。
 *
 * @example
 * ```typescript
 * import type { CompactResult } from "@teamsland/types";
 *
 * const result: CompactResult = {
 *   newSessionId: "sess-002",
 *   summary: "前 80000 token 的对话已压缩为摘要",
 * };
 * ```
 */
export interface CompactResult {
  /** 压缩后创建的新会话 ID */
  newSessionId: string;
  /** 压缩产生的摘要文本 */
  summary: string;
}
