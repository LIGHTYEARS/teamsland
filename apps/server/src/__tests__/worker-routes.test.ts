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

import type { AgentRecord } from "@teamsland/types";
import { handleWorkerRoutes, type WorkerRouteDeps } from "../worker-routes.js";

// ─── Mock 工厂 ───

function createMockRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: "worker-test001",
    pid: 99999,
    sessionId: "sess-test-001",
    issueId: "cli-abc12345",
    worktreePath: "/tmp/test-repo/.worktrees/req-test",
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function createMockDeps(records: AgentRecord[] = []): WorkerRouteDeps {
  const map = new Map<string, AgentRecord>();
  for (const r of records) {
    map.set(r.agentId, r);
  }

  return {
    registry: {
      register: vi.fn((record: AgentRecord) => {
        map.set(record.agentId, record);
      }),
      get: vi.fn((id: string) => map.get(id)),
      allRunning: vi.fn(() => [...map.values()]),
      unregister: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      runningCount: vi.fn(() => map.size),
    } as unknown as WorkerRouteDeps["registry"],

    processController: {
      spawn: vi.fn().mockResolvedValue({
        pid: 12345,
        sessionId: "sess-new-001",
        stdout: new ReadableStream(),
      }),
    } as unknown as WorkerRouteDeps["processController"],

    worktreeManager: {
      create: vi.fn().mockResolvedValue("/tmp/repos/frontend/.worktrees/req-cli-abc12345"),
    } as unknown as WorkerRouteDeps["worktreeManager"],

    dataPlane: {
      processStream: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkerRouteDeps["dataPlane"],
  };
}

function makeRequest(method: string, path: string, body?: unknown): { req: Request; url: URL } {
  const urlStr = `http://localhost:3000${path}`;
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return { req: new Request(urlStr, init), url: new URL(urlStr) };
}

// ─── 测试套件 ───

describe("handleWorkerRoutes", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // @ts-expect-error — mockImplementation return type doesn't match process.kill overloads
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it("返回 null 当路径不匹配 /api/workers", () => {
    const deps = createMockDeps();
    const { req, url } = makeRequest("GET", "/api/agents");
    const result = handleWorkerRoutes(req, url, deps);
    expect(result).toBeNull();
  });

  describe("POST /api/workers", () => {
    it("有效请求返回 201", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("POST", "/api/workers", {
        task: "实现用户登录功能",
        repo: "/tmp/repos/frontend",
      });

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = await result;
      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(201);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.workerId).toBeDefined();
      expect(json.pid).toBe(12345);
      expect(json.sessionId).toBe("sess-new-001");
      expect(json.worktreePath).toBeDefined();
      expect(json.createdAt).toBeDefined();

      expect(deps.worktreeManager.create).toHaveBeenCalled();
      expect(deps.processController.spawn).toHaveBeenCalled();
      expect(deps.registry.register).toHaveBeenCalled();
      expect(deps.dataPlane.processStream).toHaveBeenCalled();
    });

    it("缺少 task 字段返回 400", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("POST", "/api/workers", {
        repo: "/tmp/repos/frontend",
      });

      const result = handleWorkerRoutes(req, url, deps);
      const response = await result;
      expect(response?.status).toBe(400);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.error).toBe("missing_field");
    });

    it("既无 repo 又无 worktree 返回 400", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("POST", "/api/workers", {
        task: "测试任务",
      });

      const result = handleWorkerRoutes(req, url, deps);
      const response = await result;
      expect(response?.status).toBe(400);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.error).toBe("invalid_params");
    });

    it("同时提供 repo 和 worktree 返回 400", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("POST", "/api/workers", {
        task: "测试任务",
        repo: "/tmp/repos/frontend",
        worktree: "/tmp/repos/frontend/.worktrees/req-test",
      });

      const result = handleWorkerRoutes(req, url, deps);
      const response = await result;
      expect(response?.status).toBe(400);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.error).toBe("invalid_params");
    });
  });

  describe("GET /api/workers", () => {
    it("返回 Worker 列表", async () => {
      const record = createMockRecord();
      const deps = createMockDeps([record]);
      const { req, url } = makeRequest("GET", "/api/workers");

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(200);

      const json = (await response.json()) as { workers: unknown[]; total: number };
      expect(json.workers).toHaveLength(1);
      expect(json.total).toBe(1);
    });
  });

  describe("GET /api/workers/:id", () => {
    it("返回 Worker 详情", async () => {
      const record = createMockRecord();
      const deps = createMockDeps([record]);
      const { req, url } = makeRequest("GET", "/api/workers/worker-test001");

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(200);

      const json = (await response.json()) as Record<string, unknown>;
      expect(json.workerId).toBe("worker-test001");
      expect(typeof json.alive).toBe("boolean");
    });

    it("不存在的 Worker ID 返回 404", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("GET", "/api/workers/worker-nonexist");

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(404);

      const json = (await response.json()) as Record<string, unknown>;
      expect(json.error).toBe("not_found");
    });
  });

  describe("POST /api/workers/:id/cancel", () => {
    it("取消运行中的 Worker", async () => {
      const record = createMockRecord();
      const deps = createMockDeps([record]);
      const { req, url } = makeRequest("POST", "/api/workers/worker-test001/cancel", { force: false });

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = await result;
      expect(response?.status).toBe(200);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.workerId).toBe("worker-test001");
      expect(json.signal).toBe("SIGINT");
      expect(json.previousStatus).toBe("running");
      expect(killSpy).toHaveBeenCalledWith(99999, "SIGINT");
    });

    it("取消已完成的 Worker 返回 409", async () => {
      const record = createMockRecord({ status: "completed" });
      const deps = createMockDeps([record]);
      const { req, url } = makeRequest("POST", "/api/workers/worker-test001/cancel");

      const result = handleWorkerRoutes(req, url, deps);
      const response = await result;
      expect(response?.status).toBe(409);

      const json = (await response?.json()) as Record<string, unknown>;
      expect(json.error).toBe("already_terminated");
    });
  });

  describe("GET /api/workers/:id/transcript", () => {
    it("返回会话记录路径", async () => {
      const record = createMockRecord();
      const deps = createMockDeps([record]);
      const { req, url } = makeRequest("GET", "/api/workers/worker-test001/transcript");

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(200);

      const json = (await response.json()) as Record<string, unknown>;
      expect(json.workerId).toBe("worker-test001");
      expect(json.sessionId).toBe("sess-test-001");
      expect(typeof json.transcriptPath).toBe("string");
      expect(typeof json.exists).toBe("boolean");
    });

    it("不存在的 Worker ID 返回 404", async () => {
      const deps = createMockDeps();
      const { req, url } = makeRequest("GET", "/api/workers/worker-nonexist/transcript");

      const result = handleWorkerRoutes(req, url, deps);
      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(404);
    });
  });
});
