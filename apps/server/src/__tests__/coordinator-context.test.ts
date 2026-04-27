import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock @teamsland/observability（静默日志 + withSpan 透传） ───
vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  withSpan: (_t: string, _n: string, fn: (span: unknown) => unknown) => fn({}),
}));

import type { FindResult, IVikingMemoryClient, SessionContext } from "@teamsland/memory";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { AgentRecord, CoordinatorEvent } from "@teamsland/types";
import { LiveContextLoader } from "../coordinator-context.js";

// ─── 工厂函数 ───

/** 构造测试用 AgentRecord */
function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "agent-001",
    pid: 12345,
    sessionId: "sess-abc",
    issueId: "ISSUE-42",
    worktreePath: "/repos/fe/.worktrees/req-42",
    status: "running",
    retryCount: 0,
    createdAt: Date.now() - 30_000,
    ...overrides,
  };
}

/** 构造测试用 CoordinatorEvent */
function makeEvent(overrides: Partial<CoordinatorEvent> = {}): CoordinatorEvent {
  return {
    type: "lark_mention",
    id: "evt-001",
    timestamp: Date.now(),
    priority: 1,
    payload: { message: "请帮我检查一下代码" },
    ...overrides,
  };
}

/** 构造空的 FindResult */
function emptyFindResult(): FindResult {
  return { memories: [], resources: [], skills: [], total: 0 };
}

/** 构造空的 SessionContext */
function emptySessionContext(): SessionContext {
  return {
    latest_archive_overview: "",
    pre_archive_abstracts: [],
    messages: [],
    estimatedTokens: 0,
  };
}

/** 构造 mock SubagentRegistry */
function makeMockRegistry(agents: AgentRecord[] = []): SubagentRegistry {
  return {
    allRunning: vi.fn(() => agents),
    get: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    runningCount: vi.fn(() => agents.length),
    subscribe: vi.fn(() => () => {}),
    persist: vi.fn(),
    restoreOnStartup: vi.fn(),
    toRegistryState: vi.fn(),
  } as unknown as SubagentRegistry;
}

