import type { CoordinatorContext, CoordinatorEvent } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { CoordinatorPromptBuilder } from "../coordinator-prompt.js";

// ─── 工厂辅助函数 ───

function createEvent(overrides: Partial<CoordinatorEvent> = {}): CoordinatorEvent {
  return {
    type: "lark_mention",
    id: "evt-001",
    timestamp: 1700000000000,
    priority: 1,
    payload: {},
    ...overrides,
  };
}

function createContext(overrides: Partial<CoordinatorContext> = {}): CoordinatorContext {
  return {
    taskStateSummary: "",
    recentMessages: "",
    relevantMemories: "",
    ...overrides,
  };
}

// ─── 测试套件 ───

describe("CoordinatorPromptBuilder", () => {
  const builder = new CoordinatorPromptBuilder();

  describe("系统上下文块", () => {
    it("包含 taskStateSummary 当提供时", () => {
      const context = createContext({ taskStateSummary: "Worker-A 正在执行代码审查" });
      const event = createEvent();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("Worker-A 正在执行代码审查");
      expect(prompt).toContain("### 运行中的 Worker");
    });

    it("显示默认文本当上下文字段为空时", () => {
      const context = createContext();
      const event = createEvent();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("当前没有运行中的 Worker。");
      expect(prompt).toContain("无近期对话记录。");
      expect(prompt).toContain("无相关历史记忆。");
    });

    it("包含当前时间段（ISO 8601）", () => {
      const context = createContext();
      const event = createEvent();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("### 当前时间");
      // ISO 8601 格式包含 T 和 Z
      expect(prompt).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it("包含近期对话和相关记忆", () => {
      const context = createContext({
        recentMessages: "用户：帮我看看 PR #42",
        relevantMemories: "该用户偏好 TypeScript",
      });
      const event = createEvent();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("用户：帮我看看 PR #42");
      expect(prompt).toContain("该用户偏好 TypeScript");
    });
  });

  describe("lark_mention 事件", () => {
    it("输出包含 chatId、message 和 senderId", () => {
      const event = createEvent({
        type: "lark_mention",
        payload: {
          chatId: "oc_test123",
          chatName: "前端开发群",
          senderId: "ou_user001",
          senderName: "张三",
          message: "帮我检查一下登录页面的 Bug",
          messageId: "msg-12345",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("oc_test123");
      expect(prompt).toContain("帮我检查一下登录页面的 Bug");
      expect(prompt).toContain("ou_user001");
      expect(prompt).toContain("msg-12345");
      expect(prompt).toContain("## 新消息");
      expect(prompt).toContain('--origin-chat "oc_test123"');
    });
  });

  describe("meego_issue_created 事件", () => {
    it("输出包含 issueId 和 title", () => {
      const event = createEvent({
        type: "meego_issue_created",
        payload: {
          issueId: "ISSUE-789",
          projectKey: "FE",
          title: "登录页面白屏问题",
          description: "用户反馈登录后页面白屏",
          assigneeId: "ou_dev001",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("ISSUE-789");
      expect(prompt).toContain("登录页面白屏问题");
      expect(prompt).toContain("## 新工单");
      expect(prompt).toContain("FE");
      expect(prompt).toContain("用户反馈登录后页面白屏");
      expect(prompt).toContain("ou_dev001");
    });
  });

  describe("meego_issue_assigned 事件", () => {
    it("输出包含工单指派信息", () => {
      const event = createEvent({
        type: "meego_issue_assigned",
        payload: {
          issueId: "ISSUE-456",
          projectKey: "FE",
          assigneeId: "ou_dev002",
          title: "优化首页加载速度",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## 工单指派");
      expect(prompt).toContain("ISSUE-456");
      expect(prompt).toContain("ou_dev002");
      expect(prompt).toContain("优化首页加载速度");
    });
  });

  describe("worker_completed 事件", () => {
    it("输出包含 workerId 和 resultSummary", () => {
      const event = createEvent({
        type: "worker_completed",
        payload: {
          workerId: "worker-abc123",
          issueId: "ISSUE-789",
          resultSummary: "已修复登录白屏问题，PR #42 已提交",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("worker-abc123");
      expect(prompt).toContain("已修复登录白屏问题，PR #42 已提交");
      expect(prompt).toContain("## Worker 完成");
      expect(prompt).toContain("ISSUE-789");
    });
  });

  describe("worker_anomaly 事件", () => {
    it("输出包含 [优先处理] 标记", () => {
      const event = createEvent({
        type: "worker_anomaly",
        payload: {
          workerId: "worker-err001",
          anomalyType: "crash",
          details: "内存溢出导致进程崩溃",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("[优先处理]");
      expect(prompt).toContain("worker-err001");
      expect(prompt).toContain("crash");
      expect(prompt).toContain("内存溢出导致进程崩溃");
    });
  });

  describe("worker_timeout 事件", () => {
    it("输出包含超时信息", () => {
      const event = createEvent({
        type: "worker_timeout",
        payload: {
          workerId: "worker-timeout001",
          timeoutSeconds: 300,
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## Worker 超时");
      expect(prompt).toContain("worker-timeout001");
      expect(prompt).toContain("300s");
    });
  });

  describe("meego_issue_status_changed 事件", () => {
    it("输出包含状态变更信息", () => {
      const event = createEvent({
        type: "meego_issue_status_changed",
        payload: {
          issueId: "ISSUE-100",
          projectKey: "FE",
          oldStatus: "进行中",
          newStatus: "已完成",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## 工单状态变更");
      expect(prompt).toContain("ISSUE-100");
      expect(prompt).toContain("进行中");
      expect(prompt).toContain("已完成");
    });
  });

  describe("diagnosis_ready 事件", () => {
    it("输出包含诊断信息", () => {
      const event = createEvent({
        type: "diagnosis_ready",
        payload: {
          targetWorkerId: "worker-001",
          observerWorkerId: "observer-001",
          report: "发现 3 个潜在性能瓶颈",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## 诊断报告就绪");
      expect(prompt).toContain("worker-001");
      expect(prompt).toContain("observer-001");
      expect(prompt).toContain("发现 3 个潜在性能瓶颈");
    });
  });

  describe("user_query 事件", () => {
    it("输出包含用户查询信息", () => {
      const event = createEvent({
        type: "user_query",
        payload: {
          query: "当前有多少个 Worker 在运行？",
          userId: "ou_user999",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## 用户查询");
      expect(prompt).toContain("当前有多少个 Worker 在运行？");
      expect(prompt).toContain("ou_user999");
    });
  });

  describe("提示词结构", () => {
    it("系统上下文和事件提示词之间有分隔线", () => {
      const event = createEvent();
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("\n---\n");
    });
  });
});
