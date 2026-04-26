import { randomUUID } from "node:crypto";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { WorktreeManager } from "@teamsland/git";
import type { DocumentParser } from "@teamsland/ingestion";
import type { LarkCli, LarkNotifier } from "@teamsland/lark";
import type { ConfirmationWatcher, MeegoEventBus } from "@teamsland/meego";
import type { ExtractLoop, IVikingMemoryClient, MemoryUpdater, TeamMemoryStore } from "@teamsland/memory";
import { ingestDocument } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { LarkMentionPayload, MeegoEventPayload, PersistentQueue, QueueMessage } from "@teamsland/queue";
import type {
  InterruptController,
  ObserverController,
  ProcessController,
  ResumeController,
  SidecarDataPlane,
  SubagentRegistry,
} from "@teamsland/sidecar";
import { CapacityError } from "@teamsland/sidecar";
import type { AppConfig, EventHandler, MeegoEvent, TaskConfig } from "@teamsland/types";
import type { CoordinatorSessionManager } from "./coordinator.js";
import { handleDiagnosisReady } from "./diagnosis-handler.js";
import { handleWorkerAnomaly, handleWorkerCompleted } from "./worker-handlers.js";

const logger = createLogger("server:events");

/**
 * 事件处理器依赖项
 *
 * 由 `registerEventHandlers` 注入的外部服务与配置集合。
 *
 * @example
 * ```typescript
 * import type { EventHandlerDeps } from "./event-handlers.js";
 *
 * const deps: EventHandlerDeps = {
 *   processController: controller,
 *   config: appConfig,
 *   teamId: "team-001",
 *   // ... 其他必填字段
 * };
 * ```
 */
export interface EventHandlerDeps {
  /** Claude Code 子进程控制器 */
  processController: ProcessController;
  /** Sidecar 数据平面 — 消费 Agent 子进程的 NDJSON 流 */
  dataPlane: SidecarDataPlane;
  /** 动态上下文组装器 */
  assembler: DynamicContextAssembler;
  /** Agent 注册表 */
  registry: SubagentRegistry;
  /** Git worktree 管理器 */
  worktreeManager: WorktreeManager;
  /** 飞书通知器 */
  notifier: LarkNotifier;
  /** 飞书 CLI（联系人/群组搜索） */
  larkCli: LarkCli;
  /** 全局应用配置 */
  config: AppConfig;
  /** 团队 ID */
  teamId: string;
  /** 文档解析器 */
  documentParser: DocumentParser;
  /** 团队记忆存储（仅 TeamMemoryStore 时可用于 ingest） */
  memoryStore: TeamMemoryStore | null;
  /** 记忆提取循环（LLM 未配置时为 null） */
  extractLoop: ExtractLoop | null;
  /** 记忆更新器（NullMemoryStore 时为 null） */
  memoryUpdater: MemoryUpdater | null;
  /** 人工确认监视器 */
  confirmationWatcher: ConfirmationWatcher;
  /** Coordinator Session Manager（未启用时为 null） */
  coordinatorManager: CoordinatorSessionManager | null;
  /** 中断控制器（未启用时为 null） */
  interruptController?: InterruptController | null;
  /** 恢复控制器（未启用时为 null） */
  resumeController?: ResumeController | null;
  /** 观察者控制器（未启用时为 null） */
  observerController?: ObserverController | null;
  /** OpenViking client（worker 完成时写回记忆） */
  vikingClient?: IVikingMemoryClient | null;
}

/**
 * 从 repoMapping 配置中解析指定项目对应的第一个仓库路径
 *
 * 如果找不到映射条目或仓库列表为空，返回 undefined。
 */
function resolveRepoPath(config: AppConfig, projectKey: string): string | undefined {
  const entry = config.repoMapping.find((e) => e.meegoProjectId === projectKey);
  if (!entry || entry.repos.length === 0) {
    return undefined;
  }
  return entry.repos[0].path;
}

/**
 * 从事件 payload 中提取 assigneeId（不存在时返回空字符串）
 */
function extractAssigneeId(event: MeegoEvent): string {
  return typeof event.payload.assigneeId === "string" ? event.payload.assigneeId : "";
}

/**
 * 从事件 payload 中提取描述文本
 *
 * 将 payload 的 title 和 description 字段拼接为可读字符串。
 */
function extractDescription(event: MeegoEvent): string {
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const description = typeof event.payload.description === "string" ? event.payload.description : "";
  return [title, description].filter(Boolean).join(" — ");
}

