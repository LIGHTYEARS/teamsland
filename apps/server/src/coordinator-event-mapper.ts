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
  lark_dm: "lark_dm",
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
  lark_dm: 1,
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

// ---------------------------------------------------------------------------
// Per-type payload extractors
// ---------------------------------------------------------------------------

type LarkChatPayload = {
  event: { issueId: string; projectKey: string; payload: Record<string, unknown> };
  chatId: string;
  senderId: string;
  messageId: string;
};

type MeegoEventPayload = {
  event: { issueId: string; projectKey: string; payload: Record<string, unknown> };
};

/** 从 event.payload 中提取消息文本（优先 title，次选 description） */
function extractMessage(eventPayload: Record<string, unknown>): string | undefined {
  if (typeof eventPayload.title === "string") return eventPayload.title;
  if (typeof eventPayload.description === "string") return eventPayload.description;
  return undefined;
}

/** 从 event.payload 中提取聊天上下文（仅当 description 为字符串时） */
function extractChatContext(eventPayload: Record<string, unknown>): string | undefined {
  return typeof eventPayload.description === "string" ? eventPayload.description : undefined;
}

const PAYLOAD_EXTRACTORS: Record<string, (payload: unknown) => Record<string, unknown>> = {
  lark_mention(payload) {
    const p = payload as LarkChatPayload & {
      senderName?: string;
      senderDepartment?: string;
    };
    const ep = p.event.payload;
    return {
      chatId: p.chatId,
      senderId: p.senderId,
      senderName: p.senderName ?? "",
      senderDepartment: p.senderDepartment ?? "",
      messageId: p.messageId,
      message: extractMessage(ep),
      chatContext: extractChatContext(ep),
      issueId: p.event.issueId,
      projectKey: p.event.projectKey,
    };
  },

  lark_dm(payload) {
    const p = payload as LarkChatPayload & {
      senderName: string;
      senderDepartment: string;
    };
    const ep = p.event.payload;
    return {
      chatId: p.chatId,
      senderId: p.senderId,
      senderName: p.senderName,
      senderDepartment: p.senderDepartment,
      messageId: p.messageId,
      message: extractMessage(ep),
      chatContext: extractChatContext(ep),
      chatType: "p2p",
    };
  },

  meego_issue_created(payload) {
    const p = payload as MeegoEventPayload;
    return {
      issueId: p.event.issueId,
      projectKey: p.event.projectKey,
      title: p.event.payload.title,
      description: p.event.payload.description,
    };
  },

  meego_issue_assigned(payload) {
    const p = payload as MeegoEventPayload;
    return {
      issueId: p.event.issueId,
      projectKey: p.event.projectKey,
      assigneeId: p.event.payload.assigneeId,
    };
  },

  meego_issue_status_changed(payload) {
    const p = payload as MeegoEventPayload;
    return {
      issueId: p.event.issueId,
      projectKey: p.event.projectKey,
      status: p.event.payload.status,
      previousStatus: p.event.payload.previousStatus,
    };
  },

  meego_sprint_started(payload) {
    const p = payload as MeegoEventPayload;
    return {
      issueId: p.event.issueId,
      projectKey: p.event.projectKey,
      sprintName: p.event.payload.sprintName,
    };
  },

  worker_completed(payload) {
    const p = payload as { workerId: string; sessionId: string; issueId: string; resultSummary: string };
    return { workerId: p.workerId, sessionId: p.sessionId, issueId: p.issueId, resultSummary: p.resultSummary };
  },

  worker_anomaly(payload) {
    const p = payload as { workerId: string; anomalyType: string; details: string };
    return { workerId: p.workerId, anomalyType: p.anomalyType, details: p.details };
  },

  diagnosis_ready(payload) {
    const p = payload as { targetWorkerId: string; observerWorkerId: string; report: string };
    return { targetWorkerId: p.targetWorkerId, observerWorkerId: p.observerWorkerId, report: p.report };
  },

  worker_interrupted(payload) {
    const p = payload as { workerId: string; reason: string };
    return { workerId: p.workerId, reason: p.reason };
  },

  worker_resumed(payload) {
    const p = payload as { workerId: string; predecessorId: string };
    return { workerId: p.workerId, predecessorId: p.predecessorId };
  },
};

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
  const extractor = PAYLOAD_EXTRACTORS[message.type];
  if (extractor) {
    return extractor(message.payload);
  }
  // 未知类型：尝试将整个 payload 作为 Record 返回
  if (typeof message.payload === "object" && message.payload !== null) {
    return { ...message.payload } as Record<string, unknown>;
  }
  return {};
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
