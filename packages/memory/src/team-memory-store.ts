import { Database } from "bun:sqlite";
import { createLogger, withSpan } from "@teamsland/observability";
import type { AbstractMemoryStore, MemoryEntry, MemoryType, StorageConfig } from "@teamsland/types";
import type { Embedder } from "./embedder.js";

const logger = createLogger("memory:store");

/** L0 抽象类型列表 — profile, preferences, entities, soul, identity */
const L0_TYPES: readonly MemoryType[] = ["profile", "preferences", "entities", "soul", "identity"] as const;

/**
 * SQLite 行记录原始类型
 *
 * bun:sqlite 查询返回的原始行格式，用于 mapRow 转换。
 *
 * @example
 * ```typescript
 * const row: RawEntryRow = {
 *   entry_id: "e1",
 *   team_id: "team-1",
 *   agent_id: "agent-1",
 *   memory_type: "entities",
 *   content: "Alice 是前端工程师",
 *   access_count: 5,
 *   created_at: 1713600000000,
 *   updated_at: 1713600000000,
 *   metadata: "{}",
 * };
 * ```
 */
interface RawEntryRow {
  entry_id: string;
  team_id: string;
  agent_id: string;
  memory_type: string;
  content: string;
  access_count: number;
  created_at: number;
  updated_at: number;
  metadata: string;
}

/**
 * 预检 sqlite-vec (vec0) 扩展是否可用
 *
 * 使用内存数据库尝试加载 vec0 扩展，立即关闭。
 * 不抛出异常 — 返回结构化的检测结果。
 *
 * @returns 检测结果：`ok: true` 表示可用，`ok: false` 附带错误信息
 *
 * @example
 * ```typescript
 * import { checkVec0Available } from "@teamsland/memory";
 *
 * const result = checkVec0Available();
 * if (!result.ok) {
 *   console.error(`sqlite-vec 不可用: ${result.error}`);
 * }
 * ```
 */
export function checkVec0Available(): { ok: true } | { ok: false; error: string } {
  const testDb = new Database(":memory:");
  try {
    testDb.loadExtension("vec0");
    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    testDb.close();
  }
}

/**
 * 团队记忆存储
 *
 * 基于 bun:sqlite + sqlite-vec 扩展 + FTS5 全文索引的记忆存储实现。
 * 使用四表架构：metadata（memory_entries）、向量（memory_vec）、全文索引（memory_fts）、去重（raw_corpus）。
 *
 * **关键约束**：vec0 虚拟表不能与其他表 JOIN（会无限挂起）。
 * 所有向量查询使用两步模式：先从 vec0 查 ID + 距离，再批量从 memory_entries 获取。
 *
 * @example
 * ```typescript
 * import { TeamMemoryStore } from "@teamsland/memory";
 * import type { StorageConfig } from "@teamsland/types";
 * import type { Embedder } from "@teamsland/memory";
 *
 * const store = new TeamMemoryStore("team-1", config, embedder);
 * await store.writeEntry(entry);
 * const results = await store.vectorSearch(queryVec, 10);
 * store.close();
 * ```
 */
export class TeamMemoryStore implements AbstractMemoryStore {
  private readonly db: Database;
  private readonly teamId: string;
  private readonly embedder: Embedder;
  private readonly vectorDimensions: number;

