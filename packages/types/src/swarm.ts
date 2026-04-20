/**
 * Swarm 子任务
 *
 * 代表 TaskPlanner 拆解后的一个可执行子任务节点。
 * `dependencies` 中的 taskId 必须全部完成后，当前 SubTask 才能开始执行。
 *
 * @example
 * ```typescript
 * import type { SubTask } from "@teamsland/types";
 *
 * const subtask: SubTask = {
 *   taskId: "subtask-001",
 *   description: "分析 Q1 代码提交记录，汇总主要变更模式",
 *   agentRole: "代码分析师",
 *   dependencies: [],
 * };
 * ```
 */
export interface SubTask {
  /** 子任务唯一标识符 */
  taskId: string;
  /** 子任务的自然语言描述 */
  description: string;
  /** 执行该子任务的 Agent 角色定义 */
  agentRole: string;
  /** 前置依赖的子任务 ID 列表；空数组表示无依赖，可立即执行 */
  dependencies: string[];
}

/**
 * Swarm 单个 Worker 的执行结果
 *
 * @example
 * ```typescript
 * import type { WorkerResult } from "@teamsland/types";
 *
 * const result: WorkerResult = {
 *   taskId: "subtask-001",
 *   status: "fulfilled",
 *   output: { summary: "共 47 个提交，主要集中在 packages/memory" },
 * };
 * ```
 */
export interface WorkerResult {
  /** 对应的子任务 ID */
  taskId: string;
  /** 执行状态 */
  status: "fulfilled" | "rejected";
  /** 成功时的输出数据 */
  output?: Record<string, unknown>;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * runSwarm 整体执行结果
 *
 * @example
 * ```typescript
 * import type { SwarmResult } from "@teamsland/types";
 *
 * const result: SwarmResult = {
 *   success: true,
 *   results: [
 *     { taskId: "subtask-001", status: "fulfilled", output: { summary: "..." } },
 *   ],
 *   failedTaskIds: [],
 * };
 * ```
 */
export interface SwarmResult {
  /** 是否通过法定人数检查（fulfilled / total >= minSwarmSuccessRatio） */
  success: boolean;
  /** 所有子任务的执行结果列表 */
  results: WorkerResult[];
  /** 执行失败的子任务 ID 列表 */
  failedTaskIds: string[];
}
