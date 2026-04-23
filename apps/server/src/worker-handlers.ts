// @teamsland/server — Worker 事件处理器（完成 / 异常）

import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { QueueMessage, WorkerAnomalyPayload, WorkerCompletedPayload } from "@teamsland/queue";
import type { CoordinatorEvent } from "@teamsland/types";
import type { EventHandlerDeps } from "./event-handlers.js";

const logger = createLogger("server:events");

/**
 * 处理 worker_completed 队列消息
 *
 * 从 WorkerCompletedPayload 提取 Worker 执行结果，
 * 注销 Worker 注册表条目，通过 Coordinator 决策后续操作（整理结果 + 通知群聊），
 * 若 Coordinator 未启用则直接走 fallback 通知路径。
 *
 * @example
 * ```typescript
 * await handleWorkerCompleted(msg, deps);
 * ```
 */
export async function handleWorkerCompleted(msg: QueueMessage, deps: EventHandlerDeps): Promise<void> {
  const payload = msg.payload as WorkerCompletedPayload;
  const { workerId, sessionId, issueId, resultSummary } = payload;

  logger.info({ msgId: msg.id, workerId, issueId, sessionId }, "处理 worker_completed 事件");

  deps.registry.unregister(workerId);
  logger.info({ workerId }, "Worker 已从注册表注销");

  // Viking 写回（异步，失败不影响主流程）
  if (deps.vikingClient) {
    writebackToViking(deps.vikingClient, workerId, issueId, resultSummary).catch((err: unknown) => {
      logger.warn({ workerId, err }, "Viking 写回失败");
    });
  }

  if (deps.coordinatorManager) {
    const event: CoordinatorEvent = {
      type: "worker_completed",
      id: msg.id,
      timestamp: msg.createdAt,
      priority: 2,
      payload: {
        workerId,
        sessionId,
        issueId,
        resultSummary,
      },
    };

    try {
      await deps.coordinatorManager.processEvent(event);
      logger.info({ workerId, issueId }, "worker_completed 已提交 Coordinator 处理");
      return;
    } catch (err: unknown) {
      logger.error({ workerId, issueId, err }, "Coordinator 处理 worker_completed 失败，回退到直接通知");
    }
  }

  await notifyWorkerCompleted(deps, workerId, issueId, resultSummary);
}

/**
 * 将 Worker 执行结果写回 OpenViking
 *
 * 将任务状态更新为 completed，将活跃任务文档移至已完成目录，
 * 并通过 Session 提交触发记忆提取。
 * 此函数为 fire-and-forget，失败不影响主流程。
 *
 * @param client - OpenViking 客户端
 * @param workerId - Worker ID
 * @param issueId - 关联的任务 ID
 * @param resultSummary - Worker 执行结果摘要
 *
 * @example
 * ```typescript
 * await writebackToViking(vikingClient, "worker-abc123", "ISSUE-42", "任务已完成：修复了登录页面的 bug");
 * ```
 */
async function writebackToViking(
  client: IVikingMemoryClient,
  workerId: string,
  issueId: string,
  resultSummary: string,
): Promise<void> {
  const taskId = workerId.replace("worker-", "");
  const now = new Date().toISOString();
  const taskMd = [
    `# task-${taskId}`,
    "",
    `- **status**: completed`,
    `- **worker_id**: ${workerId}`,
    `- **updated_at**: ${now}`,
    "",
    "## Brief",
    "",
    issueId,
    "",
    "## Result",
    "",
    resultSummary,
  ].join("\n");

  // 写任务状态到 completed
  const completedUri = `viking://resources/tasks/completed/task-${taskId}.md`;
  const activeUri = `viking://resources/tasks/active/task-${taskId}.md`;
  await client.write(completedUri, taskMd, { mode: "create" });
  await client.rm(activeUri).catch(() => {});

  // Session 提交 → 触发记忆提取
  const sessionId = await client.createSession(`worker-${taskId}`);
  await client.addMessage(sessionId, "user", issueId);
  await client.addMessage(sessionId, "assistant", resultSummary);
  await client.commitSession(sessionId);
}

/**
 * Fallback 通知：Worker 完成后直接向指派人发送飞书 DM
 *
 * 当 Coordinator 未启用或处理失败时使用此路径。
 */
