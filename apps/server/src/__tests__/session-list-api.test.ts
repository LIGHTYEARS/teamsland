import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionDB } from "@teamsland/session";
import type { SessionConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ApiRouteDeps, handleExtendedApiRoutes } from "../api-routes.js";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const TEST_CONFIG: SessionConfig = {
  compactionTokenThreshold: 100,
  sqliteJitterRangeMs: [0, 1],
  busyTimeoutMs: 5000,
};

describe("GET /api/sessions", () => {
  let db: SessionDB;
  let dbPath: string;
  let deps: ApiRouteDeps;
  const teamId = "team-default";

  beforeAll(async () => {
    dbPath = join(tmpdir(), `session-api-test-${randomUUID()}.sqlite`);
    db = new SessionDB(dbPath, TEST_CONFIG);

    deps = {
      registry: { allRunning: () => [] } as unknown as ApiRouteDeps["registry"],
      sessionDb: db,
      teamId,
    };

    await db.createSession({
      sessionId: "sess-1",
      teamId,
      sessionType: "task_worker",
      source: "meego",
      summary: "认证模块",
    });
    await db.createSession({
      sessionId: "sess-2",
      teamId,
      sessionType: "coordinator",
      source: "coordinator",
      summary: "协调器启动",
    });
    await db.createSession({
      sessionId: "sess-3",
      teamId,
      sessionType: "task_worker",
      source: "dashboard",
      summary: "重构配置",
    });
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {}
  });

  it("返回所有非 archived session", async () => {
    const req = new Request("http://localhost/api/sessions");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    expect(res).not.toBeNull();
    const body = (await res?.json()) as { sessions: unknown[]; total: number };
    expect(body.sessions).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it("按 type 过滤", async () => {
    const req = new Request("http://localhost/api/sessions?type=task_worker");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    const body = (await res?.json()) as { sessions: Array<{ sessionType: string }> };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.every((s) => s.sessionType === "task_worker")).toBe(true);
  });

  it("按 search 过滤", async () => {
    const req = new Request("http://localhost/api/sessions?search=认证");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    const body = (await res?.json()) as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-1");
  });
});
