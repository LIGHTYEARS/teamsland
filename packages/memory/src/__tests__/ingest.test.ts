import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Embedder } from "../embedder.js";
import { ExtractLoop } from "../extract-loop.js";
import { ingestDocument } from "../ingest.js";
import type { LlmClient, LlmMessage, LlmResponse, LlmToolDef, MemoryOperation } from "../llm-client.js";
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

// ─── FakeLlmClient ───

class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private callIndex = 0;

  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }

  async chat(_messages: LlmMessage[], _tools?: LlmToolDef[]): Promise<LlmResponse> {
    if (this.callIndex >= this.responses.length) {
      return { content: "[]" };
    }
    return this.responses[this.callIndex++];
  }
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
  tmpDir = await mkdtemp(join(tmpdir(), "ingest-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 辅助函数 ───

function createConfig(): StorageConfig {
  dbCounter++;
  return {
    sqliteVec: {
      dbPath: join(tmpDir, `ingest-${dbCounter}.sqlite`),
      busyTimeoutMs: 5000,
      vectorDimensions: 512,
    },
    embedding: { model: "fake", contextSize: 2048 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  };
}

function createStore(teamId = "team-1"): TeamMemoryStore {
  const config = createConfig();
  const embedder = new FakeEmbedder();
  embedder.init();
  return new TeamMemoryStore(teamId, config, embedder);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("ingestDocument", () => {
  const TEAM_ID = "team-1";
  const AGENT_ID = "agent-1";

  // 1. 新文档 → SHA256 计算、raw_corpus 保存、ExtractLoop 调用、操作应用
  it("新文档摄入：SHA256 去重记录、提取、并写入操作", async () => {
    const store = createStore(TEAM_ID);
    try {
      const doc = "团队会议纪要：决定使用 React 技术栈";
      const hash = sha256(doc);

      const ops: MemoryOperation[] = [{ type: "create", memoryType: "decisions", content: "决定使用 React 技术栈" }];
      const llm = new FakeLlmClient([{ content: JSON.stringify(ops) }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const updater = new MemoryUpdater(store);

      // 摄入前不存在
      expect(await store.exists(TEAM_ID, hash)).toBe(false);

      await ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater);

      // 摄入后 raw_corpus 已记录
      expect(await store.exists(TEAM_ID, hash)).toBe(true);

      // 操作已写入 memory_entries
      const all = await store.listAll();
      expect(all.length).toBe(1);
      expect(all[0].content).toBe("决定使用 React 技术栈");
      expect(all[0].memoryType).toBe("decisions");
    } finally {
      store.close();
    }
  });

  // 2. 重复文档（相同 SHA256）→ 跳过，ExtractLoop 不调用
  it("重复文档跳过摄入，ExtractLoop 不调用", async () => {
    const store = createStore(TEAM_ID);
    try {
      const doc = "重复文档内容：不应被二次摄入";
      const ops: MemoryOperation[] = [{ type: "create", memoryType: "entities", content: "重复内容" }];
      const llm = new FakeLlmClient([{ content: JSON.stringify(ops) }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const updater = new MemoryUpdater(store);

      // spy on loop.extract
      const extractSpy = vi.spyOn(loop, "extract");

      // 第一次摄入
      await ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater);
      expect(extractSpy).toHaveBeenCalledTimes(1);

      const allAfterFirst = await store.listAll();
      expect(allAfterFirst.length).toBe(1);

      // 第二次摄入相同文档
      await ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater);
      expect(extractSpy).toHaveBeenCalledTimes(1); // 仍然只调用一次

      const allAfterSecond = await store.listAll();
      expect(allAfterSecond.length).toBe(1); // 未新增条目
    } finally {
      store.close();
    }
  });

  // 3. ExtractLoop 返回空数组 → 无操作写入，不报错
  it("ExtractLoop 返回空数组时无操作写入且不报错", async () => {
    const store = createStore(TEAM_ID);
    try {
      const doc = "无需提取记忆的普通文档";
      const llm = new FakeLlmClient([{ content: "[]" }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const updater = new MemoryUpdater(store);

      await expect(ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater)).resolves.toBeUndefined();

      // raw_corpus 仍然记录
      expect(await store.exists(TEAM_ID, sha256(doc))).toBe(true);

      // 无条目写入
      const all = await store.listAll();
      expect(all.length).toBe(0);
    } finally {
      store.close();
    }
  });

  // 4. ExtractLoop 抛出异常 → 静默处理，raw_corpus 仍记录
  it("ExtractLoop 抛出异常时静默处理，raw_corpus 仍记录", async () => {
    const store = createStore(TEAM_ID);
    try {
      const doc = "会触发 ExtractLoop 异常的文档";
      const errorLlm: LlmClient = {
        async chat(_messages: LlmMessage[], _tools?: LlmToolDef[]): Promise<LlmResponse> {
          throw new Error("LLM 服务不可用");
        },
      };
      const loop = new ExtractLoop({ llm: errorLlm, store, teamId: TEAM_ID, maxIterations: 5 });
      const updater = new MemoryUpdater(store);

      // 不应抛出异常
      await expect(ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater)).resolves.toBeUndefined();

      // raw_corpus 仍然记录（在提取之前保存）
      expect(await store.exists(TEAM_ID, sha256(doc))).toBe(true);

      // 无条目写入
      const all = await store.listAll();
      expect(all.length).toBe(0);
    } finally {
      store.close();
    }
  });

  // 5. 多条操作 → 全部写入
  it("ExtractLoop 返回多条操作时全部写入", async () => {
    const store = createStore(TEAM_ID);
    try {
      const doc = "团队综合报告：人员、决策与偏好更新";
      const ops: MemoryOperation[] = [
        { type: "create", memoryType: "entities", content: "Alice 是前端工程师" },
        { type: "create", memoryType: "decisions", content: "采用 Bun 作为运行时" },
        { type: "create", memoryType: "preferences", content: "代码风格偏好 Biome" },
      ];
      const llm = new FakeLlmClient([{ content: JSON.stringify(ops) }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const updater = new MemoryUpdater(store);

      await ingestDocument(doc, TEAM_ID, AGENT_ID, store, loop, updater);

      const all = await store.listAll();
      expect(all.length).toBe(3);

      const contents = all.map((e) => e.content);
      expect(contents).toContain("Alice 是前端工程师");
      expect(contents).toContain("采用 Bun 作为运行时");
      expect(contents).toContain("代码风格偏好 Biome");
    } finally {
      store.close();
    }
  });
});
