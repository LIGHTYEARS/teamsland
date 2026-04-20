# @teamsland/session — SessionDB 设计

> 日期：2026-04-20
> 状态：已批准
> 依赖：`bun:sqlite`（运行时），`@teamsland/types`（类型）
> 范围：完整 SessionDB — schema、CRUD、FTS5 搜索、WAL 并发、compaction（IoC 模式）

## 概述

`@teamsland/session` 提供 SQLite 持久化层，管理 Agent 会话（sessions）、消息（messages）和任务（tasks）。基于 `bun:sqlite` 实现，支持 WAL 并发写入、FTS5 全文搜索、以及 token 感知的会话压缩（compaction）。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| SQLite 驱动 | `bun:sqlite` | Bun 内建，零依赖，同步 API，高性能 |
| 并发模型 | WAL + busy_timeout + 随机 jitter | 多 Agent 并发写入时避免 SQLITE_BUSY |
| 全文搜索 | FTS5 虚拟表 | 支持 session 内消息搜索，crash recovery 时快速定位上下文 |
| Compaction 触发 | IoC — 注入 compactor 函数 | 解耦 SessionDB 与 Claude Code / LLM 调用 |
| Row 类型位置 | `@teamsland/types` | 下游包（Dashboard、Sidecar）需要导入 Row 类型 |

## 文件结构

```
packages/session/src/
├── index.ts              # barrel 导出
├── session-db.ts         # SessionDB 类（主 API）
├── schema.ts             # SQL DDL 常量 + migration
├── jitter.ts             # 写入 jitter 工具函数
└── __tests__/
    ├── session-db.test.ts
    └── schema.test.ts
```

## 依赖

- 运行时：`bun:sqlite`（Bun 内建，无需 npm 安装）
- Workspace：`@teamsland/types`（`SessionConfig`、Row 类型）
- Dev：`@teamsland/observability`（测试中可选使用 logger）

## 类型定义（新增到 @teamsland/types）

以下类型需要先添加到 `packages/types/src/session.ts` 并通过 barrel 导出：

```typescript
/** Session 状态 */
export type SessionStatus = "active" | "compacted" | "archived";

/** Task 内部状态 */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** Session 记录行 */
export interface SessionRow {
  sessionId: string;
  parentSessionId: string | null;
  teamId: string;
  projectId: string | null;
  agentId: string | null;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  contextHash: string | null;
  metadata: Record<string, unknown> | null;
}

/** Message 记录行 */
export interface MessageRow {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  toolName: string | null;
  traceId: string | null;
  createdAt: number;
}

/** Task 记录行 */
export interface TaskRow {
  taskId: string;
  sessionId: string;
  teamId: string;
  meegoIssueId: string;
  status: TaskStatus;
  subtaskDag: TaskConfig[] | null;
  createdAt: number;
  completedAt: number | null;
}

/** Compaction 结果 */
export interface CompactResult {
  newSessionId: string;
  summary: string;
}
```

## API

### `SessionDB` 类

```typescript
import type { Database } from "bun:sqlite";
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

class SessionDB {
  constructor(dbPath: string, config: SessionConfig)
}
```

**构造行为：**
1. 打开/创建 SQLite 数据库文件
2. 执行 `PRAGMA journal_mode = WAL`
3. 执行 `PRAGMA busy_timeout = {config.busyTimeoutMs}`
4. 运行 schema migration（创建表/索引/FTS5 虚拟表）
5. 存储 `config.sqliteJitterRangeMs` 供写操作使用

### Sessions API

```typescript
createSession(params: {
  sessionId: string;
  teamId: string;
  agentId?: string;
  projectId?: string;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void>

getSession(sessionId: string): SessionRow | undefined

updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>

listActiveSessions(teamId: string): SessionRow[]
```

### Messages API

```typescript
appendMessage(params: {
  sessionId: string;
  role: string;
  content: string;
  toolName?: string;
  traceId?: string;
}): Promise<number>  // returns message id

getMessages(sessionId: string, opts?: {
  limit?: number;
  offset?: number;
}): MessageRow[]

searchMessages(query: string, opts?: {
  sessionId?: string;
  limit?: number;
}): MessageRow[]
```

**`searchMessages` 行为：**
- 使用 FTS5 `MATCH` 语法查询 `messages_fts` 虚拟表
- 可选按 `sessionId` 过滤
- 返回匹配行（含 FTS5 rank 排序）

### Tasks API

```typescript
createTask(params: {
  taskId: string;
  sessionId: string;
  teamId: string;
  meegoIssueId: string;
  subtaskDag?: TaskConfig[];
}): Promise<void>

getTask(taskId: string): TaskRow | undefined

updateTaskStatus(taskId: string, status: TaskStatus, completedAt?: number): Promise<void>

listTasks(sessionId: string): TaskRow[]
```

### Compaction API

```typescript
shouldCompact(
  sessionId: string,
  tokenCounter: (messages: MessageRow[]) => number
): boolean

compact(
  sessionId: string,
  compactor: (messages: MessageRow[]) => Promise<string>
): Promise<CompactResult>
```

**`shouldCompact` 行为：**
1. 获取 session 的所有消息
2. 调用注入的 `tokenCounter` 计算总 token 数
3. 与 `config.compactionTokenThreshold` 比较
4. 返回 `true` 表示需要压缩

**`compact` 行为：**
1. 获取原 session 的所有消息
2. 调用注入的 `compactor` 函数获取摘要文本
3. 生成新 `sessionId`（UUID）
4. `createSession({ sessionId: newId, parentSessionId: originalId, teamId, agentId })`
5. `appendMessage({ sessionId: newId, role: "assistant", content: summary })`
6. `updateSessionStatus(originalId, "compacted")`
7. 返回 `{ newSessionId, summary }`

### Lifecycle

```typescript
close(): void
```

关闭数据库连接。

## Schema (SQL DDL)

```sql
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
  metadata          TEXT  -- JSON
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

-- FTS5 triggers for auto-sync
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
  subtask_dag    TEXT,  -- JSON
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
```

## 写入 Jitter

每次写操作（INSERT/UPDATE）前，sleep 一个随机延迟：

```typescript
function jitter(range: [number, number]): Promise<void> {
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

注意：jitter 仅在写操作中使用，读操作不加延迟。由于 `bun:sqlite` 是同步的，jitter 使写操作变为 async（先 await jitter，再同步执行 SQL）。

## 错误处理

定义 `SessionDbError` 类：

```typescript
class SessionDbError extends Error {
  constructor(
    message: string,
    public readonly code: "SCHEMA_MIGRATION_FAILED" | "SESSION_NOT_FOUND" | "COMPACTION_FAILED" | "FTS_QUERY_ERROR",
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SessionDbError";
  }
}
```

## 测试策略

使用临时文件（`:memory:` 不支持 WAL，使用 `tmpdir` 下的临时 .sqlite 文件）：

- Schema migration 正确执行
- Sessions CRUD
- Messages 追加和查询
- FTS5 搜索返回正确结果
- Task CRUD + 状态流转
- `shouldCompact` 在超过阈值时返回 true
- `compact` 创建新 session 并标记原 session 为 compacted
- `listActiveSessions` 只返回 active 状态
- 并发写入不会 SQLITE_BUSY（jitter 生效）

## 验证标准

- `bunx tsc --noEmit --project packages/session/tsconfig.json` 零错误
- `bunx biome check packages/session/src/` 零错误
- `bunx vitest run packages/session/` 全部通过
- 导出的函数/类型有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
- Row 类型已添加到 `@teamsland/types` 并正确导出
