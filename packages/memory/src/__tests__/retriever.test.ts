import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntry, MemoryType, StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import { retrieve } from "../retriever.js";
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

const TEST_CONFIG: StorageConfig = {
  sqliteVec: { dbPath: "will-be-overridden", busyTimeoutMs: 5000, vectorDimensions: 512 },
  embedding: { model: "fake", contextSize: 2048 },
  entityMerge: { cosineThreshold: 0.95 },
  fts5: { optimizeIntervalHours: 24 },
};

let tmpDir: string;

function tmpDbPath(prefix: string): string {
  return join(tmpDir, `${prefix}-${randomUUID()}.sqlite`);
}

function makeEntry(
  id: string,
  content: string,
  memoryType: MemoryType = "entities",
  teamId = "team-1",
  accessCount = 1,
): MemoryEntry {
  return {
    id,
    teamId,
    agentId: "agent-1",
    memoryType,
    content,
    accessCount,
    createdAt: new Date(),
    updatedAt: new Date(),
    toDict: () => ({ id, content }),
    toVectorPoint: () => ({ id, vector: [], payload: { content } }),
  };
}

function createConfig(): StorageConfig {
  return {
    ...TEST_CONFIG,
    sqliteVec: { ...TEST_CONFIG.sqliteVec, dbPath: tmpDbPath("retriever") },
  };
}

async function createStore(teamId = "team-1"): Promise<{ store: TeamMemoryStore; embedder: FakeEmbedder }> {
  const config = createConfig();
  const embedder = new FakeEmbedder();
  await embedder.init();
  const store = new TeamMemoryStore(teamId, config, embedder);
  return { store, embedder };
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "retriever-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("retrieve", () => {
  const TEAM_ID = "team-1";

  // 1. L0 abstracts 出现在结果前端
  it("L0 abstracts 出现在结果前端", async () => {
    const { store, embedder } = await createStore();
    try {
      // 写入 L0 条目（profile 类型）
      await store.writeEntry(makeEntry("l0-1", "团队 profile 信息", "profile"));
      await store.writeEntry(makeEntry("l0-2", "团队偏好设置", "preferences"));
      // 写入非 L0 条目
      await store.writeEntry(makeEntry("e1", "技术决策记录", "decisions"));
      await store.writeEntry(makeEntry("e2", "事件日志内容", "events"));

      const results = await retrieve(store, embedder, "技术决策", TEAM_ID, 10);

      // L0 条目必须出现在前两个位置
      const l0Ids = new Set(["l0-1", "l0-2"]);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(l0Ids.has(results[0].id)).toBe(true);
      expect(l0Ids.has(results[1].id)).toBe(true);
    } finally {
      store.close();
    }
  });

  // 2. 向量搜索结果在 L0 之后
  it("向量搜索结果在 L0 之后", async () => {
    const { store, embedder } = await createStore();
    try {
      // 写入 L0 条目
      await store.writeEntry(makeEntry("l0-profile", "团队概况", "profile"));

      // 写入非 L0 条目，内容与查询相似
      await store.writeEntry(makeEntry("vec-1", "React 技术栈决策", "decisions"));
      await store.writeEntry(makeEntry("vec-2", "Vue 框架选型", "decisions"));

      const results = await retrieve(store, embedder, "React", TEAM_ID, 10);

      // 第一个必须是 L0
      expect(results[0].id).toBe("l0-profile");

      // 后续应包含非 L0 条目
      const nonL0Ids = results.slice(1).map((r) => r.id);
      expect(nonL0Ids.length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  // 3. 遵守 topK 限制
  it("遵守 topK 限制", async () => {
    const { store, embedder } = await createStore();
    try {
      // 写入多条各类型条目
      for (let i = 0; i < 5; i++) {
        await store.writeEntry(makeEntry(`l0-${i}`, `L0 内容 ${i}`, "entities"));
      }
      for (let i = 0; i < 10; i++) {
        await store.writeEntry(makeEntry(`e-${i}`, `事件内容 ${i}`, "events"));
      }

      const topK = 7;
      const results = await retrieve(store, embedder, "内容", TEAM_ID, topK);

      expect(results.length).toBeLessThanOrEqual(topK);
    } finally {
      store.close();
    }
  });

  // 4. L0 条目计入 topK，ranked 填满剩余名额
  it("L0 条目计入 topK，ranked 填满剩余名额", async () => {
    const { store, embedder } = await createStore();
    try {
      // 写入 3 条 L0 条目
      for (let i = 0; i < 3; i++) {
        await store.writeEntry(makeEntry(`l0-${i}`, `L0 profile ${i}`, "profile"));
      }

      // 写入 5 条非 L0 条目
      for (let i = 0; i < 5; i++) {
        await store.writeEntry(makeEntry(`evt-${i}`, `事件 ${i}`, "events"));
      }

      // topK=5：L0 占 3 名额，ranked 最多补 2
      const results = await retrieve(store, embedder, "内容", TEAM_ID, 5);

      expect(results.length).toBeLessThanOrEqual(5);

      // 前 3 个应该全是 L0
      const l0Ids = new Set(["l0-0", "l0-1", "l0-2"]);
      for (const r of results.slice(0, 3)) {
        expect(l0Ids.has(r.id)).toBe(true);
      }
    } finally {
      store.close();
    }
  });

  // 5. 空存储返回空数组
  it("空存储返回空数组", async () => {
    const { store, embedder } = await createStore();
    try {
      const results = await retrieve(store, embedder, "任意查询", TEAM_ID, 10);
      expect(results).toEqual([]);
    } finally {
      store.close();
    }
  });
});