/**
 * 判断事件是否来自飞书群聊 @mention
 *
 * LarkConnector 桥接的事件在 payload 中标记 `source: "lark_mention"`。
 */
function isLarkMention(event: MeegoEvent): boolean {
  return event.payload.source === "lark_mention";
}

/**
 * @deprecated 使用 `registerQueueConsumer` 替代。此函数在双写过渡期保留。
 *
 * 在 MeegoEventBus 上注册所有事件处理器
 *
 * 为 `issue.created`、`issue.status_changed`、`issue.assigned`、`sprint.started`
 * 四种事件类型分别注册对应的处理器。每个处理器内部自带 try/catch，
 * 确保单个处理器的异常不会导致事件总线崩溃。
 *
 * @param bus - Meego 事件总线实例
 * @param deps - 事件处理器依赖项
 *
 * @example
 * ```typescript
 * registerEventHandlers(bus, deps);
 * ```
 */
export function registerEventHandlers(bus: MeegoEventBus, deps: EventHandlerDeps): void {
  bus.on("issue.created", createIssueCreatedHandler(deps));
  bus.on("issue.status_changed", createStatusChangedHandler(deps));
  bus.on("issue.assigned", createAssignedHandler(deps));
  bus.on("sprint.started", createSprintStartedHandler());

  logger.info("所有事件处理器注册完成（EventBus 路径，已标记 deprecated）");
}

/**
 * 注册 PersistentQueue 消费者
 *
 * 将 PersistentQueue 的消费回调注册为事件处理管线。
 * 根据 `msg.type` 分发到对应的处理逻辑，复用现有 handler 实现。
 *
 * @param queue - PersistentQueue 实例
 * @param deps - 事件处理器依赖项
 *
 * @example
 * ```typescript
 * registerQueueConsumer(queue, deps);
 * ```
 */
export function registerQueueConsumer(queue: PersistentQueue, deps: EventHandlerDeps): void {
  const issueCreatedHandler = createIssueCreatedHandler(deps);
  const statusChangedHandler = createStatusChangedHandler(deps);
  const assignedHandler = createAssignedHandler(deps);
  const sprintStartedHandler = createSprintStartedHandler();

  queue.consume(async (msg: QueueMessage) => {
    switch (msg.type) {
      case "lark_mention":
        await handleLarkMentionMessage(msg, issueCreatedHandler, deps);
        break;
      case "meego_issue_created":
        await handleMeegoEventMessage(msg, issueCreatedHandler);
        break;
      case "meego_issue_status_changed":
        await handleMeegoEventMessage(msg, statusChangedHandler);
        break;
      case "meego_issue_assigned":
        await handleMeegoEventMessage(msg, assignedHandler);
        break;
      case "meego_sprint_started":
        await handleMeegoEventMessage(msg, sprintStartedHandler);
        break;
      case "worker_completed":
        await handleWorkerCompleted(msg, deps);
        break;
      case "worker_anomaly":
        await handleWorkerAnomaly(msg, deps);
        break;
      case "diagnosis_ready":
        await handleDiagnosisReady(msg, deps);
        break;
      default:
        logger.warn({ msgId: msg.id, type: msg.type }, "未知的队列消息类型");
    }
  });

  logger.info("PersistentQueue 消费者注册完成");
}

/**
 * 处理 lark_mention 类型的队列消息
 *
 * 从 LarkMentionPayload 中提取 MeegoEvent，补充 chatId / senderId / messageId
 * 到 event.payload，然后委托给 issue.created handler。
 *
 * @example
 * ```typescript
 * await handleLarkMentionMessage(msg, issueCreatedHandler, deps);
 * ```
 */
async function handleLarkMentionMessage(
  msg: QueueMessage,
  handler: EventHandler,
  _deps: EventHandlerDeps,
): Promise<void> {
  const payload = msg.payload as LarkMentionPayload;
  const event = payload.event;
  // 确保 Lark @mention 的聊天上下文信息在 event.payload 中可用
  event.payload.chatId = payload.chatId;
  event.payload.senderId = payload.senderId;
  event.payload.messageId = payload.messageId;
  event.payload.source = "lark_mention";
  logger.info({ msgId: msg.id, eventId: event.eventId }, "队列消费：lark_mention");
  await handler.process(event);
}

