# @teamsland/session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/session` package — a SQLite-backed session store with WAL mode, FTS5 full-text search, write jitter for concurrency, and automatic compaction. Provides `SessionDB` class as the sole public API for managing sessions, messages, and tasks.

**Architecture:** Four source files: `schema.ts` (DDL + migration), `jitter.ts` (write-delay utility), `session-db.ts` (main SessionDB class), and `index.ts` (barrel exports). Row types live in `@teamsland/types/src/session-row.ts`. The SessionDB uses `bun:sqlite` (synchronous API) with async wrappers that apply random jitter before writes to reduce WAL contention in multi-agent scenarios.

**Tech Stack:** TypeScript (strict), Bun, bun:sqlite, Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/session` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has a dependency on `@teamsland/types`. The tsconfig references `../types`.

**Testing constraint:** Vitest normally runs under Node.js, but `bun:sqlite` is only available in Bun runtime. Solution: run session tests with `bunx --bun vitest run packages/session/` which forces Bun runtime. No polyfill needed.

**SQLite constraint:** WAL mode requires a real file — `:memory:` does not support WAL. Tests must use a temp file in `os.tmpdir()` with a unique name, cleaned up in `afterAll`.

## Critical Files

- **Create:** `packages/types/src/session-row.ts` (SessionRow, MessageRow, TaskRow, CompactResult types)
- **Modify:** `packages/types/src/index.ts` (add session-row re-exports)
- **Create:** `packages/session/src/schema.ts` (SQL DDL + migration function)
- **Create:** `packages/session/src/jitter.ts` (write jitter utility)
- **Create:** `packages/session/src/session-db.ts` (SessionDB class)
- **Modify:** `packages/session/src/index.ts` (barrel exports)
- **Create:** `packages/session/src/__tests__/schema.test.ts`
- **Create:** `packages/session/src/__tests__/session-db.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- `createdAt` / `updatedAt` are Unix milliseconds (`Date.now()`)
- `metadata` and `subtaskDag` stored as JSON TEXT in SQLite — serialize with `JSON.stringify`, parse with `JSON.parse`
- Run tests with: `bunx --bun vitest run packages/session/`
- Run typecheck with: `bunx tsc --noEmit --project packages/session/tsconfig.json`
- Run lint with: `bunx biome check packages/session/src/`

---

### Task 1: Add Session Row Types to @teamsland/types

**Files:**
- Create: `packages/types/src/session-row.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create `packages/types/src/session-row.ts`**

Create `/Users/bytedance/workspace/teamsland/packages/types/src/session-row.ts`:

```typescript
import type { TaskConfig } from "./task.js";

/**
 * Session 状态枚举
 *
 * 会话的生命周期状态：活跃、已压缩、已归档。
 *
 * @example
 * ```typescript
 * import type { SessionStatus } from "@teamsland/types";
 *
 * const status: SessionStatus = "active";
 * ```
 */
export type SessionStatus = "active" | "compacted" | "archived";

/**
 * Task 状态枚举
 *
 * 任务执行的生命周期状态。
 *
 * @example
 * ```typescript
 * import type { TaskStatus } from "@teamsland/types";
 *
 * const status: TaskStatus = "running";
 * ```
 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Session 行记录
 *
 * 对应 SQLite sessions 表的一行数据，由 SessionDB 读取后返回。
 *
 * @example
 * ```typescript
 * import type { SessionRow } from "@teamsland/types";
 *
 * const row: SessionRow = {
 *   sessionId: "sess-001",
 *   parentSessionId: null,
 *   teamId: "team-alpha",
 *   projectId: "project_xxx",
 *   agentId: "agent-fe",
 *   status: "active",
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   contextHash: null,
 *   metadata: { source: "meego" },
 * };
 * ```
 */
export interface SessionRow {
  /** 会话唯一标识 */
  sessionId: string;
  /** 父会话 ID（compaction 产生的新会话指向旧会话） */
  parentSessionId: string | null;
  /** 所属团队 ID */
  teamId: string;
  /** 关联的项目 ID */
  projectId: string | null;
  /** 关联的 Agent ID */
  agentId: string | null;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
  /** 最后更新时间（Unix 毫秒时间戳） */
  updatedAt: number;
  /** 上下文哈希，用于检测变更 */
  contextHash: string | null;
  /** 可选扩展元数据（JSON 反序列化） */
  metadata: Record<string, unknown> | null;
}

/**
 * Message 行记录
 *
 * 对应 SQLite messages 表的一行数据。content 字段同时被 FTS5 索引。
 *
 * @example
 * ```typescript
 * import type { MessageRow } from "@teamsland/types";
 *
 * const msg: MessageRow = {
 *   id: 1,
 *   sessionId: "sess-001",
 *   role: "assistant",
 *   content: "已完成代码审查",
 *   toolName: null,
 *   traceId: "trace-abc",
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface MessageRow {
  /** 自增主键 */
  id: number;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色（user / assistant / system / tool） */
  role: string;
  /** 消息文本内容 */
  content: string;
  /** 工具调用名称（仅 role=tool 时有值） */
  toolName: string | null;
  /** 链路追踪 ID */
  traceId: string | null;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
}

