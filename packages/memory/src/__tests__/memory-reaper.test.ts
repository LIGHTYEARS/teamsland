import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryConfig, MemoryEntry, MemoryType, StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import { MemoryReaper } from "../memory-reaper.js";
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

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "reaper-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function tmpDbPath(prefix: string): string {
  return join(tmpDir, `${prefix}-${randomUUID()}.sqlite`);
}

function makeStorageConfig(): StorageConfig {
  return {
    sqliteVec: { dbPath: tmpDbPath("reaper"), busyTimeoutMs: 5000, vectorDimensions: 512 },
    embedding: { model: "fake", contextSize: 2048 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  };
}

function makeMemoryConfig(overrides?: Partial<MemoryConfig>): MemoryConfig {
  return {
    decayHalfLifeDays: 30,
    extractLoopMaxIterations: 3,
    exemptTypes: ["decisions", "identity"],
    perTypeTtl: { events: 90, cases: 365, patterns: 365, preferences: 180 },
    ...overrides,
  };
}

function makeEntry(
  id: string,
  content: string,
  memoryType: MemoryType,
  options?: { accessCount?: number; updatedAt?: Date; createdAt?: Date },
): MemoryEntry {
  const now = new Date();
  const accessCount = options?.accessCount ?? 1;
  const updatedAt = options?.updatedAt ?? now;
  const createdAt = options?.createdAt ?? now;
  return {
    id,
    teamId: "team-1",
    agentId: "agent-1",
    memoryType,
    content,
    accessCount,
    createdAt,
    updatedAt,
    toDict: () => ({ id, content }),
    toVectorPoint: () => ({ id, vector: [], payload: { content } }),
  };
}

function createStore(storageConfig?: StorageConfig): TeamMemoryStore {
  const cfg = storageConfig ?? makeStorageConfig();
  const embedder = new FakeEmbedder();
  embedder.init();
  return new TeamMemoryStore("team-1", cfg, embedder);
}

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("MemoryReaper", () => {
  // 1. 豁免类型永不归档
  it("豁免类型（decisions, identity）永不归档", async () => {
    const store = createStore();
    const config = makeMemoryConfig();

    try {
      // 写入豁免类型条目，使用非常旧的更新时间
      const oldDate = new Date(Date.now() - 500 * 86_400_000);
      await store.writeEntry(makeEntry("d1", "决策记录1", "decisions", { updatedAt: oldDate, accessCount: 0 }));
      await store.writeEntry(makeEntry("i1", "身份信息1", "identity", { updatedAt: oldDate, accessCount: 0 }));

      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      // 豁免类型均跳过，archived 为 0
      expect(stats.archived).toBe(0);
      expect(stats.skipped).toBe(2);

      // 条目仍然存在
      expect(store.getEntry("d1")).not.toBeNull();
      expect(store.getEntry("i1")).not.toBeNull();
    } finally {
      store.close();
    }
  });

  // 2. 超过 perTypeTtl 的条目被归档
  it("超过 perTypeTtl 的条目被归档", async () => {
    const store = createStore();
    // events TTL = 90 天，使用 100 天前的 updatedAt
    const config = makeMemoryConfig({ perTypeTtl: { events: 90 } });

    try {
      const oldDate = new Date(Date.now() - 100 * 86_400_000);
      await store.writeEntry(makeEntry("ev1", "旧事件1", "events", { updatedAt: oldDate, accessCount: 5 }));

      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      expect(stats.archived).toBe(1);
      expect(stats.skipped).toBe(0);

      // 条目已被删除
      expect(store.getEntry("ev1")).toBeNull();
    } finally {
      store.close();
    }
  });

  // 3. hotnessScore < 0.1 的条目被归档
  it("hotnessScore < 0.1 的条目被归档", async () => {
    const store = createStore();
    // 使用较短半衰期让旧条目衰减到 < 0.1
    const config = makeMemoryConfig({
      decayHalfLifeDays: 7,
      exemptTypes: [],
      perTypeTtl: {},
    });

    try {
      // accessCount=0 → hotnessScore 恒为 0（< 0.1）
      const oldDate = new Date(Date.now() - 200 * 86_400_000);
      await store.writeEntry(makeEntry("e1", "低热度条目", "entities", { updatedAt: oldDate, accessCount: 0 }));

      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      expect(stats.archived).toBe(1);
      expect(stats.skipped).toBe(0);

      expect(store.getEntry("e1")).toBeNull();
    } finally {
      store.close();
    }
  });

  // 4. 高访问量 + 近期更新的条目不被归档
  it("高访问量近期更新的条目不被归档（生存）", async () => {
    const store = createStore();
    const config = makeMemoryConfig({
      decayHalfLifeDays: 30,
      exemptTypes: [],
      perTypeTtl: {},
    });

    try {
      // accessCount=100 + 刚更新 → 高热度，不应归档
      await store.writeEntry(makeEntry("hot1", "高热度条目", "entities", { accessCount: 100, updatedAt: new Date() }));

      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      expect(stats.archived).toBe(0);
      expect(stats.skipped).toBe(1);

      expect(store.getEntry("hot1")).not.toBeNull();
    } finally {
      store.close();
    }
  });

  // 5. reap() 返回正确的 archived/skipped 计数
  it("reap() 返回正确的 archived/skipped 计数", async () => {
    const store = createStore();
    const config = makeMemoryConfig({
      decayHalfLifeDays: 7,
      exemptTypes: ["decisions"],
      perTypeTtl: { events: 90 },
    });

    try {
      const oldDate = new Date(Date.now() - 100 * 86_400_000);
      const veryOldDate = new Date(Date.now() - 200 * 86_400_000);

      // 豁免类型 → 跳过
      await store.writeEntry(makeEntry("d1", "决策条目", "decisions", { updatedAt: veryOldDate, accessCount: 0 }));
      // 超过 events TTL → 归档
      await store.writeEntry(makeEntry("ev1", "过期事件", "events", { updatedAt: oldDate, accessCount: 100 }));
      // 低热度 → 归档
      await store.writeEntry(makeEntry("e1", "低热度实体", "entities", { updatedAt: veryOldDate, accessCount: 0 }));
      // 高热度 → 跳过
      await store.writeEntry(makeEntry("e2", "高热度实体", "entities", { accessCount: 50, updatedAt: new Date() }));

      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      // d1 → skipped (豁免), ev1 → archived (TTL), e1 → archived (hotness), e2 → skipped (高热度)
      expect(stats.archived).toBe(2);
      expect(stats.skipped).toBe(2);
    } finally {
      store.close();
    }
  });

  // 6. 空存储返回 { archived: 0, skipped: 0 }
  it("空存储返回 { archived: 0, skipped: 0 }", async () => {
    const store = createStore();
    const config = makeMemoryConfig();

    try {
      const reaper = new MemoryReaper(store, config);
      const stats = await reaper.reap();

      expect(stats.archived).toBe(0);
      expect(stats.skipped).toBe(0);
    } finally {
      store.close();
    }
  });
});
