// @teamsland/server — Coordinator 初始化模块

import type { LarkNotifier } from "@teamsland/lark";
import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import { type SubagentRegistry, WorkerManager, type WorkerManagerOpts } from "@teamsland/sidecar";
import type { AppConfig } from "@teamsland/types";
import { LiveContextLoader } from "../coordinator-context.js";
import { initCoordinatorWorkspace } from "../coordinator-init.js";
import { CoordinatorProcess } from "../coordinator-process.js";
import { CoordinatorPromptBuilder } from "../coordinator-prompt.js";

const logger = createLogger("init:coordinator");

/**
 * Coordinator 初始化结果
 */
export interface CoordinatorResult {
  /** CoordinatorProcess（未启用时为 null） */
  coordinator: CoordinatorProcess | null;
  /** WorkerManager（未启用时为 null） */
  workerManager: WorkerManager | null;
}

/**
 * 初始化 Coordinator 框架
 *
 * 1. 检查 Coordinator 是否启用
 * 2. 验证 claude binary 可用
 * 3. 初始化工作区
 * 4. 创建 CoordinatorProcess（真同步 processEvent + session 轮转）
 * 5. 创建 WorkerManager（stdout result 信号 + origin tracking）
 */
export async function initCoordinator(
  config: AppConfig,
  queue: PersistentQueue,
  registry: SubagentRegistry,
  _controller: AbortController,
  parentLogger: ReturnType<typeof createLogger>,
  vikingClient: IVikingMemoryClient,
  notifier: LarkNotifier,
): Promise<CoordinatorResult> {
  if (!config.coordinator?.enabled) {
    parentLogger.info("Coordinator 未启用，跳过初始化");
    return { coordinator: null, workerManager: null };
  }

  // Validate claude binary availability
  const claudePath = Bun.which("claude");
  if (!claudePath) {
    parentLogger.error(
      "claude binary not found in PATH — Coordinator will not be able to spawn sessions. " +
        "Install Claude Code CLI or ensure it is in PATH.",
    );
    return { coordinator: null, workerManager: null };
  }

  const coordConfig = config.coordinator;

  // 1. 初始化工作区
  const workspacePath = await initCoordinatorWorkspace(config);
  parentLogger.info({ workspacePath }, "Coordinator 工作区已初始化");

  // 2. 创建 LiveContextLoader + PromptBuilder
  const contextLoader = new LiveContextLoader({ registry, vikingClient });
  const promptBuilder = new CoordinatorPromptBuilder();

  // 3. 创建 CoordinatorProcess
  const coordinator = new CoordinatorProcess({
    config: {
      workspacePath,
      systemPromptPath: `${workspacePath}/CLAUDE.md`,
      allowedTools: [
        "Bash(teamsland *)",
        "Bash(lark-cli *)",
        "Bash(bytedcli *)",
        "Bash(curl *)",
        "Bash(cat *)",
        "Bash(echo *)",
        "Bash(date *)",
        "Read",
      ],
      sessionMaxLifetimeMs: coordConfig.sessionMaxLifetimeMs ?? 30 * 60 * 1000,
      maxEventsPerSession: coordConfig.maxEventsPerSession ?? 20,
      resultTimeoutMs: coordConfig.inferenceTimeoutMs ?? 5 * 60 * 1000,
    },
    contextLoader,
    promptBuilder,
  });

  // 4. 创建 WorkerManager
  const workerManager = new WorkerManager({
    registry,
    queue: queue as unknown as WorkerManagerOpts["queue"],
    notifier,
    workerSystemPromptPath: `${workspacePath}/worker-system.md`,
    defaultAllowedTools: ["Bash(git *)", "Bash(teamsland *)", "Bash(lark-cli *)", "Read", "Edit", "Write"],
    maxBudgetPerWorker: coordConfig.maxBudgetPerWorker ?? 2.0,
  });

  logger.info({ workspacePath }, "Coordinator 初始化完成（CoordinatorProcess + WorkerManager）");
  return { coordinator, workerManager };
}
