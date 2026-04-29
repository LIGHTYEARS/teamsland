import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRow, SessionConfig, TaskConfig } from "@teamsland/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionDB, SessionDbError } from "../session-db.js";

const TEST_CONFIG: SessionConfig = {
  compactionTokenThreshold: 100,
  sqliteJitterRangeMs: [0, 1],
  busyTimeoutMs: 5000,
};

describe("SessionDB", () => {
  let db: SessionDB;
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `session-db-test-${randomUUID()}.sqlite`);
    db = new SessionDB(dbPath, TEST_CONFIG);
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // 文件可能不存在
    }
  });

  describe("constructor", () => {
    it("打开数据库并设置 WAL 模式", () => {
      const testPath = join(tmpdir(), `session-wal-test-${randomUUID()}.sqlite`);
      const testDb = new SessionDB(testPath, TEST_CONFIG);
      // 不抛错即表示成功
      testDb.close();
      try {
        unlinkSync(testPath);
        unlinkSync(`${testPath}-wal`);
        unlinkSync(`${testPath}-shm`);
      } catch {
        // ignore
      }
    });
  });

  describe("Sessions", () => {
    const sessionId = `sess-${randomUUID()}`;
    const teamId = "team-alpha";

    it("createSession 创建新会话", async () => {
      await db.createSession({
        sessionId,
        teamId,
        agentId: "agent-fe",
        projectId: "project_xxx",
        metadata: { source: "test" },
      });

      const row = db.getSession(sessionId);
      expect(row).toBeDefined();
      expect(row?.sessionId).toBe(sessionId);
      expect(row?.teamId).toBe(teamId);
      expect(row?.agentId).toBe("agent-fe");
      expect(row?.projectId).toBe("project_xxx");
      expect(row?.status).toBe("active");
      expect(row?.metadata).toEqual({ source: "test" });
      expect(row?.parentSessionId).toBeNull();
    });

    it("createSession 支持 parentSessionId", async () => {
      const childId = `sess-child-${randomUUID()}`;
      await db.createSession({
        sessionId: childId,
        teamId,
        parentSessionId: sessionId,
      });

      const row = db.getSession(childId);
      expect(row?.parentSessionId).toBe(sessionId);
    });

    it("getSession 返回 undefined 当会话不存在", () => {
      const row = db.getSession("nonexistent");
      expect(row).toBeUndefined();
    });

    it("updateSessionStatus 更新状态", async () => {
      await db.updateSessionStatus(sessionId, "compacted");
      const row = db.getSession(sessionId);
      expect(row?.status).toBe("compacted");
    });

    it("listActiveSessions 按团队过滤", async () => {
      const activeId = `sess-active-${randomUUID()}`;
      await db.createSession({ sessionId: activeId, teamId });

      const sessions = db.listActiveSessions(teamId);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.every((s) => s.teamId === teamId && s.status === "active")).toBe(true);
    });

    it("listActiveSessions 不返回非活跃会话", () => {
      const sessions = db.listActiveSessions(teamId);
      expect(sessions.every((s) => s.status === "active")).toBe(true);
    });

    it("createSession 支持 sessionType, source, originData, summary 字段", async () => {
      const sid = `sess-${randomUUID()}`;
      await db.createSession({
        sessionId: sid,
        teamId: "team-alpha",
        sessionType: "task_worker",
        source: "meego",
        originData: { meegoIssueId: "ISSUE-42", senderId: "ou_user001" },
        summary: "实现用户认证模块",
      });
      const session = db.getSession(sid);
      expect(session).toBeDefined();
      expect(session?.sessionType).toBe("task_worker");
      expect(session?.source).toBe("meego");
      expect(session?.originData).toEqual({ meegoIssueId: "ISSUE-42", senderId: "ou_user001" });
      expect(session?.summary).toBe("实现用户认证模块");
      expect(session?.messageCount).toBe(0);
    });
  });

  describe("Messages", () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = `sess-msg-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-msg" });
    });

    it("appendMessage 返回自增 ID", async () => {
      const id1 = await db.appendMessage({
        sessionId,
        role: "user",
        content: "你好",
      });
      const id2 = await db.appendMessage({
        sessionId,
        role: "assistant",
        content: "你好！有什么可以帮助你的？",
      });

      expect(id1).toBeGreaterThan(0);
      expect(id2).toBe(id1 + 1);
    });

    it("appendMessage 支持 toolName 和 traceId", async () => {
      const id = await db.appendMessage({
        sessionId,
        role: "tool",
        content: '{"result": "ok"}',
        toolName: "git-diff",
        traceId: "trace-001",
      });

      const messages = db.getMessages(sessionId);
      const msg = messages.find((m) => m.id === id);
      expect(msg?.toolName).toBe("git-diff");
      expect(msg?.traceId).toBe("trace-001");
    });

    it("getMessages 按 createdAt 排序返回", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "第一条" });
      await db.appendMessage({ sessionId, role: "assistant", content: "第二条" });
      await db.appendMessage({ sessionId, role: "user", content: "第三条" });

      const messages = db.getMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("第一条");
      expect(messages[2].content).toBe("第三条");
    });

    it("getMessages 支持 limit 和 offset", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "消息1" });
      await db.appendMessage({ sessionId, role: "user", content: "消息2" });
      await db.appendMessage({ sessionId, role: "user", content: "消息3" });

      const page = db.getMessages(sessionId, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0].content).toBe("消息2");
      expect(page[1].content).toBe("消息3");
    });

    it("searchMessages 通过 FTS5 搜索内容", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "请帮我实现登录功能" });
      await db.appendMessage({ sessionId, role: "assistant", content: "好的，我来实现登录页面" });
      await db.appendMessage({ sessionId, role: "user", content: "谢谢" });

      // trigram 分词器要求查询串 ≥ 3 个字符；"实现登录"同时出现在前两条消息中
      const results = db.searchMessages("实现登录");
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const r of results) {
        expect(r.content).toContain("登录");
      }
    });

    it("searchMessages 支持按 sessionId 过滤", async () => {
      const otherId = `sess-other-${randomUUID()}`;
      await db.createSession({ sessionId: otherId, teamId: "team-other" });
      await db.appendMessage({ sessionId: otherId, role: "user", content: "登录问题" });
      await db.appendMessage({ sessionId, role: "user", content: "登录需求" });

      const results = db.searchMessages("登录", { sessionId });
      expect(results.every((r) => r.sessionId === sessionId)).toBe(true);
    });

    it("searchMessages 支持 limit", async () => {
      for (let i = 0; i < 5; i++) {
        await db.appendMessage({ sessionId, role: "user", content: `搜索测试消息 ${i}` });
      }

      const results = db.searchMessages("搜索测试", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("appendMessage 递增 session 的 messageCount", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "hello" });
      await db.appendMessage({ sessionId, role: "assistant", content: "hi" });
      const session = db.getSession(sessionId);
      expect(session?.messageCount).toBe(2);
    });
  });

  describe("Tasks", () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = `sess-task-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-task" });
    });

    it("createTask 创建新任务", async () => {
      const taskId = `task-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-42",
      });

      const row = db.getTask(taskId);
      expect(row).toBeDefined();
      expect(row?.taskId).toBe(taskId);
      expect(row?.sessionId).toBe(sessionId);
      expect(row?.status).toBe("pending");
      expect(row?.subtaskDag).toBeNull();
      expect(row?.completedAt).toBeNull();
    });

    it("createTask 支持 subtaskDag", async () => {
      const taskId = `task-dag-${randomUUID()}`;
      const dag: TaskConfig[] = [
        {
          issueId: "ISSUE-42",
          meegoEvent: {
            eventId: "evt-1",
            issueId: "ISSUE-42",
            projectKey: "FE",
            type: "issue.created",
            payload: {},
            timestamp: Date.now(),
          },
          meegoProjectId: "project_xxx",
          description: "子任务1",
          triggerType: "frontend_dev",
          agentRole: "coder",
          worktreePath: "/tmp/wt1",
          assigneeId: "user-001",
        },
      ];

      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-42",
        subtaskDag: dag,
      });

      const row = db.getTask(taskId);
      expect(row?.subtaskDag).toEqual(dag);
    });

    it("getTask 返回 undefined 当任务不存在", () => {
      const row = db.getTask("nonexistent");
      expect(row).toBeUndefined();
    });

    it("updateTaskStatus 更新状态", async () => {
      const taskId = `task-status-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-43",
      });

      const now = Date.now();
      await db.updateTaskStatus(taskId, "completed", now);

      const row = db.getTask(taskId);
      expect(row?.status).toBe("completed");
      expect(row?.completedAt).toBe(now);
    });

    it("updateTaskStatus 不传 completedAt 时保持 null", async () => {
      const taskId = `task-running-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-44",
      });

      await db.updateTaskStatus(taskId, "running");

      const row = db.getTask(taskId);
      expect(row?.status).toBe("running");
      expect(row?.completedAt).toBeNull();
    });

    it("listTasks 返回会话下所有任务", async () => {
      const taskId1 = `task-list-1-${randomUUID()}`;
      const taskId2 = `task-list-2-${randomUUID()}`;

      await db.createTask({ taskId: taskId1, sessionId, teamId: "team-task", meegoIssueId: "ISSUE-50" });
      await db.createTask({ taskId: taskId2, sessionId, teamId: "team-task", meegoIssueId: "ISSUE-51" });

      const tasks = db.listTasks(sessionId);
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.some((t) => t.taskId === taskId1)).toBe(true);
      expect(tasks.some((t) => t.taskId === taskId2)).toBe(true);
    });
  });

  describe("Compaction", () => {
    it("shouldCompact 当 token 数超过阈值时返回 true", async () => {
      const sessionId = `sess-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      for (let i = 0; i < 10; i++) {
        await db.appendMessage({
          sessionId,
          role: "user",
          content: `这是一条测试消息，用于触发 compaction 逻辑 ${i}`,
        });
      }

      const result = db.shouldCompact(sessionId, () => 200);
      expect(result).toBe(true);
    });

    it("shouldCompact 当 token 数低于阈值时返回 false", async () => {
      const sessionId = `sess-no-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      await db.appendMessage({ sessionId, role: "user", content: "短消息" });

      const result = db.shouldCompact(sessionId, () => 10);
      expect(result).toBe(false);
    });

    it("compact 执行压缩流程", async () => {
      const sessionId = `sess-do-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      for (let i = 0; i < 5; i++) {
        await db.appendMessage({ sessionId, role: "user", content: `对话内容 ${i}` });
      }

      const result = await db.compact(sessionId, async (messages: MessageRow[]) => {
        return `摘要：共 ${messages.length} 条消息`;
      });

      expect(result.newSessionId).toBeDefined();
      expect(result.newSessionId).not.toBe(sessionId);
      expect(result.summary).toBe("摘要：共 5 条消息");

      const oldSession = db.getSession(sessionId);
      expect(oldSession?.status).toBe("compacted");

      const newSession = db.getSession(result.newSessionId);
      expect(newSession?.status).toBe("active");
      expect(newSession?.parentSessionId).toBe(sessionId);

      const newMessages = db.getMessages(result.newSessionId);
      expect(newMessages.length).toBe(1);
      expect(newMessages[0].role).toBe("system");
      expect(newMessages[0].content).toContain("摘要：共 5 条消息");
    });

    it("compact 会话不存在时抛出 SessionDbError", async () => {
      await expect(db.compact("nonexistent", async () => "summary")).rejects.toThrow(SessionDbError);
    });
  });

  describe("SessionDbError", () => {
    it("包含正确的 code 和 message", () => {
      const err = new SessionDbError("test error", "SESSION_NOT_FOUND");
      expect(err.message).toBe("test error");
      expect(err.code).toBe("SESSION_NOT_FOUND");
      expect(err.name).toBe("SessionDbError");
    });

    it("支持 cause 链", () => {
      const cause = new Error("root cause");
      const err = new SessionDbError("wrapped", "COMPACTION_FAILED", cause);
      expect(err.cause).toBe(cause);
    });
  });
});
