import { randomUUID } from "node:crypto";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { WorktreeManager } from "@teamsland/git";
import type { DocumentParser, IntentClassifier } from "@teamsland/ingestion";
import type { LarkCli, LarkNotifier } from "@teamsland/lark";
import type { MeegoEventBus } from "@teamsland/meego";
import type { ExtractLoop, MemoryUpdater, TeamMemoryStore } from "@teamsland/memory";
import { ingestDocument } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { ProcessController, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import { CapacityError } from "@teamsland/sidecar";
import type { TaskPlanner } from "@teamsland/swarm";
import { runSwarm } from "@teamsland/swarm";
import type { AppConfig, ComplexTask, EventHandler, MeegoEvent, TaskConfig } from "@teamsland/types";

const logger = createLogger("server:events");

/** 意图分类的最低置信度阈值，低于此值将跳过处理 */
const CONFIDENCE_THRESHOLD = 0.5;

/** 描述或实体数量超过此阈值时视为复杂任务，使用 Swarm 模式 */
const SWARM_ENTITY_THRESHOLD = 3;

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
 *   intentClassifier: classifier,
 *   processController: controller,
 *   dataPlane: sidecarDataPlane,
 *   assembler: contextAssembler,
 *   registry: subagentRegistry,
 *   worktreeManager: worktreeManager,
 *   notifier: larkNotifier,
 *   larkCli: larkCli,
 *   config: appConfig,
 *   teamId: "team-001",
 *   documentParser: parser,
 *   memoryStore: teamMemoryStore,
 *   extractLoop: loop,
 *   memoryUpdater: updater,
 *   taskPlanner: planner,
 * };
 * ```
 */
export interface EventHandlerDeps {
  /** 意图分类器 */
  intentClassifier: IntentClassifier;
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
  /** 任务拆解器（LLM 未配置时为 null，不启用 Swarm） */
  taskPlanner: TaskPlanner | null;
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
 * import { registerEventHandlers } from "./event-handlers.js";
 * import type { MeegoEventBus } from "@teamsland/meego";
 *
 * declare const bus: MeegoEventBus;
 * declare const deps: EventHandlerDeps;
 *
 * registerEventHandlers(bus, deps);
 * ```
 */