/**
 * Task 行记录
 *
 * 对应 SQLite tasks 表的一行数据。subtaskDag 存储为 JSON TEXT。
 *
 * @example
 * ```typescript
 * import type { TaskRow } from "@teamsland/types";
 *
 * const task: TaskRow = {
 *   taskId: "task-001",
 *   sessionId: "sess-001",
 *   teamId: "team-alpha",
 *   meegoIssueId: "ISSUE-42",
 *   status: "pending",
 *   subtaskDag: null,
 *   createdAt: Date.now(),
 *   completedAt: null,
 * };
 * ```
 */
export interface TaskRow {
  /** 任务唯一标识 */
  taskId: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 所属团队 ID */
  teamId: string;
  /** 关联的 Meego Issue ID */
  meegoIssueId: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 子任务 DAG（JSON 反序列化） */
  subtaskDag: TaskConfig[] | null;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
  /** 完成时间（Unix 毫秒时间戳） */
  completedAt: number | null;
}

/**
 * Compaction 结果
 *
 * 执行上下文压缩后返回的结果，包含新会话 ID 和压缩摘要。
 *
 * @example
 * ```typescript
 * import type { CompactResult } from "@teamsland/types";
 *
 * const result: CompactResult = {
 *   newSessionId: "sess-002",
 *   summary: "前 80000 token 的对话已压缩为摘要",
 * };
 * ```
 */
export interface CompactResult {
  /** 压缩后创建的新会话 ID */
  newSessionId: string;
  /** 压缩产生的摘要文本 */
  summary: string;
}
```

- [ ] **Step 2: Update types barrel to export session-row types**

Add to `/Users/bytedance/workspace/teamsland/packages/types/src/index.ts`, after the existing task exports:

```typescript
// Session 持久化行类型
export type { CompactResult, MessageRow, SessionRow, SessionStatus, TaskRow, TaskStatus } from "./session-row.js";
```

- [ ] **Step 3: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/types/src/session-row.ts packages/types/src/index.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/types/src/session-row.ts packages/types/src/index.ts && git commit -m "$(cat <<'EOF'
feat(types): add session-row types — SessionRow, MessageRow, TaskRow, CompactResult

Types for the SessionDB SQLite storage layer. Includes SessionStatus and TaskStatus
union types for lifecycle state management.
EOF
)"
```

---

### Task 2: Implement schema.ts — SQL DDL and Migration

**Files:**
- Create: `packages/session/src/schema.ts`
- Create: `packages/session/src/__tests__/schema.test.ts`

TDD: write failing test first, then implement.

- [ ] **Step 1: Create schema test**

Create `/Users/bytedance/workspace/teamsland/packages/session/src/__tests__/schema.test.ts`:

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCHEMA_SQL, migrateSchema } from "../schema.js";

