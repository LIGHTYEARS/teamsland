/**
 * Agent 进程状态
 *
 * @example
 * ```typescript
 * import type { AgentStatus } from "@teamsland/types";
 *
 * const status: AgentStatus = "running";
 * ```
 */
export type AgentStatus = "running" | "completed" | "failed";

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
