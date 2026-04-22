import { SessionDB } from "@teamsland/session";
import { ObservableMessageBus, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import type { AgentRecord, SidecarConfig } from "@teamsland/types";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  withSpan: (_t: string, _s: string, fn: (span: unknown) => Promise<unknown>) =>
    fn({ setAttribute: vi.fn(), addEvent: vi.fn() }),
  initTracing: vi.fn(),
  shutdownTracing: vi.fn(),
  getTracer: () => ({
    startSpan: () => ({ end: vi.fn(), setAttribute: vi.fn(), setStatus: vi.fn(), recordException: vi.fn() }),
  }),
}));

const sidecarConfig: SidecarConfig = {
  maxConcurrentSessions: 20,
  maxRetryCount: 3,
  maxDelegateDepth: 2,
  workerTimeoutSeconds: 300,
  healthCheckTimeoutMs: 30000,
  minSwarmSuccessRatio: 0.5,
};

describe("DataPlane -> SessionDB 集成测试", () => {
  let sessionDb: SessionDB;
  let registry: SubagentRegistry;
  let dataPlane: SidecarDataPlane;

  afterEach(() => {
    sessionDb.close();
  });

  function setup() {
    sessionDb = new SessionDB(":memory:", {
      compactionTokenThreshold: 80000,
      sqliteJitterRangeMs: [0, 0] as [number, number],
      busyTimeoutMs: 5000,
    });

    const notifier = { sendDm: vi.fn(), sendCard: vi.fn() };
    registry = new SubagentRegistry({
      config: sidecarConfig,
      notifier: notifier as never,
      registryPath: `/tmp/test-registry-dp-${Date.now()}.json`,
    });

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn() };
    const messageBus = new ObservableMessageBus({ logger: logger as never });
    dataPlane = new SidecarDataPlane({ registry, sessionDb, logger: logger as never, messageBus });
  }

  function makeStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const ndjson = lines.map((l) => `${l}\n`).join("");
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ndjson));
        controller.close();
      },
    });
  }

  it("assistant 事件写入 SessionDB", async () => {
    setup();

    const agentId = "agent-dp-001";
    const sessionId = "sess-dp-001";

    await sessionDb.createSession({ sessionId, teamId: "default", agentId });
    const record: AgentRecord = {
      agentId,
      pid: process.pid,
      sessionId,
      issueId: "I-DP-001",
      worktreePath: "/tmp/dp-test",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
    };
    registry.register(record);

    const stdout = makeStream([
      JSON.stringify({ type: "assistant", content: "开始分析代码" }),
      JSON.stringify({ type: "assistant", content: "发现3个组件需要重构" }),
      JSON.stringify({ type: "result", content: "任务完成" }),
    ]);

    await dataPlane.processStream(agentId, stdout);

    const messages = sessionDb.getMessages(sessionId);
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(registry.get(agentId)).toBeUndefined();
  });

  it("error 事件标记 agent 为 failed", async () => {
    setup();

    const agentId = "agent-dp-002";
    const sessionId = "sess-dp-002";

    await sessionDb.createSession({ sessionId, teamId: "default", agentId });
    const record: AgentRecord = {
      agentId,
      pid: process.pid,
      sessionId,
      issueId: "I-DP-002",
      worktreePath: "/tmp/dp-test-2",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
    };
    registry.register(record);

    const stdout = makeStream([JSON.stringify({ type: "error", content: "编译失败" })]);

    await dataPlane.processStream(agentId, stdout);

    expect(registry.get(agentId)).toBeUndefined();

    const messages = sessionDb.getMessages(sessionId);
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it("拦截禁止的 tool_use 事件", async () => {
    setup();

    const agentId = "agent-dp-003";
    const sessionId = "sess-dp-003";

    await sessionDb.createSession({ sessionId, teamId: "default", agentId });
    registry.register({
      agentId,
      pid: process.pid,
      sessionId,
      issueId: "I-DP-003",
      worktreePath: "/tmp/dp-test-3",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
    });

    const stdout = makeStream([
      JSON.stringify({ type: "tool_use", name: "delegate", input: {} }),
      JSON.stringify({ type: "tool_use", name: "Read", input: { path: "/tmp/test" } }),
      JSON.stringify({ type: "result", content: "done" }),
    ]);

    await dataPlane.processStream(agentId, stdout);

    const messages = sessionDb.getMessages(sessionId);
    expect(messages.length).toBe(2);
  });
});
