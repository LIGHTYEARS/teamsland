// @teamsland/server — Sidecar 进程管理初始化模块

import type { LarkNotifier } from "@teamsland/lark";
import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import { ObservableMessageBus, ProcessController, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import type { AppConfig } from "@teamsland/types";

/**
 * Sidecar 初始化结果
 *
 * @example
 * ```typescript
 * import type { SidecarResult } from "./sidecar.js";
 *
 * const sidecar: SidecarResult = await initSidecar(config, notifier, sessionDb, logger);
 * sidecar.registry.allRunning();
 * ```
 */
export interface SidecarResult {
  /** 进程控制器 */
  processController: ProcessController;
  /** Agent 注册表 */
  registry: SubagentRegistry;
  /** 可观测消息总线 */
  messageBus: ObservableMessageBus;
  /** Sidecar 数据平面 */
  dataPlane: SidecarDataPlane;
  /** 孤儿清理定时器（可能为 null） */
  orphanTimer: ReturnType<typeof setInterval> | null;
}

/**
 * 初始化 Sidecar 进程管理组件
 *
 * 按顺序初始化以下组件：
 * 1. ProcessController — Claude Code 子进程管理
 * 2. SubagentRegistry — Agent 注册表，含启动恢复
 * 3. ObservableMessageBus — 可观测消息总线
 * 4. SidecarDataPlane — 数据平面（NDJSON 流消费）
 *
 * @param config - 应用配置
 * @param notifier - 飞书通知器（用于 SubagentRegistry 告警）
 * @param sessionDb - 会话数据库（用于 SidecarDataPlane）
 * @param logger - 日志记录器
 * @returns Sidecar 所有组件和孤儿清理定时器
 *
 * @example
 * ```typescript
 * import { initSidecar } from "./init/sidecar.js";
 *
 * const sidecar = await initSidecar(config, notifier, sessionDb, logger);
 * logger.info({ running: sidecar.registry.runningCount() }, "Sidecar 就绪");
 * ```
 */
export async function initSidecar(
  config: AppConfig,
  notifier: LarkNotifier,
  sessionDb: SessionDB,
  logger: ReturnType<typeof createLogger>,
): Promise<SidecarResult> {
  // ProcessController
  const processController = new ProcessController({ logger });

  // SubagentRegistry
  const registry = new SubagentRegistry({
    config: config.sidecar,
    notifier,
    logger,
  });
  const orphanTimer = await registry.restoreOnStartup();
  logger.info("SubagentRegistry 启动恢复完成");

  // ObservableMessageBus
  const messageBus = new ObservableMessageBus({ logger: createLogger("sidecar:bus") });
  logger.info("ObservableMessageBus 已初始化");

  // SidecarDataPlane
  const dataPlane = new SidecarDataPlane({ registry, sessionDb, logger, messageBus });
  logger.info("SidecarDataPlane 已初始化");

  return { processController, registry, messageBus, dataPlane, orphanTimer };
}
