import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamslandApiError, TeamslandClient } from "../http-client.js";

const BASE_URL = "http://localhost:3000";

describe("TeamslandClient", () => {
  let client: TeamslandClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new TeamslandClient(BASE_URL);
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response;
  }

  describe("spawnWorker", () => {
    it("发送正确的 POST 请求并返回 Worker 创建结果", async () => {
      const responseBody = {
        workerId: "worker-abc",
        pid: 12345,
        sessionId: "sess-xyz",
        worktreePath: "/tmp/worker-abc",
        createdAt: 1700000000000,
      };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      const result = await client.spawnWorker({
        task: "修复 bug",
        repo: "https://github.com/org/repo",
      });

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "修复 bug", repo: "https://github.com/org/repo" }),
      });
      expect(result).toEqual(responseBody);
    });
  });

  describe("listWorkers", () => {
    it("发送 GET 请求到 /api/workers", async () => {
      const responseBody = { workers: [], total: 0 };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      const result = await client.listWorkers();

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
      expect(result).toEqual(responseBody);
    });
  });

  describe("getWorker", () => {
    it("发送 GET 请求到 /api/workers/:id", async () => {
      const responseBody = {
        workerId: "worker-abc",
        pid: 12345,
        sessionId: "sess-xyz",
        status: "running",
        worktreePath: "/tmp/worker-abc",
        createdAt: 1700000000000,
        alive: true,
      };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      const result = await client.getWorker("worker-abc");

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers/worker-abc`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
      expect(result).toEqual(responseBody);
    });
  });

  describe("cancelWorker", () => {
    it("发送 POST 请求到 /api/workers/:id/cancel", async () => {
      const responseBody = {
        workerId: "worker-abc",
        signal: "SIGINT",
        previousStatus: "running",
      };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      const result = await client.cancelWorker("worker-abc");

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers/worker-abc/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
      expect(result).toEqual(responseBody);
    });

    it("强制取消时发送 force 参数", async () => {
      const responseBody = {
        workerId: "worker-abc",
        signal: "SIGKILL",
        previousStatus: "running",
      };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      await client.cancelWorker("worker-abc", true);

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers/worker-abc/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
    });
  });

  describe("getTranscript", () => {
    it("发送 GET 请求到 /api/workers/:id/transcript", async () => {
      const responseBody = {
        workerId: "worker-abc",
        sessionId: "sess-xyz",
        transcriptPath: "/tmp/transcripts/worker-abc.jsonl",
        exists: true,
      };
      mockFetch.mockResolvedValue(mockResponse(200, responseBody));

      const result = await client.getTranscript("worker-abc");

      expect(mockFetch).toHaveBeenCalledWith(`${BASE_URL}/api/workers/worker-abc/transcript`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
      expect(result).toEqual(responseBody);
    });
  });

  describe("错误处理", () => {
    it("非 2xx 状态码抛出 TeamslandApiError 并包含状态码", async () => {
      mockFetch.mockResolvedValue(mockResponse(404, { error: "not found" }));

      await expect(client.getWorker("nonexistent")).rejects.toThrow(TeamslandApiError);

      try {
        await client.getWorker("nonexistent");
      } catch (err: unknown) {
        const apiErr = err as TeamslandApiError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.body).toEqual({ error: "not found" });
      }
    });

    it("500 错误抛出 TeamslandApiError", async () => {
      mockFetch.mockResolvedValue(mockResponse(500, { error: "internal error" }));

      await expect(client.listWorkers()).rejects.toThrow(TeamslandApiError);
    });

    it("连接失败抛出 status 为 0 的 TeamslandApiError", async () => {
      mockFetch.mockRejectedValue(new TypeError("fetch failed"));

      await expect(client.listWorkers()).rejects.toThrow(TeamslandApiError);

      try {
        await client.listWorkers();
      } catch (err: unknown) {
        const apiErr = err as TeamslandApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.message).toContain("Cannot connect to teamsland server");
      }
    });

    it("非 TypeError 异常直接抛出", async () => {
      const customError = new Error("unexpected");
      mockFetch.mockRejectedValue(customError);

      await expect(client.listWorkers()).rejects.toThrow("unexpected");
    });
  });
});
