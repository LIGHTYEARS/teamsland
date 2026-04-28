// @teamsland/server — Coordinator 初始化模块

import { homedir } from "node:os";
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
 * 确保 bytedcli CLI 二进制和对应的 skill 都可用
 *
 * 1. 检查 bytedcli 是否在 PATH 中，不在则通过 npm 全局安装
 * 2. 检查是否已全局安装 bytedcli skill，不在则通过 npx skills -g 安装
 *
 * 安装失败不阻塞启动，仅降级（飞书卡片等功能可能不可用）。
 */
async function ensureBytedcli(parentLogger: ReturnType<typeof createLogger>): Promise<void> {
  const env = { ...process.env, npm_config_registry: "https://bnpm.byted.org" };

  // 1. 确保 bytedcli 二进制可用
  if (Bun.which("bytedcli")) {
    parentLogger.info("bytedcli 已在 PATH 中");
  } else {
    parentLogger.info("bytedcli 未找到，正在安装...");
    const proc = Bun.spawn(["npm", "install", "-g", "@bytedance-dev/bytedcli@latest"], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      parentLogger.warn({ exitCode, stderr }, "bytedcli 安装失败，飞书卡片等功能可能不可用");
    } else {
      parentLogger.info("bytedcli 安装完成");
    }
  }

  // 2. 确保 bytedcli skill 已全局安装（~/.claude/skills/）
  const skillMarker = `${homedir()}/.claude/skills/bytedcli/SKILL.md`;
  const skillExists = await Bun.file(skillMarker).exists();
  if (skillExists) {
    parentLogger.info("bytedcli skill 已安装");
    return;
  }

  parentLogger.info("bytedcli skill 未找到，正在安装...");
  const skillProc = Bun.spawn(
    [
      "npx",
      "skills@latest",
      "add",
      "code.byted.org/byteapi/bytedcli",
      "--skill",
      "bytedcli",
      "--version",
      "1.0.28",
      "-g",
      "-y",
    ],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const skillExitCode = await skillProc.exited;
  if (skillExitCode !== 0) {
    const stderr = await new Response(skillProc.stderr).text();
    parentLogger.warn({ exitCode: skillExitCode, stderr }, "bytedcli skill 安装失败");
  } else {
    parentLogger.info("bytedcli skill 安装完成");
  }
}

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

  // 2. 确保 bytedcli 二进制和 skill 可用（非阻塞 — 失败仅 warn）
  await ensureBytedcli(parentLogger);

  // 3. 创建 LiveContextLoader + PromptBuilder
  const contextLoader = new LiveContextLoader({ registry, vikingClient });
  const promptBuilder = new CoordinatorPromptBuilder();

  // 4. 创建 CoordinatorProcess
  const coordinator = new CoordinatorProcess({
    config: {
      workspacePath,
      sessionMaxLifetimeMs: coordConfig.sessionMaxLifetimeMs ?? 30 * 60 * 1000,
      maxEventsPerSession: coordConfig.maxEventsPerSession ?? 20,
      resultTimeoutMs: coordConfig.resultTimeoutMs ?? coordConfig.inferenceTimeoutMs ?? 5 * 60 * 1000,
    },
    contextLoader,
    promptBuilder,
  });

  // 5. 创建 WorkerManager
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
