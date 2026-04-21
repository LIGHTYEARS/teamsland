import { randomUUID } from "node:crypto";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { WorktreeManager } from "@teamsland/git";
import type { IntentClassifier } from "@teamsland/ingestion";
import type { LarkNotifier } from "@teamsland/lark";
import type { MeegoEventBus } from "@teamsland/meego";
import { createLogger } from "@teamsland/observability";
import type { ProcessController, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import { CapacityError } from "@teamsland/sidecar";
import type { AppConfig, EventHandler, MeegoEvent, TaskConfig } from "@teamsland/types";

const logger = createLogger("server:events");

/** 意图分类的最低置信度阈值，低于此值将跳过处理 */
const CONFIDENCE_THRESHOLD = 0.5;

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
 *   config: appConfig,
 *   teamId: "team-001",
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
  /** 全局应用配置 */
  config: AppConfig;
  /** 团队 ID */
  teamId: string;
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
 * 创建 issue.created 事件处理器
 *
 * 完整流水线：意图分类 → worktree 创建 → 提示词组装 → Agent 进程启动 → 注册表写入。
 * 置信度低于阈值时跳过处理；注册表容量不足时通过飞书 DM 通知。
 */
function createIssueCreatedHandler(deps: EventHandlerDeps): EventHandler {
  return {
    async process(event: MeegoEvent): Promise<void> {
      try {
        logger.info({ eventId: event.eventId, issueId: event.issueId }, "处理 issue.created 事件");

        // 1. 意图分类
        const intentResult = await deps.intentClassifier.classify(event);
        logger.info(
          { issueId: event.issueId, intentType: intentResult.type, confidence: intentResult.confidence },
          "意图分类完成",
        );

        if (intentResult.confidence < CONFIDENCE_THRESHOLD) {
          logger.info({ issueId: event.issueId, confidence: intentResult.confidence }, "置信度低于阈值，跳过处理");
          return;
        }

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

        // 5. 组装初始提示词
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

        // 7. 注册到注册表
        const agentId = `agent-${event.issueId}-${randomUUID().slice(0, 8)}`;
        try {
          deps.registry.register({
            agentId,
            pid: spawnResult.pid,
            sessionId: spawnResult.sessionId,
            issueId: event.issueId,
            worktreePath,
            status: "running",
            retryCount: 0,
            createdAt: Date.now(),
          });
          logger.info({ agentId, issueId: event.issueId }, "Agent 注册完成");

          // 8. 启动数据平面流处理（fire-and-forget）
          deps.dataPlane.processStream(agentId, spawnResult.stdout).catch((streamErr: unknown) => {
            logger.error({ agentId, issueId: event.issueId, err: streamErr }, "数据平面流处理异常");
          });
        } catch (err: unknown) {
          if (err instanceof CapacityError) {
            logger.warn({ current: err.current, max: err.max, issueId: event.issueId }, "Agent 注册表容量已满");
            await deps.notifier.sendDm(
              assigneeId || "unknown",
              `任务 ${event.issueId} 无法启动 Agent：当前并发数已满（${err.current}/${err.max}），请稍后重试。`,
            );
            return;
          }
          throw err;
        }
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
