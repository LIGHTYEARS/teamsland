import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type {
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorSessionManagerConfig,
} from "@teamsland/types";
import type { CoordinatorPromptBuilderLike, SpawnedProcess, SpawnFn } from "../coordinator.js";
import { CoordinatorSessionManager } from "../coordinator.js";

// ─── 测试用常量 ───

const DEFAULT_CONFIG: CoordinatorSessionManagerConfig = {
  workspacePath: "/tmp/test-coordinator",
  sessionIdleTimeoutMs: 300_000,
  sessionMaxLifetimeMs: 1_800_000,
  sessionReuseWindowMs: 300_000,
  maxRecoveryRetries: 3,
  inferenceTimeoutMs: 60_000,
};

function makeEvent(overrides: Partial<CoordinatorEvent> = {}): CoordinatorEvent {
  return {
    type: "lark_mention",
    id: `evt-${Date.now()}`,
    timestamp: Date.now(),
    priority: 1,
    payload: { chatId: "oc_test" },
    ...overrides,
  };
}

function makeContextLoader(): CoordinatorContextLoader {
  return {
    async load(_event: CoordinatorEvent): Promise<CoordinatorContext> {
      return {
        taskStateSummary: "",
        recentMessages: "",
        relevantMemories: "",
      };
    },
  };
}

function makePromptBuilder(): CoordinatorPromptBuilderLike {
  return {
    build(_event: CoordinatorEvent, _context: CoordinatorContext): string {
      return "test prompt";
    },
  };
}

// ─── 测试用 spawnFn mock ───

/**
 * 创建返回成功的模拟 spawn 函数
 */