  /**
   * 构造团队记忆存储
   *
   * 打开 SQLite 数据库，启用 WAL 模式，加载 sqlite-vec 扩展，并创建四张表。
   *
   * @param teamId - 团队 ID
   * @param config - 存储配置
   * @param embedder - Embedding 生成器
   *
   * @example
   * ```typescript
   * const store = new TeamMemoryStore("team-1", storageConfig, embedder);
   * ```
   */
  constructor(teamId: string, config: StorageConfig, embedder: Embedder) {
    this.teamId = teamId;
    this.embedder = embedder;
    this.vectorDimensions = config.sqliteVec.vectorDimensions;

    this.db = new Database(config.sqliteVec.dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run(`PRAGMA busy_timeout = ${config.sqliteVec.busyTimeoutMs}`);
    this.db.loadExtension("vec0");

    this.createTables();
    logger.info({ teamId, dbPath: config.sqliteVec.dbPath }, "TeamMemoryStore 初始化完成");
  }

  /** 创建四张核心表 */
  private createTables(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        entry_id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        memory_type TEXT NOT NULL,
        content TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        entry_id TEXT PRIMARY KEY,
        embedding float[${this.vectorDimensions}] distance_metric=cosine
      )
    `);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        team_id UNINDEXED,
        entry_id UNINDEXED
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS raw_corpus (
        team_id TEXT NOT NULL,
        sha256_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(team_id, sha256_hash)
      )
    `);
  }

  /**
   * 向量相似度搜索
   *
   * 两步查询：先从 vec0 获取 ID + 距离，再从 memory_entries 批量获取完整记录。
   * vec0 虚拟表不能 JOIN，必须分步执行。
   *
   * @param queryVec - 查询向量
   * @param limit - 最大返回条数，默认 10
   * @returns 按距离升序排列的记忆条目
   *
   * @example
   * ```typescript
   * const results = await store.vectorSearch(queryVec, 5);
   * for (const entry of results) {
   *   console.log(entry.id, entry.content);
   * }
   * ```
   */
  async vectorSearch(queryVec: number[], limit = 10): Promise<MemoryEntry[]> {
    return withSpan("memory:store", "TeamMemoryStore.vectorSearch", async (span) => {
      span.setAttribute("query.limit", limit);
      span.setAttribute("query.dimensions", queryVec.length);

      // Step 1: 从 vec0 查询最近邻 ID
      const vecResults = this.db
        .query(`SELECT entry_id, distance FROM memory_vec WHERE embedding MATCH ? AND k = ?`)
        .all(new Float32Array(queryVec), limit) as Array<{ entry_id: string; distance: number }>;

      span.setAttribute("vec.result_count", vecResults.length);
      if (vecResults.length === 0) return [];

      // Step 2: 批量从 memory_entries 获取完整记录
      const placeholders = vecResults.map(() => "?").join(", ");
      const ids = vecResults.map((r) => r.entry_id);
      const rows = this.db
        .query(`SELECT * FROM memory_entries WHERE entry_id IN (${placeholders})`)
        .all(...ids) as RawEntryRow[];

      // 按 vec0 返回的距离顺序排序
      const rowMap = new Map<string, RawEntryRow>();
      for (const row of rows) {
        rowMap.set(row.entry_id, row);
      }

      const results: MemoryEntry[] = [];
      for (const vr of vecResults) {
        const row = rowMap.get(vr.entry_id);
        if (row) {
          results.push(this.mapRow(row));
        }
      }
      span.setAttribute("result.count", results.length);
      return results;
    });
  }

  /**
   * 写入一条记忆
   *
   * 生成 embedding 向量后，依次写入 memory_entries（metadata）、memory_vec（向量）、
   * memory_fts（全文索引）。FTS5 写入失败不会阻塞其他写入。
   *
   * @param entry - 记忆条目
   *
   * @example
   * ```typescript
   * await store.writeEntry({
   *   id: "e1",
   *   teamId: "team-1",
   *   agentId: "agent-1",
   *   memoryType: "entities",
   *   content: "Alice 是前端工程师",
   *   accessCount: 1,
   *   createdAt: new Date(),
   *   updatedAt: new Date(),
   *   toDict: () => ({}),
   *   toVectorPoint: () => ({ id: "e1", vector: [], payload: {} }),
   * });
   * ```
   */
  async writeEntry(entry: MemoryEntry): Promise<void> {
    const embedding = await this.embedder.embed(entry.content);

    // 写入 metadata 表
    this.db
      .query(
        `INSERT OR REPLACE INTO memory_entries
         (entry_id, team_id, agent_id, memory_type, content, access_count, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.teamId,
        entry.agentId,
        entry.memoryType,
        entry.content,
        entry.accessCount,
        entry.createdAt.getTime(),
        entry.updatedAt.getTime(),
        JSON.stringify(entry.metadata ?? {}),
      );

    // 写入 vec0 向量表
    this.db
      .query("INSERT OR REPLACE INTO memory_vec (entry_id, embedding) VALUES (?, ?)")
      .run(entry.id, new Float32Array(embedding));

    // 写入 FTS5 — 失败不阻塞
    try {
      this.db
        .query("INSERT INTO memory_fts (content, team_id, entry_id) VALUES (?, ?, ?)")
        .run(entry.content, entry.teamId, entry.id);
    } catch (err: unknown) {
      logger.warn({ entryId: entry.id, err }, "FTS5 写入失败，已跳过");
    }
  }

  /**
   * 检查原始语料是否已存在（按团队 + 内容哈希去重）
   *
   * @param teamId - 团队 ID
   * @param hash - SHA-256 哈希
   * @returns 是否已存在
   *
   * @example
   * ```typescript
   * const isDuplicate = await store.exists("team-1", "abc123");
   * if (!isDuplicate) {
   *   await store.saveRawCorpus("team-1", "abc123");
   * }
   * ```
   */
  async exists(teamId: string, hash: string): Promise<boolean> {
    const row = this.db.query("SELECT 1 FROM raw_corpus WHERE team_id = ? AND sha256_hash = ?").get(teamId, hash);
    return row !== null;
  }

  /**
   * 列出团队下所有 L0 抽象记忆
   *
   * L0 类型包括：profile, preferences, entities, soul, identity。
   *
   * @param teamId - 团队 ID
   * @returns L0 类型的记忆条目列表
   *
   * @example
   * ```typescript
   * const abstracts = await store.listAbstracts("team-1");
   * for (const entry of abstracts) {
   *   console.log(entry.memoryType, entry.content);
   * }
   * ```
   */
  async listAbstracts(teamId: string): Promise<MemoryEntry[]> {
    const placeholders = L0_TYPES.map(() => "?").join(", ");
    const rows = this.db
      .query(`SELECT * FROM memory_entries WHERE team_id = ? AND memory_type IN (${placeholders})`)
      .all(teamId, ...L0_TYPES) as RawEntryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * 列出当前团队的所有记忆条目
   *
   * @returns 当前 teamId 对应的全部记忆条目
   *
   * @example
   * ```typescript
   * const all = await store.listAll();
   * console.log(`共 ${all.length} 条记忆`);
   * ```
   */
  async listAll(): Promise<MemoryEntry[]> {
    const rows = this.db.query("SELECT * FROM memory_entries WHERE team_id = ?").all(this.teamId) as RawEntryRow[];
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * 归档（删除）一条记忆
   *
   * 从 memory_entries、memory_vec、memory_fts 三张表中删除。
   *
   * @param id - 记忆条目 ID
   *
   * @example
   * ```typescript
   * await store.archive("e1");
   * ```
   */
  async archive(id: string): Promise<void> {
    this.db.query("DELETE FROM memory_entries WHERE entry_id = ?").run(id);
    this.db.query("DELETE FROM memory_vec WHERE entry_id = ?").run(id);
    try {
      this.db.query("DELETE FROM memory_fts WHERE entry_id = ?").run(id);
    } catch (err: unknown) {
      logger.warn({ entryId: id, err }, "FTS5 删除失败，已跳过");
    }
  }

  /**
   * 保存原始语料去重记录
   *
   * @param teamId - 团队 ID
   * @param hash - SHA-256 哈希
   *
   * @example
   * ```typescript
   * await store.saveRawCorpus("team-1", "abc123def456");
   * ```
   */
  async saveRawCorpus(teamId: string, hash: string): Promise<void> {
    this.db
      .query("INSERT OR IGNORE INTO raw_corpus (team_id, sha256_hash, created_at) VALUES (?, ?, ?)")
      .run(teamId, hash, Date.now());
  }

  /**
   * FTS5 全文搜索
   *
   * 使用 FTS5 MATCH 语法搜索记忆内容，返回匹配的记忆条目。
   *
   * @param query - FTS5 搜索查询
   * @param limit - 最大返回条数，默认 10
   * @returns 匹配的记忆条目列表
   *
   * @example
   * ```typescript
   * const results = store.ftsSearch("React hooks", 5);
   * for (const entry of results) {
   *   console.log(entry.content);
   * }
   * ```
   */
  ftsSearch(query: string, limit = 10): MemoryEntry[] {
    // 从 FTS5 获取 entry_id 列表
    const ftsRows = this.db
      .query("SELECT entry_id FROM memory_fts WHERE memory_fts MATCH ? LIMIT ?")
      .all(query, limit) as Array<{ entry_id: string }>;

    if (ftsRows.length === 0) return [];

    const placeholders = ftsRows.map(() => "?").join(", ");
    const ids = ftsRows.map((r) => r.entry_id);
    const rows = this.db
      .query(`SELECT * FROM memory_entries WHERE entry_id IN (${placeholders})`)
      .all(...ids) as RawEntryRow[];

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * 批量递增检索命中条目的 access_count
   *
   * 仅递增计数器，不更新 `updated_at`，以避免检索操作重置年龄衰减时钟。
   *
   * @param entryIds - 需要递增的条目 ID 列表
   *
   * @example
   * ```typescript
   * store.incrementAccessCount(["e1", "e2", "e3"]);
   * ```
   */
  incrementAccessCount(entryIds: string[]): void {
    if (entryIds.length === 0) return;
    const placeholders = entryIds.map(() => "?").join(", ");
    this.db.run(
      `UPDATE memory_entries SET access_count = access_count + 1 WHERE entry_id IN (${placeholders})`,
      entryIds,
    );
  }

  /**
   * 按 ID 获取单条记忆
   *
   * @param entryId - 记忆条目 ID
   * @returns 记忆条目，找不到时返回 null
   *
   * @example
   * ```typescript
   * const entry = store.getEntry("e1");
   * if (entry) {
   *   console.log(entry.content);
   * }
   * ```
   */
  getEntry(entryId: string): MemoryEntry | null {
    const row = this.db.query("SELECT * FROM memory_entries WHERE entry_id = ?").get(entryId) as RawEntryRow | null;
    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * 优化 FTS5 索引
   *
   * 执行 FTS5 的 optimize 命令，合并 b-tree 段以提高查询性能。
   *
   * @example
   * ```typescript
   * store.optimizeFts5();
   * ```
   */
  optimizeFts5(): void {
    this.db.run("INSERT INTO memory_fts(memory_fts) VALUES('optimize')");
    logger.info("FTS5 索引优化完成");
  }

  /**
   * 关闭数据库连接
   *
   * @example
   * ```typescript
   * store.close();
   * ```
   */
  close(): void {
    this.db.close();
    logger.info({ teamId: this.teamId }, "TeamMemoryStore 已关闭");
  }

  /**
   * 将 SQLite 原始行转换为 MemoryEntry
   *
   * 包含 toDict() 和 toVectorPoint() 闭包。
   * toVectorPoint().vector 始终为空数组（向量不从 vec0 回读）。
   */
  private mapRow(row: RawEntryRow): MemoryEntry {
    const parsedMetadata = JSON.parse(row.metadata) as Record<string, unknown>;
    const entry: MemoryEntry = {
      id: row.entry_id,
      teamId: row.team_id,
      agentId: row.agent_id,
      memoryType: row.memory_type as MemoryType,
      content: row.content,
      accessCount: row.access_count,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      metadata: parsedMetadata,
      toDict() {
        return {
          id: entry.id,
          teamId: entry.teamId,
          agentId: entry.agentId,
          memoryType: entry.memoryType,
          content: entry.content,
          accessCount: entry.accessCount,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
          metadata: entry.metadata,
        };
      },
      toVectorPoint() {
        return {
          id: entry.id,
          vector: [],
          payload: {
            teamId: entry.teamId,
            agentId: entry.agentId,
            memoryType: entry.memoryType,
            content: entry.content,
            accessCount: entry.accessCount,
          },
        };
      },
    };
    return entry;
  }
}
