// @teamsland/server — Dashboard 初始化模块

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import type { IVikingMemoryClient } from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import type { SessionDB } from "@teamsland/session";
import { ClaudeMdInjector, SkillInjector, type SubagentRegistry } from "@teamsland/sidecar";
import type { TicketStore } from "@teamsland/ticket";
import type { AppConfig } from "@teamsland/types";
import type { CoordinatorProcess } from "../coordinator-process.js";
import { startDashboard } from "../dashboard.js";
import { LarkAuthManager } from "../lark-auth.js";
import type { ContextResult } from "./context.js";
import type { LarkResult } from "./lark.js";
import type { SidecarResult } from "./sidecar.js";

/**
 * Dashboard 初始化结果
 *
 * @example
 * ```typescript
 * import type { DashboardResult } from "./dashboard.js";
 *
 * const dashboard: DashboardResult = initDashboard(config, registry, sessionDb, lark, controller, logger, sidecar, context);
 * // 关闭时: dashboard.server.stop();
 * ```
 */
export interface DashboardResult {
  /** Dashboard HTTP/WebSocket 服务实例 */
  server: ReturnType<typeof Bun.serve>;
  /** Lark OAuth 管理器（未启用时为 undefined） */
  authManager: LarkAuthManager | undefined;
  /** 广播队列数据变更到所有 WebSocket 客户端 */
  broadcastQueueUpdate: () => void;
}

/** Worker Skill 名称列表 */
const WORKER_SKILL_NAMES = ["lark-messaging", "teamsland-report"];

/**
 * 构建 SkillInjector 实例
 *
 * 从 `~/.teamsland/worker-template/.claude/skills/` 读取 worker skills（由 npx skills add 安装），
 * 结合 skillRouting 配置构建 SkillInjector。
 */
function buildSkillInjector(config: AppConfig, logger: ReturnType<typeof createLogger>): SkillInjector {
  const skillsBasePath = join(homedir(), ".teamsland", "worker-template", ".claude", "skills");
  const skills = WORKER_SKILL_NAMES.map((name) => ({
    name,
    sourcePath: resolve(skillsBasePath, name),
  }));

  return new SkillInjector({
    skills,
    routing: config.skillRouting,
    coreSkills: ["teamsland-report"],
    logger,
  });
}

/**
 * 初始化 Dashboard HTTP/WebSocket 服务
 *
 * 根据配置决定是否启用 Lark OAuth 认证，
 * 创建 SkillInjector 和 ClaudeMdInjector 实例，
 * 然后调用 `startDashboard` 启动 Bun.serve 服务。
 *
 * @param config - 应用配置
 * @param registry - Agent 注册表
 * @param sessionDb - 会话数据库
 * @param lark - 飞书组件
 * @param controller - 全局 AbortController
 * @param logger - 日志记录器
 * @param sidecar - Sidecar 初始化结果（processController、dataPlane）
 * @param context - 业务上下文结果（worktreeManager）
 * @param hookEngine - Hook 引擎实例（可选，未配置时为 null）
 * @param hookMetricsCollector - Hook 指标收集器（可选，未配置时为 null）
 * @param vikingClient - OpenViking 记忆服务客户端（可选，未配置时为 null）
 * @returns Dashboard 服务实例和认证管理器
 *
 * @example
 * ```typescript
 * import { initDashboard } from "./init/dashboard.js";
 *
 * const dashboard = initDashboard(config, registry, sessionDb, lark, controller, logger, sidecar, context, hookEngine, hookMetricsCollector, vikingClient);
 * logger.info({ port: config.dashboard.port }, "Dashboard 已启动");
 * ```
 */
/** Ticket lifecycle 依赖 */
export interface TicketDeps {
  ticketStore: TicketStore;
  queue: PersistentQueue;
  larkSendDm: (userId: string, text: string) => Promise<void>;
  coordinatorManager?: CoordinatorProcess | null;
}

export function initDashboard(
  config: AppConfig,
  registry: SubagentRegistry,
  sessionDb: SessionDB,
  _lark: LarkResult,
  controller: AbortController,
  logger: ReturnType<typeof createLogger>,
  sidecar: SidecarResult,
  context: ContextResult,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
  vikingClient?: IVikingMemoryClient | null,
  ticketDeps?: TicketDeps,
): DashboardResult {
  const authManager =
    config.dashboard.auth.provider === "lark_oauth"
      ? new LarkAuthManager(config.lark, config.dashboard.auth, `http://localhost:${config.dashboard.port}`)
      : undefined;

  // Skill 注入器
  const skillInjector = buildSkillInjector(config, logger);
  logger.info("SkillInjector 已初始化");

  // CLAUDE.md 任务上下文注入器
  const claudeMdInjector = new ClaudeMdInjector();
  logger.info("ClaudeMdInjector 已初始化");

  const { server, broadcastQueueUpdate } = startDashboard(
    {
      registry,
      sessionDb,
      config: config.dashboard,
      authManager,
      processController: sidecar.processController,
      worktreeManager: context.worktreeManager,
      dataPlane: sidecar.dataPlane,
      skillInjector,
      claudeMdInjector,
      meegoApiBase: config.meego.apiBaseUrl,
      meegoPluginToken: config.meego.pluginAccessToken,
      teamslandApiBase: config.sidecar.teamslandApiBase ?? `http://localhost:${config.dashboard.port}`,
      hookEngine,
      hookMetricsCollector,
      appConfig: config,
      vikingClient,
      interruptController: sidecar.interruptController,
      ticketStore: ticketDeps?.ticketStore,
      queue: ticketDeps?.queue,
      larkSendDm: ticketDeps?.larkSendDm,
      coordinatorManager: ticketDeps?.coordinatorManager,
    },
    controller.signal,
  );

  logger.info({ port: config.dashboard.port }, "Dashboard 服务初始化完成");

  return { server, authManager, broadcastQueueUpdate };
}
