// @teamsland/server — Coordinator 初始化模块

import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import { AnomalyDetector, type SubagentRegistry } from "@teamsland/sidecar";
import type { AppConfig } from "@teamsland/types";
import { CoordinatorSessionManager } from "../coordinator.js";
import { LiveContextLoader } from "../coordinator-context.js";
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
  /** 异常检测器（未启用时为 null） */
  anomalyDetector: AnomalyDetector | null;
}

/**
 * 初始化 Coordinator 框架
 *
 * 按顺序完成以下步骤：
 * 1. 检查 Coordinator 是否启用
 * 2. 初始化工作区目录结构和配置文件
 * 3. 创建 LiveContextLoader（接入注册表和 VikingMemoryClient）
 * 4. 创建 Session Manager（含上下文加载器和提示词构建器）
 * 5. 创建并启动 Worker 生命周期监控器
 *
 * @param config - 应用完整配置
 * @param queue - 持久化消息队列
 * @param registry - Agent 注册表
 * @param controller - 全局 AbortController
 * @param parentLogger - 父级日志记录器
 * @param vikingClient - OpenViking 记忆客户端
 * @returns CoordinatorResult，包含 manager 和 lifecycleMonitor
 *
 * @example
 * ```typescript
 * import { initCoordinator } from "./init/coordinator.js";
 *
 * const coordinator = await initCoordinator(config, queue, registry, controller, logger, vikingClient);
 * if (coordinator.manager) {
 *   await coordinator.manager.processEvent(event);
 * }
 * ```
 */
export async function initCoordinator(
  config: AppConfig,
  queue: PersistentQueue,
  registry: SubagentRegistry,
  controller: AbortController,
  parentLogger: ReturnType<typeof createLogger>,
  vikingClient: IVikingMemoryClient,
): Promise<CoordinatorResult> {
  if (!config.coordinator?.enabled) {
    parentLogger.info("Coordinator 未启用，跳过初始化");
    return { manager: null, lifecycleMonitor: null, anomalyDetector: null };
  }

  // Validate claude binary availability
  const claudePath = Bun.which("claude");
  if (!claudePath) {
    parentLogger.error(
      "claude binary not found in PATH — Coordinator will not be able to spawn sessions. " +
        "Install Claude Code CLI or ensure it is in PATH.",
    );
  }

  const coordConfig = config.coordinator;

  // 1. 初始化工作区
  const workspacePath = await initCoordinatorWorkspace(config);
  parentLogger.info({ workspacePath }, "Coordinator 工作区已初始化");

  // 2. 创建 LiveContextLoader
  const contextLoader = new LiveContextLoader({
    registry,
    vikingClient,
  });
  const promptBuilder = new CoordinatorPromptBuilder();

  // 3. 创建 Session Manager
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

  // 4. 创建并启动 Worker 生命周期监控器
  const lifecycleLogger = createLogger("server:worker-lifecycle");
  const workerTimeoutMs = config.sidecar.workerTimeoutSeconds * 1000;
  const lifecycleMonitor = new WorkerLifecycleMonitor(registry, queue, lifecycleLogger, workerTimeoutMs);
  lifecycleMonitor.start(controller.signal);

  // 5. 创建 AnomalyDetector
  const anomalyDetector = new AnomalyDetector({
    registry,
    workerTimeoutMs: config.sidecar.workerTimeoutSeconds * 1000,
    logger: createLogger("coordinator:anomaly"),
  });

  anomalyDetector.onAnomaly((anomaly) => {
    // 将 AnomalyType 映射到 WorkerAnomalyPayload.anomalyType 的合法值
    const anomalyTypeMap: Record<string, "timeout" | "error_spike" | "stuck" | "crash"> = {
      timeout: "timeout",
      unexpected_exit: "crash",
      high_error_rate: "error_spike",
      inactive: "stuck",
      progress_stall: "stuck",
    };
    const mappedType = anomalyTypeMap[anomaly.type] ?? "crash";

    queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: anomaly.agentId,
        anomalyType: mappedType,
        details: anomaly.details,
      },
      traceId: `anomaly-${anomaly.agentId}-${anomaly.type}`,
      priority: "high",
    });
  });

  // 启动对所有当前运行中 agent 的监控
  for (const agent of registry.allRunning()) {
    anomalyDetector.startMonitoring(agent.agentId);
  }

  parentLogger.info("Coordinator 框架初始化完成（LiveContextLoader 已启用）");
  return { manager, lifecycleMonitor, anomalyDetector };
}
