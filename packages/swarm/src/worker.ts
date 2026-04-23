import { createLogger } from "@teamsland/observability";
import type { ComplexTask, SubTask, TaskConfig, WorkerResult } from "@teamsland/types";
import type { SwarmOpts } from "./types.js";

const logger = createLogger("swarm:worker");

/**
 * 从 SubTask + 父任务构建 Worker 所需的 TaskConfig
 *
 * 将子任务的描述、角色映射到 TaskConfig 结构，
 * 其余字段（meegoEvent、meegoProjectId 等）从父任务继承。
 */
function buildTaskConfig(subtask: SubTask, parent: ComplexTask): TaskConfig {
  return {
    issueId: subtask.taskId,
    meegoEvent: parent.meegoEvent,
    meegoProjectId: parent.meegoProjectId,
    description: subtask.description,
    triggerType: parent.triggerType,
    agentRole: subtask.agentRole,
    worktreePath: parent.worktreePath,
    assigneeId: parent.assigneeId,
  };
}

/**
 * @deprecated 将在 Coordinator 架构下被 teamsland CLI 的多 worker spawn 替代。
 * 参见 PRODUCT.md "大脑 + 手脚" 章节。
 *
 * 执行单个 Swarm Worker
 *
 * 通过 DynamicContextAssembler 构建子任务的 Prompt，
 * 通过 ProcessController 启动 Claude Code 子进程。
 * 成功时返回 fulfilled WorkerResult，失败时返回 rejected WorkerResult（不抛出异常）。
 *
 * @param subtask - 当前执行的子任务
 * @param parent - 父复杂任务（提供 meegoEvent、worktreePath 等上下文）
 * @param opts - Swarm 运行选项（注入所有依赖）
 * @returns Worker 执行结果
 *
 * @example
 * ```typescript
 * import { runWorker } from "@teamsland/swarm";
 *
 * const result = await runWorker(
 *   { taskId: "st-1", description: "分析提交记录", agentRole: "代码分析师", dependencies: [] },
 *   complexTask,
 *   opts,
 * );
 * if (result.status === "fulfilled") {
 *   console.log("Worker 完成:", result.taskId);
 * }
 * ```
 */
export async function runWorker(subtask: SubTask, parent: ComplexTask, opts: SwarmOpts): Promise<WorkerResult> {
  logger.info({ taskId: subtask.taskId, role: subtask.agentRole }, "Worker 启动");

  try {
    const taskConfig = buildTaskConfig(subtask, parent);
    const prompt = await opts.assembler.buildInitialPrompt(taskConfig, opts.teamId);

    const spawnResult = await opts.processController.spawn({
      issueId: subtask.taskId,
      worktreePath: parent.worktreePath,
      initialPrompt: prompt,
    });

    logger.info({ taskId: subtask.taskId, pid: spawnResult.pid, sessionId: spawnResult.sessionId }, "Worker 完成");
    return {
      taskId: subtask.taskId,
      status: "fulfilled",
      output: { pid: spawnResult.pid, sessionId: spawnResult.sessionId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ taskId: subtask.taskId, error: message }, "Worker 失败");
    return {
      taskId: subtask.taskId,
      status: "rejected",
      error: message,
    };
  }
}
