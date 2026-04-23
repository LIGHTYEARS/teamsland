// @teamsland/server — 事件管线初始化模块

import type { HookContext, HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import { LarkConnector } from "@teamsland/lark";
import { MeegoConnector, MeegoEventBus } from "@teamsland/meego";
import type { IVikingMemoryClient } from "@teamsland/memory";
import { TeamMemoryStore } from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { EnqueueOptions } from "@teamsland/queue";
import { PersistentQueue } from "@teamsland/queue";
import type { AppConfig, EnqueueFn, MeegoEvent } from "@teamsland/types";
import { registerEventHandlers, registerQueueConsumer } from "../event-handlers.js";
import type { ContextResult } from "./context.js";
import type { LarkResult } from "./lark.js";
import type { SidecarResult } from "./sidecar.js";
import type { StorageResult } from "./storage.js";
import { TEAM_ID } from "./storage.js";

/**
 * 事件管线初始化结果
 *
 * @example
 * ```typescript
 * import type { EventsResult } from "./init/events.js";
 *
 * const result: EventsResult = await initEvents(config, context, sidecar, storage, lark, controller, logger);
 * result.queue.close();
 * ```
 */
export interface EventsResult {
  /** @deprecated 旧事件总线，双写过渡期保留 */
  eventBus: MeegoEventBus;
  /** 持久化消息队列 */
  queue: PersistentQueue;
}

/**
 * 初始化事件管线（双写模式）
 *
 * 按顺序完成以下步骤：
 * 1. 创建 PersistentQueue
 * 2. 创建 MeegoEventBus（向后兼容）
 * 3. 注册旧 EventBus 处理器 + 新 Queue 消费者（双写）
 *    - 当 Coordinator 启用时，跳过 registerQueueConsumer（由 Coordinator 接管队列消费）
 * 4. 启动 MeegoConnector（同时写入两个路径）
 * 5. 可选启动 LarkConnector（仅写入 Queue 路径）
 *
 * @param config - 应用配置
 * @param context - 业务上下文组件
 * @param sidecar - Sidecar 组件
 * @param storage - 存储层组件
 * @param lark - 飞书组件
 * @param controller - 全局 AbortController
 * @param logger - 日志记录器
 * @param coordinatorEnabled - 是否启用了 Coordinator（启用时跳过 legacy 队列消费者注册）
 * @param hookEngine - Hook 引擎实例（可选，传入时事件先经过 hook 层拦截）
 * @param hookContext - Hook 运行时上下文（hookEngine 存在时必须提供）
 * @param hookMetricsCollector - Hook 指标收集器（hookEngine 存在时必须提供）
 * @param vikingClient - OpenViking 客户端（worker 完成时写回记忆，可选）
 * @returns EventsResult，包含 eventBus 和 queue
 *
 * @example
 * ```typescript
 * import { initEvents } from "./init/events.js";
 *
 * const { eventBus, queue } = await initEvents(config, context, sidecar, storage, lark, controller, logger);
 * ```
 */
export async function initEvents(
  config: AppConfig,
  context: ContextResult,
  sidecar: SidecarResult,
  storage: StorageResult,
  lark: LarkResult,
  controller: AbortController,
  logger: ReturnType<typeof createLogger>,
  coordinatorEnabled = false,
  hookEngine?: HookEngine | null,
  hookContext?: HookContext | null,
  hookMetricsCollector?: HookMetricsCollector | null,
  vikingClient?: IVikingMemoryClient | null,
): Promise<EventsResult> {
  // PersistentQueue
  const queue = new PersistentQueue({
    dbPath: config.queue?.dbPath ?? "data/queue.sqlite",
    busyTimeoutMs: config.queue?.busyTimeoutMs ?? 5000,
    visibilityTimeoutMs: config.queue?.visibilityTimeoutMs ?? 60_000,
    maxRetries: config.queue?.maxRetries ?? 3,
    deadLetterEnabled: config.queue?.deadLetterEnabled ?? true,
    pollIntervalMs: config.queue?.pollIntervalMs ?? 100,
  });

  // MeegoEventBus（双写过渡期保留）
  const eventBus = new MeegoEventBus(storage.eventDb);

  // 事件处理器依赖项
  const deps = {
    processController: sidecar.processController,
    dataPlane: sidecar.dataPlane,
    assembler: context.assembler,
    registry: sidecar.registry,
    worktreeManager: context.worktreeManager,
    notifier: lark.notifier,
    larkCli: lark.larkCli,
    config,
    teamId: TEAM_ID,
    documentParser: context.documentParser,
    memoryStore: storage.memoryStore instanceof TeamMemoryStore ? storage.memoryStore : null,
    extractLoop: context.extractLoop,
    memoryUpdater: context.memoryUpdater,
    confirmationWatcher: context.confirmationWatcher,
    coordinatorManager: null,
    interruptController: sidecar.interruptController ?? null,
    observerController: sidecar.observerController ?? null,
    vikingClient: vikingClient ?? null,
  };

  // 注册旧 EventBus 处理器（双写路径 A）
  registerEventHandlers(eventBus, deps);

  // 注册新 Queue 消费者（双写路径 B）
  // 当 Coordinator 启用时跳过，由 Coordinator 接管队列消费
  if (!coordinatorEnabled) {
    registerQueueConsumer(queue, deps);
  } else {
    logger.info("Coordinator 已启用，跳过 legacy 队列消费者注册");
  }

  // 创建入队函数（含可选 Hook 层拦截）
  const rawEnqueue: EnqueueFn = (opts) => queue.enqueue(opts as EnqueueOptions);

  const enqueue: EnqueueFn =
    hookEngine && hookContext
      ? (opts) => {
          const event = extractEventForHooks(opts);
          if (event) {
            // 异步处理 hook 拦截，同步返回占位消息 ID
            const placeholderId = "hook-intercepted";
            hookEngine
              .processEvent(event, hookContext)
              .then((consumed) => {
                if (consumed) {
                  logger.info({ eventId: event.eventId, type: event.type }, "事件已被 Hook 层消费");
                  return;
                }
                // Hook 未消费，回落到队列
                if (hookMetricsCollector) {
                  hookMetricsCollector.recordTierQueue();
                }
                rawEnqueue(opts);
              })
              .catch((err: unknown) => {
                logger.error({ err, eventId: event.eventId }, "Hook 处理异常，回落到队列");
                if (hookMetricsCollector) {
                  hookMetricsCollector.recordTierQueue();
                }
                rawEnqueue(opts);
              });
            return placeholderId;
          }
          if (hookMetricsCollector) {
            hookMetricsCollector.recordTierQueue();
          }
          return rawEnqueue(opts);
        }
      : rawEnqueue;

  // MeegoConnector（同时写入 EventBus + Queue）
  const connector = new MeegoConnector({ config: config.meego, eventBus, enqueue });
  await connector.start(controller.signal);
  logger.info("MeegoConnector 已启动（双写模式：EventBus + Queue）");

  // LarkConnector（仅写入 Queue 路径）
  if (config.lark.connector?.enabled) {
    const larkConnector = new LarkConnector({
      config: config.lark.connector,
      larkCli: lark.larkCli,
      enqueue,
      historyContextCount: config.lark.bot.historyContextCount,
    });
    await larkConnector.start(controller.signal);
    logger.info("LarkConnector 已启动（Queue 路径）");
  }

  return { eventBus, queue };
}

/**
 * 从入队选项中提取 MeegoEvent，供 Hook 引擎处理
 *
 * 根据 payload 结构尝试提取嵌套的 MeegoEvent 对象。
 * LarkMentionPayload 和 MeegoEventPayload 均包含 `event` 字段。
 * 无法提取时返回 null，由调用方直接入队。
 *
 * @param opts - 入队选项
 * @returns 提取到的 MeegoEvent 或 null
 *
 * @example
 * ```typescript
 * const event = extractEventForHooks({
 *   type: "meego_issue_created",
 *   payload: { event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 } },
 * });
 * // event?.eventId === "e1"
 * ```
 */
function extractEventForHooks(opts: {
  type: string;
  payload: unknown;
  priority?: string;
  traceId?: string;
}): MeegoEvent | null {
  const payload = opts.payload;
  if (!payload || typeof payload !== "object") return null;

  // LarkMentionPayload 和 MeegoEventPayload 都包含 event 字段
  const candidate = payload as Record<string, unknown>;
  const event = candidate.event;
  if (!event || typeof event !== "object") return null;

  const meegoEvent = event as Record<string, unknown>;
  if (
    typeof meegoEvent.eventId === "string" &&
    typeof meegoEvent.issueId === "string" &&
    typeof meegoEvent.projectKey === "string" &&
    typeof meegoEvent.type === "string" &&
    typeof meegoEvent.timestamp === "number"
  ) {
    return meegoEvent as unknown as MeegoEvent;
  }

  return null;
}