describe("schema", () => {
  let db: InstanceType<typeof Database>;
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `session-schema-test-${randomUUID()}.sqlite`);
    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // 文件可能不存在
    }
  });

  it("SCHEMA_SQL 是非空字符串", () => {
    expect(typeof SCHEMA_SQL).toBe("string");
    expect(SCHEMA_SQL.length).toBeGreaterThan(100);
  });

  it("migrateSchema 成功创建所有表", () => {
    migrateSchema(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("messages_fts");
  });

  it("migrateSchema 是幂等的（重复调用不报错）", () => {
    expect(() => migrateSchema(db)).not.toThrow();
    expect(() => migrateSchema(db)).not.toThrow();
  });

  it("sessions 表具有正确的列", () => {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("session_id");
    expect(colNames).toContain("parent_session_id");
    expect(colNames).toContain("team_id");
    expect(colNames).toContain("project_id");
    expect(colNames).toContain("agent_id");
    expect(colNames).toContain("status");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("updated_at");
    expect(colNames).toContain("context_hash");
    expect(colNames).toContain("metadata");
  });

  it("messages 表具有正确的列", () => {
    const columns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("id");
    expect(colNames).toContain("session_id");
    expect(colNames).toContain("role");
    expect(colNames).toContain("content");
    expect(colNames).toContain("tool_name");
    expect(colNames).toContain("trace_id");
    expect(colNames).toContain("created_at");
  });

  it("tasks 表具有正确的列", () => {
    const columns = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("task_id");
    expect(colNames).toContain("session_id");
    expect(colNames).toContain("team_id");
    expect(colNames).toContain("meego_issue_id");
    expect(colNames).toContain("status");
    expect(colNames).toContain("subtask_dag");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("completed_at");
  });

  it("FTS5 触发器存在", () => {
    const triggers = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name")
      .all() as { name: string }[];
    const triggerNames = triggers.map((t) => t.name);

    expect(triggerNames).toContain("messages_ai");
    expect(triggerNames).toContain("messages_ad");
  });

  it("索引存在", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_sessions_team_status");
    expect(indexNames).toContain("idx_messages_session");
    expect(indexNames).toContain("idx_tasks_session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/session/src/__tests__/schema.test.ts`
Expected: FAIL — `../schema.js` does not exist

- [ ] **Step 3: Create schema.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/session/src/schema.ts`:

```typescript
import type { Database } from "bun:sqlite";

/**
 * Session 数据库 DDL 语句
 *
 * 包含 sessions、messages、tasks 三张表的建表语句，
 * 以及 FTS5 虚拟表、触发器和索引定义。
 *
 * @example
 * ```typescript
 * import { SCHEMA_SQL } from "@teamsland/session";
 *
 * console.log(SCHEMA_SQL.includes("CREATE TABLE"));
 * // true
 * ```
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id        TEXT PRIMARY KEY,
  parent_session_id TEXT,
  team_id           TEXT NOT NULL,
  project_id        TEXT,
  agent_id          TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  context_hash      TEXT,
  metadata          TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_team_status ON sessions(team_id, status);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  tool_name   TEXT,
  trace_id    TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  content=messages,
  content_rowid=id
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, session_id)
  VALUES (new.id, new.content, new.session_id);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, session_id)
  VALUES ('delete', old.id, old.content, old.session_id);
END;

CREATE TABLE IF NOT EXISTS tasks (
  task_id        TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  team_id        TEXT NOT NULL,
  meego_issue_id TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  subtask_dag    TEXT,
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
`;

/**
 * 执行数据库 schema 迁移
 *
 * 幂等操作：使用 IF NOT EXISTS 保证重复调用安全。
 * 在事务中执行所有 DDL 语句以保证原子性。
 *
 * @param db - bun:sqlite Database 实例
 *
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { migrateSchema } from "@teamsland/session";
 *
 * const db = new Database("./session.sqlite");
 * migrateSchema(db);
 * ```
 */
export function migrateSchema(db: Database): void {
  db.exec(SCHEMA_SQL);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/session/src/__tests__/schema.test.ts`
Expected: All 7 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/session/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/session/src/schema.ts packages/session/src/__tests__/schema.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/session/src/schema.ts packages/session/src/__tests__/schema.test.ts && git commit -m "$(cat <<'EOF'
feat(session): add schema.ts — DDL for sessions, messages, tasks + FTS5

TDD: 7 tests covering table creation, columns, triggers, indexes, idempotency
EOF
)"
```

---

### Task 3: Implement jitter.ts — Write Jitter Utility

**Files:**
- Create: `packages/session/src/jitter.ts`

This is a small internal utility (not exported from the package barrel). No separate test file — it will be implicitly tested through SessionDB tests.

- [ ] **Step 1: Create jitter.ts**

Create `/Users/bytedance/workspace/teamsland/packages/session/src/jitter.ts`:

```typescript
/**
 * 写入抖动延迟
 *
 * 在 SQLite WAL 写入前引入随机延迟，减少多 Agent 并发写入时的锁竞争。
 * 延迟范围由 SessionConfig.sqliteJitterRangeMs 配置。
 *
 * @param range - [最小毫秒, 最大毫秒] 的延迟范围
 * @returns 延迟完成后 resolve 的 Promise
 *
 * @example
 * ```typescript
 * import { jitter } from "./jitter.js";
 *
 * await jitter([20, 150]);
 * // 等待 20~150ms 的随机延迟
 * ```
 */
export function jitter(range: [number, number]): Promise<void> {
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/session/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/session/src/jitter.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/session/src/jitter.ts && git commit -m "feat(session): add jitter.ts — random write delay for WAL contention reduction"
```

---

### Task 4: Implement session-db.ts — SessionDB Class

**Files:**
- Create: `packages/session/src/session-db.ts`
- Create: `packages/session/src/__tests__/session-db.test.ts`

TDD: write comprehensive tests first, then implement.

- [ ] **Step 1: Create session-db test**

Create `/Users/bytedance/workspace/teamsland/packages/session/src/__tests__/session-db.test.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageRow, SessionConfig, TaskConfig } from "@teamsland/types";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SessionDB, SessionDbError } from "../session-db.js";

const TEST_CONFIG: SessionConfig = {
  compactionTokenThreshold: 100,
  sqliteJitterRangeMs: [0, 1],
  busyTimeoutMs: 5000,
};

describe("SessionDB", () => {
  let db: SessionDB;
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `session-db-test-${randomUUID()}.sqlite`);
    db = new SessionDB(dbPath, TEST_CONFIG);
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // 文件可能不存在
    }
  });

  describe("constructor", () => {
    it("打开数据库并设置 WAL 模式", () => {
      const testPath = join(tmpdir(), `session-wal-test-${randomUUID()}.sqlite`);
      const testDb = new SessionDB(testPath, TEST_CONFIG);
      // 不抛错即表示成功
      testDb.close();
      try {
        unlinkSync(testPath);
        unlinkSync(`${testPath}-wal`);
        unlinkSync(`${testPath}-shm`);
      } catch {
        // ignore
      }
    });
  });

  describe("Sessions", () => {
    const sessionId = `sess-${randomUUID()}`;
    const teamId = "team-alpha";

    it("createSession 创建新会话", async () => {
      await db.createSession({
        sessionId,
        teamId,
        agentId: "agent-fe",
        projectId: "project_xxx",
        metadata: { source: "test" },
      });

      const row = db.getSession(sessionId);
      expect(row).toBeDefined();
      expect(row?.sessionId).toBe(sessionId);
      expect(row?.teamId).toBe(teamId);
      expect(row?.agentId).toBe("agent-fe");
      expect(row?.projectId).toBe("project_xxx");
      expect(row?.status).toBe("active");
      expect(row?.metadata).toEqual({ source: "test" });
      expect(row?.parentSessionId).toBeNull();
    });

    it("createSession 支持 parentSessionId", async () => {
      const childId = `sess-child-${randomUUID()}`;
      await db.createSession({
        sessionId: childId,
        teamId,
        parentSessionId: sessionId,
      });

      const row = db.getSession(childId);
      expect(row?.parentSessionId).toBe(sessionId);
    });

    it("getSession 返回 undefined 当会话不存在", () => {
      const row = db.getSession("nonexistent");
      expect(row).toBeUndefined();
    });

    it("updateSessionStatus 更新状态", async () => {
      await db.updateSessionStatus(sessionId, "compacted");
      const row = db.getSession(sessionId);
      expect(row?.status).toBe("compacted");
    });

    it("listActiveSessions 按团队过滤", async () => {
      const activeId = `sess-active-${randomUUID()}`;
      await db.createSession({ sessionId: activeId, teamId });

      const sessions = db.listActiveSessions(teamId);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.every((s) => s.teamId === teamId && s.status === "active")).toBe(true);
    });

    it("listActiveSessions 不返回非活跃会话", () => {
      const sessions = db.listActiveSessions(teamId);
      expect(sessions.every((s) => s.status === "active")).toBe(true);
    });
  });

  describe("Messages", () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = `sess-msg-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-msg" });
    });

    it("appendMessage 返回自增 ID", async () => {
      const id1 = await db.appendMessage({
        sessionId,
        role: "user",
        content: "你好",
      });
      const id2 = await db.appendMessage({
        sessionId,
        role: "assistant",
        content: "你好！有什么可以帮助你的？",
      });

      expect(id1).toBeGreaterThan(0);
      expect(id2).toBe(id1 + 1);
    });

    it("appendMessage 支持 toolName 和 traceId", async () => {
      const id = await db.appendMessage({
        sessionId,
        role: "tool",
        content: '{"result": "ok"}',
        toolName: "git-diff",
        traceId: "trace-001",
      });

      const messages = db.getMessages(sessionId);
      const msg = messages.find((m) => m.id === id);
      expect(msg?.toolName).toBe("git-diff");
      expect(msg?.traceId).toBe("trace-001");
    });

    it("getMessages 按 createdAt 排序返回", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "第一条" });
      await db.appendMessage({ sessionId, role: "assistant", content: "第二条" });
      await db.appendMessage({ sessionId, role: "user", content: "第三条" });

      const messages = db.getMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe("第一条");
      expect(messages[2].content).toBe("第三条");
    });

    it("getMessages 支持 limit 和 offset", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "消息1" });
      await db.appendMessage({ sessionId, role: "user", content: "消息2" });
      await db.appendMessage({ sessionId, role: "user", content: "消息3" });

      const page = db.getMessages(sessionId, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0].content).toBe("消息2");
      expect(page[1].content).toBe("消息3");
    });

    it("searchMessages 通过 FTS5 搜索内容", async () => {
      await db.appendMessage({ sessionId, role: "user", content: "请帮我实现登录功能" });
      await db.appendMessage({ sessionId, role: "assistant", content: "好的，我来实现登录页面" });
      await db.appendMessage({ sessionId, role: "user", content: "谢谢" });

      const results = db.searchMessages("登录");
      expect(results.length).toBeGreaterThanOrEqual(2);
      for (const r of results) {
        expect(r.content).toContain("登录");
      }
    });

    it("searchMessages 支持按 sessionId 过滤", async () => {
      const otherId = `sess-other-${randomUUID()}`;
      await db.createSession({ sessionId: otherId, teamId: "team-other" });
      await db.appendMessage({ sessionId: otherId, role: "user", content: "登录问题" });
      await db.appendMessage({ sessionId, role: "user", content: "登录需求" });

      const results = db.searchMessages("登录", { sessionId });
      expect(results.every((r) => r.sessionId === sessionId)).toBe(true);
    });

    it("searchMessages 支持 limit", async () => {
      for (let i = 0; i < 5; i++) {
        await db.appendMessage({ sessionId, role: "user", content: `搜索测试消息 ${i}` });
      }

      const results = db.searchMessages("搜索测试", { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe("Tasks", () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = `sess-task-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-task" });
    });

    it("createTask 创建新任务", async () => {
      const taskId = `task-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-42",
      });

      const row = db.getTask(taskId);
      expect(row).toBeDefined();
      expect(row?.taskId).toBe(taskId);
      expect(row?.sessionId).toBe(sessionId);
      expect(row?.status).toBe("pending");
      expect(row?.subtaskDag).toBeNull();
      expect(row?.completedAt).toBeNull();
    });

    it("createTask 支持 subtaskDag", async () => {
      const taskId = `task-dag-${randomUUID()}`;
      const dag: TaskConfig[] = [
        {
          issueId: "ISSUE-42",
          meegoEvent: {
            eventId: "evt-1",
            issueId: "ISSUE-42",
            projectKey: "FE",
            type: "issue.created",
            payload: {},
            timestamp: Date.now(),
          },
          meegoProjectId: "project_xxx",
          description: "子任务1",
          triggerType: "frontend_dev",
          agentRole: "coder",
          worktreePath: "/tmp/wt1",
          assigneeId: "user-001",
        },
      ];

      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-42",
        subtaskDag: dag,
      });

      const row = db.getTask(taskId);
      expect(row?.subtaskDag).toEqual(dag);
    });

    it("getTask 返回 undefined 当任务不存在", () => {
      const row = db.getTask("nonexistent");
      expect(row).toBeUndefined();
    });

    it("updateTaskStatus 更新状态", async () => {
      const taskId = `task-status-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-43",
      });

      const now = Date.now();
      await db.updateTaskStatus(taskId, "completed", now);

      const row = db.getTask(taskId);
      expect(row?.status).toBe("completed");
      expect(row?.completedAt).toBe(now);
    });

    it("updateTaskStatus 不传 completedAt 时保持 null", async () => {
      const taskId = `task-running-${randomUUID()}`;
      await db.createTask({
        taskId,
        sessionId,
        teamId: "team-task",
        meegoIssueId: "ISSUE-44",
      });

      await db.updateTaskStatus(taskId, "running");

      const row = db.getTask(taskId);
      expect(row?.status).toBe("running");
      expect(row?.completedAt).toBeNull();
    });

    it("listTasks 返回会话下所有任务", async () => {
      const taskId1 = `task-list-1-${randomUUID()}`;
      const taskId2 = `task-list-2-${randomUUID()}`;

      await db.createTask({ taskId: taskId1, sessionId, teamId: "team-task", meegoIssueId: "ISSUE-50" });
      await db.createTask({ taskId: taskId2, sessionId, teamId: "team-task", meegoIssueId: "ISSUE-51" });

      const tasks = db.listTasks(sessionId);
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      expect(tasks.some((t) => t.taskId === taskId1)).toBe(true);
      expect(tasks.some((t) => t.taskId === taskId2)).toBe(true);
    });
  });

  describe("Compaction", () => {
    it("shouldCompact 当 token 数超过阈值时返回 true", async () => {
      const sessionId = `sess-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      // 添加消息使 token 数超过阈值 (100)
      for (let i = 0; i < 10; i++) {
        await db.appendMessage({
          sessionId,
          role: "user",
          content: `这是一条测试消息，用于触发 compaction 逻辑 ${i}`,
        });
      }

      // 模拟 token 计数器：每条消息算 20 token
      const result = db.shouldCompact(sessionId, () => 200);
      expect(result).toBe(true);
    });

    it("shouldCompact 当 token 数低于阈值时返回 false", async () => {
      const sessionId = `sess-no-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      await db.appendMessage({ sessionId, role: "user", content: "短消息" });

      const result = db.shouldCompact(sessionId, () => 10);
      expect(result).toBe(false);
    });

    it("compact 执行压缩流程", async () => {
      const sessionId = `sess-do-compact-${randomUUID()}`;
      await db.createSession({ sessionId, teamId: "team-compact" });

      for (let i = 0; i < 5; i++) {
        await db.appendMessage({ sessionId, role: "user", content: `对话内容 ${i}` });
      }

      const result = await db.compact(sessionId, async (messages: MessageRow[]) => {
        return `摘要：共 ${messages.length} 条消息`;
      });

      expect(result.newSessionId).toBeDefined();
      expect(result.newSessionId).not.toBe(sessionId);
      expect(result.summary).toBe("摘要：共 5 条消息");

      // 原会话标记为 compacted
      const oldSession = db.getSession(sessionId);
      expect(oldSession?.status).toBe("compacted");

      // 新会话是 active，parent 指向旧会话
      const newSession = db.getSession(result.newSessionId);
      expect(newSession?.status).toBe("active");
      expect(newSession?.parentSessionId).toBe(sessionId);

      // 新会话有一条 system 消息包含摘要
      const newMessages = db.getMessages(result.newSessionId);
      expect(newMessages.length).toBe(1);
      expect(newMessages[0].role).toBe("system");
      expect(newMessages[0].content).toContain("摘要：共 5 条消息");
    });

    it("compact 会话不存在时抛出 SessionDbError", async () => {
      await expect(
        db.compact("nonexistent", async () => "summary")
      ).rejects.toThrow(SessionDbError);
    });
  });

  describe("SessionDbError", () => {
    it("包含正确的 code 和 message", () => {
      const err = new SessionDbError("test error", "SESSION_NOT_FOUND");
      expect(err.message).toBe("test error");
      expect(err.code).toBe("SESSION_NOT_FOUND");
      expect(err.name).toBe("SessionDbError");
    });

    it("支持 cause 链", () => {
      const cause = new Error("root cause");
      const err = new SessionDbError("wrapped", "COMPACTION_FAILED", cause);
      expect(err.cause).toBe(cause);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: FAIL — `../session-db.js` does not exist

- [ ] **Step 3: Create session-db.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/session/src/session-db.ts`:

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CompactResult,
  MessageRow,
  SessionConfig,
  SessionRow,
  SessionStatus,
  TaskConfig,
  TaskRow,
  TaskStatus,
} from "@teamsland/types";
import { jitter } from "./jitter.js";
import { migrateSchema } from "./schema.js";

/**
 * SessionDB 错误码
 */
type SessionDbErrorCode = "SCHEMA_MIGRATION_FAILED" | "SESSION_NOT_FOUND" | "COMPACTION_FAILED" | "FTS_QUERY_ERROR";

/**
 * SessionDB 专用错误类
 *
 * 携带结构化错误码，便于上层根据 code 进行分类处理。
 *
 * @example
 * ```typescript
 * import { SessionDbError } from "@teamsland/session";
 *
 * try {
 *   db.getSession("nonexistent");
 * } catch (err) {
 *   if (err instanceof SessionDbError && err.code === "SESSION_NOT_FOUND") {
 *     console.log("会话不存在");
 *   }
 * }
 * ```
 */
export class SessionDbError extends Error {
  override readonly name = "SessionDbError";

  constructor(
    message: string,
    public readonly code: SessionDbErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Session 持久化数据库
 *
 * 基于 bun:sqlite 的 WAL 模式数据库，提供会话、消息、任务的 CRUD 操作，
 * 以及 FTS5 全文搜索和上下文 compaction 功能。所有写操作引入随机 jitter
 * 以减少多 Agent 并发场景下的 WAL 锁竞争。
 *
 * @example
 * ```typescript
 * import { SessionDB } from "@teamsland/session";
 * import type { SessionConfig } from "@teamsland/types";
 *
 * const config: SessionConfig = {
 *   compactionTokenThreshold: 80000,
 *   sqliteJitterRangeMs: [20, 150],
 *   busyTimeoutMs: 5000,
 * };
 *
 * const db = new SessionDB("./data/session.sqlite", config);
 * await db.createSession({ sessionId: "sess-001", teamId: "team-alpha" });
 * await db.appendMessage({ sessionId: "sess-001", role: "user", content: "你好" });
 * const messages = db.getMessages("sess-001");
 * db.close();
 * ```
 */
export class SessionDB {
  private readonly db: InstanceType<typeof Database>;
  private readonly config: SessionConfig;

  constructor(dbPath: string, config: SessionConfig) {
    this.config = config;
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`PRAGMA busy_timeout = ${config.busyTimeoutMs};`);

    try {
      migrateSchema(this.db);
    } catch (err: unknown) {
      throw new SessionDbError(
        "Schema migration failed",
        "SCHEMA_MIGRATION_FAILED",
        err,
      );
    }
  }

  // ─── Sessions ───

  /**
   * 创建新会话
   *
   * @param params - 会话参数
   *
   * @example
   * ```typescript
   * await db.createSession({
   *   sessionId: "sess-001",
   *   teamId: "team-alpha",
   *   agentId: "agent-fe",
   *   metadata: { source: "meego" },
   * });
   * ```
   */
  async createSession(params: {
    sessionId: string;
    teamId: string;
    agentId?: string;
    projectId?: string;
    parentSessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, parent_session_id, team_id, project_id, agent_id, status, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
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
      );
  }

  /**
   * 根据 ID 获取会话
   *
   * @param sessionId - 会话 ID
   * @returns 会话行数据，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const session = db.getSession("sess-001");
   * if (session) {
   *   console.log(session.status);
   * }
   * ```
   */
  getSession(sessionId: string): SessionRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as RawSessionRow | null;

    if (!row) return undefined;
    return this.mapSessionRow(row);
  }

  /**
   * 更新会话状态
   *
   * @param sessionId - 会话 ID
   * @param status - 新状态
   *
   * @example
   * ```typescript
   * await db.updateSessionStatus("sess-001", "compacted");
   * ```
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?")
      .run(status, Date.now(), sessionId);
  }

  /**
   * 列出团队下所有活跃会话
   *
   * @param teamId - 团队 ID
   * @returns 活跃会话列表
   *
   * @example
   * ```typescript
   * const sessions = db.listActiveSessions("team-alpha");
   * console.log(`活跃会话数: ${sessions.length}`);
   * ```
   */
  listActiveSessions(teamId: string): SessionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE team_id = ? AND status = 'active' ORDER BY created_at DESC")
      .all(teamId) as RawSessionRow[];

    return rows.map((row) => this.mapSessionRow(row));
  }

  // ─── Messages ───

  /**
   * 追加消息到会话
   *
   * @param params - 消息参数
   * @returns 新消息的自增 ID
   *
   * @example
   * ```typescript
   * const id = await db.appendMessage({
   *   sessionId: "sess-001",
   *   role: "user",
   *   content: "请帮我实现登录功能",
   *   traceId: "trace-abc",
   * });
   * ```
   */
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
      .run(
        params.sessionId,
        params.role,
        params.content,
        params.toolName ?? null,
        params.traceId ?? null,
        now,
      );

    return Number(result.lastInsertRowid);
  }

  /**
   * 获取会话下的消息列表
   *
   * @param sessionId - 会话 ID
   * @param opts - 分页选项
   * @returns 按 createdAt 升序排列的消息列表
   *
   * @example
   * ```typescript
   * const messages = db.getMessages("sess-001", { limit: 50, offset: 0 });
   * ```
   */
  getMessages(sessionId: string, opts?: { limit?: number; offset?: number }): MessageRow[] {
    const limit = opts?.limit ?? 1000;
    const offset = opts?.offset ?? 0;

    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(sessionId, limit, offset) as RawMessageRow[];

    return rows.map((row) => this.mapMessageRow(row));
  }

  /**
   * 通过 FTS5 全文搜索消息内容
   *
   * @param query - FTS5 查询字符串
   * @param opts - 过滤选项
   * @returns 匹配的消息列表
   *
   * @example
   * ```typescript
   * const results = db.searchMessages("登录", { sessionId: "sess-001", limit: 20 });
   * ```
   */
  searchMessages(query: string, opts?: { sessionId?: string; limit?: number }): MessageRow[] {
    const limit = opts?.limit ?? 100;

    try {
      if (opts?.sessionId) {
        const rows = this.db
          .prepare(
            `SELECT messages.* FROM messages_fts
             JOIN messages ON messages.id = messages_fts.rowid
             WHERE messages_fts MATCH ? AND messages_fts.session_id = ?
             ORDER BY rank
             LIMIT ?`,
          )
          .all(query, opts.sessionId, limit) as RawMessageRow[];

        return rows.map((row) => this.mapMessageRow(row));
      }

      const rows = this.db
        .prepare(
          `SELECT messages.* FROM messages_fts
           JOIN messages ON messages.id = messages_fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as RawMessageRow[];

      return rows.map((row) => this.mapMessageRow(row));
    } catch (err: unknown) {
      throw new SessionDbError(
        `FTS query failed: ${query}`,
        "FTS_QUERY_ERROR",
        err,
      );
    }
  }

  // ─── Tasks ───

  /**
   * 创建新任务
   *
   * @param params - 任务参数
   *
   * @example
   * ```typescript
   * await db.createTask({
   *   taskId: "task-001",
   *   sessionId: "sess-001",
   *   teamId: "team-alpha",
   *   meegoIssueId: "ISSUE-42",
   *   subtaskDag: [{ ... }],
   * });
   * ```
   */
  async createTask(params: {
    taskId: string;
    sessionId: string;
    teamId: string;
    meegoIssueId: string;
    subtaskDag?: TaskConfig[];
  }): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, session_id, team_id, meego_issue_id, status, subtask_dag, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        params.taskId,
        params.sessionId,
        params.teamId,
        params.meegoIssueId,
        params.subtaskDag ? JSON.stringify(params.subtaskDag) : null,
        now,
      );
  }

  /**
   * 根据 ID 获取任务
   *
   * @param taskId - 任务 ID
   * @returns 任务行数据，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const task = db.getTask("task-001");
   * if (task) {
   *   console.log(task.status);
   * }
   * ```
   */
  getTask(taskId: string): TaskRow | undefined {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE task_id = ?")
      .get(taskId) as RawTaskRow | null;

    if (!row) return undefined;
    return this.mapTaskRow(row);
  }

  /**
   * 更新任务状态
   *
   * @param taskId - 任务 ID
   * @param status - 新状态
   * @param completedAt - 完成时间（可选，仅在 completed/failed 时传入）
   *
   * @example
   * ```typescript
   * await db.updateTaskStatus("task-001", "completed", Date.now());
   * ```
   */
  async updateTaskStatus(taskId: string, status: TaskStatus, completedAt?: number): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    this.db
      .prepare("UPDATE tasks SET status = ?, completed_at = ? WHERE task_id = ?")
      .run(status, completedAt ?? null, taskId);
  }

  /**
   * 列出会话下所有任务
   *
   * @param sessionId - 会话 ID
   * @returns 任务列表
   *
   * @example
   * ```typescript
   * const tasks = db.listTasks("sess-001");
   * console.log(`任务数: ${tasks.length}`);
   * ```
   */
  listTasks(sessionId: string): TaskRow[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as RawTaskRow[];

    return rows.map((row) => this.mapTaskRow(row));
  }

  // ─── Compaction ───

  /**
   * 判断会话是否需要执行上下文压缩
   *
   * @param sessionId - 会话 ID
   * @param tokenCounter - 将消息列表转换为 token 数的函数
   * @returns 是否超过阈值需要压缩
   *
   * @example
   * ```typescript
   * const needsCompact = db.shouldCompact("sess-001", (msgs) => msgs.reduce((sum, m) => sum + m.content.length / 4, 0));
   * ```
   */
  shouldCompact(sessionId: string, tokenCounter: (messages: MessageRow[]) => number): boolean {
    const messages = this.getMessages(sessionId);
    if (messages.length === 0) return false;
    const tokenCount = tokenCounter(messages);
    return tokenCount >= this.config.compactionTokenThreshold;
  }

  /**
   * 执行上下文压缩
   *
   * 将当前会话的所有消息交给 compactor 生成摘要，创建新会话写入摘要，
   * 并将旧会话标记为 compacted。
   *
   * @param sessionId - 待压缩的会话 ID
   * @param compactor - 将消息列表压缩为摘要文本的异步函数
   * @returns 压缩结果（新会话 ID + 摘要）
   *
   * @example
   * ```typescript
   * const result = await db.compact("sess-001", async (messages) => {
   *   return `会话包含 ${messages.length} 条消息，主题为前端开发`;
   * });
   * console.log(result.newSessionId, result.summary);
   * ```
   */
  async compact(
    sessionId: string,
    compactor: (messages: MessageRow[]) => Promise<string>,
  ): Promise<CompactResult> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new SessionDbError(
        `Session not found: ${sessionId}`,
        "SESSION_NOT_FOUND",
      );
    }

    const messages = this.getMessages(sessionId);

    let summary: string;
    try {
      summary = await compactor(messages);
    } catch (err: unknown) {
      throw new SessionDbError(
        `Compaction failed for session: ${sessionId}`,
        "COMPACTION_FAILED",
        err,
      );
    }

    const newSessionId = `sess-${randomUUID()}`;

    // 创建新会话，parent 指向旧会话
    await this.createSession({
      sessionId: newSessionId,
      teamId: session.teamId,
      agentId: session.agentId ?? undefined,
      projectId: session.projectId ?? undefined,
      parentSessionId: sessionId,
      metadata: session.metadata ?? undefined,
    });

    // 写入摘要消息到新会话
    await this.appendMessage({
      sessionId: newSessionId,
      role: "system",
      content: summary,
    });

    // 标记旧会话为 compacted
    await this.updateSessionStatus(sessionId, "compacted");

    return { newSessionId, summary };
  }

  // ─── Lifecycle ───

  /**
   * 关闭数据库连接
   *
   * @example
   * ```typescript
   * db.close();
   * ```
   */
  close(): void {
    this.db.close();
  }

  // ─── Private Helpers ───

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
    };
  }

  private mapMessageRow(row: RawMessageRow): MessageRow {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolName: row.tool_name,
      traceId: row.trace_id,
      createdAt: row.created_at,
    };
  }

  private mapTaskRow(row: RawTaskRow): TaskRow {
    return {
      taskId: row.task_id,
      sessionId: row.session_id,
      teamId: row.team_id,
      meegoIssueId: row.meego_issue_id,
      status: row.status as TaskStatus,
      subtaskDag: row.subtask_dag ? (JSON.parse(row.subtask_dag) as TaskConfig[]) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}

// ─── Raw Row Types (SQLite column names) ───

interface RawSessionRow {
  session_id: string;
  parent_session_id: string | null;
  team_id: string;
  project_id: string | null;
  agent_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  context_hash: string | null;
  metadata: string | null;
}

interface RawMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  trace_id: string | null;
  created_at: number;
}

