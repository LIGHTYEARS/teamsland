import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AgentRecord } from "@teamsland/types";
import { type WorkerEvent, WorkerManager, type WorkerManagerOpts } from "../worker-manager.js";

function createMockRegistry() {
  const map = new Map<string, AgentRecord>();
  return {
    register: vi.fn((record: AgentRecord) => map.set(record.agentId, record)),
    unregister: vi.fn((id: string) => map.delete(id)),
    get: vi.fn((id: string) => map.get(id)),
    allRunning: vi.fn(() => [...map.values()]),
    runningCount: vi.fn(() => map.size),
  };
}

function createMockQueue() {
  return {
    enqueue: vi.fn(),
  };
}

function createMockNotifier() {
  return {
    sendDm: vi.fn(),
    sendCard: vi.fn(),
  };
}

function createMockSpawnFn(resultText = "task done") {
  return vi.fn().mockImplementation(() => {
    const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
    const initLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "w-session-1",
    });
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      result: resultText,
      session_id: "w-session-1",
      duration_ms: 5000,
      num_turns: 3,
    });

    let resolveExited: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });

    const stdout = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(`${initLine}\n`));
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(`${resultLine}\n`));
            setTimeout(() => {
              controller.close();
              resolveExited?.(0);
            }, 50);
          }, 50);
        }, 10);
      },
    });
    const stderr = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    return { pid: 99, stdin, stdout, stderr, exited, killed: false, kill: vi.fn() };
  });
}

describe("WorkerManager", () => {
  afterEach(() => vi.restoreAllMocks());

  it("spawnWorker: 注册 worker 并在 result 后入队 worker_completed", async () => {
    const registry = createMockRegistry();
    const queue = createMockQueue();
    const notifier = createMockNotifier();
    const spawnFn = createMockSpawnFn("task done");

    const mgr = new WorkerManager({
      registry: registry as unknown as WorkerManagerOpts["registry"],
      queue: queue as unknown as WorkerManagerOpts["queue"],
      notifier: notifier as unknown as WorkerManagerOpts["notifier"],
      spawnFn,
      workerSystemPromptPath: "/tmp/worker.md",
      defaultAllowedTools: ["Read", "Edit"],
    });

    const events: WorkerEvent[] = [];
    mgr.onWorkerEvent((e) => events.push(e));

    const workerId = await mgr.spawnWorker({
      prompt: "fix the bug",
      issueId: "ISS-1",
      projectKey: "PROJ",
      origin: { chatId: "oc_xxx", senderId: "ou_yyy", source: "lark_mention" },
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(registry.register).toHaveBeenCalledOnce();
    const registered = registry.register.mock.calls[0][0];
    expect(registered.origin?.chatId).toBe("oc_xxx");
    expect(registered.origin?.senderId).toBe("ou_yyy");

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_completed",
        payload: expect.objectContaining({
          workerId,
          resultSummary: "task done",
          chatId: "oc_xxx",
          senderId: "ou_yyy",
        }),
      }),
    );
  });

  it("spawnWorker: 进程异常退出时入队 worker_anomaly 并通知用户", async () => {
    const registry = createMockRegistry();
    const queue = createMockQueue();
    const notifier = createMockNotifier();

    let resolveExited: (code: number) => void;

    const spawnFn = vi.fn().mockImplementation(() => {
      const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
      const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "w-s-2" });
      const exited = new Promise<number>((resolve) => {
        resolveExited = resolve;
      });
      const stdout = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(`${initLine}\n`));
            setTimeout(() => {
              controller.close();
              resolveExited?.(1);
            }, 50);
          }, 10);
        },
      });
      const stderr = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      return { pid: 100, stdin, stdout, stderr, exited, killed: false, kill: vi.fn() };
    });

    const mgr = new WorkerManager({
      registry: registry as unknown as WorkerManagerOpts["registry"],
      queue: queue as unknown as WorkerManagerOpts["queue"],
      notifier: notifier as unknown as WorkerManagerOpts["notifier"],
      spawnFn,
      workerSystemPromptPath: "/tmp/worker.md",
      defaultAllowedTools: ["Read"],
    });

    const events: WorkerEvent[] = [];
    mgr.onWorkerEvent((e) => events.push(e));

    await mgr.spawnWorker({
      prompt: "do something",
      issueId: "ISS-2",
      projectKey: "PROJ",
      origin: { chatId: "oc_aaa", senderId: "ou_bbb", source: "lark_dm" },
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_anomaly",
        payload: expect.objectContaining({
          anomalyType: "unexpected_exit",
          chatId: "oc_aaa",
          senderId: "ou_bbb",
        }),
      }),
    );
    expect(notifier.sendDm).toHaveBeenCalled();
  });
});
