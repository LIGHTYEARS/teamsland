/**
 * 发现的项目信息
 *
 * 表示通过 session 发现机制扫描到的一个项目，
 * 包含项目元数据及其关联的 session 列表。
 *
 * @example
 * ```ts
 * import type { DiscoveredProject } from "@teamsland/types";
 *
 * const project: DiscoveredProject = {
 *   name: "teamsland",
 *   path: "/Users/dev/workspace/teamsland",
 *   displayName: "Team AI Collaboration Platform",
 *   sessions: [
 *     {
 *       id: "sess_001",
 *       summary: "重构配置模块",
 *       messageCount: 42,
 *       lastActivity: "2026-04-23T10:30:00.000Z",
 *       cwd: "/Users/dev/workspace/teamsland",
 *       sessionType: "coordinator",
 *     },
 *   ],
 *   sessionMeta: { hasMore: false, total: 1 },
 * };
 * ```
 */
export interface DiscoveredProject {
  /** 编码后的目录名 */
  name: string;
  /** 项目实际路径 */
  path: string;
  /** 显示名称（来自 package.json 或路径片段） */
  displayName: string;
  /** 该项目下已发现的 session 列表 */
  sessions: DiscoveredSession[];
  /** session 分页元信息 */
  sessionMeta: { hasMore: boolean; total: number };
}

/**
 * 发现的 Session 信息
 *
 * 表示单个被发现的 Claude Code session，
 * 包含 session 的基本元数据和类型信息。
 *
 * @example
 * ```ts
 * import type { DiscoveredSession } from "@teamsland/types";
 *
 * const session: DiscoveredSession = {
 *   id: "sess_abc123",
 *   summary: "实现用户认证模块",
 *   messageCount: 87,
 *   lastActivity: "2026-04-23T15:45:00.000Z",
 *   cwd: "/Users/dev/workspace/teamsland",
 *   sessionType: "task_worker",
 *   workerId: "worker_01",
 *   chatId: "chat_xyz",
 * };
 * ```
 */
export interface DiscoveredSession {
  /** Session 唯一标识 */
  id: string;
  /** Session 摘要描述 */
  summary: string;
  /** 消息总数 */
  messageCount: number;
  /** 最后活动时间（ISO 8601） */
  lastActivity: string;
  /** 工作目录 */
  cwd: string;
  /** Session 类型 */
  sessionType?: "coordinator" | "task_worker" | "observer_worker" | "unknown";
  /** Worker 标识 */
  workerId?: string;
  /** 聊天 ID */
  chatId?: string;
}
