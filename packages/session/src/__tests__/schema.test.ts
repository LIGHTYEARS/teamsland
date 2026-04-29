import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateSchema, SCHEMA_SQL } from "../schema.js";

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

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
      name: string;
    }[];
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
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all() as {
      name: string;
    }[];
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

  it("sessions 表包含 v2 新增列", () => {
    const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain("session_type");
    expect(colNames).toContain("source");
    expect(colNames).toContain("origin_data");
    expect(colNames).toContain("summary");
    expect(colNames).toContain("message_count");
  });

  it("idx_sessions_type_source 索引存在", () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_sessions_type_source'")
      .all() as { name: string }[];

    expect(indexes).toHaveLength(1);
  });
});
