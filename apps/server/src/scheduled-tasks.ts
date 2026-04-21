import type { WorktreeManager } from "@teamsland/git";
import type { LarkNotifier } from "@teamsland/lark";
import type { MeegoEventBus } from "@teamsland/meego";
import type { MemoryReaper, TeamMemoryStore } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { AlertNotifier, SubagentRegistry } from "@teamsland/sidecar";
import { Alerter } from "@teamsland/sidecar";

const logger = createLogger("server:scheduler");

/**
 * 启动 Worktree 回收定时任务
 *
 * 定期调用 `WorktreeManager.reap()` 清理过期的 agent worktree。
 * 将 `SubagentRegistry.allRunning()` 作为候选列表传入，默认保留 7 天。
 * 回调内部的错误会被捕获并记录，不会向外抛出。
 *
 * @param worktreeManager - Worktree 管理器实例
 * @param registry - Agent 注册表，用于获取当前运行的 agent 列表
 * @param intervalMs - 执行间隔（毫秒）
 * @returns setInterval 返回的定时器 ID，可用于 clearInterval 停止任务
 *
 * @example
 * ```typescript
 * import { startWorktreeReaper } from "@teamsland/server";
 *
 * const timer = startWorktreeReaper(worktreeManager, registry, 3_600_000);
 * // 关闭时清理
 * clearInterval(timer);
 * ```
 */
export function startWorktreeReaper(
  worktreeManager: WorktreeManager,
  registry: SubagentRegistry,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  logger.info({ intervalMs }, "Worktree 回收任务已启动");

  return setInterval(async () => {
    try {
      const agents = registry.allRunning();
      const results = await worktreeManager.reap(agents, 7);

      let removed = 0;
      let skipped = 0;
      for (const r of results) {
        if (r.action === "removed" || r.action === "auto-committed-and-removed") {
          removed++;
        } else {
          skipped++;
        }
      }

      logger.info({ removed, skipped, total: results.length }, "Worktree 回收完成");
    } catch (err: unknown) {
      logger.error({ err }, "Worktree 回收失败");
    }
  }, intervalMs);
}

/**
 * 启动记忆回收定时任务
 *
 * 定期调用 `MemoryReaper.reap()` 清理过期和低热度的记忆条目。
 * 回调内部的错误会被捕获并记录，不会向外抛出。
 *
 * @param reaper - 记忆回收器实例
 * @param intervalMs - 执行间隔（毫秒）
 * @returns setInterval 返回的定时器 ID，可用于 clearInterval 停止任务
 *
 * @example
 * ```typescript
 * import { startMemoryReaper } from "@teamsland/server";
 *
 * const timer = startMemoryReaper(reaper, 86_400_000);
 * clearInterval(timer);
 * ```
 */
export function startMemoryReaper(reaper: MemoryReaper, intervalMs: number): ReturnType<typeof setInterval> {
  logger.info({ intervalMs }, "记忆回收任务已启动");

  return setInterval(async () => {
    try {
      const stats = await reaper.reap();
      logger.info({ archived: stats.archived, skipped: stats.skipped }, "记忆回收完成");
    } catch (err: unknown) {
      logger.error({ err }, "记忆回收失败");
    }
  }, intervalMs);
}

/**
 * 启动已见事件清扫定时任务
 *
 * 定期调用 `MeegoEventBus.sweepSeenEvents()` 清理过期的已处理事件记录。
 * 默认清理 1 小时前的旧记录。回调内部的错误会被捕获并记录，不会向外抛出。
 *
 * @param eventBus - Meego 事件总线实例
 * @param intervalMs - 执行间隔（毫秒）
 * @returns setInterval 返回的定时器 ID，可用于 clearInterval 停止任务
 *
 * @example
 * ```typescript
 * import { startSeenEventsSweep } from "@teamsland/server";
 *
 * const timer = startSeenEventsSweep(eventBus, 3_600_000);
 * clearInterval(timer);
 * ```
 */