export function registerEventHandlers(bus: MeegoEventBus, deps: EventHandlerDeps): void {
  bus.on("issue.created", createIssueCreatedHandler(deps));
  bus.on("issue.status_changed", createStatusChangedHandler());
  bus.on("issue.assigned", createAssignedHandler(deps));
  bus.on("sprint.started", createSprintStartedHandler());

  logger.info("所有事件处理器注册完成");
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
 * 解析实体中的 owner 名称并通过飞书通知相关人员（fire-and-forget）
 *
 * 对每个 owner 名调用 `LarkCli.contactSearch`，找到对应的 Lark userId 后
 * 发送 DM 通知。同时向团队群发送任务创建通知卡片。
 * 搜索或发送失败时仅记录警告日志，不影响调用方流程。
 *
 * @param deps - 事件处理器依赖项
 * @param event - 原始 Meego 事件
 * @param owners - 从 IntentClassifier 提取的负责人名列表
 *
 * @example
 * ```typescript
 * resolveAndNotifyOwners(deps, event, ["张三", "李四"]);
 * ```
 */
function resolveAndNotifyOwners(deps: EventHandlerDeps, event: MeegoEvent, owners: string[]): void {
  if (owners.length === 0) return;

  const doResolve = async () => {
    for (const owner of owners) {
      const contacts = await deps.larkCli.contactSearch(owner, 1);
      if (contacts.length === 0) {
        logger.debug({ owner, issueId: event.issueId }, "未找到匹配联系人");
        continue;
      }
      const userId = contacts[0].userId;
      await deps.notifier.sendDm(userId, `任务 ${event.issueId}（项目 ${event.projectKey}）与您相关，请关注。`);
      logger.info({ owner, userId, issueId: event.issueId }, "已向相关人员发送 DM");
    }
  };

  doResolve().catch((err: unknown) => {
    logger.warn({ owners, issueId: event.issueId, err }, "联系人解析/通知失败（不影响 Agent 启动）");
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
 * 判断任务是否应使用 Swarm 模式（多 Agent 协作）
 *
 * 条件：TaskPlanner 可用 且 解析出的实体数量 >= SWARM_ENTITY_THRESHOLD。
 *
 * @example
 * ```typescript
 * const useSwarm = shouldUseSwarm(deps, ["UserService", "AuthController", "LoginPage"]);
 * // useSwarm === true (3 个实体 >= 阈值)
 * ```
 */
function shouldUseSwarm(deps: EventHandlerDeps, entities: string[]): boolean {
  return deps.taskPlanner !== null && entities.length >= SWARM_ENTITY_THRESHOLD;
}

/**
 * 以 Swarm 模式执行复杂任务
 *
 * 将 TaskConfig 转换为 ComplexTask，调用 runSwarm 进行多 Agent 协作。
 * 失败时记录错误日志并通过飞书 DM 通知指派人。
 *
 * @example
 * ```typescript
 * await dispatchSwarm(deps, taskConfig);
 * ```
 */
async function dispatchSwarm(deps: EventHandlerDeps, taskConfig: TaskConfig): Promise<void> {
  if (!deps.taskPlanner) return;
  const complexTask: ComplexTask = { ...taskConfig, subtasks: [] };
  const result = await runSwarm(complexTask, {
    planner: deps.taskPlanner,
    registry: deps.registry,
    assembler: deps.assembler,
    processController: deps.processController,
    config: deps.config.sidecar,
    teamId: deps.teamId,
  });
  if (!result.success) {
    logger.warn({ issueId: taskConfig.issueId, failedTaskIds: result.failedTaskIds }, "Swarm 未通过法定人数");
    if (taskConfig.assigneeId) {
      await deps.notifier.sendDm(
        taskConfig.assigneeId,
        `任务 ${taskConfig.issueId} 的 Swarm 协作未完全成功（失败子任务: ${result.failedTaskIds.join(", ")}）`,
      );
    }
  } else {
    logger.info({ issueId: taskConfig.issueId }, "Swarm 任务执行成功");
  }
}

/**
 * 创建 issue.created 事件处理器
 *
 * 完整流水线：意图分类 → worktree 创建 → 文档记忆注入 → 提示词组装 → Agent 进程启动 → 注册表写入。
 * 置信度低于阈值时跳过处理；注册表容量不足时通过飞书 DM 通知。
 */
function createIssueCreatedHandler(deps: EventHandlerDeps): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info({ eventId: event.eventId, issueId: event.issueId }, "处理 issue.created 事件");

        // 1. 文档解析 + 意图分类（解析结果复用于步骤 4.5 记忆注入）
        const rawDescription = extractDescription(event);
        const parsedDocument = rawDescription ? deps.documentParser.parseMarkdown(rawDescription) : null;
        const intentResult = await deps.intentClassifier.classify(event, {
          entities: parsedDocument?.entities,
        });
        logger.info(
          { issueId: event.issueId, intentType: intentResult.type, confidence: intentResult.confidence },
          "意图分类完成",
        );

        if (intentResult.confidence < CONFIDENCE_THRESHOLD) {
          logger.info({ issueId: event.issueId, confidence: intentResult.confidence }, "置信度低于阈值，跳过处理");
          return;
        }

        // 1.5. 联系人解析 + 通知（fire-and-forget, 不阻塞后续流程）
        resolveAndNotifyOwners(deps, event, intentResult.entities.owners);

        // 2. 解析仓库路径
        const repoPath = resolveRepoPath(deps.config, event.projectKey);
        if (!repoPath) {
          logger.warn({ projectKey: event.projectKey, issueId: event.issueId }, "未找到项目对应的仓库映射");
          const assignee = extractAssigneeId(event);
          if (assignee) {
            await deps.notifier.sendDm(
              assignee,
              `任务 ${event.issueId} 无法启动 Agent：项目 ${event.projectKey} 未配置仓库映射，请检查 config.json 的 repoMapping 字段。`,
            );
          }
          return;
        }

        // 3. 创建 worktree
        const worktreePath = await deps.worktreeManager.create(repoPath, event.issueId);
        logger.info({ issueId: event.issueId, worktreePath }, "Git worktree 创建完成");

        // 4. 构建 TaskConfig
        const assigneeId = extractAssigneeId(event);
        const taskConfig: TaskConfig = {
          issueId: event.issueId,
          meegoEvent: event,
          meegoProjectId: event.projectKey,
          description: extractDescription(event),
          triggerType: intentResult.type,
          agentRole: intentResult.type,
          worktreePath,
          assigneeId,
        };

        // agentId 提前计算，供步骤 4.5 和步骤 7 共用
        const agentId = `agent-${event.issueId}-${randomUUID().slice(0, 8)}`;

        // 4.5. 文档解析 + 记忆注入（fire-and-forget, 不阻塞 Agent 启动）
        scheduleMemoryIngestion(deps, event, agentId, parsedDocument);

        // 4.6. 复杂任务检测 → Swarm 分支
        const entities = parsedDocument?.entities ?? [];
        if (shouldUseSwarm(deps, entities)) {
          logger.info({ issueId: event.issueId, entityCount: entities.length }, "检测到复杂任务，使用 Swarm 模式");
          await dispatchSwarm(deps, taskConfig);
          return;
        }

        // 5. 组装初始提示词（单 Agent 路径）
        const prompt = await deps.assembler.buildInitialPrompt(taskConfig, deps.teamId);
        logger.info({ issueId: event.issueId, promptLength: prompt.length }, "初始提示词组装完成");

        // 6. 启动 Agent 子进程
        const spawnResult = await deps.processController.spawn({
          issueId: event.issueId,
          worktreePath,
          initialPrompt: prompt,
        });
        logger.info(
          { issueId: event.issueId, pid: spawnResult.pid, sessionId: spawnResult.sessionId },
          "Agent 子进程已启动",
        );

        // 7. 注册到注册表 + 启动数据平面流
        await registerAgent(deps, {
          agentId,
          pid: spawnResult.pid,
          sessionId: spawnResult.sessionId,
          issueId: event.issueId,
          worktreePath,
          assigneeId,
          stdout: spawnResult.stdout,
        });
      } catch (err: unknown) {
        logger.error({ eventId: event.eventId, issueId: event.issueId, error: err }, "issue.created 处理失败");
      }
    },
  };
}

/**
 * 创建 issue.status_changed 事件处理器
 *
 * 占位实现：记录状态变更事件的日志。
 */
function createStatusChangedHandler(): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info(
          {
            eventId: event.eventId,
            issueId: event.issueId,
            payload: event.payload,
          },
          "issue.status_changed 事件已接收（占位处理器）",
        );
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