function createMockSpawnFn(): SpawnFn {
  const initLine = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "test-session-001",
  });
  return vi.fn().mockImplementation(
    (): SpawnedProcess => ({
      pid: 12345,
      stdin: {
        write: vi.fn().mockReturnValue(0),
        flush: vi.fn(),
        end: vi.fn(),
      },
      stdout: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${initLine}\n`));
          controller.close();
        },
      }),
      stderr: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      exited: Promise.resolve(0),
    }),
  );
}

/**
 * 创建一个会失败的模拟 spawn 函数
 */
function createFailingSpawnFn(): SpawnFn {
  return vi.fn().mockImplementation(() => {
    throw new Error("spawn failed");
  });
}

// ─── 测试套件 ───

describe("CoordinatorSessionManager", () => {
  let manager: CoordinatorSessionManager;
  let mockSpawnFn: SpawnFn;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSpawnFn = createMockSpawnFn();
    manager = new CoordinatorSessionManager({
      config: DEFAULT_CONFIG,
      contextLoader: makeContextLoader(),
      promptBuilder: makePromptBuilder(),
      spawnFn: mockSpawnFn,
    });
  });

  afterEach(() => {
    manager.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("shouldReuseSession", () => {
    it("应在无活跃 session 时返回 false", () => {
      const event = makeEvent();
      expect(manager.shouldReuseSession(event)).toBe(false);
    });

    it("应在 P0 事件时返回 false", async () => {
      // 先创建一个活跃 session
      await manager.processEvent(makeEvent({ id: "evt-1" }));
      expect(manager.getState()).toBe("running");

      const p0Event = makeEvent({ id: "evt-2", priority: 0 });
      expect(manager.shouldReuseSession(p0Event)).toBe(false);
    });

    it("应在相同 chatId 且在窗口内时返回 true", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1", payload: { chatId: "oc_same" } }));
      expect(manager.getState()).toBe("running");

      const nextEvent = makeEvent({ id: "evt-2", payload: { chatId: "oc_same" } });
      expect(manager.shouldReuseSession(nextEvent)).toBe(true);
    });

    it("应在不同 chatId 时返回 false", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1", payload: { chatId: "oc_a" } }));
      expect(manager.getState()).toBe("running");

      const diffChatEvent = makeEvent({ id: "evt-2", payload: { chatId: "oc_b" } });
      expect(manager.shouldReuseSession(diffChatEvent)).toBe(false);
    });

    it("应在 session 过期时返回 false", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1", payload: { chatId: "oc_same" } }));
      expect(manager.getState()).toBe("running");

      // 推进时间超过 maxLifetimeMs
      vi.advanceTimersByTime(DEFAULT_CONFIG.sessionMaxLifetimeMs + 1000);

      const event = makeEvent({ id: "evt-2", payload: { chatId: "oc_same" } });
      expect(manager.shouldReuseSession(event)).toBe(false);
    });

    it("应在空闲超过复用窗口时返回 false", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1", payload: { chatId: "oc_same" } }));
      expect(manager.getState()).toBe("running");

      // 推进时间超过 sessionReuseWindowMs
      vi.advanceTimersByTime(DEFAULT_CONFIG.sessionReuseWindowMs + 1000);

      const event = makeEvent({ id: "evt-2", payload: { chatId: "oc_same" } });
      expect(manager.shouldReuseSession(event)).toBe(false);
    });
  });

  describe("processEvent", () => {
    it("应从 idle 转换到 running 状态", async () => {
      expect(manager.getState()).toBe("idle");

      await manager.processEvent(makeEvent({ id: "evt-1" }));

      expect(manager.getState()).toBe("running");
      const session = manager.getActiveSession();
      expect(session).not.toBeNull();
      expect(session?.sessionId).toBe("test-session-001");
      expect(session?.processedEvents).toEqual(["evt-1"]);
    });

    it("应在 spawn 失败时进入恢复流程", async () => {
      manager = new CoordinatorSessionManager({
        config: { ...DEFAULT_CONFIG, maxRecoveryRetries: 0 },
        contextLoader: makeContextLoader(),
        promptBuilder: makePromptBuilder(),
        spawnFn: createFailingSpawnFn(),
      });

      await expect(manager.processEvent(makeEvent({ id: "evt-fail" }))).rejects.toThrow(/recovery exhausted/);

      expect(manager.getState()).toBe("failed");
    });

    it("应在复用 session 时更新 processedEvents", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1", payload: { chatId: "oc_reuse" } }));
      expect(manager.getActiveSession()?.processedEvents).toEqual(["evt-1"]);

      await manager.processEvent(makeEvent({ id: "evt-2", payload: { chatId: "oc_reuse" } }));
      expect(manager.getActiveSession()?.processedEvents).toEqual(["evt-1", "evt-2"]);
    });
  });

  describe("reset", () => {
    it("应清除状态和 session", async () => {
      await manager.processEvent(makeEvent({ id: "evt-1" }));
      expect(manager.getState()).toBe("running");
      expect(manager.getActiveSession()).not.toBeNull();

      manager.reset();

      expect(manager.getState()).toBe("idle");
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  describe("getState / getActiveSession", () => {
    it("初始状态应为 idle，session 为 null", () => {
      expect(manager.getState()).toBe("idle");
      expect(manager.getActiveSession()).toBeNull();
    });
  });

  // ─── 流式 session_id 提取（Fix 1 新增） ───

  describe("流式 session_id 提取", () => {
    it("应在获取 session_id 后立即返回，无需等待进程退出", async () => {
      // stdout 发出 init 行后永远不关闭 — 模拟长时间运行的 Claude 进程
      const initLine = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "stream-session-001",
      });

      const neverClosingSpawnFn: SpawnFn = vi.fn().mockImplementation(
        (): SpawnedProcess => ({
          pid: 99999,
          stdin: { write: vi.fn().mockReturnValue(0), flush: vi.fn(), end: vi.fn() },
          stdout: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`${initLine}\n`));
              // 不调用 controller.close() — 进程持续运行
            },
          }),
          stderr: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
          exited: new Promise(() => {}), // 进程永远不退出
        }),
      );

      manager = new CoordinatorSessionManager({
        config: DEFAULT_CONFIG,
        contextLoader: makeContextLoader(),
        promptBuilder: makePromptBuilder(),
        spawnFn: neverClosingSpawnFn,
      });

      // processEvent 应快速返回，而非挂住等待进程退出
      await manager.processEvent(makeEvent({ id: "evt-stream-1" }));

      expect(manager.getState()).toBe("running");
      expect(manager.getActiveSession()?.sessionId).toBe("stream-session-001");
    });

    it("应在 stdout 无数据时使用 placeholder ID 立即完成（超时在后台处理）", async () => {
      // stdout 永远不发出任何数据 — 但 processEvent 不再阻塞
      const silentSpawnFn: SpawnFn = vi.fn().mockImplementation(
        (): SpawnedProcess => ({
          pid: 88888,
          stdin: { write: vi.fn().mockReturnValue(0), flush: vi.fn(), end: vi.fn() },
          stdout: new ReadableStream({
            start() {
              // 永远不 enqueue 也不 close
            },
          }),
          stderr: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
          exited: new Promise(() => {}),
        }),
      );

      manager = new CoordinatorSessionManager({
        config: { ...DEFAULT_CONFIG, inferenceTimeoutMs: 200, maxRecoveryRetries: 0 },
        contextLoader: makeContextLoader(),
        promptBuilder: makePromptBuilder(),
        spawnFn: silentSpawnFn,
      });

      await manager.processEvent(makeEvent({ id: "evt-timeout-1" }));

      // processEvent 不再阻塞，应立即以 placeholder ID 完成
      expect(manager.getState()).toBe("running");
      const session = manager.getActiveSession();
      expect(session).not.toBeNull();
      expect(session?.sessionId).toMatch(/^coord-/);
    });

    it("应在 destroySession 时杀死 pending 进程", async () => {
      vi.useRealTimers(); // 此测试需要真实定时器

      const killedPids: number[] = [];

      const hangingSpawnFn: SpawnFn = vi.fn().mockImplementation(
        (): SpawnedProcess => ({
          pid: 77777,
          stdin: { write: vi.fn().mockReturnValue(0), flush: vi.fn(), end: vi.fn() },
          stdout: new ReadableStream({
            pull() {
              // 永远挂起 — 模拟 pending 状态
              return new Promise<void>(() => {});
            },
          }),
          stderr: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
          exited: new Promise(() => {}),
        }),
      );

      vi.spyOn(process, "kill").mockImplementation((pid: number) => {
        killedPids.push(pid);
        return true;
      });

      manager = new CoordinatorSessionManager({
        config: { ...DEFAULT_CONFIG, inferenceTimeoutMs: 2_000 },
        contextLoader: makeContextLoader(),
        promptBuilder: makePromptBuilder(),
        spawnFn: hangingSpawnFn,
      });

      // 启动 processEvent 但不 await — 它会挂在 extractSessionIdFromStream
      const processPromise = manager.processEvent(makeEvent({ id: "evt-pending-1" }));

      // 给微任务一些时间让 pendingProcess 被设置
      await new Promise((r) => setTimeout(r, 50));

      // 在流式读取期间 reset（触发 destroySession）
      manager.reset();

      // 应该已杀死 pendingProcess
      expect(killedPids).toContain(77777);

      // 忽略 processEvent 的错误（超时或被杀）
      await processPromise.catch(() => {});

      vi.mocked(process.kill).mockRestore();
      vi.useFakeTimers({ shouldAdvanceTime: true }); // 恢复 fake timers
    }, 10_000);
  });
});
