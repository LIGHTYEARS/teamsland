// @teamsland/server — 定时任务初始化模块

import type { MeegoEventBus } from "@teamsland/meego";
import { TeamMemoryStore } from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";
import {
  createAlerter,
  startFts5Optimize,
  startHealthCheck,
  startMemoryReaper,
  startSeenEventsSweep,
  startWorktreeReaper,
} from "../scheduled-tasks.js";
import type { ContextResult } from "./context.js";
import type { LarkResult } from "./lark.js";
import type { SidecarResult } from "./sidecar.js";
import type { StorageResult } from "./storage.js";

/**
 * 定时任务初始化结果
 *
 * @example
 * ```typescript
 * import type { ScheduledTasksResult } from "./scheduled-tasks.js";
 *
 * const timers: ScheduledTasksResult = initScheduledTasks(config, storage, sidecar, context, lark, eventBus, logger);
 * // 关闭时清理所有定时器
 * timers.clearAll();
 * ```
 */
export interface ScheduledTasksResult {
  /** 健康检查定时器 */
  healthCheckTimer: ReturnType<typeof setInterval>;
  /** Worktree 回收定时器 */
  worktreeReaperTimer: ReturnType<typeof setInterval>;
  /** 记忆回收定时器（可能为 null） */
  memoryReaperTimer: ReturnType<typeof setInterval> | null;
  /** 已见事件清扫定时器 */
  seenEventsSweepTimer: ReturnType<typeof setInterval>;
  /** FTS5 索引优化定时器（可能为 null） */
  fts5OptimizeTimer: ReturnType<typeof setInterval> | null;
  /** 清理所有定时器的便捷方法 */
  clearAll: () => void;
}

/**
 * 初始化所有定时任务
 *
 * 启动以下定时任务：
 * 1. 健康检查（每分钟）
 * 2. Worktree 回收（每小时）
 * 3. 记忆回收（每天，仅 TeamMemoryStore 可用时）
 * 4. 已见事件清扫（每小时）
 * 5. FTS5 索引优化（按配置间隔，仅 TeamMemoryStore 可用时）
 *
 * @param config - 应用配置
 * @param storage - 存储层组件
 * @param sidecar - Sidecar 组件
 * @param context - 业务上下文组件
 * @param lark - 飞书组件
 * @param eventBus - 事件总线（用于已见事件清扫）
 * @param logger - 日志记录器
 * @returns 所有定时器 ID 和清理方法
 *
 * @example
 * ```typescript
 * import { initScheduledTasks } from "./init/scheduled-tasks.js";
 *
 * const timers = initScheduledTasks(config, storage, sidecar, context, lark, eventBus, logger);
 * // 优雅关闭时
 * timers.clearAll();
 * ```
 */
export function initScheduledTasks(
  config: AppConfig,
  storage: StorageResult,
  sidecar: SidecarResult,
  context: ContextResult,
  lark: LarkResult,
  eventBus: MeegoEventBus,
  logger: ReturnType<typeof createLogger>,
): ScheduledTasksResult {
  const alerter = createAlerter(lark.notifier, config.lark.notification.teamChannelId);

  const healthCheckTimer = startHealthCheck(
    alerter,
    sidecar.registry,
    Math.floor(config.sidecar.maxConcurrentSessions * 0.9),
    60_000,
  );

  const worktreeReaperTimer = startWorktreeReaper(context.worktreeManager, sidecar.registry, 3_600_000);

  const memoryReaperTimer = storage.memoryReaper ? startMemoryReaper(storage.memoryReaper, 86_400_000) : null;

  const seenEventsSweepTimer = startSeenEventsSweep(eventBus, 3_600_000);

  const fts5OptimizeTimer =
    storage.memoryStore instanceof TeamMemoryStore
      ? startFts5Optimize(storage.memoryStore, config.storage.fts5.optimizeIntervalHours * 3_600_000)
      : null;

  logger.info("所有定时任务已启动");

  const clearAll = () => {
    clearInterval(healthCheckTimer);
    clearInterval(worktreeReaperTimer);
    if (memoryReaperTimer) clearInterval(memoryReaperTimer);
    clearInterval(seenEventsSweepTimer);
    if (fts5OptimizeTimer) clearInterval(fts5OptimizeTimer);
  };

  return {
    healthCheckTimer,
    worktreeReaperTimer,
    memoryReaperTimer,
    seenEventsSweepTimer,
    fts5OptimizeTimer,
    clearAll,
  };
}
