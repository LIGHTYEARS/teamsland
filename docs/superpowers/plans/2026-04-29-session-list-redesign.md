# Session List Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JSONL-scanning session list with a SQLite-backed session list that only shows platform-initiated sessions, with proper type, source, status, and linked entity information.

**Architecture:** Add 5 new columns to the `sessions` table (`session_type`, `source`, `origin_data`, `summary`, `message_count`). Expand `SessionStatus` to 5 states. Wire all 4 creation paths to populate these fields. Add a new `GET /api/sessions` endpoint. Switch the dashboard UI to consume it. Push real-time `session_update` events via WebSocket.

**Tech Stack:** SQLite (bun:sqlite), Hono/Bun HTTP server, React + Zustand-style hooks, Vitest, WebSocket

---

### Task 1: Schema Migration — Add New Columns

**Files:**
- Modify: `packages/session/src/schema.ts:17-75`
- Modify: `packages/types/src/session-row.ts:15,54-75`
- Test: `packages/session/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write the failing test for new columns**

Add a test in `packages/session/src/__tests__/schema.test.ts` that asserts the 5 new columns exist after migration:

```typescript
it("sessions 表包含 session_type, source, origin_data, summary, message_count 列", () => {
  const columns = db
    .prepare("PRAGMA table_info(sessions)")
    .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
  const colMap = new Map(columns.map((c) => [c.name, c]));

  expect(colMap.has("session_type")).toBe(true);
  expect(colMap.has("source")).toBe(true);
  expect(colMap.has("origin_data")).toBe(true);
  expect(colMap.has("summary")).toBe(true);

  const msgCount = colMap.get("message_count");
  expect(msgCount).toBeDefined();
  expect(msgCount!.notnull).toBe(1);
  expect(msgCount!.dflt_value).toBe("0");
});

