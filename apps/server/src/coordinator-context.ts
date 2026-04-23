// @teamsland/server — Coordinator 上下文加载器（Stub 实现）

import { createLogger } from "@teamsland/observability";
import type { CoordinatorContext, CoordinatorContextLoader, CoordinatorEvent } from "@teamsland/types";

const logger = createLogger("server:coordinator-context");

/**
 * Worker 列表 API 响应结构
 *
 * @example
 * ```typescript
 * const resp: WorkerListResponse = {
 *   workers: [{ workerId: "w-1", status: "running", createdAt: Date.now() }],
 *   total: 1,
 * };
 * ```
 */
interface WorkerListResponse {
  /** Worker 条目列表 */
  workers: Array<{
    workerId: string;
    status: string;
    taskBrief?: string;
    createdAt: number;
  }>;
  /** 总数 */
  total: number;
}

/**
 * Stub 上下文加载器（Phase 2）
 *
 * 通过调用内部 Worker API 获取当前运行中任务的摘要。
 * Phase 3 将替换为 OpenViking 实现，届时补充 recentMessages 和 relevantMemories 的加载。
 *
 * @example
 * ```typescript
 * import { StubContextLoader } from "./coordinator-context.js";
 * import type { CoordinatorEvent } from "@teamsland/types";
 *
 * const loader = new StubContextLoader("http://localhost:3000");
 * const ctx = await loader.load({ type: "lark_mention", id: "e1", timestamp: Date.now(), priority: 1, payload: {} });
 * console.log(ctx.taskStateSummary);
 * ```
 */
export class StubContextLoader implements CoordinatorContextLoader {
  constructor(private readonly serverUrl: string) {}

  /**
   * 根据事件加载上下文
   *
   * 从 server 的 /api/workers 端点拉取在运行 Worker 列表，
   * 格式化为文本摘要。Phase 2 中 recentMessages / relevantMemories 返回空字符串。
   *
   * @param _event - Coordinator 事件（Phase 2 中暂未使用）
   * @returns 上下文信息
   *
   * @example
   * ```typescript
   * const ctx = await loader.load(event);
   * console.log(ctx.taskStateSummary);
   * ```
   */
  async load(_event: CoordinatorEvent): Promise<CoordinatorContext> {
    let taskStateSummary = "";
    try {
      const resp = await fetch(`${this.serverUrl}/api/workers`);
      if (resp.ok) {
        const data = (await resp.json()) as WorkerListResponse;
        if (data.workers.length > 0) {
          taskStateSummary = data.workers
            .map((w) => `- ${w.workerId} [${w.status}] ${w.taskBrief ?? "(无描述)"}`)
            .join("\n");
        }
      }
    } catch (err: unknown) {
      logger.warn({ err }, "获取 Worker 列表失败（将使用空上下文）");
    }

    return {
      taskStateSummary,
      recentMessages: "",
      relevantMemories: "",
    };
  }
}