/**
 * 处理 Meego 事件类型的队列消息
 *
 * 从 MeegoEventPayload 中提取 MeegoEvent，委托给对应的 handler。
 *
 * @example
 * ```typescript
 * await handleMeegoEventMessage(msg, issueCreatedHandler);
 * ```
 */
async function handleMeegoEventMessage(msg: QueueMessage, handler: EventHandler): Promise<void> {
  const payload = msg.payload as MeegoEventPayload;
  const event = payload.event;
  logger.info({ msgId: msg.id, eventId: event.eventId, type: msg.type }, "队列消费：meego 事件");
  await handler.process(event);
}

/**
 * 解析并异步注入文档到团队记忆（fire-and-forget）
 *
 * 若 memoryStore、extractLoop、memoryUpdater 任一为 null，或 parsedDocument 为 null / 无 sections，则跳过。
 * 失败时记录警告日志，不影响调用方流程。
 *
 * @param deps - 事件处理器依赖项
 * @param event - 触发记忆注入的 MeegoEvent
 * @param agentId - 已分配的 Agent ID，用于关联记忆条目
 * @param parsedDocument - 由调用方预解析的文档结构（复用，避免重复解析）
 *
 * @example
 * ```typescript
 * const parsed = deps.documentParser.parseMarkdown(rawDescription);
 * scheduleMemoryIngestion(deps, event, agentId, parsed);
 * ```
 */
function scheduleMemoryIngestion(
  deps: EventHandlerDeps,
  event: MeegoEvent,
  agentId: string,
  parsedDocument: { sections: Array<{ heading: string; content: string }> } | null,
): void {
  const { memoryStore, extractLoop, memoryUpdater } = deps;
  if (!memoryStore || !extractLoop || !memoryUpdater) {
    return;
  }
  if (!parsedDocument || parsedDocument.sections.length === 0) {
    return;
  }
  const rawDescription = extractDescription(event);
  const docText = parsedDocument.sections.map((s) => `${s.heading}\n${s.content}`).join("\n\n") || rawDescription;
  ingestDocument(docText, deps.teamId, agentId, memoryStore, extractLoop, memoryUpdater).catch((ingestErr: unknown) => {
    logger.warn({ issueId: event.issueId, err: ingestErr }, "文档记忆注入失败（不影响 Agent 启动）");
  });
}

/**
 * 将已启动的 Agent 注册到注册表并启动数据平面流
 *
 * 容量不足时向指派人发送 DM 通知并返回 false；成功返回 true。
 */
async function registerAgent(
  deps: EventHandlerDeps,
  params: {
    agentId: string;
    pid: number;
    sessionId: string;
    issueId: string;
    worktreePath: string;
    assigneeId: string;
    stdout: ReadableStream;
  },
): Promise<boolean> {
  try {
    deps.registry.register({
      agentId: params.agentId,
      pid: params.pid,
      sessionId: params.sessionId,
      issueId: params.issueId,
      worktreePath: params.worktreePath,
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
    });
    logger.info({ agentId: params.agentId, issueId: params.issueId }, "Agent 注册完成");

    deps.dataPlane.processStream(params.agentId, params.stdout).catch((streamErr: unknown) => {
      logger.error({ agentId: params.agentId, issueId: params.issueId, err: streamErr }, "数据平面流处理异常");
    });
    return true;
  } catch (err: unknown) {
    if (err instanceof CapacityError) {
      logger.warn({ current: err.current, max: err.max, issueId: params.issueId }, "Agent 注册表容量已满");
      await deps.notifier.sendDm(
        params.assigneeId || "unknown",
        `任务 ${params.issueId} 无法启动 Agent：当前并发数已满（${err.current}/${err.max}），请稍后重试。`,
      );
      return false;
    }
    throw err;
  }
}

/**
 * 统一的 Agent 启动流程
 *
 * Lark @mention 和 Meego 工单共用的核心启动路径：
 * 解析仓库 → 创建 worktree → 文档解析 + 记忆注入 → 组装提示词 → spawn Agent → 注册。
 * 移除了对 IntentClassifier 的依赖，所有事件源使用相同的直接 spawn 路径。
 *
 * @param deps - 事件处理器依赖项
 * @param event - 触发 Agent 启动的 MeegoEvent
 * @returns Agent 注册结果（成功/失败）及元数据；仓库路径未找到时返回 null
 *
 * @example
 * ```typescript
 * const result = await spawnAgent(deps, event);
 * if (result) {
 *   logger.info({ agentId: result.agentId }, "Agent 启动成功");
 * }
 * ```
 */
