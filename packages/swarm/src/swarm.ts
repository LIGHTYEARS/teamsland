import { createLogger } from "@teamsland/observability";
import type { ComplexTask, SubTask, SwarmResult, WorkerResult } from "@teamsland/types";
import type { SwarmOpts } from "./types.js";
import { runWorker } from "./worker.js";

const logger = createLogger("swarm:orchestrator");

/**
 * @deprecated 将在 Coordinator 架构下被 teamsland CLI 的多 worker spawn 替代。
 * 参见 PRODUCT.md "大脑 + 手脚" 章节。
 *
 * 执行 Swarm 任务编排
 *
 * 完整流程：
 * 1. `planner.decompose(task)` 得到 SubTask[]
 * 2. 拓扑排序，将 SubTask 按依赖分层（每层内可完全并行）
 * 3. 逐层以 `Promise.all` 执行 Worker（runWorker 内部不抛异常）
 * 4. 收集所有层的 WorkerResult
 * 5. 法定人数检查：`fulfilled / total >= minSwarmSuccessRatio`
 * 6. 返回 SwarmResult
 *
 * @param task - 待执行的复杂任务
 * @param opts - Swarm 运行选项（注入所有依赖）
 * @returns Swarm 整体执行结果
 * @throws {Error} 拓扑排序检测到循环依赖或未知依赖时抛出
 *
 * @example
 * ```typescript
 * import { runSwarm } from "@teamsland/swarm";
 *
 * const result = await runSwarm(complexTask, {
 *   planner, registry, assembler, processController, config, teamId: "team-abc",
 * });
 * if (!result.success) {
 *   console.error("Swarm 未通过法定人数", result.failedTaskIds);
 * }
 * ```
 */
export async function runSwarm(task: ComplexTask, opts: SwarmOpts): Promise<SwarmResult> {
  logger.info({ issueId: task.issueId }, "Swarm 启动");

  const subtasks = await opts.planner.decompose(task);

  if (subtasks.length === 0) {
    logger.warn({ issueId: task.issueId }, "Swarm 收到空子任务列表，直接返回成功");
    return { success: true, results: [], failedTaskIds: [] };
  }

  const tiers = topoSort(subtasks);
  logger.info({ issueId: task.issueId, tiers: tiers.length, total: subtasks.length }, "拓扑排序完成");

  const allResults: WorkerResult[] = [];

  for (const tier of tiers) {
    const tierResults = await Promise.all(tier.map((subtask) => runWorker(subtask, task, opts)));
    for (const result of tierResults) {
      allResults.push(result);
    }
  }

  const fulfilled = allResults.filter((r) => r.status === "fulfilled").length;
  const total = allResults.length;
  const ratio = total === 0 ? 1 : fulfilled / total;
  const success = ratio >= opts.config.minSwarmSuccessRatio;
  const failedTaskIds = allResults.filter((r) => r.status === "rejected").map((r) => r.taskId);

  logger.info(
    { issueId: task.issueId, fulfilled, total, ratio, success },
    success ? "Swarm 通过法定人数" : "Swarm 未通过法定人数",
  );

  return { success, results: allResults, failedTaskIds };
}

/**
 * 将 SubTask 列表按依赖关系拓扑排序分层（Kahn BFS）
 *
 * 同一层内的 SubTask 之间无依赖，可完全并行。
 *
 * @param subtasks - 子任务列表
 * @returns 分层后的二维数组
 * @throws {Error} 循环依赖或引用未知 taskId 时抛出
 */
function topoSort(subtasks: SubTask[]): SubTask[][] {
  const idToTask = new Map<string, SubTask>(subtasks.map((s) => [s.taskId, s]));
  const inDegree = buildInDegreeMap(subtasks, idToTask);
  return drainTiers(idToTask, inDegree);
}

/** 构建各节点的入度表，同时校验依赖引用有效性 */
function buildInDegreeMap(subtasks: SubTask[], idToTask: Map<string, SubTask>): Map<string, number> {
  const inDegree = new Map<string, number>(subtasks.map((s) => [s.taskId, 0]));

  for (const subtask of subtasks) {
    for (const dep of subtask.dependencies) {
      if (!idToTask.has(dep)) {
        throw new Error(`topoSort: 未知依赖 ${dep}（来自 subtask ${subtask.taskId}）`);
      }
      inDegree.set(subtask.taskId, (inDegree.get(subtask.taskId) ?? 0) + 1);
    }
  }

  return inDegree;
}

/** 逐层剥离入度为 0 的节点，构建分层结果 */
function drainTiers(idToTask: Map<string, SubTask>, inDegree: Map<string, number>): SubTask[][] {
  const tiers: SubTask[][] = [];
  const remaining = new Set(idToTask.keys());

  while (remaining.size > 0) {
    const tier = collectReadyTasks(remaining, inDegree, idToTask);

    if (tier.length === 0) {
      throw new Error("topoSort: 检测到循环依赖，无法完成拓扑排序");
    }

    tiers.push(tier);
    removeTierAndUpdateDegrees(tier, remaining, inDegree, idToTask);
  }

  return tiers;
}

/** 收集当前层所有入度为 0 的任务 */
function collectReadyTasks(
  remaining: Set<string>,
  inDegree: Map<string, number>,
  idToTask: Map<string, SubTask>,
): SubTask[] {
  const tier: SubTask[] = [];
  for (const id of remaining) {
    if ((inDegree.get(id) ?? 0) === 0) {
      const task = idToTask.get(id);
      if (task) tier.push(task);
    }
  }
  return tier;
}

/** 从 remaining 中移除已完成的层，并更新后继节点入度 */
function removeTierAndUpdateDegrees(
  tier: SubTask[],
  remaining: Set<string>,
  inDegree: Map<string, number>,
  idToTask: Map<string, SubTask>,
): void {
  for (const completed of tier) {
    remaining.delete(completed.taskId);
  }

  for (const completed of tier) {
    for (const candidateId of remaining) {
      if (idToTask.get(candidateId)?.dependencies.includes(completed.taskId)) {
        inDegree.set(candidateId, (inDegree.get(candidateId) ?? 1) - 1);
      }
    }
  }
}
