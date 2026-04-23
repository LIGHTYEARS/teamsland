/**
 * Worker 拓扑图
 *
 * 描述 coordinator 与 worker 之间的关系拓扑，
 * 用于前端可视化渲染 session 间的协作关系。
 *
 * @example
 * ```ts
 * import type { TopologyGraph } from "@teamsland/types";
 *
 * const graph: TopologyGraph = {
 *   nodes: [
 *     {
 *       id: "node_coord",
 *       type: "coordinator",
 *       sessionId: "sess_001",
 *       status: "running",
 *       label: "主协调器",
 *       metadata: { startedAt: "2026-04-23T09:00:00.000Z" },
 *     },
 *     {
 *       id: "node_worker1",
 *       type: "task_worker",
 *       sessionId: "sess_002",
 *       status: "running",
 *       label: "认证模块 Worker",
 *       taskBrief: "实现 OAuth2 登录流程",
 *       metadata: {
 *         workerId: "worker_01",
 *         requester: "coord_main",
 *         startedAt: "2026-04-23T09:05:00.000Z",
 *       },
 *     },
 *   ],
 *   edges: [
 *     { from: "node_coord", to: "node_worker1", type: "spawned" },
 *   ],
 * };
 * ```
 */
export interface TopologyGraph {
  /** 拓扑图中的所有节点 */
  nodes: TopologyNode[];
  /** 拓扑图中的所有边 */
  edges: TopologyEdge[];
}

/**
 * 拓扑图节点
 *
 * 表示拓扑图中的一个节点，对应一个 coordinator 或 worker session。
 * 包含节点的类型、状态、标签以及关联的元数据。
 *
 * @example
 * ```ts
 * import type { TopologyNode } from "@teamsland/types";
 *
 * const node: TopologyNode = {
 *   id: "node_obs",
 *   type: "observer_worker",
 *   sessionId: "sess_003",
 *   status: "idle",
 *   label: "日志观察者",
 *   metadata: {
 *     workerId: "observer_01",
 *     chatId: "chat_monitor",
 *     startedAt: "2026-04-23T08:00:00.000Z",
 *   },
 * };
 * ```
 */
export interface TopologyNode {
  /** 节点唯一标识 */
  id: string;
  /** 节点类型 */
  type: "coordinator" | "task_worker" | "observer_worker";
  /** 关联的 session ID */
  sessionId: string;
  /** 节点当前状态 */
  status: "running" | "completed" | "failed" | "idle";
  /** 节点显示标签 */
  label: string;
  /** 任务简要描述 */
  taskBrief?: string;
  /** 节点元数据 */
  metadata: {
    /** Worker 标识 */
    workerId?: string;
    /** 请求发起方 */
    requester?: string;
    /** 聊天 ID */
    chatId?: string;
    /** 飞书项目 Issue ID */
    meegoIssueId?: string;
    /** 启动时间（ISO 8601） */
    startedAt?: string;
    /** 完成时间（ISO 8601） */
    completedAt?: string;
  };
}

/**
 * 拓扑图边
 *
 * 表示拓扑图中两个节点之间的有向关系，
 * 描述 coordinator 派生 worker 或 observer 监控的关系。
 *
 * @example
 * ```ts
 * import type { TopologyEdge } from "@teamsland/types";
 *
 * const spawnEdge: TopologyEdge = {
 *   from: "node_coord",
 *   to: "node_worker1",
 *   type: "spawned",
 * };
 *
 * const observeEdge: TopologyEdge = {
 *   from: "node_observer",
 *   to: "node_worker1",
 *   type: "observes",
 * };
 * ```
 */
export interface TopologyEdge {
  /** 起始节点 ID */
  from: string;
  /** 目标节点 ID */
  to: string;
  /** 边类型 */
  type: "spawned" | "observes";
}