async function spawnAgent(
  deps: EventHandlerDeps,
  event: MeegoEvent,
): Promise<{ agentId: string; registered: boolean; description: string } | null> {
  // 1. 解析仓库路径
  const repoPath = resolveRepoPath(deps.config, event.projectKey);
  if (!repoPath) {
    logger.warn({ projectKey: event.projectKey, issueId: event.issueId }, "未找到项目对应的仓库映射");
    return null;
  }

  // 2. 创建 worktree
  const worktreePath = await deps.worktreeManager.create(repoPath, event.issueId);
  logger.info({ issueId: event.issueId, worktreePath }, "Git worktree 创建完成");

  // 3. 构建 TaskConfig（不再依赖 IntentClassifier）
  const description = extractDescription(event);
  const assigneeId = extractAssigneeId(event);
  const triggerType = isLarkMention(event) ? "lark_mention" : "meego_issue";
  const taskConfig: TaskConfig = {
    issueId: event.issueId,
    meegoEvent: event,
    meegoProjectId: event.projectKey,
    description,
    triggerType,
    agentRole: "general",
    worktreePath,
    assigneeId,
  };

  const agentId = `agent-${event.issueId}-${randomUUID().slice(0, 8)}`;

  // 4. 文档解析 + 记忆注入（fire-and-forget, 不阻塞 Agent 启动）
  const rawDescription = extractDescription(event);
  const parsedDocument = rawDescription ? deps.documentParser.parseMarkdown(rawDescription) : null;
  scheduleMemoryIngestion(deps, event, agentId, parsedDocument);

  // 5. 组装初始提示词
  const prompt = await deps.assembler.buildInitialPrompt(taskConfig, deps.teamId);
  logger.info({ issueId: event.issueId, promptLength: prompt.length }, "初始提示词组装完成");

  // 5. 启动 Agent 子进程
  const spawnResult = await deps.processController.spawn({
    issueId: event.issueId,
    worktreePath,
    initialPrompt: prompt,
  });
  logger.info({ issueId: event.issueId, pid: spawnResult.pid, sessionId: spawnResult.sessionId }, "Agent 子进程已启动");

  // 6. 注册到注册表 + 启动数据平面流
  const registered = await registerAgent(deps, {
    agentId,
    pid: spawnResult.pid,
    sessionId: spawnResult.sessionId,
    issueId: event.issueId,
    worktreePath,
    assigneeId,
    stdout: spawnResult.stdout,
  });

  return { agentId, registered, description };
}

/**
 * 仓库映射缺失时发送错误通知
 *
 * 根据事件来源类型选择通知方式：
 * - Lark @mention → 在群聊中回复错误消息
 * - Meego 工单 → 向 assignee 发送飞书 DM
 *
 * @example
 * ```typescript
 * await notifyRepoMappingMissing(deps, event);
 * ```
 */
async function notifyRepoMappingMissing(deps: EventHandlerDeps, event: MeegoEvent): Promise<void> {
  if (isLarkMention(event)) {
    const chatId = typeof event.payload.chatId === "string" ? event.payload.chatId : "";
    const messageId = typeof event.payload.messageId === "string" ? event.payload.messageId : "";
    if (chatId) {
      await deps.larkCli.sendGroupMessage(
        chatId,
        "无法处理：群聊未配置项目映射，请检查 config.json 的 lark.connector.chatProjectMapping。",
        messageId ? { replyToMessageId: messageId } : undefined,
      );
    }
    return;
  }

  const assignee = extractAssigneeId(event);
  if (assignee) {
    await deps.notifier.sendDm(
      assignee,
      `任务 ${event.issueId} 无法启动 Agent：项目 ${event.projectKey} 未配置仓库映射，请检查 config.json 的 repoMapping 字段。`,
    );
  }
}

/**
 * 向飞书群聊发送 Agent 启动确认回复
 *
 * 仅对 Lark @mention 事件生效。失败时仅记录警告日志，不影响 Agent 执行。
 *
 * @example
 * ```typescript
 * await replyLarkMentionConfirmation(deps, event, "帮我查一下 API 性能数据");
 * ```
 */
