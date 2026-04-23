// @teamsland/server — Coordinator 初始化模块

import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { AppConfig } from "@teamsland/types";
import { CoordinatorSessionManager } from "../coordinator.js";
import { StubContextLoader } from "../coordinator-context.js";
import { initCoordinatorWorkspace } from "../coordinator-init.js";
import { CoordinatorPromptBuilder } from "../coordinator-prompt.js";
import { WorkerLifecycleMonitor } from "../worker-lifecycle.js";

/**
 * Coordinator 初始化结果
 *
 * @example
 * ```typescript
 * import type { CoordinatorResult } from "./init/coordinator.js";
 *
 * const result: CoordinatorResult = await initCoordinator(config, queue, registry, controller, logger);
 * if (result.manager) {
 *   await result.manager.processEvent(event);
 * }
 * ```
 */
export interface CoordinatorResult {
  /** Coordinator Session Manager（未启用时为 null） */
  manager: CoordinatorSessionManager | null;
  /** Worker 生命周期监控器（未启用时为 null） */
  lifecycleMonitor: WorkerLifecycleMonitor | null;
}

/**
 * 初始化 Coordinator 框架
 *
 * 按顺序完成以下步骤：
 * 1. 检查 Coordinator 是否启用
 * 2. 初始化工作区目录结构和配置文件
 * 3. 创建 Session Manager（含上下文加载器和提示词构建器）
 * 4. 创建并启动 Worker 生命周期监控器
 *
 * @param config - 应用完整配置
 * @param queue - 持久化消息队列
 * @param registry - Agent 注册表
 * @param controller - 全局 AbortController
 * @param parentLogger - 父级日志记录器
 * @returns CoordinatorResult，包含 manager 和 lifecycleMonitor
 *
 * @example
 * ```typescript
 * import { initCoordinator } from "./init/coordinator.js";
 *
 * const coordinator = await initCoordinator(config, queue, registry, controller, logger);
 * if (coordinator.manager) {
 *   queue.consume(async (msg) => {
 *     const event = toCoordinatorEvent(msg);
 *     await coordinator.manager?.processEvent(event);
 *   });
 * }
 * ```
 */
export async function initCoordinator(
  config: AppConfig,
  queue: PersistentQueue,
  registry: SubagentRegistry,
  controller: AbortController,
  parentLogger: ReturnType<typeof createLogger>,
): Promise<CoordinatorResult> {
  if (!config.coordinator?.enabled) {
    parentLogger.info("Coordinator 未启用，跳过初始化");
    return { manager: null, lifecycleMonitor: null };
  }

  const coordConfig = config.coordinator;

  // 1. 初始化工作区
  const workspacePath = await initCoordinatorWorkspace(config);
  parentLogger.info({ workspacePath }, "Coordinator 工作区已初始化");

  // 2. 创建 Session Manager
  const serverUrl = `http://localhost:${config.dashboard.port}`;
  const contextLoader = new StubContextLoader(serverUrl);
  const promptBuilder = new CoordinatorPromptBuilder();

  const manager = new CoordinatorSessionManager({
    config: {
      workspacePath,
      sessionIdleTimeoutMs: coordConfig.sessionIdleTimeoutMs,
      sessionMaxLifetimeMs: coordConfig.sessionMaxLifetimeMs,
      sessionReuseWindowMs: coordConfig.sessionReuseWindowMs,
      maxRecoveryRetries: coordConfig.maxRecoveryRetries,
      inferenceTimeoutMs: coordConfig.inferenceTimeoutMs,
    },
    contextLoader,
    promptBuilder,
  });

  // 3. 创建并启动 Worker 生命周期监控器
  const lifecycleLogger = createLogger("server:worker-lifecycle");
  const workerTimeoutMs = config.sidecar.workerTimeoutSeconds * 1000;
  const lifecycleMonitor = new WorkerLifecycleMonitor(registry, queue, lifecycleLogger, workerTimeoutMs);
  lifecycleMonitor.start(controller.signal);

  parentLogger.info("Coordinator 框架初始化完成");
  return { manager, lifecycleMonitor };
}
