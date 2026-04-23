import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { HookContext, HookContextDeps, HookMetrics } from "./types.js";

const logger = createLogger("hooks:context");

/**
 * 构建 HookContext 实例
 *
 * 将服务端依赖组装为 hook handler 可用的上下文对象。
 * 每个 hook handler 调用时共享同一个 HookContext 实例。
 *
 * @param deps - 服务端依赖集合
 * @param metrics - 指标收集器实例
 * @returns 完整的 HookContext 对象
 *
 * @example
 * ```typescript
 * import { buildHookContext } from "@teamsland/hooks";
 *
 * const ctx = buildHookContext(deps, metricsCollector);
 * await ctx.lark.sendGroupMessage("oc_xxx", "Hello");
 * ```
 */
export function buildHookContext(deps: HookContextDeps, metrics: HookMetrics): HookContext {
  return {
    lark: deps.larkCli,
    notifier: deps.notifier,
    spawn: async (opts) => {
      const branchSuffix = `hook-${randomUUID().slice(0, 8)}`;
      const worktreePath = opts.worktreePath ?? (await deps.worktreeManager.create(opts.repo, branchSuffix));
      const issueId = `hook-${randomUUID().slice(0, 8)}`;
      const prompt = [
        "## 任务",
        opts.task,
        "",
        "## 请求者",
        opts.requester,
        opts.chatId ? `\n## 关联群聊\n${opts.chatId}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const result = await deps.processController.spawn({
        issueId,
        worktreePath,
        initialPrompt: prompt,
      });

      const agentId = `hook-agent-${result.sessionId}`;
      deps.registry.register({
        agentId,
        pid: result.pid,
        sessionId: result.sessionId,
        issueId,
        worktreePath,
        status: "running",
        retryCount: 0,
        createdAt: Date.now(),
        origin: {
          source: "coordinator" as const,
          senderId: opts.requester,
          chatId: opts.chatId,
        },
        taskBrief: opts.task.slice(0, 200),
        workerType: "task" as const,
      });

      logger.info({ agentId, issueId, worktreePath }, "Hook 派发 Worker 成功");

      return {
        agentId,
        pid: result.pid,
        sessionId: result.sessionId,
        worktreePath,
      };
    },
    queue: {
      enqueue: async (event) => {
        await deps.queue.enqueue(event);
      },
    },
    registry: deps.registry,
    config: deps.config,
    log: {
      info: (obj, msg) => logger.info(obj, msg),
      warn: (obj, msg) => logger.warn(obj, msg),
      error: (obj, msg) => logger.error(obj, msg),
      debug: (obj, msg) => logger.debug(obj, msg),
    },
    metrics,
  };
}