interface RawTaskRow {
  task_id: string;
  session_id: string;
  team_id: string;
  meego_issue_id: string;
  status: string;
  subtask_dag: string | null;
  created_at: number;
  completed_at: number | null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/session/src/__tests__/session-db.test.ts`
Expected: All tests pass (approximately 20+ assertions across Sessions, Messages, Tasks, Compaction, and SessionDbError describe blocks)

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/session/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/session/src/session-db.ts packages/session/src/__tests__/session-db.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/session/src/session-db.ts packages/session/src/__tests__/session-db.test.ts && git commit -m "$(cat <<'EOF'
feat(session): add SessionDB class — full CRUD for sessions, messages, tasks

Includes WAL mode, FTS5 search, write jitter, and compaction flow.
TDD: 20+ test cases covering all public API methods and error handling.
EOF
)"
```

---

### Task 5: Update Barrel Exports

**Files:**
- Modify: `packages/session/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/session/src/index.ts` with:

```typescript
// @teamsland/session — SessionDB (SQLite WAL + FTS5 + compaction)
// 基于 bun:sqlite 的会话持久化层，所有 Agent 通过 SessionDB 管理对话历史

export { SessionDB, SessionDbError } from "./session-db.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/session/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/session/src/`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/session/src/index.ts && git commit -m "feat(session): add barrel exports — SessionDB, SessionDbError"
```

---

### Task 6: Full Verification

- [ ] **Step 1: Run all session tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/session/`
Expected: All tests pass (schema.test.ts + session-db.test.ts, approximately 27+ tests total)

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/session/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on entire package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/session/src/`
Expected: No errors

- [ ] **Step 4: Verify types package still compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import { SessionDB, SessionDbError } from './packages/session/src/index.ts'; console.log('SessionDB:', typeof SessionDB); console.log('SessionDbError:', typeof SessionDbError);"`
Expected:
```
SessionDB: function
SessionDbError: function
```

- [ ] **Step 6: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/session/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/session/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output (no non-null assertions)

- [ ] **Step 7: Integration smoke test**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "
import { SessionDB } from './packages/session/src/index.ts';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

const dbPath = join(tmpdir(), 'session-smoke-' + randomUUID() + '.sqlite');
const db = new SessionDB(dbPath, { compactionTokenThreshold: 80000, sqliteJitterRangeMs: [0, 1], busyTimeoutMs: 5000 });

await db.createSession({ sessionId: 'smoke-1', teamId: 'team-test' });
await db.appendMessage({ sessionId: 'smoke-1', role: 'user', content: '集成测试' });
const msgs = db.getMessages('smoke-1');
console.log('消息数:', msgs.length);
console.log('内容:', msgs[0].content);

const results = db.searchMessages('集成');
console.log('搜索结果:', results.length);

db.close();
unlinkSync(dbPath);
try { unlinkSync(dbPath + '-wal'); } catch {}
try { unlinkSync(dbPath + '-shm'); } catch {}
console.log('OK');
"`
Expected:
```
消息数: 1
内容: 集成测试
搜索结果: 1
OK
```

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/session/` — all tests pass (~27 tests)
2. `bunx tsc --noEmit --project packages/session/tsconfig.json` — exits 0
3. `bunx tsc --noEmit --project packages/types/tsconfig.json` — exits 0
4. `bunx biome check packages/session/src/` — no errors
5. All exported functions/classes have Chinese JSDoc with `@example`
6. No `any`, no `!` non-null assertions in source files
7. `SessionDB` and `SessionDbError` exported from `@teamsland/session`
8. `SessionRow`, `MessageRow`, `TaskRow`, `CompactResult`, `SessionStatus`, `TaskStatus` exported from `@teamsland/types`
9. `schema.ts` and `jitter.ts` are internal (not exported from barrel)
10. Tests use temp files (not `:memory:`) and clean up in afterAll
11. WAL mode and busy_timeout set in constructor
12. FTS5 virtual table with insert/delete triggers working
13. Compaction creates new session, marks old as compacted, writes summary
