import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryEntry, MemoryType, StorageConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Embedder } from "../embedder.js";
import { ExtractLoop } from "../extract-loop.js";
import type { LlmClient, LlmMessage, LlmResponse, LlmToolDef } from "../llm-client.js";
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

// ─── 辅助函数 ───

let tmpDir: string;

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

function createConfig(): StorageConfig {
  return {
    sqliteVec: { dbPath: tmpDbPath("extract-loop"), busyTimeoutMs: 5000, vectorDimensions: 512 },
    embedding: { model: "fake", contextSize: 2048 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
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
  tmpDir = await mkdtemp(join(tmpdir(), "extract-loop-test-"));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── 测试套件 ───

describe.skipIf(!vecAvailable)("ExtractLoop", () => {
  const TEAM_ID = "team-1";

  // 1. LLM 返回纯文本（无工具调用）→ 解析为 MemoryOperation[]
  it("LLM 返回纯文本时解析为 MemoryOperation[]", async () => {
    const { store } = await createStore();
    try {
      const operations = JSON.stringify([
        { type: "create", memoryType: "decisions", content: "团队决定采用 TypeScript" },
        { type: "create", memoryType: "entities", content: "Alice 是前端工程师" },
      ]);
      const llm = new FakeLlmClient([{ content: operations }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });

      const result = await loop.extract("会议记录：团队讨论了技术栈选型。");

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("create");
      expect(result[0].memoryType).toBe("decisions");
      expect(result[0].content).toBe("团队决定采用 TypeScript");
      expect(result[1].type).toBe("create");
      expect(result[1].memoryType).toBe("entities");
      expect(result[1].content).toBe("Alice 是前端工程师");
    } finally {
      store.close();
    }
  });

  // 2. LLM 使用 memory_search 工具调用 → 执行工具 → 继续循环 → 返回结果
  it("LLM 使用 memory_search 工具调用后继续循环", async () => {
    const { store } = await createStore();
    try {
      // 预先写入一条记忆供搜索
      await store.writeEntry(makeEntry("existing-1", "React 技术栈决策记录", "decisions"));

      const finalOps = JSON.stringify([{ type: "create", memoryType: "decisions", content: "新决策：使用 Vite 打包" }]);

      // 第一轮：返回工具调用（memory_search）
      // 第二轮：返回纯文本结果
      const llm = new FakeLlmClient([
        {
          content: "",
          toolCalls: [{ name: "memory_search", args: { query: "React", limit: 5 } }],
        },
        { content: finalOps },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("技术文档：我们使用 React 和 Vite。");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("create");
      expect(result[0].content).toBe("新决策：使用 Vite 打包");
    } finally {
      store.close();
    }
  });

  // 3. LLM 使用 memory_read 工具调用 → 执行工具 → 继续循环
  it("LLM 使用 memory_read 工具调用后继续循环", async () => {
    const { store } = await createStore();
    try {
      await store.writeEntry(makeEntry("entry-abc", "Alice 是团队负责人", "entities"));

      const finalOps = JSON.stringify([
        { type: "update", memoryType: "entities", content: "Alice 是技术总监", targetId: "entry-abc" },
      ]);

      const llm = new FakeLlmClient([
        {
          content: "",
          toolCalls: [{ name: "memory_read", args: { entryId: "entry-abc" } }],
        },
        { content: finalOps },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("人员变动：Alice 已晋升为技术总监。");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("update");
      expect(result[0].targetId).toBe("entry-abc");
    } finally {
      store.close();
    }
  });

  // 4. LLM 使用 memory_ls 工具调用 → 执行工具 → 继续循环
  it("LLM 使用 memory_ls 工具调用后继续循环", async () => {
    const { store } = await createStore();
    try {
      await store.writeEntry(makeEntry("ls-1", "团队偏好：使用 Prettier", "preferences"));

      const finalOps = JSON.stringify([{ type: "create", memoryType: "preferences", content: "新偏好：使用 Biome" }]);

      const llm = new FakeLlmClient([
        {
          content: "",
          toolCalls: [{ name: "memory_ls", args: { teamId: TEAM_ID } }],
        },
        { content: finalOps },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("工具链更新：团队迁移到 Biome。");

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("create");
      expect(result[0].memoryType).toBe("preferences");
    } finally {
      store.close();
    }
  });

  // 5. LLM 超过 maxIterations → 返回空数组
  it("LLM 超过 maxIterations 时返回空数组", async () => {
    const { store } = await createStore();
    try {
      // 每次都返回工具调用，永远不返回纯文本
      const llm = new FakeLlmClient([
        { content: "", toolCalls: [{ name: "memory_search", args: { query: "test" } }] },
        { content: "", toolCalls: [{ name: "memory_search", args: { query: "test" } }] },
        { content: "", toolCalls: [{ name: "memory_search", args: { query: "test" } }] },
        { content: "", toolCalls: [{ name: "memory_search", args: { query: "test" } }] },
        { content: "", toolCalls: [{ name: "memory_search", args: { query: "test" } }] },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 3 });
      const result = await loop.extract("测试文档");

      expect(result).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 6. LLM 返回格式错误的 JSON → 返回 []
  it("LLM 返回格式错误的 JSON 时返回空数组", async () => {
    const { store } = await createStore();
    try {
      const llm = new FakeLlmClient([{ content: "这不是 JSON 格式的内容" }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });

      const result = await loop.extract("测试文档");

      expect(result).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 7. LLM 抛出异常 → 返回 []
  it("LLM 抛出异常时返回空数组", async () => {
    const { store } = await createStore();
    try {
      const errorLlm: LlmClient = {
        async chat(_messages: LlmMessage[], _tools?: LlmToolDef[]): Promise<LlmResponse> {
          throw new Error("LLM 服务不可用");
        },
      };

      const loop = new ExtractLoop({ llm: errorLlm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("测试文档");

      expect(result).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 8. 空文档 → 返回 []
  it("空文档返回空数组", async () => {
    const { store } = await createStore();
    try {
      const llm = new FakeLlmClient([{ content: "[]" }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });

      const result = await loop.extract("");

      expect(result).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 9. LLM 返回 JSON 对象而不是数组 → 返回 []
  it("LLM 返回 JSON 对象而非数组时返回空数组", async () => {
    const { store } = await createStore();
    try {
      const llm = new FakeLlmClient([{ content: '{"type": "create", "content": "test"}' }]);
      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });

      const result = await loop.extract("测试文档");

      expect(result).toEqual([]);
    } finally {
      store.close();
    }
  });

  // 10. memory_read 读取不存在的 ID → 工具返回 null JSON → 循环正常继续
  it("memory_read 读取不存在 ID 时循环正常继续", async () => {
    const { store } = await createStore();
    try {
      const finalOps = JSON.stringify([{ type: "create", memoryType: "entities", content: "新实体信息" }]);

      const llm = new FakeLlmClient([
        {
          content: "",
          toolCalls: [{ name: "memory_read", args: { entryId: "nonexistent-id" } }],
        },
        { content: finalOps },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("测试文档");

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("新实体信息");
    } finally {
      store.close();
    }
  });

  // 11. 多个工具调用在同一轮中 → 全部执行 → 继续循环
  it("同一轮多个工具调用时全部执行", async () => {
    const { store } = await createStore();
    try {
      await store.writeEntry(makeEntry("multi-1", "团队文化", "profile"));

      const finalOps = JSON.stringify([{ type: "create", memoryType: "decisions", content: "多工具调用后的决策" }]);

      const llm = new FakeLlmClient([
        {
          content: "",
          toolCalls: [
            { name: "memory_search", args: { query: "文化" } },
            { name: "memory_ls", args: { teamId: TEAM_ID } },
          ],
        },
        { content: finalOps },
      ]);

      const loop = new ExtractLoop({ llm, store, teamId: TEAM_ID, maxIterations: 5 });
      const result = await loop.extract("团队文化文档");

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("多工具调用后的决策");
    } finally {
      store.close();
    }
  });
});
