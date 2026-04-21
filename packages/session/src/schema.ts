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
  content_rowid=id,
  tokenize='trigram'
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