it("idx_sessions_type_source 索引存在", () => {
  const indexes = db.prepare("PRAGMA index_list(sessions)").all() as Array<{ name: string }>;
  const names = indexes.map((i) => i.name);
  expect(names).toContain("idx_sessions_type_source");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx --bun vitest run packages/session/src/__tests__/schema.test.ts`
Expected: FAIL — columns and index don't exist yet.

- [ ] **Step 3: Add migration SQL to schema.ts**

In `packages/session/src/schema.ts`, add a `MIGRATION_V2_SQL` constant after `SCHEMA_SQL`, and update `migrateSchema()`:

```typescript
export const MIGRATION_V2_SQL = `
ALTER TABLE sessions ADD COLUMN session_type TEXT;
ALTER TABLE sessions ADD COLUMN source TEXT;
ALTER TABLE sessions ADD COLUMN origin_data TEXT;
ALTER TABLE sessions ADD COLUMN summary TEXT;
ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
`;

export const MIGRATION_V2_INDEX = `
CREATE INDEX IF NOT EXISTS idx_sessions_type_source ON sessions(session_type, source);
`;

export function migrateSchema(db: Database): void {
  db.exec(SCHEMA_SQL);

  // v2: add session metadata columns (idempotent — ignore "duplicate column" errors)
  for (const stmt of MIGRATION_V2_SQL.trim().split(";").filter(Boolean)) {
    try {
      db.exec(`${stmt.trim()};`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("duplicate column name")) throw err;
    }
  }

  db.exec(MIGRATION_V2_INDEX);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx --bun vitest run packages/session/src/__tests__/schema.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Expand SessionStatus type**

In `packages/types/src/session-row.ts`, change the `SessionStatus` type:

```typescript
export type SessionStatus = "active" | "completed" | "failed" | "compacted" | "archived";
```

- [ ] **Step 6: Add new fields to SessionRow type**

In `packages/types/src/session-row.ts`, add after the `metadata` field in the `SessionRow` interface:

```typescript
/** Session 角色类型 */
sessionType: "coordinator" | "task_worker" | "observer_worker" | null;
/** 触发来源 */
source: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator" | null;
/** 来源元数据（JSON 反序列化） */
originData: OriginData | null;
/** 会话摘要 */
summary: string | null;
/** 消息计数 */
messageCount: number;
```

And add the `OriginData` interface (exported) before `SessionRow`:

```typescript
export interface OriginData {
  chatId?: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  meegoIssueId?: string;
  observeTargetId?: string;
}
```

- [ ] **Step 7: Add new types to session-row.ts exports and OriginData to types/src/index.ts**

In `packages/types/src/index.ts`, add `OriginData` to the re-export line from `./session-row.js`:

```typescript
export type {
  CompactResult,
  MessageRow,
  OriginData,
  SessionRow,
  SessionStatus,
  TaskRow,
  TaskStatus,
} from "./session-row.js";
```

- [ ] **Step 8: Commit**

```bash
git add packages/session/src/schema.ts packages/types/src/session-row.ts packages/types/src/index.ts packages/session/src/__tests__/schema.test.ts
git commit -m "feat(session): add session_type, source, origin_data, summary, message_count columns"
```

---

### Task 2: Update SessionDB — createSession, appendMessage, mapSessionRow

**Files:**
- Modify: `packages/session/src/session-db.ts:110-135,214-228,510-564`
- Test: `packages/session/src/__tests__/session-db.test.ts`

- [ ] **Step 1: Write failing tests for new createSession fields**

Add in `packages/session/src/__tests__/session-db.test.ts`, inside the `Sessions` describe block:

```typescript
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
  expect(session!.sessionType).toBe("task_worker");
  expect(session!.source).toBe("meego");
  expect(session!.originData).toEqual({ meegoIssueId: "ISSUE-42", senderId: "ou_user001" });
  expect(session!.summary).toBe("实现用户认证模块");
  expect(session!.messageCount).toBe(0);
});
```

- [ ] **Step 2: Write failing test for appendMessage incrementing message_count**

```typescript
it("appendMessage 递增 session 的 messageCount", async () => {
  const sid = `sess-${randomUUID()}`;
  await db.createSession({ sessionId: sid, teamId: "team-alpha" });
  await db.appendMessage({ sessionId: sid, role: "user", content: "hello" });
  await db.appendMessage({ sessionId: sid, role: "assistant", content: "hi" });
  const session = db.getSession(sid);
  expect(session!.messageCount).toBe(2);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: FAIL — new fields undefined, messageCount not incrementing.

- [ ] **Step 4: Update mapSessionRow to include new fields**

In `packages/session/src/session-db.ts`, update the `mapSessionRow` private method and the `RawSessionRow` interface:

Add to `RawSessionRow`:
```typescript
session_type: string | null;
source: string | null;
origin_data: string | null;
summary: string | null;
message_count: number;
```

Update `mapSessionRow`:
```typescript
private mapSessionRow(row: RawSessionRow): SessionRow {
  return {
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id,
    teamId: row.team_id,
    projectId: row.project_id,
    agentId: row.agent_id,
    status: row.status as SessionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contextHash: row.context_hash,
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    sessionType: row.session_type as SessionRow["sessionType"],
    source: row.source as SessionRow["source"],
    originData: row.origin_data ? (JSON.parse(row.origin_data) as OriginData) : null,
    summary: row.summary,
    messageCount: row.message_count,
  };
}
```

Add `import type { OriginData }` to the imports from `@teamsland/types`.

- [ ] **Step 5: Update createSession to accept and persist new fields**

Update the `createSession` params type:
```typescript
async createSession(params: {
  sessionId: string;
  teamId: string;
  agentId?: string;
  projectId?: string;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
  sessionType?: "coordinator" | "task_worker" | "observer_worker";
  source?: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";
  originData?: OriginData;
  summary?: string;
}): Promise<void> {
  await jitter(this.config.sqliteJitterRangeMs);
  const now = Date.now();
  this.db
    .prepare(
      `INSERT INTO sessions (session_id, parent_session_id, team_id, project_id, agent_id, status, created_at, updated_at, metadata, session_type, source, origin_data, summary)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.sessionId,
      params.parentSessionId ?? null,
      params.teamId,
      params.projectId ?? null,
      params.agentId ?? null,
      now,
      now,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.sessionType ?? null,
      params.source ?? null,
      params.originData ? JSON.stringify(params.originData) : null,
      params.summary ?? null,
    );
}
```

- [ ] **Step 6: Update appendMessage to increment message_count**

In the `appendMessage` method, add the counter increment after the INSERT:

```typescript
async appendMessage(params: {
  sessionId: string;
  role: string;
  content: string;
  toolName?: string;
  traceId?: string;
}): Promise<number> {
  await jitter(this.config.sqliteJitterRangeMs);
  const now = Date.now();
  const result = this.db
    .prepare(
      `INSERT INTO messages (session_id, role, content, tool_name, trace_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(params.sessionId, params.role, params.content, params.toolName ?? null, params.traceId ?? null, now);

  this.db
    .prepare("UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE session_id = ?")
    .run(now, params.sessionId);

  return Number(result.lastInsertRowid);
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/session/src/session-db.ts packages/session/src/__tests__/session-db.test.ts
git commit -m "feat(session): support new fields in createSession and message_count in appendMessage"
```

---

### Task 3: Add listSessions Query Method and updateSummary

**Files:**
- Modify: `packages/session/src/session-db.ts`
- Test: `packages/session/src/__tests__/session-db.test.ts`

- [ ] **Step 1: Write failing test for listSessions**

```typescript
describe("listSessions", () => {
  it("按 session_type 和 source 过滤", async () => {
    const teamId = `team-${randomUUID()}`;
    await db.createSession({ sessionId: `sess-${randomUUID()}`, teamId, sessionType: "task_worker", source: "meego" });
    await db.createSession({ sessionId: `sess-${randomUUID()}`, teamId, sessionType: "coordinator", source: "coordinator" });
    await db.createSession({ sessionId: `sess-${randomUUID()}`, teamId, sessionType: "task_worker", source: "dashboard" });

    const meegoWorkers = db.listSessions({ teamId, sessionType: "task_worker", source: "meego" });
    expect(meegoWorkers).toHaveLength(1);
    expect(meegoWorkers[0].source).toBe("meego");

    const allWorkers = db.listSessions({ teamId, sessionType: "task_worker" });
    expect(allWorkers).toHaveLength(2);

    const all = db.listSessions({ teamId });
    expect(all).toHaveLength(3);
  });

  it("分页和排序正确", async () => {
    const teamId = `team-${randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      await db.createSession({ sessionId: `sess-page-${i}-${randomUUID()}`, teamId, sessionType: "task_worker", source: "meego" });
    }
    const page1 = db.listSessions({ teamId, limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = db.listSessions({ teamId, limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    // 降序 — 更新时间最晚的排前面
    expect(page1[0].updatedAt).toBeGreaterThanOrEqual(page1[1].updatedAt);
  });

  it("默认排除 archived 状态", async () => {
    const teamId = `team-${randomUUID()}`;
    const activeId = `sess-${randomUUID()}`;
    const archivedId = `sess-${randomUUID()}`;
    await db.createSession({ sessionId: activeId, teamId, sessionType: "task_worker", source: "meego" });
    await db.createSession({ sessionId: archivedId, teamId, sessionType: "task_worker", source: "meego" });
    await db.updateSessionStatus(archivedId, "archived");

    const sessions = db.listSessions({ teamId });
    expect(sessions.every((s) => s.status !== "archived")).toBe(true);

    const withArchived = db.listSessions({ teamId, includeArchived: true });
    expect(withArchived.some((s) => s.status === "archived")).toBe(true);
  });

  it("search 过滤 summary 和 session_id", async () => {
    const teamId = `team-${randomUUID()}`;
    const sid1 = `sess-${randomUUID()}`;
    const sid2 = `sess-${randomUUID()}`;
    await db.createSession({ sessionId: sid1, teamId, sessionType: "task_worker", source: "meego", summary: "实现用户认证模块" });
    await db.createSession({ sessionId: sid2, teamId, sessionType: "task_worker", source: "meego", summary: "重构配置加载器" });

    const results = db.listSessions({ teamId, search: "认证" });
    expect(results).toHaveLength(1);
    expect(results[0].sessionId).toBe(sid1);
  });

  it("countSessions 返回总数", async () => {
    const teamId = `team-${randomUUID()}`;
    await db.createSession({ sessionId: `sess-${randomUUID()}`, teamId, sessionType: "task_worker", source: "meego" });
    await db.createSession({ sessionId: `sess-${randomUUID()}`, teamId, sessionType: "coordinator", source: "coordinator" });
    const count = db.countSessions({ teamId });
    expect(count).toBe(2);
  });
});
```

- [ ] **Step 2: Write failing test for updateSummary**

```typescript
it("updateSummary 更新 session 摘要", async () => {
  const sid = `sess-${randomUUID()}`;
  await db.createSession({ sessionId: sid, teamId: "team-alpha" });
  expect(db.getSession(sid)!.summary).toBeNull();

  await db.updateSummary(sid, "新的摘要文本");
  expect(db.getSession(sid)!.summary).toBe("新的摘要文本");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: FAIL — `listSessions`, `countSessions`, `updateSummary` don't exist.

- [ ] **Step 4: Implement listSessions method**

Add to `SessionDB` class in `packages/session/src/session-db.ts`:

```typescript
listSessions(opts: {
  teamId: string;
  sessionType?: string;
  source?: string;
  status?: string;
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}): SessionRow[] {
  const conditions: string[] = ["team_id = ?"];
  const params: unknown[] = [opts.teamId];

  if (opts.sessionType) {
    conditions.push("session_type = ?");
    params.push(opts.sessionType);
  }
  if (opts.source) {
    conditions.push("source = ?");
    params.push(opts.source);
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (!opts.includeArchived && !opts.status) {
    conditions.push("status != 'archived'");
  }
  if (opts.search) {
    conditions.push("(summary LIKE ? OR session_id LIKE ?)");
    const pattern = `%${opts.search}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.join(" AND ");
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  params.push(limit, offset);

  const rows = this.db
    .prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params) as RawSessionRow[];

  return rows.map((row) => this.mapSessionRow(row));
}

countSessions(opts: {
  teamId: string;
  sessionType?: string;
  source?: string;
  status?: string;
  search?: string;
  includeArchived?: boolean;
}): number {
  const conditions: string[] = ["team_id = ?"];
  const params: unknown[] = [opts.teamId];

  if (opts.sessionType) {
    conditions.push("session_type = ?");
    params.push(opts.sessionType);
  }
  if (opts.source) {
    conditions.push("source = ?");
    params.push(opts.source);
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (!opts.includeArchived && !opts.status) {
    conditions.push("status != 'archived'");
  }
  if (opts.search) {
    conditions.push("(summary LIKE ? OR session_id LIKE ?)");
    const pattern = `%${opts.search}%`;
    params.push(pattern, pattern);
  }

  const where = conditions.join(" AND ");
  const row = this.db
    .prepare(`SELECT COUNT(*) as count FROM sessions WHERE ${where}`)
    .get(...params) as { count: number };
  return row.count;
}
```

- [ ] **Step 5: Implement updateSummary method**

```typescript
async updateSummary(sessionId: string, summary: string): Promise<void> {
  await jitter(this.config.sqliteJitterRangeMs);
  this.db
    .prepare("UPDATE sessions SET summary = ?, updated_at = ? WHERE session_id = ?")
    .run(summary, Date.now(), sessionId);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/session/src/session-db.ts packages/session/src/__tests__/session-db.test.ts
git commit -m "feat(session): add listSessions, countSessions, updateSummary methods"
```

---

### Task 4: New API Endpoint — GET /api/sessions

**Files:**
- Modify: `apps/server/src/api-routes.ts:56-78`
- Modify: `apps/server/src/dashboard.ts:52-99` (add `sessionDb` to `ApiRouteDeps`)
- Test: `apps/server/src/__tests__/session-list-api.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/session-list-api.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionDB } from "@teamsland/session";
import type { SessionConfig } from "@teamsland/types";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { handleExtendedApiRoutes, type ApiRouteDeps } from "../api-routes.js";

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

    await db.createSession({ sessionId: "sess-1", teamId, sessionType: "task_worker", source: "meego", summary: "认证模块" });
    await db.createSession({ sessionId: "sess-2", teamId, sessionType: "coordinator", source: "coordinator", summary: "协调器启动" });
    await db.createSession({ sessionId: "sess-3", teamId, sessionType: "task_worker", source: "dashboard", summary: "重构配置" });
  });

  afterAll(() => {
    db.close();
    try { unlinkSync(dbPath); unlinkSync(`${dbPath}-wal`); unlinkSync(`${dbPath}-shm`); } catch {}
  });

  it("返回所有非 archived session", async () => {
    const req = new Request("http://localhost/api/sessions");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    expect(res).not.toBeNull();
    const body = await res!.json() as { sessions: unknown[]; total: number };
    expect(body.sessions).toHaveLength(3);
    expect(body.total).toBe(3);
  });

  it("按 type 过滤", async () => {
    const req = new Request("http://localhost/api/sessions?type=task_worker");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    const body = await res!.json() as { sessions: Array<{ sessionType: string }> };
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions.every((s) => s.sessionType === "task_worker")).toBe(true);
  });

  it("按 search 过滤", async () => {
    const req = new Request("http://localhost/api/sessions?search=认证");
    const url = new URL(req.url);
    const res = await handleExtendedApiRoutes(req, url, deps);
    const body = await res!.json() as { sessions: Array<{ sessionId: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].sessionId).toBe("sess-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx --bun vitest run apps/server/src/__tests__/session-list-api.test.ts`
Expected: FAIL — `sessionDb` not on `ApiRouteDeps`, route not handled.

- [ ] **Step 3: Update ApiRouteDeps to include sessionDb and teamId**

In `apps/server/src/api-routes.ts`, update the interface:

```typescript
export interface ApiRouteDeps {
  registry: SubagentRegistry;
  sessionDb: SessionDB;
  teamId: string;
}
```

Add import:
```typescript
import type { SessionDB } from "@teamsland/session";
```

- [ ] **Step 4: Add GET /api/sessions route handler**

In `handleExtendedApiRoutes`, add before the return null:

```typescript
// GET /api/sessions
if (url.pathname === "/api/sessions" && req.method === "GET") {
  return handleSessionsListRoute(url, deps);
}
```

Implement the handler:

```typescript
function handleSessionsListRoute(url: URL, deps: ApiRouteDeps): Response {
  const type = url.searchParams.get("type") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  try {
    const sessions = deps.sessionDb.listSessions({
      teamId: deps.teamId,
      sessionType: type,
      source,
      status,
      search,
      limit,
      offset,
    });
    const total = deps.sessionDb.countSessions({
      teamId: deps.teamId,
      sessionType: type,
      source,
      status,
      search,
    });

    return jsonResponse({
      sessions,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err: unknown) {
    logger.error({ err }, "Session 列表获取失败");
    return jsonResponse({ error: "query_failed", message: "Session 列表查询失败" }, 500);
  }
}
```

- [ ] **Step 5: Update deps construction in dashboard.ts**

In `apps/server/src/dashboard.ts`, where `handleExtendedApiRoutes` is called, pass `sessionDb` and `teamId` in the deps. Find where `ApiRouteDeps` is constructed (in the `fetch` handler) and add:

```typescript
const extendedResult = handleExtendedApiRoutes(req, url, {
  registry: deps.registry,
  sessionDb: deps.sessionDb,
  teamId: deps.config.teamId ?? "default",
});
```

Also add `teamId` to `DashboardConfig` in `packages/types/src/config.ts` if not already present — or use a hardcoded default team ID from the app config.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bunx --bun vitest run apps/server/src/__tests__/session-list-api.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/api-routes.ts apps/server/src/dashboard.ts apps/server/src/__tests__/session-list-api.test.ts
git commit -m "feat(server): add GET /api/sessions endpoint backed by SQLite"
```

---

### Task 5: Wire Session Creation — Dashboard Chat Path

**Files:**
- Modify: `apps/server/src/dashboard-ws.ts:454-466`

- [ ] **Step 1: Add SessionDB.createSession call in handleClaudeCommand**

In `apps/server/src/dashboard-ws.ts`, after the `ctx.registry.register(...)` call (line ~466) and before the `ctx.dataPlane.processStream(...)` call, add:

```typescript
ctx.sessionDb.createSession({
  sessionId: spawnResult.sessionId,
  teamId: ctx.teamId,
  agentId: newAgentId,
  sessionType: "task_worker",
  source: "dashboard",
}).catch((err: unknown) => {
  logger.error({ err, sessionId: spawnResult.sessionId }, "Dashboard session 注册失败");
});
```

This requires `sessionDb` and `teamId` to be available in `WsHandlerContext`. Check what `WsHandlerContext` contains and add them if missing.

- [ ] **Step 2: Verify WsHandlerContext has sessionDb and teamId**

In `apps/server/src/dashboard-ws.ts`, find the `WsHandlerContext` interface and add:

```typescript
sessionDb: SessionDB;
teamId: string;
```

Then in `apps/server/src/dashboard.ts` where `wsContext` is constructed, pass these through from `deps`.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/dashboard-ws.ts apps/server/src/dashboard.ts
git commit -m "feat(server): register dashboard chat sessions in SQLite"
```

---

### Task 6: Wire Session Creation — Coordinator Path

**Files:**
- Modify: `apps/server/src/coordinator-process.ts:131-167`

- [ ] **Step 1: Add SessionDB dependency to CoordinatorProcess**

In `apps/server/src/coordinator-process.ts`, add `sessionDb` to `CoordinatorProcessOpts`:

```typescript
export interface CoordinatorProcessOpts {
  config: CoordinatorProcessConfig;
  contextLoader: CoordinatorContextLoader;
  promptBuilder: CoordinatorPromptBuilderLike;
  spawnFn?: CliProcessOpts["spawnFn"];
  sessionDb?: SessionDB;
  teamId?: string;
}
```

Store as a private field:
```typescript
private readonly sessionDb?: SessionDB;
private readonly teamId: string;
```

In the constructor:
```typescript
this.sessionDb = opts.sessionDb;
this.teamId = opts.teamId ?? "default";
```

- [ ] **Step 2: Register coordinator session in ensureProcess**

In `ensureProcess()`, after `this.sessionId = newSessionId;` (line ~138), add:

```typescript
if (newSessionId && this.sessionDb) {
  this.sessionDb.createSession({
    sessionId: newSessionId,
    teamId: this.teamId,
    sessionType: "coordinator",
    source: "coordinator",
  }).catch((err: unknown) => {
    logger.error({ err, sessionId: newSessionId }, "Coordinator session 注册失败");
  });
}
```

- [ ] **Step 3: Update coordinator initialization to pass sessionDb**

In `apps/server/src/init/coordinator.ts`, where `CoordinatorProcess` is constructed, pass `sessionDb` and `teamId`:

```typescript
const coordinator = new CoordinatorProcess({
  config: { ... },
  contextLoader,
  promptBuilder,
  sessionDb: deps.sessionDb,
  teamId: deps.teamId,
});
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/coordinator-process.ts apps/server/src/init/coordinator.ts
git commit -m "feat(server): register coordinator sessions in SQLite"
```

---

### Task 7: Wire Session Creation — Hook-Spawned Worker Path

**Files:**
- Modify: `packages/hooks/src/context.ts:29-77`
- Modify: `packages/hooks/src/types.ts` (HookContextDeps)

- [ ] **Step 1: Add sessionDb to HookContextDeps**

In `packages/hooks/src/types.ts`, add to `HookContextDeps`:

```typescript
sessionDb: SessionDB;
teamId: string;
```

Add the import for `SessionDB`.

- [ ] **Step 2: Register session in spawn closure**

In `packages/hooks/src/context.ts`, after `deps.registry.register(...)` (line ~67), add:

```typescript
deps.sessionDb.createSession({
  sessionId: result.sessionId,
  teamId: deps.teamId,
  agentId,
  sessionType: "task_worker",
  source: (opts.source as "meego" | "lark_mention" | "lark_dm") ?? "coordinator",
  originData: {
    chatId: opts.chatId,
    senderId: opts.requester,
  },
  summary: opts.task.slice(0, 200),
}).catch((err: unknown) => {
  logger.error({ err, sessionId: result.sessionId }, "Hook worker session 注册失败");
});
```

This requires `opts.source` to be available. Add `source` to the spawn opts type in `packages/hooks/src/types.ts` — the `HookContext.spawn` parameter type:

```typescript
spawn: (opts: {
  task: string;
  requester: string;
  chatId: string;
  repo: string;
  worktreePath?: string;
  source?: "meego" | "lark_mention" | "lark_dm" | "coordinator";
}) => Promise<{ agentId: string; pid: number; sessionId: string; worktreePath: string }>;
```

- [ ] **Step 3: Update callers to pass source**

The hook handlers that call `ctx.spawn(...)` need to pass `source`. These are in `packages/hooks/src/handlers/` — find each handler that processes Meego or Lark events and add the `source` field matching the event origin. For example, a Meego issue handler should pass `source: "meego"`, a Lark DM handler should pass `source: "lark_dm"`, etc.

- [ ] **Step 4: Commit**

```bash
git add packages/hooks/src/context.ts packages/hooks/src/types.ts
git commit -m "feat(hooks): register hook-spawned worker sessions in SQLite"
```

---

### Task 8: Wire Session Creation — Observer Worker Path

**Files:**
- Modify: `packages/sidecar/src/observer-controller.ts:102-145`

- [ ] **Step 1: Add sessionDb dependency to ObserverController**

In the `ObserverController` constructor options, add `sessionDb` and `teamId`. Store as fields.

- [ ] **Step 2: Register observer session after spawn**

In the `observe()` method, after `this.registry.register(...)` (line ~136), add:

```typescript
if (this.sessionDb) {
  this.sessionDb.createSession({
    sessionId: spawnResult.sessionId,
    teamId: this.teamId,
    agentId: observerAgentId,
    sessionType: "observer_worker",
    source: "coordinator",
    originData: { observeTargetId: req.targetAgentId },
  }).catch((err: unknown) => {
    this.logger.error({ err, sessionId: spawnResult.sessionId }, "Observer session 注册失败");
  });
}
```

- [ ] **Step 3: Update ObserverController construction site to pass sessionDb**

In wherever `ObserverController` is instantiated (likely in `apps/server/src/init/sidecar.ts`), pass `sessionDb` and `teamId`.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/observer-controller.ts
git commit -m "feat(sidecar): register observer worker sessions in SQLite"
```

---

### Task 9: Wire Session Status Updates in SidecarDataPlane

**Files:**
- Modify: `packages/sidecar/src/data-plane.ts:186-228,232-252`
- Test: add test scenario in new file `packages/sidecar/src/__tests__/data-plane-status.test.ts`

- [ ] **Step 1: Write failing test for session status update on completion**

Create `packages/sidecar/src/__tests__/data-plane-status.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionDB } from "@teamsland/session";
import type { SessionConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SidecarDataPlane } from "../data-plane.js";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

const TEST_CONFIG: SessionConfig = {
  compactionTokenThreshold: 100,
  sqliteJitterRangeMs: [0, 1],
  busyTimeoutMs: 5000,
};

describe("SidecarDataPlane session status", () => {
  let db: SessionDB;
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `dp-status-test-${randomUUID()}.sqlite`);
    db = new SessionDB(dbPath, TEST_CONFIG);
  });

  afterAll(() => {
    db.close();
    try { unlinkSync(dbPath); unlinkSync(`${dbPath}-wal`); unlinkSync(`${dbPath}-shm`); } catch {}
  });

  it("result 事件将 session 状态更新为 completed", async () => {
    const sessionId = `sess-${randomUUID()}`;
    const agentId = `agent-${randomUUID()}`;
    await db.createSession({ sessionId, teamId: "t", sessionType: "task_worker", source: "meego" });

    const registry = {
      get: vi.fn().mockReturnValue({ agentId, sessionId, status: "running" }),
      allRunning: vi.fn().mockReturnValue([]),
      unregister: vi.fn(),
      subscribe: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const dp = new SidecarDataPlane({ registry: registry as any, sessionDb: db, logger: logger as any });

    const line = JSON.stringify({ type: "result", stop_reason: "end_turn" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${line}\n`));
        controller.close();
      },
    });

    await dp.processStream(agentId, stream);

    const session = db.getSession(sessionId);
    expect(session!.status).toBe("completed");
  });

  it("error 事件将 session 状态更新为 failed", async () => {
    const sessionId = `sess-${randomUUID()}`;
    const agentId = `agent-${randomUUID()}`;
    await db.createSession({ sessionId, teamId: "t", sessionType: "task_worker", source: "meego" });

    const registry = {
      get: vi.fn().mockReturnValue({ agentId, sessionId, status: "running" }),
      allRunning: vi.fn().mockReturnValue([]),
      unregister: vi.fn(),
      subscribe: vi.fn(),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const dp = new SidecarDataPlane({ registry: registry as any, sessionDb: db, logger: logger as any });

    const line = JSON.stringify({ type: "error", message: "crash" });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${line}\n`));
        controller.close();
      },
    });

    await dp.processStream(agentId, stream);

    const session = db.getSession(sessionId);
    expect(session!.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx --bun vitest run packages/sidecar/src/__tests__/data-plane-status.test.ts`
Expected: FAIL — session status not updated.

- [ ] **Step 3: Update updateStatus to also update SessionDB**

In `packages/sidecar/src/data-plane.ts`, modify the `updateStatus` method:

```typescript
private updateStatus(agentId: string, status: "completed" | "failed"): void {
  const record = this.registry.get(agentId);
  if (record) {
    record.status = status;
    this.sessionDb.updateSessionStatus(record.sessionId, status).catch((err) => {
      this.logger.warn({ agentId, err }, "Session 状态更新失败");
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx --bun vitest run packages/sidecar/src/__tests__/data-plane-status.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/data-plane.ts packages/sidecar/src/__tests__/data-plane-status.test.ts
git commit -m "feat(sidecar): update session status in SQLite on agent completion/failure"
```

---

### Task 10: Wire Summary Updates in SidecarDataPlane

**Files:**
- Modify: `packages/sidecar/src/data-plane.ts:162-228`

- [ ] **Step 1: Add summary extraction logic to routeEvent**

In the `routeEvent` method, after the `rawEventListener` call, extract summary from specific event types:

```typescript
// Extract summary from first user message or summary event
if (type === "system" && typeof event.summary === "string") {
  const record = this.registry.get(agentId);
  if (record) {
    this.sessionDb.updateSummary(record.sessionId, (event.summary as string).slice(0, 200)).catch((err) => {
      this.logger.warn({ agentId, err }, "Summary 更新失败");
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/sidecar/src/data-plane.ts
git commit -m "feat(sidecar): extract and persist session summary from NDJSON events"
```

---

### Task 11: WebSocket session_update Events

**Files:**
- Modify: `apps/server/src/dashboard.ts:101-164`

- [ ] **Step 1: Add WsSessionUpdate type**

In `apps/server/src/dashboard.ts`, add:

```typescript
interface WsSessionUpdate {
  type: "session_update";
  action: "created" | "status_changed" | "summary_updated" | "message_count_updated";
  session: SessionRow;
}
```

Add to the `WsMessage` union:
```typescript
type WsMessage =
  | WsAgentsUpdate
  | WsConnected
  | WsNormalizedMessage
  | WsCommandError
  | WsCommandAck
  | WsCoordinatorState
  | WsTicketUpdate
  | WsQueueUpdate
  | WsSessionUpdate;
```

Import `SessionRow` from `@teamsland/types`.

- [ ] **Step 2: Expose broadcastSessionUpdate function**

Add a `broadcastSessionUpdate` function to the `startDashboard` return value:

```typescript
function broadcastSessionUpdate(action: WsSessionUpdate["action"], session: SessionRow): void {
  broadcast(clients, { type: "session_update", action, session });
}
```

Return it:
```typescript
return { server, broadcastQueueUpdate, broadcastSessionUpdate };
```

- [ ] **Step 3: Wire broadcasts at creation and status change points**

The broadcast calls should be triggered from the same places that write to SQLite. The simplest approach: have the `handleClaudeCommand` and other creation paths call `broadcastSessionUpdate("created", ...)` after the `createSession` call. For status changes, `SidecarDataPlane.updateStatus` already fires — the dashboard's `rawEventListener` + registry subscribe can trigger it. Alternatively, add a callback on `SessionDB` or use the existing WebSocket wiring.

The pragmatic approach: in `dashboard.ts`, subscribe to registry changes (already done for `agents_update`) and when a session status changes, also broadcast a `session_update`. This keeps broadcast logic centralized.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/dashboard.ts
git commit -m "feat(server): broadcast session_update WebSocket events"
```

---

### Task 12: New Dashboard Store — useSessionListStore

**Files:**
- Create: `apps/dashboard/src/stores/useSessionListStore.ts`

- [ ] **Step 1: Create the store**

```typescript
import type { SessionRow } from "@teamsland/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

export interface SessionListFilters {
  type?: string;
  source?: string;
  status?: string;
  search?: string;
}

export function useSessionListStore(filters: SessionListFilters = {}): {
  sessions: SessionRow[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
} {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const { subscribe } = useWebSocket();
  const offsetRef = useRef(0);
  const fetchVersionRef = useRef(0);

  const fetchSessions = useCallback(
    (append = false) => {
      const version = ++fetchVersionRef.current;
      if (!append) {
        setLoading(true);
        offsetRef.current = 0;
      }

      const params = new URLSearchParams();
      if (filters.type) params.set("type", filters.type);
      if (filters.source) params.set("source", filters.source);
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      params.set("limit", "50");
      params.set("offset", String(offsetRef.current));

      fetch(`/api/sessions?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ sessions: SessionRow[]; total: number; hasMore: boolean }>;
        })
        .then((data) => {
          if (version !== fetchVersionRef.current) return;
          setSessions((prev) => (append ? [...prev, ...data.sessions] : data.sessions));
          setTotal(data.total);
          setHasMore(data.hasMore);
          offsetRef.current += data.sessions.length;
        })
        .catch(() => {
          if (version !== fetchVersionRef.current) return;
          if (!append) setSessions([]);
        })
        .finally(() => {
          if (version !== fetchVersionRef.current) return;
          setLoading(false);
        });
    },
    [filters.type, filters.source, filters.status, filters.search],
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "session_update") {
        fetchSessions();
      }
    });
  }, [subscribe, fetchSessions]);

  const loadMore = useCallback(() => {
    if (hasMore && !loading) fetchSessions(true);
  }, [hasMore, loading, fetchSessions]);

  return { sessions, total, loading, hasMore, refresh: () => fetchSessions(), loadMore };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/stores/useSessionListStore.ts
git commit -m "feat(dashboard): add useSessionListStore backed by GET /api/sessions"
```

---

### Task 13: Update SessionsListPage to Use New Store

**Files:**
- Modify: `apps/dashboard/src/pages/SessionsListPage.tsx`

- [ ] **Step 1: Rewrite SessionsListPage**

Replace the entire component to use `useSessionListStore` instead of `useProjectStore`:

```typescript
import type { SessionRow } from "@teamsland/types";
import { Button } from "@teamsland/ui/components/ui/button";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@teamsland/ui/components/ui/table";
import { Bot, Cpu, Eye, Inbox, Search } from "lucide-react";
import { useState } from "react";
import { useSessionListStore } from "../stores/useSessionListStore";

const TYPE_ICONS: Record<string, typeof Cpu> = {
  coordinator: Bot,
  task_worker: Cpu,
  observer_worker: Eye,
};

const TYPE_LABELS: Record<string, string> = {
  coordinator: "协调器",
  task_worker: "任务 Worker",
  observer_worker: "观察者",
};

const SOURCE_LABELS: Record<string, string> = {
  meego: "Meego",
  lark_mention: "Lark @",
  lark_dm: "Lark DM",
  dashboard: "Dashboard",
  coordinator: "Coordinator",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  compacted: "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "运行中",
  completed: "已完成",
  failed: "失败",
  compacted: "已压缩",
  archived: "已归档",
};

const TYPE_FILTER_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "coordinator", label: "协调器" },
  { value: "task_worker", label: "任务 Worker" },
  { value: "observer_worker", label: "观察者" },
] as const;

const SOURCE_FILTER_OPTIONS = [
  { value: "", label: "全部来源" },
  { value: "meego", label: "Meego" },
  { value: "lark_dm", label: "Lark DM" },
  { value: "lark_mention", label: "Lark @" },
  { value: "dashboard", label: "Dashboard" },
  { value: "coordinator", label: "Coordinator" },
] as const;

export function SessionsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");

  const { sessions, total, loading, hasMore } = useSessionListStore({
    type: typeFilter || undefined,
    source: sourceFilter || undefined,
    search: search || undefined,
  });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      <header className="shrink-0 px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">会话</h1>
        <p className="text-sm text-muted-foreground">浏览平台管理的 Agent 会话 ({total})</p>
      </header>

      <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-3">
        {/* Type filter */}
        <div className="flex items-center gap-1">
          {TYPE_FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
                typeFilter === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-1">
          {SOURCE_FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSourceFilter(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
                sourceFilter === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索会话…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session ID</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead>关联实体</TableHead>
              <TableHead className="text-right">消息数</TableHead>
              <TableHead>最后活跃</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
                    <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : sessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState
                    icon={<Inbox size={40} strokeWidth={1} />}
                    title={search || typeFilter || sourceFilter ? "没有匹配当前筛选条件的会话" : "暂无平台会话"}
                    description={search || typeFilter || sourceFilter ? "尝试调整筛选条件" : "通过 Dashboard、Meego 或 Lark 发起任务以创建会话"}
                    action={
                      (search || typeFilter || sourceFilter) ? (
                        <Button variant="outline" size="sm" onClick={() => { setSearch(""); setTypeFilter(""); setSourceFilter(""); }}>
                          清除筛选
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              sessions.map((session) => {
                const TypeIcon = TYPE_ICONS[session.sessionType ?? ""] ?? Cpu;
                const originData = session.originData as Record<string, unknown> | null;
                const linkedEntity = originData?.meegoIssueId
                  ? String(originData.meegoIssueId)
                  : originData?.senderName
                    ? String(originData.senderName)
                    : originData?.observeTargetId
                      ? `观察: ${String(originData.observeTargetId).slice(0, 12)}`
                      : "—";

                return (
                  <TableRow
                    key={session.sessionId}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => onNavigate(`/sessions/${session.projectId ?? "unknown"}/${session.sessionId}`)}
                  >
                    <TableCell className="font-mono text-xs">{session.sessionId.slice(0, 16)}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <TypeIcon size={12} className="text-muted-foreground" />
                        <span className="text-xs">{TYPE_LABELS[session.sessionType ?? ""] ?? "未知"}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                        {SOURCE_LABELS[session.source ?? ""] ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] ?? ""}`}>
                        {STATUS_LABELS[session.status] ?? session.status}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">{session.summary ?? "—"}</TableCell>
                    <TableCell className="text-xs">{linkedEntity}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{session.messageCount ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {session.updatedAt ? formatRelativeTime(session.updatedAt) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/dashboard/src/pages/SessionsListPage.tsx
git commit -m "feat(dashboard): rewrite SessionsListPage to use SQLite-backed store"
```

---

### Task 14: Update Sidebar SessionList and SessionFilters

**Files:**
- Modify: `apps/dashboard/src/components/sidebar/SessionList.tsx`
- Modify: `apps/dashboard/src/components/sidebar/SessionFilters.tsx`
- Modify: `apps/dashboard/src/components/sidebar/ProjectList.tsx`
- Modify: `apps/dashboard/src/components/sidebar/Sidebar.tsx`

- [ ] **Step 1: Update SessionList to accept SessionRow[]**

In `apps/dashboard/src/components/sidebar/SessionList.tsx`, change the props to accept `SessionRow[]` from `@teamsland/types` instead of `DiscoveredSession[]`:

```typescript
import type { SessionRow } from "@teamsland/types";

export interface SessionListProps {
  sessions: SessionRow[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  activeFilters?: Set<string>;
}
```

Update the component to read from `SessionRow` fields (`session.sessionId`, `session.sessionType`, `session.summary`, `session.updatedAt`, `session.messageCount`).

- [ ] **Step 2: Update Sidebar to use useSessionListStore**

In `apps/dashboard/src/components/sidebar/Sidebar.tsx`, replace the `projects` prop with `useSessionListStore`:

```typescript
import { useSessionListStore } from "../../stores/useSessionListStore.js";
```

Group sessions by `projectId` for display. Filter by `activeFilters` set.

- [ ] **Step 3: Update SessionFilters**

Add source filter options alongside the existing type filters in `SessionFilters.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/sidebar/SessionList.tsx apps/dashboard/src/components/sidebar/SessionFilters.tsx apps/dashboard/src/components/sidebar/ProjectList.tsx apps/dashboard/src/components/sidebar/Sidebar.tsx
git commit -m "feat(dashboard): update sidebar to use SQLite-backed session list"
```

---

### Task 15: Add SessionType and SessionSource Types to @teamsland/types

**Files:**
- Modify: `packages/types/src/session-row.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Add named types**

In `packages/types/src/session-row.ts`, add:

```typescript
export type SessionType = "coordinator" | "task_worker" | "observer_worker";
export type SessionSource = "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";
```

- [ ] **Step 2: Export from index**

Add `SessionType` and `SessionSource` to the re-export in `packages/types/src/index.ts`.

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/session-row.ts packages/types/src/index.ts
git commit -m "feat(types): add SessionType and SessionSource named types"
```

---

### Task 16: Typecheck and Lint

**Files:** All modified files

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS with no errors. Fix any type errors in the modified files.

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: PASS. Fix any lint issues.

- [ ] **Step 3: Run lint fix if needed**

Run: `bun run lint:fix`

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: resolve typecheck and lint errors from session list redesign"
```

---

### Task 17: Run Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `bun run test:run`
Expected: ALL PASS. If any existing tests fail, fix the regressions.

- [ ] **Step 2: Verify new tests specifically**

Run: `bunx --bun vitest run packages/session/src/__tests__/ packages/sidecar/src/__tests__/data-plane-status.test.ts apps/server/src/__tests__/session-list-api.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Commit any regression fixes**

```bash
git add -A
git commit -m "fix: resolve test regressions from session list redesign"
```

---

### Task 18: UI Verification

- [ ] **Step 1: Start dev services**

Run: `bun run dev`
Wait for all three services to start (viking:1933, server:3001, dashboard:5173).

- [ ] **Step 2: Verify session list page**

Open `http://localhost:5173/#/sessions` in a browser. Verify:
- The session list loads (may be empty if no platform sessions exist yet)
- Type and source filter pills render and are clickable
- Search input works
- Empty state shows appropriate message

- [ ] **Step 3: Create a test session via dashboard chat**

Navigate to a session detail view and send a message. Verify:
- The new session appears in the session list
- Type shows "任务 Worker"
- Source shows "Dashboard"
- Status shows "运行中"
- Summary updates as the session progresses
- Message count increments

- [ ] **Step 4: Use /screenshot-to-feishu for remote verification**

Capture screenshots of the sessions list page at 1920x1080 and send to Feishu for review.
