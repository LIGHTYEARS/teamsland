import type { QueueMessage } from "@teamsland/queue";
import { describe, expect, it } from "vitest";
import { toCoordinatorEvent } from "../coordinator-event-mapper.js";

/**
 * 构建测试用 QueueMessage 的辅助函数
 *
 * @example
 * ```typescript
 * const msg = makeMessage("lark_mention", { chatId: "oc_xxx" });
 * ```
 */
function makeMessage(type: string, payload: Record<string, unknown>, overrides?: Partial<QueueMessage>): QueueMessage {
  return {
    id: "msg-001",
    type: type as QueueMessage["type"],
    payload: payload as unknown as QueueMessage["payload"],
    priority: "normal",
    status: "pending",
    retryCount: 0,
    maxRetries: 3,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    scheduledAt: 1700000000000,
    traceId: "trace-001",
    ...overrides,
  };
}

/** 兼容旧名的别名（与 makeMessage 功能相同） */
const createQueueMessage = makeMessage;

describe("coordinator-event-mapper", () => {
  describe("类型映射", () => {
    it("lark_mention 映射为 lark_mention", () => {
      const msg = makeMessage("lark_mention", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_xxx",
        senderId: "ou_xxx",
        messageId: "msg_xxx",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("lark_mention");
    });

    it("meego_issue_created 映射为 meego_issue_created", () => {
      const msg = makeMessage("meego_issue_created", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.created",
          payload: { title: "测试" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("meego_issue_created");
    });

    it("meego_issue_assigned 映射为 meego_issue_assigned", () => {
      const msg = makeMessage("meego_issue_assigned", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.assigned",
          payload: { assigneeId: "user-1" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("meego_issue_assigned");
    });

    it("meego_issue_status_changed 映射为 meego_issue_status_changed", () => {
      const msg = makeMessage("meego_issue_status_changed", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.status_changed",
          payload: {},
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("meego_issue_status_changed");
    });

    it("meego_sprint_started 映射为 meego_sprint_started", () => {
      const msg = makeMessage("meego_sprint_started", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "sprint.started", payload: {}, timestamp: 0 },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("meego_sprint_started");
    });

    it("worker_completed 映射为 worker_completed", () => {
      const msg = makeMessage("worker_completed", {
        workerId: "w1",
        sessionId: "s1",
        issueId: "I1",
        resultSummary: "完成",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("worker_completed");
    });

    it("worker_anomaly 映射为 worker_anomaly", () => {
      const msg = makeMessage("worker_anomaly", {
        workerId: "w1",
        anomalyType: "timeout",
        details: "超时",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("worker_anomaly");
    });

    it("lark_dm 映射为 lark_dm", () => {
      const msg = makeMessage("lark_dm", {
        event: { eventId: "e1", issueId: "msg_dm", projectKey: "", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("lark_dm");
    });
  });

  describe("优先级映射", () => {
    it("worker_anomaly 优先级为 0（最高）", () => {
      const msg = makeMessage("worker_anomaly", {
        workerId: "w1",
        anomalyType: "crash",
        details: "崩溃",
      });
      expect(toCoordinatorEvent(msg).priority).toBe(0);
    });

    it("lark_mention 优先级为 1", () => {
      const msg = makeMessage("lark_mention", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_xxx",
        senderId: "ou_xxx",
        messageId: "msg_xxx",
      });
      expect(toCoordinatorEvent(msg).priority).toBe(1);
    });

    it("lark_dm 优先级为 1", () => {
      const msg = makeMessage("lark_dm", {
        event: { eventId: "e1", issueId: "msg_dm", projectKey: "", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      expect(toCoordinatorEvent(msg).priority).toBe(1);
    });

    it("worker_completed 优先级为 2", () => {
      const msg = makeMessage("worker_completed", {
        workerId: "w1",
        sessionId: "s1",
        issueId: "I1",
        resultSummary: "完成",
      });
      expect(toCoordinatorEvent(msg).priority).toBe(2);
    });

    it("meego_issue_created 优先级为 3", () => {
      const msg = makeMessage("meego_issue_created", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
      });
      expect(toCoordinatorEvent(msg).priority).toBe(3);
    });

    it("meego_issue_assigned 优先级为 4", () => {
      const msg = makeMessage("meego_issue_assigned", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.assigned", payload: {}, timestamp: 0 },
      });
      expect(toCoordinatorEvent(msg).priority).toBe(4);
    });

    it("meego_issue_status_changed 优先级为 4", () => {
      const msg = makeMessage("meego_issue_status_changed", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.status_changed",
          payload: {},
          timestamp: 0,
        },
      });
      expect(toCoordinatorEvent(msg).priority).toBe(4);
    });

    it("meego_sprint_started 优先级为 4", () => {
      const msg = makeMessage("meego_sprint_started", {
        event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "sprint.started", payload: {}, timestamp: 0 },
      });
      expect(toCoordinatorEvent(msg).priority).toBe(4);
    });
  });

  describe("负载扁平化", () => {
    it("lark_mention 提取 chatId、senderId、messageId 等字段", () => {
      const msg = makeMessage("lark_mention", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.created",
          payload: { title: "帮我看看这个问题" },
          timestamp: 0,
        },
        chatId: "oc_xxx",
        senderId: "ou_xxx",
        messageId: "msg_xxx",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload).toEqual({
        chatId: "oc_xxx",
        senderId: "ou_xxx",
        senderName: "",
        senderDepartment: "",
        messageId: "msg_xxx",
        message: "帮我看看这个问题",
        chatContext: undefined,
        issueId: "I1",
        projectKey: "P1",
      });
    });

    it("lark_mention 无 message 字段时 message 为 undefined", () => {
      const msg = makeMessage("lark_mention", {
        event: {
          eventId: "e1",
          issueId: "I1",
          projectKey: "P1",
          type: "issue.created",
          payload: {},
          timestamp: 0,
        },
        chatId: "oc_xxx",
        senderId: "ou_xxx",
        messageId: "msg_xxx",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.chatId).toBe("oc_xxx");
      expect(event.payload.senderId).toBe("ou_xxx");
      expect(event.payload.messageId).toBe("msg_xxx");
      expect(event.payload.message).toBeUndefined();
    });

    it("lark_dm 提取 chatId、senderId、senderName、senderDepartment、message、chatType", () => {
      const msg = makeMessage("lark_dm", {
        event: {
          eventId: "e1",
          issueId: "msg_dm",
          projectKey: "",
          type: "issue.created",
          payload: { title: "帮我查个问题" },
          timestamp: 0,
        },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload).toEqual({
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
        message: "帮我查个问题",
        chatContext: undefined,
        chatType: "p2p",
      });
    });

    it("meego_issue_created 提取 issueId、projectKey、title、description", () => {
      const msg = makeMessage("meego_issue_created", {
        event: {
          eventId: "e1",
          issueId: "ISSUE-42",
          projectKey: "FE",
          type: "issue.created",
          payload: { title: "新增登录页面", description: "实现 SSO 登录" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload).toEqual({
        issueId: "ISSUE-42",
        projectKey: "FE",
        title: "新增登录页面",
        description: "实现 SSO 登录",
      });
    });

    it("meego_issue_assigned 提取 assigneeId", () => {
      const msg = makeMessage("meego_issue_assigned", {
        event: {
          eventId: "e1",
          issueId: "ISSUE-42",
          projectKey: "FE",
          type: "issue.assigned",
          payload: { assigneeId: "user-001" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.issueId).toBe("ISSUE-42");
      expect(event.payload.projectKey).toBe("FE");
      expect(event.payload.assigneeId).toBe("user-001");
    });

    it("meego_issue_status_changed 提取 newStatus 和 oldStatus", () => {
      const msg = makeMessage("meego_issue_status_changed", {
        event: {
          eventId: "e1",
          issueId: "ISSUE-42",
          projectKey: "FE",
          type: "issue.status_changed",
          payload: { status: "done", previousStatus: "in_progress" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.newStatus).toBe("done");
      expect(event.payload.oldStatus).toBe("in_progress");
    });

    it("meego_sprint_started 提取 sprintName", () => {
      const msg = makeMessage("meego_sprint_started", {
        event: {
          eventId: "e1",
          issueId: "SPRINT-1",
          projectKey: "FE",
          type: "sprint.started",
          payload: { sprintName: "Sprint 23" },
          timestamp: 0,
        },
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.sprintName).toBe("Sprint 23");
      expect(event.payload.projectKey).toBe("FE");
    });

    it("worker_completed 提取 workerId 和 resultSummary", () => {
      const msg = makeMessage("worker_completed", {
        workerId: "worker-001",
        sessionId: "sess-001",
        issueId: "ISSUE-42",
        resultSummary: "登录页面已实现并通过测试",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.workerId).toBe("worker-001");
      expect(event.payload.sessionId).toBe("sess-001");
      expect(event.payload.issueId).toBe("ISSUE-42");
      expect(event.payload.resultSummary).toBe("登录页面已实现并通过测试");
    });

    it("worker_completed: 提取 chatId 和 senderId", () => {
      const msg = createQueueMessage("worker_completed", {
        workerId: "w-1",
        sessionId: "s-1",
        issueId: "ISS-1",
        resultSummary: "done",
        chatId: "oc_xxx",
        senderId: "ou_yyy",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.chatId).toBe("oc_xxx");
      expect(event.payload.senderId).toBe("ou_yyy");
    });

    it("worker_anomaly 提取 workerId、anomalyType、details", () => {
      const msg = makeMessage("worker_anomaly", {
        workerId: "worker-001",
        anomalyType: "timeout",
        details: "Worker 超过 300 秒无响应",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload).toEqual({
        workerId: "worker-001",
        anomalyType: "timeout",
        details: "Worker 超过 300 秒无响应",
      });
    });
  });

  describe("通用字段", () => {
    it("id 来自 message.id", () => {
      const msg = makeMessage(
        "lark_mention",
        {
          event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
          chatId: "oc_xxx",
          senderId: "ou_xxx",
          messageId: "msg_xxx",
        },
        { id: "custom-id-123" },
      );
      const event = toCoordinatorEvent(msg);
      expect(event.id).toBe("custom-id-123");
    });

    it("timestamp 来自 message.createdAt", () => {
      const msg = makeMessage(
        "worker_completed",
        {
          workerId: "w1",
          sessionId: "s1",
          issueId: "I1",
          resultSummary: "完成",
        },
        { createdAt: 1234567890 },
      );
      const event = toCoordinatorEvent(msg);
      expect(event.timestamp).toBe(1234567890);
    });
  });

  describe("未知消息类型", () => {
    it("未知类型回退为 user_query，优先级为 4", () => {
      const msg = makeMessage("unknown_type_xyz" as QueueMessage["type"], {
        someField: "someValue",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("user_query");
      expect(event.priority).toBe(4);
    });

    it("未知类型的负载被完整保留", () => {
      const msg = makeMessage("unknown_type_xyz" as QueueMessage["type"], {
        key1: "value1",
        key2: 42,
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload.key1).toBe("value1");
      expect(event.payload.key2).toBe(42);
    });
  });
});
