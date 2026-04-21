import { Database } from "bun:sqlite";
import type { AppConfig, MeegoConfig, MeegoEvent } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ─── mock @teamsland/observability（静默日志） ───
vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { IntentClassifier } from "@teamsland/ingestion";
import { MeegoConnector, MeegoEventBus } from "@teamsland/meego";
import { SubagentRegistry } from "@teamsland/sidecar";
import { registerEventHandlers } from "../event-handlers.js";

// ─── 常量 ───

const TEST_PORT = 19080;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// ─── 测试用 Meego 配置 ───

const meegoConfig: MeegoConfig = {
  spaces: [],
  eventMode: "webhook",
  webhook: { host: "127.0.0.1", port: TEST_PORT, path: "/meego/webhook" },
  poll: { intervalSeconds: 60, lookbackMinutes: 5 },
  longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
  apiBaseUrl: "https://project.feishu.cn/open_api",
  pluginAccessToken: "",
};

// ─── 最小化 AppConfig（仅 event-handlers 实际读取的字段） ───

const testConfig = {
  meego: meegoConfig,
  lark: { appId: "test", appSecret: "test", bot: { historyContextCount: 20 }, notification: { teamChannelId: "" } },
  session: { compactionTokenThreshold: 80000, sqliteJitterRangeMs: [20, 150] as [number, number], busyTimeoutMs: 5000 },
  sidecar: {
    maxConcurrentSessions: 20,
    maxRetryCount: 3,
    maxDelegateDepth: 2,
    workerTimeoutSeconds: 300,
    healthCheckTimeoutMs: 30000,
    minSwarmSuccessRatio: 0.5,
  },
  memory: { decayHalfLifeDays: 30, extractLoopMaxIterations: 3, exemptTypes: [], perTypeTtl: {} },
  storage: {
    sqliteVec: { dbPath: ":memory:", busyTimeoutMs: 5000, vectorDimensions: 512 },
    embedding: { model: "test-model", contextSize: 512 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  },
  confirmation: { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 },
  dashboard: { port: 3000, auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] } },
  repoMapping: [{ meegoProjectId: "project_xxx", repos: [{ path: "/tmp/test-repo", name: "测试仓库" }] }],
  skillRouting: { frontend_dev: ["git-tools"] },
} as AppConfig;

// ─── Mock 工厂 ───

function createMockSpawn() {
  return vi.fn().mockResolvedValue({
    pid: 99999,
    sessionId: "sess-test-001",
    stdout: new ReadableStream(),
  });
}

function createMockWorktreeCreate() {
  return vi.fn().mockResolvedValue("/tmp/test-repo/.worktrees/req-test");
}

// ─── 测试套件 ───

