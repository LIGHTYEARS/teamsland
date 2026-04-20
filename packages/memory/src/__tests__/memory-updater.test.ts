import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import type { MemoryOperation } from "../llm-client.js";
import { MemoryUpdater } from "../memory-updater.js";
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

// ─── 全局 tmp 目录 ───

let tmpDir: string;
let dbCounter = 0;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "mem-updater-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 辅助函数 ───

function createConfig(): StorageConfig {
  dbCounter++;
  return {
    sqliteVec: {
      dbPath: join(tmpDir, `updater-${dbCounter}.sqlite`),
      busyTimeoutMs: 5000,
      vectorDimensions: 512,
    },
    embedding: { model: "fake", contextSize: 2048 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  };
}

function createStore(config?: StorageConfig): TeamMemoryStore {
  const cfg = config ?? createConfig();
  const embedder = new FakeEmbedder();
  embedder.init();
  return new TeamMemoryStore("team-1", cfg, embedder);
}

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("MemoryUpdater", () => {
  const AGENT_ID = "agent-1";
  const TEAM_ID = "team-1";

  // 1. create 操作 → writeEntry 写入新条目
  it("create 操作写入新的 MemoryEntry", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    const ops: MemoryOperation[] = [
      {
        type: "create",
        memoryType: "entities",
        content: "Alice 是前端工程师",
      },
    ];

    await updater.applyOperations(ops, AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe("Alice 是前端工程师");
    expect(all[0].memoryType).toBe("entities");
    expect(all[0].teamId).toBe(TEAM_ID);
    expect(all[0].agentId).toBe(AGENT_ID);
    expect(all[0].accessCount).toBe(0);
    expect(all[0].createdAt).toBeInstanceOf(Date);
    expect(all[0].updatedAt).toBeInstanceOf(Date);

    store.close();
  });

  // 2. update 操作 → 读取已有条目后合并内容写回
  it("update 操作更新已有条目内容", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    // 先写一条记录
    const createOps: MemoryOperation[] = [
      {
        type: "create",
        memoryType: "entities",
        content: "Bob 是后端工程师",
      },
    ];
    await updater.applyOperations(createOps, AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    expect(all.length).toBe(1);
    const existingId = all[0].id;

    // 执行 update
    const updateOps: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "entities",
        content: "Bob 是资深后端工程师，专注于 Go 语言",
        targetId: existingId,
      },
    ];
    await updater.applyOperations(updateOps, AGENT_ID, TEAM_ID);

    const updated = store.getEntry(existingId);
    expect(updated).not.toBeNull();
    expect(updated?.content).toBe("Bob 是资深后端工程师，专注于 Go 语言");
    expect(updated?.memoryType).toBe("entities");
    // accessCount 保持不变
    expect(updated?.accessCount).toBe(0);
    // id 不变
    expect(updated?.id).toBe(existingId);

    store.close();
  });

  // 3. delete 操作 → 调用 store.archive()
  it("delete 操作归档指定条目", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    // 先写一条记录
    const createOps: MemoryOperation[] = [
      {
        type: "create",
        memoryType: "decisions",
        content: "团队决定使用 TypeScript",
      },
    ];
    await updater.applyOperations(createOps, AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    expect(all.length).toBe(1);
    const targetId = all[0].id;

    // 执行 delete
    const deleteOps: MemoryOperation[] = [
      {
        type: "delete",
        memoryType: "decisions",
        content: "",
        targetId,
      },
    ];
    await updater.applyOperations(deleteOps, AGENT_ID, TEAM_ID);

    const afterDelete = store.getEntry(targetId);
    expect(afterDelete).toBeNull();

    const remaining = await store.listAll();
    expect(remaining.length).toBe(0);

    store.close();
  });

  // 4. 混合操作批次 → 按顺序处理所有操作
  it("混合操作批次按顺序全部处理", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    // 先写两条基础记录
    const setupOps: MemoryOperation[] = [
      { type: "create", memoryType: "entities", content: "Carol 是设计师" },
      { type: "create", memoryType: "decisions", content: "采用 monorepo 架构" },
    ];
    await updater.applyOperations(setupOps, AGENT_ID, TEAM_ID);

    const allAfterSetup = await store.listAll();
    expect(allAfterSetup.length).toBe(2);

    const carolEntry = allAfterSetup.find((e) => e.content === "Carol 是设计师");
    const decisionEntry = allAfterSetup.find((e) => e.content === "采用 monorepo 架构");
    expect(carolEntry).not.toBeUndefined();
    expect(decisionEntry).not.toBeUndefined();

    // 混合批次：update + delete + create
    const mixedOps: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "entities",
        content: "Carol 是资深 UI 设计师",
        // biome-ignore lint/style/noNonNullAssertion: tested above
        targetId: carolEntry!.id,
      },
      {
        type: "delete",
        memoryType: "decisions",
        content: "",
        // biome-ignore lint/style/noNonNullAssertion: tested above
        targetId: decisionEntry!.id,
      },
      { type: "create", memoryType: "patterns", content: "每周五做代码评审" },
    ];
    await updater.applyOperations(mixedOps, AGENT_ID, TEAM_ID);

    const allAfterMixed = await store.listAll();
    // 原来 2 条 → delete 1 条 + create 1 条 → 仍然 2 条
    expect(allAfterMixed.length).toBe(2);

    const contents = allAfterMixed.map((e) => e.content);
    expect(contents).toContain("Carol 是资深 UI 设计师");
    expect(contents).toContain("每周五做代码评审");
    expect(contents).not.toContain("Carol 是设计师");
    expect(contents).not.toContain("采用 monorepo 架构");

    store.close();
  });

  // 5. 空操作数组 → 无副作用
  it("空操作数组不写入任何数据", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    await updater.applyOperations([], AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    expect(all.length).toBe(0);

    store.close();
  });

  // 6. update 目标不存在 → 跳过，不抛出异常
  it("update 目标不存在时跳过且不抛出异常", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    const ops: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "entities",
        content: "不存在的目标更新",
        targetId: "non-existent-id-12345",
      },
    ];

    // 不应抛出异常
    await expect(updater.applyOperations(ops, AGENT_ID, TEAM_ID)).resolves.toBeUndefined();

    // 不应写入任何数据
    const all = await store.listAll();
    expect(all.length).toBe(0);

    store.close();
  });

  // 7. update 没有 targetId → 跳过
  it("update 没有 targetId 时跳过", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    const ops: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "entities",
        content: "缺少 targetId 的更新",
        // targetId 故意不提供
      },
    ];

    await expect(updater.applyOperations(ops, AGENT_ID, TEAM_ID)).resolves.toBeUndefined();

    const all = await store.listAll();
    expect(all.length).toBe(0);

    store.close();
  });

  // 8. delete 没有 targetId → 跳过
  it("delete 没有 targetId 时跳过", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    const ops: MemoryOperation[] = [
      {
        type: "delete",
        memoryType: "decisions",
        content: "",
        // targetId 故意不提供
      },
    ];

    await expect(updater.applyOperations(ops, AGENT_ID, TEAM_ID)).resolves.toBeUndefined();

    store.close();
  });

  // 9. create 保留 metadata
  it("create 操作保留 metadata 字段", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    const ops: MemoryOperation[] = [
      {
        type: "create",
        memoryType: "events",
        content: "2026-04-01 团队会议",
        metadata: { source: "calendar", priority: "high" },
      },
    ];

    await updater.applyOperations(ops, AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    expect(all.length).toBe(1);
    expect(all[0].metadata).toMatchObject({ source: "calendar", priority: "high" });

    store.close();
  });

  // 10. update 合并 metadata（有新 metadata 则替换）
  it("update 操作有新 metadata 时替换，无则保留原来的", async () => {
    const store = createStore();
    const updater = new MemoryUpdater(store);

    // 创建有 metadata 的条目
    const createOps: MemoryOperation[] = [
      {
        type: "create",
        memoryType: "events",
        content: "原始事件",
        metadata: { source: "manual" },
      },
    ];
    await updater.applyOperations(createOps, AGENT_ID, TEAM_ID);

    const all = await store.listAll();
    const targetId = all[0].id;

    // update 带新 metadata
    const updateWithMeta: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "events",
        content: "更新的事件",
        targetId,
        metadata: { source: "import", verified: true },
      },
    ];
    await updater.applyOperations(updateWithMeta, AGENT_ID, TEAM_ID);

    const updated = store.getEntry(targetId);
    expect(updated?.metadata).toMatchObject({ source: "import", verified: true });

    // update 不带 metadata → 保留原来的
    const updateWithoutMeta: MemoryOperation[] = [
      {
        type: "update",
        memoryType: "events",
        content: "再次更新的事件",
        targetId,
      },
    ];
    await updater.applyOperations(updateWithoutMeta, AGENT_ID, TEAM_ID);

    const updatedAgain = store.getEntry(targetId);
    expect(updatedAgain?.metadata).toMatchObject({ source: "import", verified: true });

    store.close();
  });
});
