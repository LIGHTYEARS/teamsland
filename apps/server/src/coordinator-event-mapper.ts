import type { QueueMessage } from "@teamsland/queue";
import type { CoordinatorEvent, CoordinatorEventType } from "@teamsland/types";

/**
 * QueueMessageType 到 CoordinatorEventType 的映射表
 *
 * 将队列消息类型转换为 Coordinator 统一事件类型。
 *
 * @example
 * ```typescript
 * const coordType = TYPE_MAP["lark_mention"]; // "lark_mention"
 * ```
 */
const TYPE_MAP: Record<string, CoordinatorEventType> = {
  lark_mention: "lark_mention",
  meego_issue_created: "meego_issue_created",
  meego_issue_assigned: "meego_issue_assigned",
  meego_issue_status_changed: "meego_issue_status_changed",
  meego_sprint_started: "meego_sprint_started",
  worker_completed: "worker_completed",
  worker_anomaly: "worker_anomaly",
  worker_interrupted: "worker_interrupted",
  worker_resumed: "worker_resumed",
  diagnosis_ready: "diagnosis_ready",
};

/**
 * QueueMessageType 到优先级的映射表
 *
 * 数值越小优先级越高：0 = 最高，4 = 最低。
 *
 * @example
 * ```typescript
 * const priority = PRIORITY_MAP["worker_anomaly"]; // 0
 * ```
 */
const PRIORITY_MAP: Record<string, number> = {
  worker_anomaly: 0,
  lark_mention: 1,
  worker_interrupted: 1,
  worker_completed: 2,
  worker_resumed: 2,
  diagnosis_ready: 2,
  meego_issue_created: 3,
  meego_issue_assigned: 4,
  meego_issue_status_changed: 4,
  meego_sprint_started: 4,
};

/** 默认优先级（未知消息类型使用） */
const DEFAULT_PRIORITY = 4;

/** 默认事件类型（未知消息类型回退） */
const DEFAULT_EVENT_TYPE: CoordinatorEventType = "user_query";

/**
 * 将 QueueMessage 扁平化负载为 Record<string, unknown>
 *
 * 根据消息类型提取负载中的关键字段，统一放入扁平结构中。
 *
 * @example
 * ```typescript
 * import type { QueueMessage } from "@teamsland/queue";
 *
 * const msg: QueueMessage = { type: "lark_mention", payload: { chatId: "oc_xxx", senderId: "ou_xxx", messageId: "msg_xxx", event: { ... } }, ... };
 * const flat = flattenPayload(msg);
 * // { chatId: "oc_xxx", senderId: "ou_xxx", messageId: "msg_xxx", message: "...", issueId: "I1", projectKey: "P1" }
 * ```
 */
function flattenPayload(message: QueueMessage): Record<string, unknown> {
  const { type, payload } = message;

  switch (type) {
    case "lark_mention": {
      const p = payload as {
        chatId: string;
        senderId: string;
        messageId: string;
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      // LarkConnector 将消息文本放入 event.payload.title，
      // 将聊天历史上下文放入 event.payload.description
      const eventPayload = p.event.payload;
      const message =
        typeof eventPayload.title === "string"
          ? eventPayload.title
          : typeof eventPayload.description === "string"
            ? eventPayload.description
            : undefined;
      return {
        chatId: p.chatId,
        senderId: p.senderId,
        messageId: p.messageId,
        message,
        chatContext: typeof eventPayload.description === "string" ? eventPayload.description : undefined,
        issueId: p.event.issueId,
        projectKey: p.event.projectKey,
      };
    }
    case "meego_issue_created": {
      const p = payload as {
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      return {
        issueId: p.event.issueId,
        projectKey: p.event.projectKey,
        title: p.event.payload.title,
        description: p.event.payload.description,
      };
    }
    case "meego_issue_assigned": {
      const p = payload as {
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      return {
        issueId: p.event.issueId,
        projectKey: p.event.projectKey,
        assigneeId: p.event.payload.assigneeId,
      };
    }
    case "meego_issue_status_changed": {
      const p = payload as {
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      return {
        issueId: p.event.issueId,
        projectKey: p.event.projectKey,
        status: p.event.payload.status,
        previousStatus: p.event.payload.previousStatus,
      };
    }
    case "meego_sprint_started": {
      const p = payload as {
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      return {
        issueId: p.event.issueId,
        projectKey: p.event.projectKey,
        sprintName: p.event.payload.sprintName,
      };
    }
    case "worker_completed": {
      const p = payload as {
        workerId: string;
        sessionId: string;
        issueId: string;
        resultSummary: string;
      };
      return {
        workerId: p.workerId,
        sessionId: p.sessionId,
        issueId: p.issueId,
        resultSummary: p.resultSummary,
      };
    }
    case "worker_anomaly": {
      const p = payload as {
        workerId: string;
        anomalyType: string;
        details: string;
      };
      return {
        workerId: p.workerId,
        anomalyType: p.anomalyType,
        details: p.details,
      };
    }
    case "diagnosis_ready": {
      const p = payload as {
        targetWorkerId: string;
        observerWorkerId: string;
        report: string;
      };
      return {
        targetWorkerId: p.targetWorkerId,
        observerWorkerId: p.observerWorkerId,
        report: p.report,
      };
    }
    case "worker_interrupted": {
      const p = payload as {
        workerId: string;
        reason: string;
      };
      return {
        workerId: p.workerId,
        reason: p.reason,
      };
    }
    case "worker_resumed": {
      const p = payload as {
        workerId: string;
        predecessorId: string;
      };
      return {
        workerId: p.workerId,
        predecessorId: p.predecessorId,
      };
    }
    default: {
      // 未知类型：尝试将整个 payload 作为 Record 返回
      if (typeof payload === "object" && payload !== null) {
        return { ...payload } as Record<string, unknown>;
      }
      return {};
    }
  }
}

/**
 * 将 QueueMessage 转换为 CoordinatorEvent
 *
 * 执行以下转换：
 * 1. 将 QueueMessageType 映射为 CoordinatorEventType（未知类型回退到 "user_query"）
 * 2. 根据消息类型分配优先级（未知类型默认优先级 4）
 * 3. 将负载扁平化为 Record<string, unknown>
 *
 * @example
 * ```typescript
 * import type { QueueMessage } from "@teamsland/queue";
 * import { toCoordinatorEvent } from "./coordinator-event-mapper.js";
 *
 * const msg: QueueMessage = {
 *   id: "msg-001",
 *   type: "lark_mention",
 *   payload: {
 *     event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *     chatId: "oc_xxx",
 *     senderId: "ou_xxx",
 *     messageId: "msg_xxx",
 *   },
 *   priority: "normal",
 *   status: "pending",
 *   retryCount: 0,
 *   maxRetries: 3,
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   scheduledAt: Date.now(),
 *   traceId: "trace-001",
 * };
 *
 * const event = toCoordinatorEvent(msg);
 * // event.type === "lark_mention"
 * // event.priority === 1
 * // event.payload.chatId === "oc_xxx"
 * ```
 */
export function toCoordinatorEvent(message: QueueMessage): CoordinatorEvent {
  const eventType = TYPE_MAP[message.type] ?? DEFAULT_EVENT_TYPE;
  const priority = PRIORITY_MAP[message.type] ?? DEFAULT_PRIORITY;

  return {
    type: eventType,
    id: message.id,
    timestamp: message.createdAt,
    priority,
    payload: flattenPayload(message),
  };
}