/** 构造 mock IVikingMemoryClient */
function makeMockVikingClient(overrides: Partial<IVikingMemoryClient> = {}): IVikingMemoryClient {
  return {
    healthCheck: vi.fn().mockResolvedValue(true),
    find: vi.fn().mockResolvedValue(emptyFindResult()),
    read: vi.fn().mockResolvedValue(""),
    abstract: vi.fn().mockResolvedValue(""),
    overview: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    ls: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    mv: vi.fn().mockResolvedValue(undefined),
    grep: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
    glob: vi.fn().mockResolvedValue({ matches: [], count: 0 }),
    addResource: vi.fn().mockResolvedValue({ uri: "" }),
    createSession: vi.fn().mockResolvedValue("null-session"),
    getSessionContext: vi.fn().mockResolvedValue(emptySessionContext()),
    addMessage: vi.fn().mockResolvedValue(undefined),
    commitSession: vi.fn().mockResolvedValue({ session_id: "", status: "accepted", task_id: "", archive_uri: "" }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue({ task_id: "", task_type: "", status: "completed" }),
    ...overrides,
  };
}

// ─── 测试套件 ───

describe("LiveContextLoader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ── loadTaskStateSummary ──

  describe("loadTaskStateSummary", () => {
    it("无运行中 Agent 时 taskStateSummary 为空", async () => {
      const loader = new LiveContextLoader({
        registry: makeMockRegistry([]),
        vikingClient: makeMockVikingClient(),
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.taskStateSummary).toBe("");
    });

    it("正确格式化运行中的 Agent 列表", async () => {
      const now = Date.now();
      const agents: AgentRecord[] = [
        makeAgent({ agentId: "agent-a", status: "running", issueId: "ISSUE-1", createdAt: now - 60_000 }),
        makeAgent({ agentId: "agent-b", status: "running", issueId: "ISSUE-2", createdAt: now - 120_000 }),
      ];

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(agents),
        vikingClient: makeMockVikingClient(),
      });

      const ctx = await loader.load(makeEvent());

      expect(ctx.taskStateSummary).toContain("agent-a");
      expect(ctx.taskStateSummary).toContain("[running]");
      expect(ctx.taskStateSummary).toContain("ISSUE-1");
      expect(ctx.taskStateSummary).toContain("agent-b");
      expect(ctx.taskStateSummary).toContain("ISSUE-2");
    });

    it("正确计算运行耗时（秒）", async () => {
      const now = Date.now();
      const agents: AgentRecord[] = [makeAgent({ agentId: "agent-x", createdAt: now - 90_000 })];

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(agents),
        vikingClient: makeMockVikingClient(),
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.taskStateSummary).toContain("运行 90s");
    });
  });

  // ── Viking find 集成 ──

  describe("Viking find 集成", () => {
    it("有查询时调用 find 并格式化活跃任务", async () => {
      const vikingClient = makeMockVikingClient({
        find: vi.fn().mockResolvedValue({
          memories: [
            {
              abstract: "任务A正在执行",
              uri: "t1",
              context_type: "memory",
              is_leaf: true,
              category: "",
              score: 0.9,
              match_reason: "",
            },
          ],
          resources: [],
          skills: [],
          total: 1,
        }),
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent({ payload: { message: "查询任务" } }));
      expect(vikingClient.find).toHaveBeenCalled();
      expect(ctx.taskStateSummary).toContain("[活跃任务] 任务A正在执行");
    });

    it("无查询关键词时不调用 find", async () => {
      const vikingClient = makeMockVikingClient();

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      await loader.load(makeEvent({ payload: {} }));
      expect(vikingClient.find).not.toHaveBeenCalled();
    });

    it("Agent 记忆和用户记忆分别格式化到 relevantMemories", async () => {
      const vikingClient = makeMockVikingClient({
        find: vi
          .fn()
          .mockResolvedValueOnce(emptyFindResult()) // tasks
          .mockResolvedValueOnce({
            memories: [
              {
                abstract: "Agent 学到了新知识",
                uri: "m1",
                context_type: "memory",
                is_leaf: true,
                category: "",
                score: 0.9,
                match_reason: "",
              },
            ],
            resources: [],
            skills: [],
            total: 1,
          }) // agent memories
          .mockResolvedValueOnce({
            memories: [
              {
                abstract: "用户偏好深色模式",
                uri: "m2",
                context_type: "memory",
                is_leaf: true,
                category: "",
                score: 0.8,
                match_reason: "",
              },
            ],
            resources: [],
            skills: [],
            total: 1,
          }), // user memories
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent({ payload: { message: "查询", userId: "user-001" } }));
      expect(ctx.relevantMemories).toContain("[Agent 记忆] Agent 学到了新知识");
      expect(ctx.relevantMemories).toContain("[用户记忆] 用户偏好深色模式");
    });

    it("无 requesterId 时跳过用户记忆查询", async () => {
      const findMock = vi.fn().mockResolvedValue(emptyFindResult());
      const vikingClient = makeMockVikingClient({ find: findMock });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      await loader.load(makeEvent({ payload: { message: "查询" } }));
      // 应该只调用 2 次 find（tasks + agent memories），不调用 user memories
      const calls = findMock.mock.calls;
      const userMemoryCall = calls.find(
        (c: unknown[]) =>
          typeof c[1] === "object" &&
          c[1] !== null &&
          "targetUri" in (c[1] as Record<string, unknown>) &&
          String((c[1] as Record<string, unknown>).targetUri).startsWith("viking://user/"),
      );
      expect(userMemoryCall).toBeUndefined();
    });
  });

  // ── 会话上下文 ──

  describe("会话上下文 (recentMessages)", () => {
    it("正确格式化会话上下文（含归档概要和消息）", async () => {
      const sessionCtx: SessionContext = {
        latest_archive_overview: "之前讨论了部署计划",
        pre_archive_abstracts: [],
        messages: [
          { id: "msg-1", role: "user", parts: ["请帮我检查代码"], created_at: "2025-01-01T00:00:00Z" },
          { id: "msg-2", role: "assistant", parts: ["好的，我来检查"], created_at: "2025-01-01T00:00:01Z" },
        ],
        estimatedTokens: 100,
      };

      const vikingClient = makeMockVikingClient({
        getSessionContext: vi.fn().mockResolvedValue(sessionCtx),
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.recentMessages).toContain("[对话历史概要] 之前讨论了部署计划");
      expect(ctx.recentMessages).toContain("[user] 请帮我检查代码");
      expect(ctx.recentMessages).toContain("[assistant] 好的，我来检查");
    });

    it("无归档概要时只显示消息", async () => {
      const sessionCtx: SessionContext = {
        latest_archive_overview: "",
        pre_archive_abstracts: [],
        messages: [{ id: "msg-1", role: "user", parts: ["hello"], created_at: "2025-01-01T00:00:00Z" }],
        estimatedTokens: 10,
      };

      const vikingClient = makeMockVikingClient({
        getSessionContext: vi.fn().mockResolvedValue(sessionCtx),
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.recentMessages).not.toContain("[对话历史概要]");
      expect(ctx.recentMessages).toContain("[user] hello");
    });

    it("空会话上下文时返回空字符串", async () => {
      const vikingClient = makeMockVikingClient();

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.recentMessages).toBe("");
    });

    it("处理 parts 中包含对象的消息", async () => {
      const sessionCtx: SessionContext = {
        latest_archive_overview: "",
        pre_archive_abstracts: [],
        messages: [
          { id: "msg-1", role: "user", parts: [{ text: "对象形式的文本" }], created_at: "2025-01-01T00:00:00Z" },
        ],
        estimatedTokens: 10,
      };

      const vikingClient = makeMockVikingClient({
        getSessionContext: vi.fn().mockResolvedValue(sessionCtx),
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.recentMessages).toContain("对象形式的文本");
    });
  });

  // ── buildMemoryQuery ──

  describe("buildMemoryQuery 语义", () => {
    it("从 payload 多个字段拼接查询", async () => {
      const findMock = vi.fn().mockResolvedValue(emptyFindResult());
      const vikingClient = makeMockVikingClient({ find: findMock });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      await loader.load(
        makeEvent({
          payload: { message: "检查代码", description: "登录模块", title: "代码审查" },
        }),
      );

      expect(findMock).toHaveBeenCalledWith("检查代码 登录模块 代码审查", expect.anything());
    });

    it("payload 仅有 issueId 时回退作为查询", async () => {
      const findMock = vi.fn().mockResolvedValue(emptyFindResult());
      const vikingClient = makeMockVikingClient({ find: findMock });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry(),
        vikingClient,
      });

      await loader.load(makeEvent({ payload: { issueId: "ISSUE-99" } }));
      expect(findMock).toHaveBeenCalledWith("ISSUE-99", expect.anything());
    });
  });

  // ── 错误容错 ──

  describe("错误容错", () => {
    it("registry.allRunning 抛异常时 taskStateSummary 降级为空", async () => {
      const registry = makeMockRegistry();
      vi.mocked(registry.allRunning).mockImplementation(() => {
        throw new Error("registry 炸了");
      });

      const loader = new LiveContextLoader({
        registry,
        vikingClient: makeMockVikingClient(),
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.taskStateSummary).toBe("");
    });

    it("vikingClient.find 抛异常时 relevantMemories 降级为空", async () => {
      const vikingClient = makeMockVikingClient({
        find: vi.fn().mockRejectedValue(new Error("viking 炸了")),
      });

      const loader = new LiveContextLoader({
        registry: makeMockRegistry([makeAgent()]),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent({ payload: { message: "查询" } }));
      expect(ctx.relevantMemories).toBe("");
      expect(ctx.taskStateSummary).not.toBe("");
    });

    it("vikingClient.getSessionContext 抛异常时 recentMessages 降级为空", async () => {
      const vikingClient = makeMockVikingClient({
        getSessionContext: vi.fn().mockRejectedValue(new Error("session 炸了")),
      });

      const agents = [makeAgent()];
      const loader = new LiveContextLoader({
        registry: makeMockRegistry(agents),
        vikingClient,
      });

      const ctx = await loader.load(makeEvent());
      expect(ctx.recentMessages).toBe("");
      expect(ctx.taskStateSummary).not.toBe("");
    });

    it("所有数据源同时失败全部降级为空", async () => {
      const registry = makeMockRegistry();
      vi.mocked(registry.allRunning).mockImplementation(() => {
        throw new Error("registry 炸了");
      });

      const vikingClient = makeMockVikingClient({
        find: vi.fn().mockRejectedValue(new Error("viking 炸了")),
        getSessionContext: vi.fn().mockRejectedValue(new Error("session 炸了")),
      });

      const loader = new LiveContextLoader({
        registry,
        vikingClient,
      });

      const ctx = await loader.load(makeEvent({ payload: { message: "查询" } }));
      expect(ctx.taskStateSummary).toBe("");
      expect(ctx.recentMessages).toBe("");
      expect(ctx.relevantMemories).toBe("");
    });
  });
});
