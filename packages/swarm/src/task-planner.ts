import { createLogger } from "@teamsland/observability";
import type { ComplexTask, SubTask } from "@teamsland/types";
import type { LlmClient } from "./types.js";

const logger = createLogger("swarm:planner");

/**
 * @deprecated 将在 Coordinator 架构下被 teamsland CLI 的多 worker spawn 替代。
 * 参见 PRODUCT.md "大脑 + 手脚" 章节。
 *
 * 任务拆解器
 *
 * 将 ComplexTask 委托给 LLM，输出 SubTask[]（有向无环图节点列表）。
 * LlmClient 通过构造函数注入，支持测试时替换 FakeLlmClient。
 *
 * @example
 * ```typescript
 * import { TaskPlanner } from "@teamsland/swarm";
 *
 * const planner = new TaskPlanner({ llm: myLlmClient });
 * const subtasks = await planner.decompose(complexTask);
 * // subtasks[0] => { taskId: "st-1", description: "...", agentRole: "...", dependencies: [] }
 * ```
 */
export class TaskPlanner {
  private readonly llm: LlmClient;

  /**
   * 构造 TaskPlanner
   * @param opts - 注入选项
   * @param opts.llm - LLM 客户端（可注入 FakeLlmClient 用于测试）
   */
  constructor(opts: { llm: LlmClient }) {
    this.llm = opts.llm;
  }

  /**
   * 将复杂任务拆解为有序子任务列表
   *
   * 调用 LLM，要求其返回 JSON 格式的 SubTask[]。
   * SubTask.dependencies 中的 taskId 必须引用同一返回列表中的其他 SubTask。
   *
   * @param task - 待拆解的复杂任务
   * @returns 子任务列表（已通过 JSON 解析验证）
   * @throws {Error} LLM 返回非法 JSON 或结构不符合 SubTask[] 时抛出
   *
   * @example
   * ```typescript
   * const planner = new TaskPlanner({ llm });
   * const subtasks = await planner.decompose(complexTask);
   * console.log(subtasks.length); // e.g. 3
   * ```
   */
  async decompose(task: ComplexTask): Promise<SubTask[]> {
    logger.info({ issueId: task.issueId }, "开始任务拆解");

    const systemPrompt = [
      "你是一个任务拆解专家。",
      "请将用户提供的复杂任务拆解为若干可并行执行的子任务。",
      "输出格式：JSON 数组，每个元素满足以下结构：",
      '  { "taskId": string, "description": string, "agentRole": string, "dependencies": string[] }',
      "要求：",
      "  1. taskId 唯一，格式建议 st-1、st-2……",
      "  2. dependencies 仅引用同一数组中其他 SubTask 的 taskId",
      "  3. 无依赖的 SubTask 的 dependencies 为空数组",
      "  4. 不要输出 JSON 以外的任何文本",
    ].join("\n");

    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: `任务描述：${task.description}` },
    ]);

    const subtasks = parseSubTasks(response.content);
    logger.info({ issueId: task.issueId, count: subtasks.length }, "任务拆解完成");
    return subtasks;
  }
}

/**
 * 解析 LLM 返回的 SubTask JSON
 *
 * 内部辅助函数，不导出。
 * @throws {Error} JSON 解析失败或结构不符时抛出
 */
function parseSubTasks(raw: string): SubTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(`TaskPlanner: LLM 返回非法 JSON — ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("TaskPlanner: LLM 返回值不是数组");
  }

  return parsed.map((item: unknown, index: number) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).taskId !== "string" ||
      typeof (item as Record<string, unknown>).description !== "string" ||
      typeof (item as Record<string, unknown>).agentRole !== "string" ||
      !Array.isArray((item as Record<string, unknown>).dependencies)
    ) {
      throw new Error(`TaskPlanner: 第 ${index} 个子任务结构非法`);
    }
    const rec = item as Record<string, unknown>;
    return {
      taskId: rec.taskId as string,
      description: rec.description as string,
      agentRole: rec.agentRole as string,
      dependencies: rec.dependencies as string[],
    };
  });
}
