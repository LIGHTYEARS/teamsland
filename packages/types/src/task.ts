import type { MeegoEvent } from "./meego.js";

/**
 * 单任务配置，描述一个 Agent 执行任务所需的全部上下文
 *
 * @example
 * ```typescript
 * import type { TaskConfig, MeegoEvent } from "@teamsland/types";
 *
 * const event: MeegoEvent = {
 *   eventId: "evt-001",
 *   issueId: "issue-123",
 *   projectKey: "FRONTEND",
 *   type: "issue.created",
 *   payload: {},
 *   timestamp: Date.now(),
 * };
 * const task: TaskConfig = {
 *   issueId: "issue-123",
 *   meegoEvent: event,
 *   meegoProjectId: "project_xxx",
 *   description: "实现用户登录页面",
 *   triggerType: "frontend_dev",
 *   agentRole: "architect",
 *   worktreePath: "/repos/frontend/.worktrees/req-123",
 *   assigneeId: "user-001",
 * };
 * ```
 */
export interface TaskConfig {
  /** 关联的 Meego Issue ID */
  issueId: string;
  /** 触发该任务的 Meego 事件 */
  meegoEvent: MeegoEvent;
  /** Meego 项目 ID，用于仓库映射 */
  meegoProjectId: string;
  /** 任务描述 */
  description: string;
  /** 触发类型，用于 Skill 路由 */
  triggerType: string;
  /** Agent 角色（architect / repo-scan / prd-parse 等） */
  agentRole: string;
  /** Git worktree 工作目录路径 */
  worktreePath: string;
  /** 负责人飞书 user_id，用于私聊通知 */
  assigneeId: string;
}

/**
 * 复合任务，由 TaskPlanner 将复杂需求分解为子任务 DAG
 *
 * @example
 * ```typescript
 * import type { ComplexTask } from "@teamsland/types";
 *
 * const complex: ComplexTask = {
 *   issueId: "issue-123",
 *   meegoEvent: { eventId: "e1", issueId: "issue-123", projectKey: "FE", type: "issue.created", payload: {}, timestamp: 0 },
 *   meegoProjectId: "project_xxx",
 *   description: "PRD → 技术方案",
 *   triggerType: "frontend_dev",
 *   agentRole: "architect",
 *   worktreePath: "/tmp/wt",
 *   assigneeId: "user-001",
 *   subtasks: [],
 * };
 * ```
 */
export interface ComplexTask extends TaskConfig {
  /** 子任务列表（DAG 节点） */
  subtasks: TaskConfig[];
}
