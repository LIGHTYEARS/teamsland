/**
 * Agent 进程状态
 *
 * @example
 * ```typescript
 * import type { AgentStatus } from "@teamsland/types";
 *
 * const status: AgentStatus = "interrupted";
 * ```
 */
export type AgentStatus = "running" | "completed" | "failed" | "interrupted" | "observing";

/**
 * Agent 来源信息，记录触发 Agent 创建的上下文
 *
 * @example
 * ```typescript
 * import type { AgentOrigin } from "@teamsland/types";
 *
 * const origin: AgentOrigin = {
 *   chatId: "oc_abc123",
 *   messageId: "om_xyz789",
 *   senderId: "ou_user001",
 *   source: "lark_mention",
 * };
 * ```
 */
export interface AgentOrigin {
  /** 飞书会话 ID */
  chatId?: string;
  /** 触发消息 ID */
  messageId?: string;
  /** 发送者用户 ID */
  senderId?: string;
  /** 任务受理人用户 ID */
  assigneeId?: string;
  /** 来源渠道 */
  source?: "meego" | "lark_mention" | "coordinator";
}

/**
 * Agent 实例注册记录，由 SubagentRegistry 管理
 *
 * @example
 * ```typescript
 * import type { AgentRecord } from "@teamsland/types";
 *
 * const record: AgentRecord = {
 *   agentId: "agent-001",
 *   pid: 12345,
 *   sessionId: "sess-abc",
 *   issueId: "issue-123",
 *   worktreePath: "/repos/frontend/.worktrees/req-123",
 *   status: "running",
 *   retryCount: 0,
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface AgentRecord {
  /** Agent 唯一标识 */
  agentId: string;
  /** Claude CLI 进程 PID */
  pid: number;
  /** 关联的 Session ID */
  sessionId: string;
  /** 关联的 Meego Issue ID */
  issueId: string;
  /** Git worktree 工作目录路径 */
  worktreePath: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 重试次数（上限由 sidecar.max_retry_count 配置） */
  retryCount: number;
  /** 创建时间戳（Unix 毫秒） */
  createdAt: number;
  /** Agent 来源信息（触发上下文） */
  origin?: AgentOrigin;
  /** 任务简述（便于 Dashboard 展示） */
  taskBrief?: string;
  /** 父级 Agent ID（由 coordinator 分派时填写） */
  parentAgentId?: string;
  /** 任务执行结果摘要 */
  result?: string;
  /** 完成时间戳（Unix 毫秒） */
  completedAt?: number;
  /** Worker 类型：task 为任务执行，observer 为观察模式 */
  workerType?: "task" | "observer";
  /** 观察目标 Agent ID（仅 observer 模式） */
  observeTargetId?: string;
  /** 前任 Agent ID（接力 Worker 场景） */
  predecessorId?: string;
  /** 中断原因 */
  interruptReason?: string;
  /** 原始任务提示词 */
  taskPrompt?: string;
  /** 阶段性进度报告 */
  progressReports?: Array<{ phase: string; summary: string; timestamp: number }>;
}

/**
 * 注册表状态快照，持久化到 registry.json 用于崩溃恢复
 *
 * @example
 * ```typescript
 * import type { RegistryState } from "@teamsland/types";
 *
 * const state: RegistryState = {
 *   agents: [],
 *   updatedAt: Date.now(),
 * };
 * ```
 */
export interface RegistryState {
  /** 所有已注册的 Agent 记录 */
  agents: AgentRecord[];
  /** 最后更新时间戳（Unix 毫秒） */
  updatedAt: number;
}
