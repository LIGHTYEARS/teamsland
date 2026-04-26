import { describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import type { PersistentQueue } from "@teamsland/queue";
import type { CoordinatorSessionManager } from "../coordinator.js";
import { handleObservabilityRoutes, type ObservabilityRouteDeps } from "../observability-routes.js";

// Mock coordinator manager
function makeCoordinatorManager(overrides = {}) {
  return {
    getState: vi.fn().mockReturnValue("idle"),
    getActiveSession: vi.fn().mockReturnValue(null),
    getRecoveryCount: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as CoordinatorSessionManager;
}

// Mock queue
function makeQueue(overrides = {}) {
  return {
    stats: vi.fn().mockReturnValue({ pending: 0, processing: 0, completed: 5, failed: 0, dead: 1 }),
    deadLetters: vi.fn().mockReturnValue([{ id: "dead-1", type: "lark_dm", lastError: "test" }]),
    ...overrides,
  } as unknown as PersistentQueue;
}

function makeDeps(overrides: Partial<ObservabilityRouteDeps> = {}): ObservabilityRouteDeps {
  return {
    coordinatorManager: null,
    queue: makeQueue(),
    ...overrides,
  };
}

/** 从可能为 null 的路由结果中获取 Response（断言非 null 后 await） */
async function getResponse(result: Response | Promise<Response> | null): Promise<Response> {
  expect(result).not.toBeNull();
  return await (result as Response | Promise<Response>);
}

describe("handleObservabilityRoutes", () => {
  it("should return null for non-matching routes", () => {
    const result = handleObservabilityRoutes(
      new Request("http://localhost/api/workers"),
      new URL("http://localhost/api/workers"),
      makeDeps(),
    );
    expect(result).toBeNull();
  });

  describe("GET /api/coordinator/status", () => {
    it("should return enabled: false when coordinator is null", async () => {
      const result = handleObservabilityRoutes(
        new Request("http://localhost/api/coordinator/status"),
        new URL("http://localhost/api/coordinator/status"),
        makeDeps(),
      );
      const res = await getResponse(result);
      const body = await res.json();
      expect(body).toEqual({ enabled: false });
    });

    it("should return coordinator status when enabled", async () => {
      const manager = makeCoordinatorManager({
        getState: vi.fn().mockReturnValue("running"),
        getRecoveryCount: vi.fn().mockReturnValue(1),
      });
      const result = handleObservabilityRoutes(
        new Request("http://localhost/api/coordinator/status"),
        new URL("http://localhost/api/coordinator/status"),
        makeDeps({ coordinatorManager: manager }),
      );
      const res = await getResponse(result);
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.state).toBe("running");
      expect(body.recoveryCount).toBe(1);
    });
  });

  describe("GET /api/queue/stats", () => {
    it("should return queue stats", async () => {
      const queue = makeQueue();
      const result = handleObservabilityRoutes(
        new Request("http://localhost/api/queue/stats"),
        new URL("http://localhost/api/queue/stats"),
        makeDeps({ queue }),
      );
      const res = await getResponse(result);
      const body = await res.json();
      expect(body.pending).toBe(0);
      expect(body.dead).toBe(1);
      expect(queue.stats).toHaveBeenCalled();
    });
  });

  describe("GET /api/queue/dead-letters", () => {
    it("should return dead letters with default limit", async () => {
      const queue = makeQueue();
      const result = handleObservabilityRoutes(
        new Request("http://localhost/api/queue/dead-letters"),
        new URL("http://localhost/api/queue/dead-letters"),
        makeDeps({ queue }),
      );
      const res = await getResponse(result);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(queue.deadLetters).toHaveBeenCalledWith(50);
    });

    it("should respect custom limit", async () => {
      const queue = makeQueue();
      handleObservabilityRoutes(
        new Request("http://localhost/api/queue/dead-letters?limit=10"),
        new URL("http://localhost/api/queue/dead-letters?limit=10"),
        makeDeps({ queue }),
      );
      expect(queue.deadLetters).toHaveBeenCalledWith(10);
    });
  });
});