async function replyLarkMentionConfirmation(
  deps: EventHandlerDeps,
  event: MeegoEvent,
  description: string,
): Promise<void> {
  const chatId = typeof event.payload.chatId === "string" ? event.payload.chatId : "";
  const messageId = typeof event.payload.messageId === "string" ? event.payload.messageId : "";
  if (!chatId) return;

  await deps.larkCli
    .sendGroupMessage(chatId, `收到，正在处理：${description}`, messageId ? { replyToMessageId: messageId } : undefined)
    .catch((replyErr: unknown) => {
      logger.warn({ chatId, messageId, err: replyErr }, "群聊回复失败（不影响 Agent 执行）");
    });
}

/**
 * 创建 issue.created 事件处理器
 *
 * 所有事件源（Lark @mention / Meego 工单）走统一的直接 spawn 路径，
 * 不再经过 IntentClassifier，不再区分 Lark/Meego 双路径分支。
 * Lark @mention 事件在 spawn 后额外回复群聊确认消息。
 *
 * @example
 * ```typescript
 * const handler = createIssueCreatedHandler(deps);
 * await handler.process(event);
 * ```
 */
function createIssueCreatedHandler(deps: EventHandlerDeps): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info(
          { eventId: event.eventId, issueId: event.issueId, source: event.payload.source },
          "处理 issue.created 事件",
        );

        const result = await spawnAgent(deps, event);

        if (!result) {
          await notifyRepoMappingMissing(deps, event);
          return;
        }

        if (isLarkMention(event) && result.registered) {
          await replyLarkMentionConfirmation(deps, event, result.description);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(
          { eventId: event.eventId, issueId: event.issueId, error: err, errorMessage: errMsg },
          "issue.created 处理失败",
        );
      }
    },
  };
}

/**
 * 创建 issue.status_changed 事件处理器
 *
 * 当 payload 中包含 `requiresConfirmation: true` 时，启动 ConfirmationWatcher
 * 对指派人发起确认轮询。确认结果通过飞书 DM 通知。
 * 不需要确认的状态变更仅记录日志。
 */
function createStatusChangedHandler(deps: EventHandlerDeps): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info(
          { eventId: event.eventId, issueId: event.issueId, payload: event.payload },
          "issue.status_changed 事件已接收",
        );

        const requiresConfirmation = event.payload.requiresConfirmation === true;
        if (!requiresConfirmation) return;

        const assigneeId = extractAssigneeId(event);
        if (!assigneeId) {
          logger.warn({ issueId: event.issueId }, "状态变更需要确认但缺少 assigneeId");
          return;
        }

        logger.info({ issueId: event.issueId, assigneeId }, "启动人工确认监控");

        deps.confirmationWatcher
          .watch(event.issueId, assigneeId, event.projectKey)
          .then(async (result) => {
            logger.info({ issueId: event.issueId, result }, "确认监控完成");
            if (result === "timeout") {
              await deps.notifier.sendDm(assigneeId, `任务 ${event.issueId} 确认超时，请联系管理员处理。`);
            }
          })
          .catch((err: unknown) => {
            logger.error({ issueId: event.issueId, err }, "确认监控异常");
          });
      } catch (err: unknown) {
        logger.error({ eventId: event.eventId, error: err }, "issue.status_changed 处理失败");
      }
    },
  };
}

/**
 * 创建 issue.assigned 事件处理器
 *
 * 从 payload 中提取 assigneeId，向被指派人发送飞书 DM 通知。
 */
function createAssignedHandler(deps: EventHandlerDeps): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        const assigneeId = extractAssigneeId(event) || undefined;

        if (!assigneeId) {
          logger.warn({ eventId: event.eventId, issueId: event.issueId }, "issue.assigned 事件缺少 assigneeId");
          return;
        }

        logger.info({ eventId: event.eventId, issueId: event.issueId, assigneeId }, "发送指派通知 DM");
        await deps.notifier.sendDm(
          assigneeId,
          `您已被指派到任务 ${event.issueId}（项目 ${event.projectKey}），请及时跟进。`,
        );
      } catch (err: unknown) {
        logger.error({ eventId: event.eventId, error: err }, "issue.assigned 处理失败");
      }
    },
  };
}

/**
 * 创建 sprint.started 事件处理器
 *
 * 占位实现：记录 Sprint 开始事件的日志。
 */
function createSprintStartedHandler(): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info(
          {
            eventId: event.eventId,
            projectKey: event.projectKey,
            payload: event.payload,
          },
          "sprint.started 事件已接收（占位处理器）",
        );
      } catch (err: unknown) {
        logger.error({ eventId: event.eventId, error: err }, "sprint.started 处理失败");
      }
    },
  };
}
