import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntry, MemoryType, StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import { TeamMemoryStore } from "../team-memory-store.js";

// ─── sqlite-vec 可用性检测 ───

let vecAvailable = false;
try {
  const testDb = new Database(":memory:");
  testDb.loadExtension("vec0");
  testDb.close();
  vecAvailable = true;
} catch {
  vecAvailable = false;
}

// ─── FakeEmbedder ───

class FakeEmbedder implements Embedder {
  private initialized = false;

  async init(): Promise<void> {
    this.initialized = true;
  }

  async embed(text: string): Promise<number[]> {
    if (!this.initialized) throw new Error("Embedder not initialized");
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  private hashToVector(text: string): number[] {
    const vec = new Array<number>(512);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) | 0;
    }
    for (let i = 0; i < 512; i++) {
      hash = (hash * 1103515245 + 12345) | 0;
      vec[i] = ((hash >> 16) & 0x7fff) / 0x7fff;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < 512; i++) {
      vec[i] = vec[i] / norm;
    }
    return vec;
  }
}

// ─── 辅助函数 ───

function tmpDbPath(prefix: string): string {
  return join(tmpDir, `${prefix}-${randomUUID()}.sqlite`);
}

function makeEntry(id: string, content: string, memoryType: MemoryType = "entities", teamId = "team-1"): MemoryEntry {
  return {
    id,
    teamId,
    agentId: "agent-1",
    memoryType,
    content,
    accessCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    toDict: () => ({ id, content }),
    toVectorPoint: () => ({ id, vector: [], payload: { content } }),
  };
}

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tms-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("TeamMemoryStore", () => {
  const TEAM_ID = "team-1";

  function createConfig(): StorageConfig {
    return {
      sqliteVec: { dbPath: tmpDbPath("tms"), busyTimeoutMs: 5000, vectorDimensions: 512 },
      embedding: { model: "fake", contextSize: 2048 },
      entityMerge: { cosineThreshold: 0.95 },
      fts5: { optimizeIntervalHours: 24 },
    };
  }

  function createStore(config?: StorageConfig): TeamMemoryStore {
    const cfg = config ?? createConfig();
    const embedder = new FakeEmbedder();
    embedder.init();
    return new TeamMemoryStore(TEAM_ID, cfg, embedder);
  }

  // 1. 构造函数创建全部 4 张表
  it("构造函数创建全部 4 张表", () => {
    const config = createConfig();
    const store = createStore(config);
    try {
      const db = new Database(config.sqliteVec.dbPath);
      db.loadExtension("vec0");
      const tables = db
        .query("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("memory_entries");
      expect(tableNames).toContain("memory_fts");
      expect(tableNames).toContain("raw_corpus");
      // vec0 虚拟表也出现在 sqlite_master
      expect(tableNames).toContain("memory_vec");
      db.close();
    } finally {
      store.close();
    }
  });

  // 2. writeEntry + getEntry 往返
  it("writeEntry + getEntry 往返", async () => {
    const store = createStore();
    try {
      const entry = makeEntry("e1", "Alice 是前端工程师");
      await store.writeEntry(entry);
      const got = store.getEntry("e1");
      expect(got).not.toBeNull();
      expect(got?.id).toBe("e1");
      expect(got?.content).toBe("Alice 是前端工程师");
      expect(got?.memoryType).toBe("entities");
      expect(got?.teamId).toBe("team-1");
      expect(got?.agentId).toBe("agent-1");
      expect(got?.accessCount).toBe(1);
      expect(got?.createdAt).toBeInstanceOf(Date);
      expect(got?.updatedAt).toBeInstanceOf(Date);
      // toDict 和 toVectorPoint 应可调用
      expect(typeof got?.toDict).toBe("function");
      expect(typeof got?.toVectorPoint).toBe("function");
      const dict = got?.toDict();
      expect(dict?.id).toBe("e1");
      const point = got?.toVectorPoint();
      expect(point?.id).toBe("e1");
      expect(point?.vector).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 3. writeEntry + vectorSearch 返回按距离排序的结果
  it("writeEntry + vectorSearch 返回按距离排序的结果", async () => {
    const store = createStore();
    try {
      const entry1 = makeEntry("v1", "React 组件开发");
      const entry2 = makeEntry("v2", "Vue 组件开发");
      const entry3 = makeEntry("v3", "完全不同的主题：数据库优化");
      await store.writeEntry(entry1);
      await store.writeEntry(entry2);
      await store.writeEntry(entry3);

      const embedder = new FakeEmbedder();
      await embedder.init();
      const queryVec = await embedder.embed("React 组件开发");
      const results = await store.vectorSearch(queryVec, 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
      // 第一个结果应该是最相似的
      expect(results[0].id).toBe("v1");
    } finally {
      store.close();
    }
  });

  // 4. ftsSearch 返回 FTS5 MATCH 结果
  it("ftsSearch 返回 FTS5 MATCH 结果", async () => {
    const store = createStore();
    try {
      const entry1 = makeEntry("f1", "React hooks 使用指南");
      const entry2 = makeEntry("f2", "Vue composition API");
      await store.writeEntry(entry1);
      await store.writeEntry(entry2);

      const results = store.ftsSearch("React", 10);
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("f1");
      expect(results[0].content).toContain("React");
    } finally {
      store.close();
    }
  });

  // 5. getEntry 找不到时返回 null
  it("getEntry 找不到时返回 null", () => {
    const store = createStore();
    try {
      const result = store.getEntry("nonexistent");
      expect(result).toBeNull();
    } finally {
      store.close();
    }
  });

  // 6. listAbstracts 只返回 L0 类型
  it("listAbstracts 只返回 L0 类型", async () => {
    const store = createStore();
    try {
      const l0Types: MemoryType[] = ["profile", "preferences", "entities", "soul", "identity"];
      const otherTypes: MemoryType[] = [
        "events",
        "cases",
        "patterns",
        "tools",
        "skills",
        "decisions",
        "project_context",
      ];

      for (const t of l0Types) {
        await store.writeEntry(makeEntry(`l0-${t}`, `L0 content for ${t}`, t));
      }
      for (const t of otherTypes) {
        await store.writeEntry(makeEntry(`other-${t}`, `Other content for ${t}`, t));
      }

      const abstracts = await store.listAbstracts(TEAM_ID);
      expect(abstracts.length).toBe(l0Types.length);
      for (const a of abstracts) {
        expect(l0Types).toContain(a.memoryType);
      }
    } finally {
      store.close();
    }
  });

  // 7. listAll 返回该团队的所有条目
  it("listAll 返回该团队的所有条目", async () => {
    const store = createStore();
    try {
      await store.writeEntry(makeEntry("a1", "Content A", "entities", "team-1"));
      await store.writeEntry(makeEntry("a2", "Content B", "events", "team-1"));
      await store.writeEntry(makeEntry("a3", "Content C", "tools", "team-1"));

      const all = await store.listAll();
      expect(all.length).toBe(3);
      const ids = all.map((e) => e.id).sort();
      expect(ids).toEqual(["a1", "a2", "a3"]);
    } finally {
      store.close();
    }
  });

  // 8. exists + saveRawCorpus 去重工作流
  it("exists + saveRawCorpus 去重工作流", async () => {
    const store = createStore();
    try {
      const hash = "abc123def456";
      const existsBefore = await store.exists(TEAM_ID, hash);
      expect(existsBefore).toBe(false);

      await store.saveRawCorpus(TEAM_ID, hash);

      const existsAfter = await store.exists(TEAM_ID, hash);
      expect(existsAfter).toBe(true);
    } finally {
      store.close();
    }
  });

  // 9. archive 从全部表中删除
  it("archive 从全部表中删除", async () => {
    const store = createStore();
    try {
      const entry = makeEntry("del1", "要删除的记忆");
      await store.writeEntry(entry);

      // 确认写入成功
      expect(store.getEntry("del1")).not.toBeNull();

      await store.archive("del1");

      // 确认从 memory_entries 中删除
      expect(store.getEntry("del1")).toBeNull();
      // FTS5 搜索也不应返回
      const ftsResults = store.ftsSearch("要删除的记忆", 10);
      expect(ftsResults.length).toBe(0);
    } finally {
      store.close();
    }
  });

  // 10. optimizeFts5 运行无错误
  it("optimizeFts5 运行无错误", async () => {
    const store = createStore();
    try {
      await store.writeEntry(makeEntry("opt1", "优化测试内容"));
      expect(() => store.optimizeFts5()).not.toThrow();
    } finally {
      store.close();
    }
  });

  // 11. writeEntry FTS5 失败仍写入成功（metadata + vec 已写入）
  it("writeEntry FTS5 失败仍写入成功", async () => {
    const config = createConfig();
    const embedder = new FakeEmbedder();
    await embedder.init();
    const store = new TeamMemoryStore(TEAM_ID, config, embedder);
    try {
      // 破坏 FTS5 表让后续 insert 失败
      const db = new Database(config.sqliteVec.dbPath);
      db.loadExtension("vec0");
      db.run("DROP TABLE IF EXISTS memory_fts");
      db.close();

      const entry = makeEntry("fts-fail-1", "FTS5 故障测试");
      // 不应抛出异常
      await store.writeEntry(entry);

      // metadata 应正常写入
      const got = store.getEntry("fts-fail-1");
      expect(got).not.toBeNull();
      expect(got?.content).toBe("FTS5 故障测试");
    } finally {
      store.close();
    }
  });

  // 12. vectorSearch 空数据库返回空数组
  it("vectorSearch 空数据库返回空数组", async () => {
    const store = createStore();
    try {
      const embedder = new FakeEmbedder();
      await embedder.init();
      const queryVec = await embedder.embed("任意查询");
      const results = await store.vectorSearch(queryVec, 10);
      expect(results).toEqual([]);
    } finally {
      store.close();
    }
  });
});
