// @teamsland/server — Hook 引擎初始化模块

import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { HookContext, HookEngineConfig } from "@teamsland/hooks";
import { buildHookContext, HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import type { AppConfig, MeegoEvent } from "@teamsland/types";
import type { ContextResult } from "./context.js";
import type { LarkResult } from "./lark.js";
import type { SidecarResult } from "./sidecar.js";

const logger = createLogger("server:init:hooks");

/**
 * 延迟绑定的队列引用
 *
 * 因 Hook 引擎在 PersistentQueue 之前初始化，
 * 通过此容器在队列创建后绑定实际实例。
 *
 * @example
 * ```typescript
 * import type { LazyQueueRef } from "./init/hooks.js";
 *
 * const ref: LazyQueueRef = { current: null };
 * // 队列创建后
 * ref.current = queue;
 * ```
 */
export interface LazyQueueRef {
  /** 当前绑定的 PersistentQueue 实例 */
  current: PersistentQueue | null;
}

/**
 * Hook 引擎初始化结果
 *
 * @example
 * ```typescript
 * import type { HooksResult } from "./init/hooks.js";
 *
 * const hooks: HooksResult = await initHooks(config, lark, sidecar, context, logger);
 * if (hooks.engine) {
 *   hooks.queueRef.current = queue; // 队列创建后绑定
 *   const consumed = await hooks.engine.processEvent(event, hooks.hookContext);
 * }
 * ```
 */
export interface HooksResult {
  /** Hook 引擎（未配置时为 null） */
  engine: HookEngine | null;
  /** Hook 指标收集器（未配置时为 null） */
  metricsCollector: HookMetricsCollector | null;
  /** Hook 运行时上下文（未配置时为 null） */
  hookContext: HookContext | null;
  /** 延迟队列引用，在 PersistentQueue 创建后设置 `.current` */
  queueRef: LazyQueueRef;
}

/**
 * 初始化 Hook 引擎
 *
 * 按顺序完成以下步骤：
 * 1. 检查 hooks 配置是否存在
 * 2. 确保 hooks 目录存在
 * 3. 创建 HookMetricsCollector 和 HookContext（队列通过延迟引用绑定）
 * 4. 创建并启动 HookEngine
 *
 * 因 PersistentQueue 在 initEvents 中创建（晚于 initHooks），
 * hookContext.queue.enqueue 通过 LazyQueueRef 延迟绑定。
 * 调用方需在 PersistentQueue 创建后设置 `result.queueRef.current = queue`。
 *
 * @param config - 应用完整配置
 * @param lark - 飞书组件初始化结果
 * @param sidecar - Sidecar 初始化结果
 * @param context - 业务上下文初始化结果
 * @param parentLogger - 父级日志记录器
 * @returns HooksResult，包含 engine、metricsCollector、hookContext 和 queueRef
 *
 * @example
 * ```typescript
 * import { initHooks } from "./init/hooks.js";
 *
 * const hooks = await initHooks(config, lark, sidecar, context, logger);
 * // 在 initEvents 之后绑定队列
 * hooks.queueRef.current = queue;
 * ```
 */
export async function initHooks(
  config: AppConfig,
  lark: LarkResult,
  sidecar: SidecarResult,
  context: ContextResult,
  parentLogger: ReturnType<typeof createLogger>,
): Promise<HooksResult> {
  const queueRef: LazyQueueRef = { current: null };

  if (!config.hooks) {
    parentLogger.info("Hook 引擎未配置，跳过初始化");
    return { engine: null, metricsCollector: null, hookContext: null, queueRef };
  }

  const hooksDir = resolveHooksDir(config.hooks.hooksDir);

  // 确保 hooks 目录存在
  await mkdir(hooksDir, { recursive: true });

  const engineConfig: HookEngineConfig = {
    hooksDir,
    defaultTimeoutMs: config.hooks.defaultTimeoutMs,
    multiMatch: config.hooks.multiMatch,
  };

  const metricsCollector = new HookMetricsCollector();

  // 构建 HookContext（queue 通过延迟引用绑定）
  // 需要适配器对象，因为实际服务端组件的接口与 HookContextDeps 的最小化接口不完全一致
  const notifierAdapter = {
    sendDm: (userId: string, content: string) => lark.notifier.sendDm(userId, content),
    sendGroupMessage: (chatId: string, content: string) => lark.larkCli.sendGroupMessage(chatId, content),
  };

  const registryAdapter = {
    allRunning: () =>
      sidecar.registry.allRunning().map((r) => ({
        agentId: r.agentId,
        status: r.status,
        issueId: r.issueId,
      })),
    findByIssueId: (issueId: string) =>
      sidecar.registry
        .allRunning()
        .filter((r) => r.issueId === issueId)
        .map((r) => ({ agentId: r.agentId, status: r.status })),
    register: (record: Record<string, unknown>) => {
      sidecar.registry.register(record as never);
    },
  };

  const hookContext = buildHookContext(
    {
      larkCli: lark.larkCli,
      notifier: notifierAdapter,
      processController: sidecar.processController,
      worktreeManager: context.worktreeManager,
      registry: registryAdapter,
      config: config as unknown as Readonly<Record<string, unknown>>,
      queue: {
        enqueue: async (event: MeegoEvent) => {
          if (!queueRef.current) {
            logger.error({ eventId: event.eventId }, "Hook 尝试入队但 PersistentQueue 尚未绑定");
            return;
          }
          queueRef.current.enqueue({
            type: mapEventTypeToQueueType(event.type),
            payload: { event },
            priority: "normal",
            traceId: event.eventId,
          });
        },
      },
    },
    metricsCollector,
  );

  const engine = new HookEngine(engineConfig);
  await engine.start();

  logger.info({ hooksDir, hookCount: engine.size }, "Hook 引擎初始化完成");

  return { engine, metricsCollector, hookContext, queueRef };
}

/**
 * 解析 hooks 目录路径，支持 ~ 前缀展开为 home 目录
 *
 * @param dir - 原始目录路径
 * @returns 展开后的绝对路径
 *
 * @example
 * ```typescript
 * const resolved = resolveHooksDir("~/.teamsland/coordinator/hooks");
 * // => "/Users/xxx/.teamsland/coordinator/hooks"
 * ```
 */
function resolveHooksDir(dir: string): string {
  if (dir.startsWith("~")) {
    return resolve(homedir(), dir.slice(2));
  }
  return resolve(dir);
}

/**
 * 将 MeegoEvent 的 type 映射为 QueueMessageType
 *
 * @param eventType - MeegoEvent 的 type 字段
 * @returns 对应的队列消息类型
 *
 * @example
 * ```typescript
 * const queueType = mapEventTypeToQueueType("issue.created");
 * // => "meego_issue_created"
 * ```
 */
function mapEventTypeToQueueType(
  eventType: string,
): "meego_issue_created" | "meego_issue_status_changed" | "meego_issue_assigned" | "meego_sprint_started" {
  const mapping: Record<
    string,
    "meego_issue_created" | "meego_issue_status_changed" | "meego_issue_assigned" | "meego_sprint_started"
  > = {
    "issue.created": "meego_issue_created",
    "issue.status_changed": "meego_issue_status_changed",
    "issue.assigned": "meego_issue_assigned",
    "sprint.started": "meego_sprint_started",
  };
  const mapped = mapping[eventType];
  if (!mapped) {
    logger.warn({ eventType }, "未知事件类型，回落到 meego_issue_created");
  }
  return mapped ?? "meego_issue_created";
}