async function notifyWorkerCompleted(
  deps: EventHandlerDeps,
  workerId: string,
  issueId: string,
  resultSummary: string,
): Promise<void> {
  const record = deps.registry.get(workerId);
  const briefSummary = resultSummary.length > 200 ? `${resultSummary.slice(0, 200)}...` : resultSummary;
  const message = `✅ 任务 ${issueId} 已完成\n\nWorker: ${workerId}\n结果: ${briefSummary}`;

  try {
    if (record) {
      const assignee = findAssigneeForIssue(deps, issueId);
      if (assignee) {
        await deps.notifier.sendDm(assignee, message);
        logger.info({ workerId, issueId, assignee }, "worker_completed 通知已发送");
        return;
      }
    }
    logger.info({ workerId, issueId }, "worker_completed 无法确定通知对象，仅记录日志");
  } catch (err: unknown) {
    logger.warn({ workerId, issueId, err }, "worker_completed 通知发送失败");
  }
}

/**
 * 处理 worker_anomaly 队列消息
 *
 * 从 WorkerAnomalyPayload 提取异常信息，
 * 通过 Coordinator 评估严重性并决策后续操作，
 * 若 Coordinator 未启用则直接走 fallback 通知路径。
 *
 * @example
 * ```typescript
 * await handleWorkerAnomaly(msg, deps);
 * ```
 */
export async function handleWorkerAnomaly(msg: QueueMessage, deps: EventHandlerDeps): Promise<void> {
  const payload = msg.payload as WorkerAnomalyPayload;
  const { workerId, anomalyType, details } = payload;

  logger.warn({ msgId: msg.id, workerId, anomalyType, details }, "处理 worker_anomaly 事件");

  if (deps.coordinatorManager) {
    const event: CoordinatorEvent = {
      type: "worker_anomaly",
      id: msg.id,
      timestamp: msg.createdAt,
      priority: 0,
      payload: {
        workerId,
        anomalyType,
        details,
      },
    };

    try {
      await deps.coordinatorManager.processEvent(event);
      logger.info({ workerId, anomalyType }, "worker_anomaly 已提交 Coordinator 处理");
      return;
    } catch (err: unknown) {
      logger.error({ workerId, anomalyType, err }, "Coordinator 处理 worker_anomaly 失败，回退到直接通知");
    }
  }

  // Coordinator 不可用时，尝试自动启动 Observer
  if (deps.observerController) {
    try {
      const result = await deps.observerController.observe({
        targetAgentId: workerId,
        anomalyType,
        mode: "diagnosis",
      });
      logger.info({ observerAgentId: result.observerAgentId, targetWorkerId: workerId }, "已自动启动 Observer 诊断");
      return;
    } catch (observeErr: unknown) {
      logger.error({ err: observeErr, workerId }, "自动启动 Observer 失败，回退到通知");
    }
  }

  await notifyWorkerAnomaly(deps, workerId, anomalyType, details);
}

/**
 * Fallback 通知：Worker 异常后直接向指派人发送飞书 DM 告警
 *
 * 当 Coordinator 未启用或处理失败时使用此路径。
 */
async function notifyWorkerAnomaly(
  deps: EventHandlerDeps,
  workerId: string,
  anomalyType: string,
  details: string,
): Promise<void> {
  const record = deps.registry.get(workerId);
  const issueId = record?.issueId ?? "未知";
  const message = `⚠️ Worker 异常告警\n\nWorker: ${workerId}\n任务: ${issueId}\n异常类型: ${anomalyType}\n详情: ${details}`;

  try {
    const assignee = findAssigneeForIssue(deps, issueId);
    if (assignee) {
      await deps.notifier.sendDm(assignee, message);
      logger.info({ workerId, issueId, assignee, anomalyType }, "worker_anomaly 通知已发送");
      return;
    }
    logger.warn({ workerId, issueId, anomalyType }, "worker_anomaly 无法确定通知对象，仅记录日志");
  } catch (err: unknown) {
    logger.warn({ workerId, issueId, err }, "worker_anomaly 通知发送失败");
  }
}

/**
 * 根据 issueId 从 repoMapping 配置尝试查找相关的 assignee
 *
 * 简单策略：遍历 registry 中的记录，找到 issueId 匹配的 Agent，返回其创建时的 assignee。
 * 当前实现受限于 AgentRecord 不含 assigneeId 字段，
 * 因此返回 config 中默认的 adminUserId（若配置了）。
 */
function findAssigneeForIssue(deps: EventHandlerDeps, _issueId: string): string | undefined {
  const channelId = deps.config.lark?.notification?.teamChannelId;
  return typeof channelId === "string" && channelId.length > 0 ? channelId : undefined;
}