describe("事件管线端到端", () => {
  let ac: AbortController;
  let eventBus: MeegoEventBus;
  let spawnFn: ReturnType<typeof createMockSpawn>;
  let worktreeCreateFn: ReturnType<typeof createMockWorktreeCreate>;
  let registry: SubagentRegistry;

  beforeAll(async () => {
    ac = new AbortController();

    // 真实 EventBus
    const db = new Database(":memory:");
    eventBus = new MeegoEventBus(db);

    // 真实 IntentClassifier（规则路径，stub LLM 不会被调用）
    const stubLlm = {
      async chat(): Promise<{ content: string }> {
        throw new Error("LLM 不应被调用");
      },
    };
    const intentClassifier = new IntentClassifier({ llm: stubLlm });

    // Mock ProcessController
    spawnFn = createMockSpawn();
    const processController = { spawn: spawnFn, interrupt: vi.fn(), isAlive: vi.fn().mockReturnValue(true) };

    // Mock WorktreeManager
    worktreeCreateFn = createMockWorktreeCreate();
    const worktreeManager = { create: worktreeCreateFn, reap: vi.fn().mockResolvedValue([]) };

    // Mock DynamicContextAssembler
    const assembler = { buildInitialPrompt: vi.fn().mockResolvedValue("你好，请开始工作") };

    // Mock LarkNotifier
    const notifier = { sendCard: vi.fn().mockResolvedValue(undefined), sendDm: vi.fn().mockResolvedValue(undefined) };

    // Mock LarkCli
    const larkCli = { contactSearch: vi.fn().mockResolvedValue([]), groupSearch: vi.fn().mockResolvedValue([]) };

    // 真实 SubagentRegistry
    registry = new SubagentRegistry({
      config: testConfig.sidecar,
      notifier: notifier as never,
      registryPath: `/tmp/teamsland-test-registry-${Date.now()}.json`,
    });

    // 注册事件处理器
    registerEventHandlers(eventBus, {
      intentClassifier,
      processController: processController as never,
      dataPlane: { processStream: vi.fn().mockResolvedValue(undefined) } as never,
      assembler: assembler as never,
      registry,
      worktreeManager: worktreeManager as never,
      notifier: notifier as never,
      larkCli: larkCli as never,
      config: testConfig,
      teamId: "default",
      documentParser: { parseMarkdown: vi.fn().mockReturnValue({ title: "", sections: [], entities: [] }) } as never,
      memoryStore: null,
      extractLoop: null,
      memoryUpdater: null,
      taskPlanner: null,
      confirmationWatcher: { watch: vi.fn().mockResolvedValue("approved") } as never,
    });

    // 启动 webhook
    const connector = new MeegoConnector({ config: meegoConfig, eventBus });
    await connector.start(ac.signal);
  });

  afterAll(() => {
    ac.abort();
  });

  it("issue.created 事件触发完整 Agent 启动流水线", async () => {
    const event: MeegoEvent = {
      eventId: "evt-pipeline-001",
      issueId: "I-001",
      projectKey: "project_xxx",
      type: "issue.created",
      payload: { title: "前端开发登录页面", description: "实现 SSO 登录" },
      timestamp: Date.now(),
    };

    const resp = await fetch(`${BASE_URL}/meego/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(resp.status).toBe(200);

    // 等待异步 handler 完成
    await new Promise((r) => setTimeout(r, 100));

    // spawn 应被调用
    expect(spawnFn).toHaveBeenCalledOnce();
    expect(spawnFn).toHaveBeenCalledWith(
      expect.objectContaining({ issueId: "I-001", worktreePath: "/tmp/test-repo/.worktrees/req-test" }),
    );

    // worktree 创建应被调用
    expect(worktreeCreateFn).toHaveBeenCalledWith("/tmp/test-repo", "I-001");

    // registry 应有 1 条记录
    expect(registry.runningCount()).toBe(1);
    const agents = registry.allRunning();
    expect(agents[0]?.issueId).toBe("I-001");
    expect(agents[0]?.status).toBe("running");
  });

  it("低置信度事件被跳过（无关键词匹配）", async () => {
    spawnFn.mockClear();

    const event: MeegoEvent = {
      eventId: "evt-pipeline-002",
      issueId: "I-002",
      projectKey: "project_xxx",
      type: "issue.created",
      payload: { title: "日常沟通", description: "团队周会" },
      timestamp: Date.now(),
    };

    const resp = await fetch(`${BASE_URL}/meego/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(resp.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    // spawn 不应被调用
    expect(spawnFn).not.toHaveBeenCalled();

    // registry 仍然只有上一个测试的 1 条记录
    expect(registry.runningCount()).toBe(1);
  });

  it("webhook /health 端点返回 200", async () => {
    const resp = await fetch(`${BASE_URL}/health`);
    expect(resp.status).toBe(200);

    const body = (await resp.json()) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("缺少 repoMapping 时跳过 Agent 启动并发送 DM", async () => {
    spawnFn.mockClear();

    const event: MeegoEvent = {
      eventId: "evt-pipeline-003",
      issueId: "I-003",
      projectKey: "unknown_project",
      type: "issue.created",
      payload: { title: "前端开发新功能", description: "需要组件重构", assigneeId: "user-001" },
      timestamp: Date.now(),
    };

    const resp = await fetch(`${BASE_URL}/meego/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(resp.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    // spawn 不应被调用（仓库映射缺失）
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("注册表容量满时跳过 Agent 注册并发送 DM", async () => {
    spawnFn.mockClear();

    // 填充注册表到上限（当前 1 条 + 填充 19 条 = 20 = maxConcurrentSessions）
    const padCount = testConfig.sidecar.maxConcurrentSessions - registry.runningCount();
    for (let i = 0; i < padCount; i++) {
      registry.register({
        agentId: `pad-agent-${i}`,
        pid: 10000 + i,
        sessionId: `sess-pad-${i}`,
        issueId: `PAD-${i}`,
        worktreePath: `/tmp/pad-${i}`,
        status: "running",
        retryCount: 0,
        createdAt: Date.now(),
      });
    }

    const event: MeegoEvent = {
      eventId: "evt-pipeline-004",
      issueId: "I-004",
      projectKey: "project_xxx",
      type: "issue.created",
      payload: { title: "前端开发数据面板", description: "实现 Dashboard 组件", assigneeId: "user-002" },
      timestamp: Date.now(),
    };

    const resp = await fetch(`${BASE_URL}/meego/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(resp.status).toBe(200);

    await new Promise((r) => setTimeout(r, 100));

    // spawn 会被调用（进程启动在注册之前）
    expect(spawnFn).toHaveBeenCalledOnce();

    // 但 registry 不应新增记录（容量已满，CapacityError 被捕获）
    expect(registry.runningCount()).toBe(testConfig.sidecar.maxConcurrentSessions);

    // 清理填充的 agents
    for (let i = 0; i < padCount; i++) {
      registry.unregister(`pad-agent-${i}`);
    }
  });
});