export function startSeenEventsSweep(eventBus: MeegoEventBus, intervalMs: number): ReturnType<typeof setInterval> {
  logger.info({ intervalMs }, "已见事件清扫任务已启动");

  return setInterval(() => {
    try {
      eventBus.sweepSeenEvents();
      logger.info("已见事件清扫完成");
    } catch (err: unknown) {
      logger.error({ err }, "已见事件清扫失败");
    }
  }, intervalMs);
}

/**
 * 启动 FTS5 索引优化定时任务
 *
 * 定期调用 `TeamMemoryStore.optimizeFts5()` 合并 FTS5 索引段以提高查询性能。
 * 回调内部的错误会被捕获并记录，不会向外抛出。
 *
 * @param memoryStore - 团队记忆存储实例
 * @param intervalMs - 执行间隔（毫秒）
 * @returns setInterval 返回的定时器 ID，可用于 clearInterval 停止任务
 *
 * @example
 * ```typescript
 * import { startFts5Optimize } from "@teamsland/server";
 *
 * const timer = startFts5Optimize(memoryStore, 86_400_000);
 * clearInterval(timer);
 * ```
 */
export function startFts5Optimize(memoryStore: TeamMemoryStore, intervalMs: number): ReturnType<typeof setInterval> {
  logger.info({ intervalMs }, "FTS5 优化任务已启动");

  return setInterval(() => {
    try {
      memoryStore.optimizeFts5();
      logger.info("FTS5 索引优化完成");
    } catch (err: unknown) {
      logger.error({ err }, "FTS5 索引优化失败");
    }
  }, intervalMs);
}

/**
 * LarkNotifier → AlertNotifier 适配器
 *
 * 将 Alerter 所需的 `AlertNotifier.sendCard(channelId, card)` 调用
 * 桥接到 `LarkNotifier.sendCard(title, content, level)` 上。
 * channelId 参数被忽略（LarkNotifier 内部已绑定频道）。
 *
 * @example
 * ```typescript
 * const adapter = new LarkAlertAdapter(notifier);
 * const alerter = new Alerter({ notifier: adapter, channelId: "oc_xxx" });
 * ```
 */
class LarkAlertAdapter implements AlertNotifier {
  constructor(private readonly notifier: LarkNotifier) {}

  async sendCard(_channelId: string, card: { title: string; content: string; timestamp: string }): Promise<void> {
    await this.notifier.sendCard(card.title, `${card.content}\n时间: ${card.timestamp}`, "warning");
  }
}

/**
 * 创建健康检查所需的 Alerter 实例
 *
 * 内部使用 LarkAlertAdapter 桥接 LarkNotifier 到 AlertNotifier 接口。
 *
 * @param notifier - 飞书通知器
 * @param channelId - 告警目标频道 ID
 * @returns 配置完成的 Alerter 实例
 *
 * @example
 * ```typescript
 * const alerter = createAlerter(notifier, "oc_team_channel");
 * ```
 */
export function createAlerter(notifier: LarkNotifier, channelId: string): Alerter {
  return new Alerter({ notifier: new LarkAlertAdapter(notifier), channelId });
}

/**
 * 启动健康检查定时任务
 *
 * 定期检查 Agent 并发数是否超过容量阈值（maxConcurrentSessions 的 90%），
 * 超过时通过 Alerter 发送飞书告警卡片。
 * 回调内部的错误会被捕获并记录，不会向外抛出。
 *
 * @param alerter - 告警器实例
 * @param registry - Agent 注册表
 * @param threshold - 告警阈值（建议为 maxConcurrentSessions * 0.9）
 * @param intervalMs - 执行间隔（毫秒）
 * @returns setInterval 返回的定时器 ID，可用于 clearInterval 停止任务
 *
 * @example
 * ```typescript
 * import { startHealthCheck } from "./scheduled-tasks.js";
 *
 * const timer = startHealthCheck(alerter, registry, 18, 60_000);
 * clearInterval(timer);
 * ```
 */
export function startHealthCheck(
  alerter: Alerter,
  registry: SubagentRegistry,
  threshold: number,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  logger.info({ intervalMs, threshold }, "健康检查任务已启动");

  return setInterval(async () => {
    try {
      await alerter.check("concurrent_agents", registry.runningCount(), threshold);
    } catch (err: unknown) {
      logger.error({ err }, "健康检查失败");
    }
  }, intervalMs);
}
