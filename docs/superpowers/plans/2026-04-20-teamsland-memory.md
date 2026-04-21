# @teamsland/memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/memory` package — a team memory system with sqlite-vec vector search, FTS5 full-text search, local Qwen3 embedding, ReAct extraction loop, and hotness-based garbage collection. Provides `TeamMemoryStore`, `ExtractLoop`, `MemoryUpdater`, `MemoryReaper`, `retrieve`, `ingestDocument`, and supporting utilities as the public API.

**Architecture:** Ten source files: `embedder.ts` (Embedder interface + LocalEmbedder), `lifecycle.ts` (hotnessScore), `entity-merge.ts` (cosine dedup), `llm-client.ts` (LlmClient interface + types), `team-memory-store.ts` (TeamMemoryStore), `retriever.ts` (retrieve pipeline), `extract-loop.ts` (ExtractLoop), `memory-updater.ts` (MemoryUpdater), `ingest.ts` (ingestDocument), `memory-reaper.ts` (MemoryReaper), and `index.ts` (barrel exports). Two injectable interfaces (Embedder, LlmClient) enable testing without real models.

**Tech Stack:** TypeScript (strict), Bun, bun:sqlite, sqlite-vec extension, node-llama-cpp (LocalEmbedder only), Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/memory` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has dependencies on `@teamsland/types` and `@teamsland/session`. The tsconfig references `../types` and `../session`. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-memory-design.md`.

**Testing constraint:** Vitest normally runs under Node.js, but `bun:sqlite` is only available in Bun runtime. Solution: run memory tests with `bunx --bun vitest run packages/memory/` which forces Bun runtime.

**sqlite-vec constraint:** The `vec0` virtual table **cannot be JOINed** with other tables — it will hang indefinitely. All vector queries must use a two-step pattern: first query vec0 for IDs+distances, then query the metadata table.

**sqlite-vec test constraint:** If `db.loadExtension("vec0")` fails (extension not installed), tests that need it should skip gracefully rather than fail.

**FakeEmbedder:** Returns deterministic vectors based on input string hash. Used in all tests except LocalEmbedder-specific ones.

**FakeLlmClient:** Returns pre-programmed LlmResponse sequences. Used in ExtractLoop and downstream tests.

## Critical Files

- **Modify:** `packages/types/src/config.ts` (extend MemoryConfig with exemptTypes + perTypeTtl)
- **Modify:** `packages/types/src/index.ts` (no change needed — MemoryConfig already exported)
- **Modify:** `config/config.json` (add exemptTypes + perTypeTtl to memory section)
- **Modify:** `packages/memory/package.json` (add node-llama-cpp, yaml deps)
- **Create:** `packages/memory/src/embedder.ts`
- **Create:** `packages/memory/src/lifecycle.ts`
- **Create:** `packages/memory/src/entity-merge.ts`
- **Create:** `packages/memory/src/llm-client.ts`
- **Create:** `packages/memory/src/team-memory-store.ts`
- **Create:** `packages/memory/src/retriever.ts`
- **Create:** `packages/memory/src/extract-loop.ts`
- **Create:** `packages/memory/src/memory-updater.ts`
- **Create:** `packages/memory/src/ingest.ts`
- **Create:** `packages/memory/src/memory-reaper.ts`
- **Modify:** `packages/memory/src/index.ts` (barrel exports)
- **Create:** `packages/memory/src/__tests__/lifecycle.test.ts`
- **Create:** `packages/memory/src/__tests__/entity-merge.test.ts`
- **Create:** `packages/memory/src/__tests__/team-memory-store.test.ts`
- **Create:** `packages/memory/src/__tests__/retriever.test.ts`
- **Create:** `packages/memory/src/__tests__/extract-loop.test.ts`
- **Create:** `packages/memory/src/__tests__/memory-updater.test.ts`
- **Create:** `packages/memory/src/__tests__/ingest.test.ts`
- **Create:** `packages/memory/src/__tests__/memory-reaper.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- `createdAt` / `updatedAt` stored as Unix milliseconds (`Date.now()`)
- Run tests with: `bunx --bun vitest run packages/memory/`
- Run typecheck with: `bunx tsc --noEmit --project packages/memory/tsconfig.json`
- Run lint with: `bunx biome check packages/memory/src/`

## Shared Test Helpers

Tests that need sqlite-vec share a common pattern. Define these helpers at the top of each test file that uses sqlite-vec:

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 尝试加载 sqlite-vec 扩展，返回是否可用 */
function loadSqliteVec(db: InstanceType<typeof Database>): boolean {
  try {
    db.loadExtension("vec0");
    return true;
  } catch {
    return false;
  }
}

/** 创建临时数据库路径 */
function tmpDbPath(prefix: string): string {
  return join(tmpdir(), `${prefix}-${randomUUID()}.sqlite`);
}

/** 清理临时数据库文件 */
function cleanupDb(dbPath: string): void {
  try {
    unlinkSync(dbPath);
    unlinkSync(`${dbPath}-wal`);
    unlinkSync(`${dbPath}-shm`);
  } catch {
    // 文件可能不存在
  }
}
```

### FakeEmbedder (used across multiple test files)

```typescript
import type { Embedder } from "../embedder.js";

/**
 * 确定性假 Embedder，用于测试
 *
 * 基于输入字符串的简单哈希生成固定 512 维向量。
 * 相同输入始终产生相同向量。
 */
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
    // 归一化为单位向量
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < 512; i++) {
      vec[i] = vec[i] / norm;
    }
    return vec;
  }
}
```

### FakeLlmClient (used across multiple test files)

```typescript
import type { LlmClient, LlmMessage, LlmResponse, LlmToolDef } from "../llm-client.js";

/**
 * 预编程假 LLM 客户端，用于测试
 *
 * 按调用顺序返回预设的响应序列。
 */
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
    const response = this.responses[this.callIndex];
    this.callIndex++;
    return response;
  }
}
```

---

### Task 1: Extend MemoryConfig in @teamsland/types + update config.json

**Files:**
- Modify: `packages/types/src/config.ts`
- Modify: `config/config.json`

- [ ] **Step 1: Add MemoryType import to config.ts**

In `/Users/bytedance/workspace/teamsland/packages/types/src/config.ts`, add at the very top of the file (before the first interface):

```typescript
import type { MemoryType } from "./memory.js";
```

- [ ] **Step 2: Extend MemoryConfig interface**

Replace the existing `MemoryConfig` interface in `/Users/bytedance/workspace/teamsland/packages/types/src/config.ts` (lines 243-248):

```typescript
/**
 * 记忆衰减与回收配置，对应 config/memory.yaml
 *
 * @example
 * ```typescript
 * import type { MemoryConfig } from "@teamsland/types";
 *
 * const cfg: MemoryConfig = {
 *   decayHalfLifeDays: 30,
 *   extractLoopMaxIterations: 3,
 *   exemptTypes: ["decisions", "identity"],
 *   perTypeTtl: { events: 90, cases: 365 },
 * };
 * ```
 */
export interface MemoryConfig {
  /** 记忆热度衰减半衰期（天） */
  decayHalfLifeDays: number;
  /** ExtractLoop 最大迭代次数 */
  extractLoopMaxIterations: number;
  /** 豁免类型，不参与自动回收 */
  exemptTypes: MemoryType[];
  /** 按类型的硬过期天数，超过即归档 */
  perTypeTtl: Partial<Record<MemoryType, number>>;
}
```

- [ ] **Step 3: Update config.json**

Replace the `memory` section in `/Users/bytedance/workspace/teamsland/config/config.json` (lines 42-45):

```json
"memory": {
  "decayHalfLifeDays": 30,
  "extractLoopMaxIterations": 3,
  "exemptTypes": ["decisions", "identity"],
  "perTypeTtl": {
    "events": 90,
    "cases": 365,
    "patterns": 365,
    "preferences": 180
  }
},
```

- [ ] **Step 4: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/types/src/config.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/types/src/config.ts config/config.json && git commit -m "$(cat <<'EOF'
feat(types): extend MemoryConfig with exemptTypes + perTypeTtl

Adds reaper configuration fields for memory garbage collection:
- exemptTypes: memory types exempt from automatic reaping
- perTypeTtl: per-type hard TTL in days

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Update packages/memory/package.json with new deps

**Files:**
- Modify: `packages/memory/package.json`

- [ ] **Step 1: Add runtime dependencies**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/memory/package.json`:

```json
{
  "name": "@teamsland/memory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/session": "workspace:*",
    "node-llama-cpp": "^3.0.0",
    "yaml": "^2.7.0"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`
Expected: Resolves without errors

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/package.json bun.lockb && git commit -m "$(cat <<'EOF'
chore(memory): add node-llama-cpp and yaml dependencies

Runtime deps for LocalEmbedder (GGUF model inference) and YAML serialization.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create embedder.ts — Embedder interface + LocalEmbedder

**Files:**
- Create: `packages/memory/src/embedder.ts`

No test file — LocalEmbedder requires a real GGUF model (~630MB). Tests use FakeEmbedder instead. LocalEmbedder is tested via integration/smoke tests in CI with pre-cached models.

- [ ] **Step 1: Create embedder.ts**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/embedder.ts`:

```typescript
import type { EmbeddingConfig } from "@teamsland/types";

/**
 * Embedding 生成器接口
 *
 * 抽象向量嵌入生成，允许测试中注入 FakeEmbedder。
 * 真实实现 LocalEmbedder 使用 node-llama-cpp 加载本地 Qwen3 GGUF 模型。
 *
 * @example
 * ```typescript
 * import type { Embedder } from "@teamsland/memory";
 *
 * async function getVector(embedder: Embedder, text: string): Promise<number[]> {
 *   await embedder.init();
 *   return embedder.embed(text);
 * }
 * ```
 */
export interface Embedder {
  /** 初始化模型（首次调用时加载） */
  init(): Promise<void>;
  /** 生成单条文本的 embedding 向量 */
  embed(text: string): Promise<number[]>;
  /** 批量生成 embedding 向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * 本地 Embedding 生成器
 *
 * 基于 node-llama-cpp 的 Qwen3-Embedding GGUF 模型实现。
 * 首次 `init()` 时懒加载模型（约 630MB，自动从 HuggingFace 下载）。
 * Qwen3 查询格式: `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`
 *
 * @example
 * ```typescript
 * import { LocalEmbedder } from "@teamsland/memory";
 * import type { EmbeddingConfig } from "@teamsland/types";
 *
 * const config: EmbeddingConfig = {
 *   model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
 *   contextSize: 2048,
 * };
 * const embedder = new LocalEmbedder(config);
 * await embedder.init();
 * const vector = await embedder.embed("团队会议纪要");
 * console.log(vector.length); // 512
 * ```
 */
export class LocalEmbedder implements Embedder {
  private ctx: unknown = null;
  private readonly config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  /**
   * 初始化模型
   *
   * 首次调用时下载并加载 GGUF 模型。后续调用为无操作。
   *
   * @example
   * ```typescript
   * const embedder = new LocalEmbedder(config);
   * await embedder.init();
   * ```
   */
  async init(): Promise<void> {
    if (this.ctx) return;
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelUri: this.config.model });
    this.ctx = await model.createEmbeddingContext({
      contextSize: this.config.contextSize,
    });
  }

  /**
   * 生成单条文本的 embedding 向量
   *
   * @param text - 待编码文本
   * @returns 512 维浮点向量
   * @throws 若未调用 init() 则抛出 Error("Embedder not initialized")
   *
   * @example
   * ```typescript
   * const vector = await embedder.embed("代码审查反馈");
   * console.log(vector.length); // 512
   * ```
   */
  async embed(text: string): Promise<number[]> {
    if (!this.ctx) throw new Error("Embedder not initialized");
    const formatted = `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`;
    const embeddingCtx = this.ctx as { getEmbeddingFor(text: string): Promise<{ vector: Float32Array }> };
    const result = await embeddingCtx.getEmbeddingFor(formatted);
    return Array.from(result.vector);
  }

  /**
   * 批量生成 embedding 向量
   *
   * 内部串行调用 embed()（node-llama-cpp 不支持批量 embedding context）。
   *
   * @param texts - 待编码文本列表
   * @returns 与 texts 索引一一对应的向量列表
   *
   * @example
   * ```typescript
   * const vectors = await embedder.embedBatch(["文本1", "文本2"]);
   * console.log(vectors.length); // 2
   * ```
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/memory/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/embedder.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/embedder.ts && git commit -m "$(cat <<'EOF'
feat(memory): add embedder.ts — Embedder interface + LocalEmbedder

Injectable Embedder interface for testability. LocalEmbedder uses
node-llama-cpp with Qwen3-Embedding-0.6B GGUF for local inference.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create lifecycle.ts — hotnessScore (TDD)

**Files:**
- Create: `packages/memory/src/lifecycle.ts`
- Create: `packages/memory/src/__tests__/lifecycle.test.ts`

Pure function, no dependencies — ideal TDD target.

- [ ] **Step 1: Create lifecycle test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/lifecycle.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { hotnessScore } from "../lifecycle.js";

describe("hotnessScore", () => {
  it("新建条目（age=0）得分约 0.80 * accessCount", () => {
    const score = hotnessScore(10, new Date(), 7);
    // e^(k * (0 - 14)) = e^(-14k) where k = ln2/7 ≈ 0.099
    // score = 10 / (1 + e^(-14*0.099)) ≈ 10 / (1 + 0.25) ≈ 8.0
    expect(score).toBeGreaterThan(7.5);
    expect(score).toBeLessThan(8.5);
  });

  it("age = halfLife 时得分约 0.67 * accessCount", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    // score = 10 / (1 + e^(k * (7 - 14))) = 10 / (1 + e^(-7k)) = 10 / (1 + 0.5) ≈ 6.67
    expect(score).toBeGreaterThan(6.0);
    expect(score).toBeLessThan(7.5);
  });

  it("age = 2*halfLife 时得分恰好 0.50 * accessCount（拐点）", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 2 * halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    // score = 10 / (1 + e^0) = 10 / 2 = 5.0
    expect(score).toBeCloseTo(5.0, 1);
  });

  it("age = 3*halfLife 时得分约 0.33 * accessCount", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 3 * halfLife * 86_400_000);
    const score = hotnessScore(10, updatedAt, halfLife);
    expect(score).toBeGreaterThan(2.5);
    expect(score).toBeLessThan(4.0);
  });

  it("accessCount=0 时返回 0", () => {
    const score = hotnessScore(0, new Date(), 7);
    expect(score).toBe(0);
  });

  it("非常旧的条目得分趋近于 0", () => {
    const updatedAt = new Date(Date.now() - 365 * 86_400_000);
    const score = hotnessScore(5, updatedAt, 7);
    expect(score).toBeLessThan(0.01);
  });

  it("高访问量抵消衰减", () => {
    const halfLife = 7;
    const updatedAt = new Date(Date.now() - 2 * halfLife * 86_400_000);
    const lowAccess = hotnessScore(1, updatedAt, halfLife);
    const highAccess = hotnessScore(100, updatedAt, halfLife);
    expect(highAccess).toBe(100 * lowAccess);
  });

  it("默认 halfLifeDays=7", () => {
    const score = hotnessScore(10, new Date());
    expect(score).toBeGreaterThan(7.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/lifecycle.test.ts`
Expected: FAIL — `../lifecycle.js` does not exist

- [ ] **Step 3: Create lifecycle.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/lifecycle.ts`:

```typescript
/**
 * 计算记忆条目的热度分数
 *
 * 使用 shifted sigmoid 衰减公式：
 *   score = accessCount / (1 + e^(k * (ageDays - 2 * halfLifeDays)))
 *
 * k = ln(2) / halfLifeDays
 *
 * 衰减曲线特征：
 * - age = 0         → score ≈ 0.80 * accessCount
 * - age = halfLife   → score ≈ 0.67 * accessCount
 * - age = 2*halfLife → score = 0.50 * accessCount（拐点）
 * - age = 3*halfLife → score ≈ 0.33 * accessCount
 *
 * @param accessCount - 访问计数
 * @param updatedAt - 最后更新时间
 * @param halfLifeDays - 半衰期（天），默认 7
 * @returns 热度分数（非负）
 *
 * @example
 * ```typescript
 * import { hotnessScore } from "@teamsland/memory";
 *
 * const score = hotnessScore(10, new Date("2026-04-01"), 7);
 * console.log(score); // 随 age 增长而衰减
 * ```
 */
export function hotnessScore(accessCount: number, updatedAt: Date, halfLifeDays = 7): number {
  const ageDays = (Date.now() - updatedAt.getTime()) / 86_400_000;
  const k = Math.log(2) / halfLifeDays;
  return accessCount / (1 + Math.exp(k * (ageDays - 2 * halfLifeDays)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/lifecycle.test.ts`
Expected: All 8 tests pass

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/lifecycle.ts packages/memory/src/__tests__/lifecycle.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/lifecycle.ts packages/memory/src/__tests__/lifecycle.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add lifecycle.ts — hotnessScore shifted sigmoid decay

TDD: 8 tests covering decay curve at key age points, zero access,
old entries, high access offset, and default halfLife parameter.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create entity-merge.ts — entityMerge + cosineSimilarity (TDD)

**Files:**
- Create: `packages/memory/src/entity-merge.ts`
- Create: `packages/memory/src/__tests__/entity-merge.test.ts`

Pure functions, no external dependencies — ideal TDD target.

- [ ] **Step 1: Create entity-merge test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/entity-merge.test.ts`:

```typescript
import type { MemoryEntry } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { cosineSimilarity, entityMerge } from "../entity-merge.js";

/** 创建测试用 MemoryEntry */
function makeEntry(id: string, content: string, accessCount: number): MemoryEntry {
  return {
    id,
    teamId: "team-test",
    agentId: "agent-test",
    memoryType: "entities",
    content,
    accessCount,
    createdAt: new Date(),
    updatedAt: new Date(),
    toDict: () => ({ id, content }),
    toVectorPoint: () => ({ id, vector: [], payload: { content } }),
  };
}

describe("cosineSimilarity", () => {
  it("相同向量相似度为 1", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it("正交向量相似度为 0", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it("反向向量相似度为 -1", () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("零向量返回 0", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("entityMerge", () => {
  it("不重复的条目全部保留", () => {
    const e1 = makeEntry("1", "Alice", 5);
    const e2 = makeEntry("2", "Bob", 3);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [0, 1, 0]);

    const result = entityMerge([e1, e2], embeddings, 0.95);
    expect(result).toHaveLength(2);
  });

  it("相同向量的条目去重，保留高访问量的", () => {
    const e1 = makeEntry("1", "Alice v1", 5);
    const e2 = makeEntry("2", "Alice v2", 10);

    const vec = [1, 0, 0];
    const embeddings = new Map<string, number[]>();
    embeddings.set("1", vec);
    embeddings.set("2", vec);

    const result = entityMerge([e1, e2], embeddings, 0.95);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2"); // 保留 accessCount=10
  });

  it("三个条目中两个重复，保留 2 个", () => {
    const e1 = makeEntry("1", "Alice v1", 5);
    const e2 = makeEntry("2", "Alice v2", 10);
    const e3 = makeEntry("3", "Bob", 3);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [1, 0, 0]);
    embeddings.set("3", [0, 1, 0]);

    const result = entityMerge([e1, e2, e3], embeddings, 0.95);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id).sort()).toEqual(["2", "3"]);
  });

  it("空输入返回空数组", () => {
    const result = entityMerge([], new Map(), 0.95);
    expect(result).toHaveLength(0);
  });

  it("单条目返回原条目", () => {
    const e1 = makeEntry("1", "Alice", 5);
    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);

    const result = entityMerge([e1], embeddings, 0.95);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("阈值为 1.0 时只合并完全相同的向量", () => {
    const e1 = makeEntry("1", "A", 5);
    const e2 = makeEntry("2", "B", 10);

    const embeddings = new Map<string, number[]>();
    embeddings.set("1", [1, 0, 0]);
    embeddings.set("2", [0.99, 0.01, 0]); // 接近但不完全相同

    const result = entityMerge([e1, e2], embeddings, 1.0);
    expect(result).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/entity-merge.test.ts`
Expected: FAIL — `../entity-merge.js` does not exist

- [ ] **Step 3: Create entity-merge.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/entity-merge.ts`:

```typescript
import type { MemoryEntry } from "@teamsland/types";

/**
 * 计算两个向量的余弦相似度
 *
 * @param a - 向量 A
 * @param b - 向量 B
 * @returns 余弦相似度值，范围 [-1, 1]
 *
 * @example
 * ```typescript
 * import { cosineSimilarity } from "@teamsland/memory";
 *
 * const sim = cosineSimilarity([1, 0], [0, 1]);
 * console.log(sim); // 0
 * ```
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * 实体合并去重（移植自 mem0）
 *
 * 对候选记忆条目按 embedding 余弦相似度去重。
 * 当两个条目的 cosine similarity >= threshold 时视为同一实体，
 * 保留 accessCount 更高的条目。
 *
 * 使用标记数组实现（条目数量 < 100，O(n²) 可接受）。
 *
 * @param entries - 候选记忆条目
 * @param embeddings - 条目 ID 到 embedding 向量的映射
 * @param threshold - 余弦相似度阈值，默认 0.95
 * @returns 去重后的条目列表
 *
 * @example
 * ```typescript
 * import { entityMerge } from "@teamsland/memory";
 *
 * const deduped = entityMerge(entries, embeddingMap, 0.95);
 * console.log(`去重后剩余 ${deduped.length} 条`);
 * ```
 */
export function entityMerge(
  entries: MemoryEntry[],
  embeddings: Map<string, number[]>,
  threshold = 0.95,
): MemoryEntry[] {
  if (entries.length <= 1) return [...entries];

  const removed = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (removed.has(i)) continue;
    const vecI = embeddings.get(entries[i].id);
    if (!vecI) continue;

    for (let j = i + 1; j < entries.length; j++) {
      if (removed.has(j)) continue;
      const vecJ = embeddings.get(entries[j].id);
      if (!vecJ) continue;

      const sim = cosineSimilarity(vecI, vecJ);
      if (sim >= threshold) {
        // 移除 accessCount 较低的
        if (entries[i].accessCount >= entries[j].accessCount) {
          removed.add(j);
        } else {
          removed.add(i);
          break; // i 被移除，跳出内层循环
        }
      }
    }
  }

  return entries.filter((_, idx) => !removed.has(idx));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/entity-merge.test.ts`
Expected: All 10 tests pass (4 cosineSimilarity + 6 entityMerge)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/entity-merge.ts packages/memory/src/__tests__/entity-merge.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/entity-merge.ts packages/memory/src/__tests__/entity-merge.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add entity-merge.ts — cosine similarity dedup

TDD: 10 tests covering cosineSimilarity edge cases and entityMerge
dedup logic with threshold-based merging and accessCount tiebreaking.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create llm-client.ts — LlmClient interface + types

**Files:**
- Create: `packages/memory/src/llm-client.ts`

No test file — pure type definitions and interfaces.

- [ ] **Step 1: Create llm-client.ts**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/llm-client.ts`:

```typescript
import type { MemoryType } from "@teamsland/types";

/**
 * LLM 调用结果中的工具调用
 *
 * @example
 * ```typescript
 * import type { LlmToolCall } from "@teamsland/memory";
 *
 * const call: LlmToolCall = { name: "memory_search", args: { query: "团队偏好" } };
 * ```
 */
export interface LlmToolCall {
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

/**
 * LLM 调用返回值
 *
 * @example
 * ```typescript
 * import type { LlmResponse } from "@teamsland/memory";
 *
 * const resp: LlmResponse = {
 *   content: "分析完成",
 *   toolCalls: [{ name: "memory_search", args: { query: "决策记录" } }],
 * };
 * ```
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
  /** 工具调用列表（如有） */
  toolCalls?: LlmToolCall[];
}

/**
 * LLM 消息
 *
 * @example
 * ```typescript
 * import type { LlmMessage } from "@teamsland/memory";
 *
 * const msg: LlmMessage = { role: "user", content: "分析以下文档" };
 * ```
 */
export interface LlmMessage {
  /** 角色 */
  role: "system" | "user" | "assistant" | "tool";
  /** 消息内容 */
  content: string;
  /** 工具调用 ID（role=tool 时） */
  toolCallId?: string;
}

/**
 * LLM 工具定义
 *
 * @example
 * ```typescript
 * import type { LlmToolDef } from "@teamsland/memory";
 *
 * const tool: LlmToolDef = {
 *   name: "memory_search",
 *   description: "搜索记忆",
 *   parameters: { type: "object", properties: { query: { type: "string" } } },
 * };
 * ```
 */
export interface LlmToolDef {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, unknown>;
}

/**
 * LLM 客户端接口
 *
 * 抽象 LLM API 调用，允许测试中注入 FakeLlmClient。
 * 真实实现（包装 Claude API）由应用层在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient, LlmMessage } from "@teamsland/memory";
 *
 * async function ask(client: LlmClient, question: string): Promise<string> {
 *   const messages: LlmMessage[] = [{ role: "user", content: question }];
 *   const response = await client.chat(messages);
 *   return response.content;
 * }
 * ```
 */
export interface LlmClient {
  /** 发送对话并获取回复 */
  chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse>;
}

/**
 * 记忆操作类型
 *
 * @example
 * ```typescript
 * import type { MemoryOperationType } from "@teamsland/memory";
 *
 * const op: MemoryOperationType = "create";
 * ```
 */
export type MemoryOperationType = "create" | "update" | "delete";

/**
 * 单条记忆操作，由 ExtractLoop 提取产生
 *
 * @example
 * ```typescript
 * import type { MemoryOperation } from "@teamsland/memory";
 *
 * const op: MemoryOperation = {
 *   type: "create",
 *   memoryType: "decisions",
 *   content: "团队决定使用 React 替换 Vue",
 * };
 * ```
 */
export interface MemoryOperation {
  /** 操作类型 */
  type: MemoryOperationType;
  /** 记忆类型 */
  memoryType: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 目标记忆 ID（update/delete 时必填） */
  targetId?: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * ExtractLoop 使用的 3 个工具定义
 *
 * @example
 * ```typescript
 * import { EXTRACT_TOOLS } from "@teamsland/memory";
 *
 * console.log(EXTRACT_TOOLS.map((t) => t.name));
 * // ["memory_read", "memory_search", "memory_ls"]
 * ```
 */
export const EXTRACT_TOOLS: LlmToolDef[] = [
  {
    name: "memory_read",
    description: "读取指定 ID 的记忆条目",
    parameters: {
      type: "object",
      properties: { entryId: { type: "string", description: "记忆条目 ID" } },
      required: ["entryId"],
    },
  },
  {
    name: "memory_search",
    description: "按关键词搜索记忆",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回条数上限" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_ls",
    description: "列出团队所有 L0 摘要",
    parameters: {
      type: "object",
      properties: { teamId: { type: "string", description: "团队 ID" } },
      required: ["teamId"],
    },
  },
];
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/memory/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/llm-client.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/llm-client.ts && git commit -m "$(cat <<'EOF'
feat(memory): add llm-client.ts — LlmClient interface + MemoryOperation types

Injectable LlmClient interface for ExtractLoop testability.
Includes tool definitions for memory_read, memory_search, memory_ls.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Create team-memory-store.ts — TeamMemoryStore (TDD)

**Files:**
- Create: `packages/memory/src/team-memory-store.ts`
- Create: `packages/memory/src/__tests__/team-memory-store.test.ts`

This is the core store implementation. Requires sqlite-vec extension.

- [ ] **Step 1: Create team-memory-store test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/team-memory-store.test.ts`:

Tests should cover:
- Constructor creates all 4 tables (memory_entries, memory_vec, memory_fts, raw_corpus)
- `writeEntry()` writes to all three tables (metadata + vec + FTS5)
- `vectorSearch()` returns entries sorted by distance (two-step query)
- `ftsSearch()` returns FTS5 MATCH results
- `getEntry()` returns single entry by ID, null if not found
- `listAbstracts()` returns only L0 types (profile, preferences, entities, soul, identity)
- `listAll()` returns all entries for the team
- `exists()` + `saveRawCorpus()` dedup workflow
- `archive()` removes entry from all three tables
- `optimizeFts5()` runs without error

Use FakeEmbedder. Each test creates a temp SQLite file. All tests skip gracefully if sqlite-vec is not available.

The test file should use `describe.skipIf(!vecAvailable)` pattern:

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Embedder, MemoryEntry, StorageConfig } from "@teamsland/types";
// ... (import TeamMemoryStore and FakeEmbedder)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TeamMemoryStore } from "../team-memory-store.js";

// FakeEmbedder inline (same as shared helper above)

// Check sqlite-vec availability
let vecAvailable = false;
try {
  const testDb = new Database(":memory:");
  testDb.loadExtension("vec0");
  testDb.close();
  vecAvailable = true;
} catch {
  vecAvailable = false;
}

describe.skipIf(!vecAvailable)("TeamMemoryStore", () => {
  // ... test implementation
});
```

Tests: ~12 test cases covering all public methods.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/team-memory-store.test.ts`
Expected: FAIL — `../team-memory-store.js` does not exist (or tests skip if no sqlite-vec)

- [ ] **Step 3: Create team-memory-store.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/team-memory-store.ts`:

Implementation details:
- Constructor opens SQLite with WAL + busy_timeout, loads vec0 extension, creates 4 tables
- `mapRow()` internal helper converts raw SQLite rows to MemoryEntry objects (with `toDict()` and `toVectorPoint()` closures)
- `writeEntry()` generates embedding via injected Embedder, then writes to memory_entries + memory_vec + memory_fts (FTS5 write wrapped in try/catch — non-blocking)
- `vectorSearch()` uses two-step pattern: `SELECT entry_id, distance FROM memory_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance` then batch-fetches from memory_entries
- `ftsSearch()` uses `memory_fts MATCH ?` with JOIN to memory_entries
- `archive()` deletes from all three tables in a transaction
- All timestamps stored as Unix milliseconds

Key signatures:
```typescript
export class TeamMemoryStore implements AbstractMemoryStore {
  constructor(teamId: string, config: StorageConfig, embedder: Embedder)
  async vectorSearch(queryVec: number[], limit?: number): Promise<MemoryEntry[]>
  async writeEntry(entry: MemoryEntry): Promise<void>
  async exists(teamId: string, hash: string): Promise<boolean>
  async listAbstracts(teamId: string): Promise<MemoryEntry[]>
  async listAll(): Promise<MemoryEntry[]>
  async archive(id: string): Promise<void>
  async saveRawCorpus(teamId: string, hash: string): Promise<void>
  ftsSearch(query: string, limit?: number): MemoryEntry[]
  getEntry(entryId: string): MemoryEntry | null
  optimizeFts5(): void
  close(): void
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/team-memory-store.test.ts`
Expected: All ~12 tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/memory/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/team-memory-store.ts packages/memory/src/__tests__/team-memory-store.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/team-memory-store.ts packages/memory/src/__tests__/team-memory-store.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add TeamMemoryStore — sqlite-vec + FTS5 memory storage

Implements AbstractMemoryStore with bun:sqlite + vec0 extension.
Two-step vector query pattern (no JOIN on vec0), FTS5 full-text search,
three-table architecture (metadata + vec + FTS5 + raw_corpus dedup).
TDD: ~12 tests with FakeEmbedder, graceful skip if sqlite-vec unavailable.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Create retriever.ts — retrieve pipeline (TDD)

**Files:**
- Create: `packages/memory/src/retriever.ts`
- Create: `packages/memory/src/__tests__/retriever.test.ts`

- [ ] **Step 1: Create retriever test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/retriever.test.ts`:

Tests should cover:
- Returns L0 abstracts at the front of results
- Includes vector search results
- Includes FTS5 search results
- Deduplicates via entityMerge
- Sorts by hotnessScore descending (after L0)
- Respects topK limit
- L0 entries count toward topK (ranked fills remaining slots)
- Empty store returns empty array

Uses FakeEmbedder + real TeamMemoryStore (sqlite-vec required). `describe.skipIf(!vecAvailable)` pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/retriever.test.ts`
Expected: FAIL

- [ ] **Step 3: Create retriever.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/retriever.ts`:

```typescript
import type { MemoryEntry } from "@teamsland/types";
import type { Embedder } from "./embedder.js";
import { entityMerge } from "./entity-merge.js";
import { hotnessScore } from "./lifecycle.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

/**
 * 记忆检索 Pipeline
 *
 * 融合 L0 全量 + 向量语义搜索 + FTS5 BM25 + 实体合并 + hotnessScore 重排。
 *
 * Pipeline 步骤：
 * 1. L0 全量注入（listAbstracts）
 * 2. 向量语义搜索（embed query → vectorSearch）
 * 3. FTS5 BM25 搜索（ftsSearch）
 * 4. 合并 + entityMerge 去重
 * 5. hotnessScore 重排
 * 6. topK 截断（L0 在前，ranked 补齐）
 *
 * @param store - TeamMemoryStore 实例
 * @param embedder - Embedder 实例（用于生成查询向量）
 * @param query - 检索查询文本
 * @param teamId - 团队 ID
 * @param topK - 返回最多 topK 条结果，默认 10
 * @param mergeThreshold - entityMerge 余弦相似度阈值，默认 0.95
 * @returns 排序后的 MemoryEntry 列表，总数 <= topK
 *
 * @example
 * ```typescript
 * import { retrieve } from "@teamsland/memory";
 *
 * const results = await retrieve(store, embedder, "团队技术决策", "team-alpha");
 * for (const entry of results) {
 *   console.log(`[${entry.memoryType}] ${entry.content}`);
 * }
 * ```
 */
export async function retrieve(
  store: TeamMemoryStore,
  embedder: Embedder,
  query: string,
  teamId: string,
  topK = 10,
  mergeThreshold = 0.95,
): Promise<MemoryEntry[]> {
  // 1. L0 全量
  const l0Context = await store.listAbstracts(teamId);

  // 2. 向量搜索
  const queryVec = await embedder.embed(query);
  const vecResults = await store.vectorSearch(queryVec, 50);

  // 3. FTS5 搜索
  let ftsResults: MemoryEntry[] = [];
  try {
    ftsResults = store.ftsSearch(query, 50);
  } catch {
    // FTS5 MATCH 可能失败（短查询等），静默降级
  }

  // 4. 合并 + 去重
  const l0Ids = new Set(l0Context.map((e) => e.id));
  const merged = new Map<string, MemoryEntry>();
  for (const entry of [...vecResults, ...ftsResults]) {
    if (!l0Ids.has(entry.id) && !merged.has(entry.id)) {
      merged.set(entry.id, entry);
    }
  }

  const candidates = [...merged.values()];

  // 生成去重用的 embeddings
  const embeddings = new Map<string, number[]>();
  const texts = candidates.map((e) => e.content);
  if (texts.length > 0) {
    const vecs = await embedder.embedBatch(texts);
    for (let i = 0; i < candidates.length; i++) {
      embeddings.set(candidates[i].id, vecs[i]);
    }
  }

  const deduped = entityMerge(candidates, embeddings, mergeThreshold);

  // 5. hotnessScore 重排
  const ranked = deduped.sort(
    (a, b) => hotnessScore(b.accessCount, b.updatedAt) - hotnessScore(a.accessCount, a.updatedAt),
  );

  // 6. topK 截断
  const rankedLimit = Math.max(0, topK - l0Context.length);
  return [...l0Context, ...ranked.slice(0, rankedLimit)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/retriever.test.ts`
Expected: All tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/retriever.ts packages/memory/src/__tests__/retriever.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/retriever.ts packages/memory/src/__tests__/retriever.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add retriever.ts — L0 + vector + FTS5 + merge + rerank pipeline

TDD: tests covering L0 injection, vector/FTS5 fusion, entityMerge dedup,
hotnessScore ranking, and topK truncation with FakeEmbedder.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Create extract-loop.ts — ExtractLoop (TDD)

**Files:**
- Create: `packages/memory/src/extract-loop.ts`
- Create: `packages/memory/src/__tests__/extract-loop.test.ts`

- [ ] **Step 1: Create extract-loop test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/extract-loop.test.ts`:

Tests should cover:
- LLM returns pure text (no tool calls) → parses as MemoryOperation[]
- LLM uses tool calls (memory_read, memory_search, memory_ls) → executes tools → continues loop
- LLM exceeds maxIterations → returns whatever was extracted
- LLM returns malformed JSON → returns []
- LLM throws error → returns []
- Empty document → returns []

Uses FakeLlmClient + FakeEmbedder + real TeamMemoryStore (sqlite-vec required). `describe.skipIf(!vecAvailable)` pattern.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/extract-loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Create extract-loop.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/extract-loop.ts`:

Key implementation details:
- Constructor accepts `{ llm: LlmClient, store: TeamMemoryStore, maxIterations: number }`
- `extract(doc: string)` builds system prompt instructing the LLM to analyze the document and return MemoryOperation[]
- Main loop: up to maxIterations rounds. Each round sends messages to LLM with EXTRACT_TOOLS
- If LLM returns toolCalls → execute each tool → append results to messages → continue
- If LLM returns pure text (no toolCalls) → parse JSON → return MemoryOperation[]
- Tool execution: switch on tool name, call store methods, return JSON string
- All errors caught → return [] with logged warning

```typescript
export class ExtractLoop {
  constructor(opts: { llm: LlmClient; store: TeamMemoryStore; maxIterations: number })
  async extract(doc: string): Promise<MemoryOperation[]>
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/extract-loop.test.ts`
Expected: All tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/extract-loop.ts packages/memory/src/__tests__/extract-loop.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/extract-loop.ts packages/memory/src/__tests__/extract-loop.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add ExtractLoop — ReAct LLM tool-use extraction

TDD: tests covering pure-text extraction, tool call execution,
max iterations, malformed JSON fallback, and error resilience.
Uses FakeLlmClient for deterministic LLM behavior in tests.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Create memory-updater.ts — MemoryUpdater (TDD)

**Files:**
- Create: `packages/memory/src/memory-updater.ts`
- Create: `packages/memory/src/__tests__/memory-updater.test.ts`

- [ ] **Step 1: Create memory-updater test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/memory-updater.test.ts`:

Tests should cover:
- `applyOperations()` with create operation → writes new MemoryEntry via store.writeEntry()
- `applyOperations()` with update operation → reads existing entry, merges content, writes back
- `applyOperations()` with delete operation → calls store.archive()
- `applyOperations()` with mixed operations → processes all in order
- `applyOperations()` with empty array → no-op
- Update on non-existent entry → skips gracefully (log warning, don't throw)

Uses FakeEmbedder + real TeamMemoryStore (sqlite-vec required).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/memory-updater.test.ts`
Expected: FAIL

- [ ] **Step 3: Create memory-updater.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/memory-updater.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { MemoryEntry, MemoryType } from "@teamsland/types";
import type { MemoryOperation } from "./llm-client.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

/**
 * 创建完整的 MemoryEntry 对象
 */
function createMemoryEntry(params: {
  id: string;
  teamId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}): MemoryEntry {
  return {
    ...params,
    toDict() {
      return {
        id: params.id,
        teamId: params.teamId,
        agentId: params.agentId,
        memoryType: params.memoryType,
        content: params.content,
        accessCount: params.accessCount,
        createdAt: params.createdAt.getTime(),
        updatedAt: params.updatedAt.getTime(),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      };
    },
    toVectorPoint() {
      return {
        id: params.id,
        vector: [],
        payload: {
          content: params.content,
          memoryType: params.memoryType,
          teamId: params.teamId,
          agentId: params.agentId,
        },
      };
    },
  };
}

export class MemoryUpdater {
  constructor(private readonly store: TeamMemoryStore) {}

  async applyOperations(operations: MemoryOperation[], agentId: string, teamId: string): Promise<void> {
    for (const op of operations) {
      switch (op.type) {
        case "create": {
          const now = new Date();
          const entry = createMemoryEntry({
            id: randomUUID(),
            teamId,
            agentId,
            memoryType: op.memoryType,
            content: op.content,
            accessCount: 0,
            createdAt: now,
            updatedAt: now,
            metadata: op.metadata,
          });
          await this.store.writeEntry(entry);
          break;
        }
        case "update": {
          if (!op.targetId) continue;
          const existing = this.store.getEntry(op.targetId);
          if (!existing) continue;
          const updated = createMemoryEntry({
            id: existing.id,
            teamId: existing.teamId,
            agentId: existing.agentId,
            memoryType: op.memoryType,
            content: op.content,
            accessCount: existing.accessCount,
            createdAt: existing.createdAt,
            updatedAt: new Date(),
            metadata: op.metadata ?? existing.metadata,
          });
          await this.store.writeEntry(updated);
          break;
        }
        case "delete": {
          if (!op.targetId) continue;
          await this.store.archive(op.targetId);
          break;
        }
      }
    }
  }
}
```

Add JSDoc comments to the class and `applyOperations` method with Chinese docs and `@example` blocks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/memory-updater.test.ts`
Expected: All tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/memory-updater.ts packages/memory/src/__tests__/memory-updater.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/memory-updater.ts packages/memory/src/__tests__/memory-updater.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add MemoryUpdater — batch apply ExtractLoop operations

TDD: tests covering create/update/delete operations, mixed batches,
empty input, and graceful handling of missing entries.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Create ingest.ts — ingestDocument (TDD)

**Files:**
- Create: `packages/memory/src/ingest.ts`
- Create: `packages/memory/src/__tests__/ingest.test.ts`

- [ ] **Step 1: Create ingest test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/ingest.test.ts`:

Tests should cover:
- New document → SHA256 computed, raw_corpus saved, ExtractLoop called, operations applied
- Duplicate document (same SHA256) → skipped, ExtractLoop NOT called
- ExtractLoop returns [] → no operations applied, no error
- ExtractLoop throws → caught silently, raw_corpus still recorded

Uses FakeLlmClient + FakeEmbedder + real TeamMemoryStore (sqlite-vec required).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/ingest.test.ts`
Expected: FAIL

- [ ] **Step 3: Create ingest.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/ingest.ts`:

```typescript
import { createHash } from "node:crypto";
import type { ExtractLoop } from "./extract-loop.js";
import type { MemoryUpdater } from "./memory-updater.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

/**
 * 文档摄入入口
 *
 * SHA256 去重 → ExtractLoop 提取 → MemoryUpdater 写入。
 * 失败时静默处理（最终一致性 — 下次摄入时重试）。
 *
 * @param doc - 文档文本内容
 * @param teamId - 团队 ID
 * @param agentId - Agent ID
 * @param store - TeamMemoryStore 实例
 * @param extractLoop - ExtractLoop 实例
 * @param updater - MemoryUpdater 实例
 *
 * @example
 * ```typescript
 * import { ingestDocument } from "@teamsland/memory";
 *
 * await ingestDocument(
 *   "团队会议纪要：决定使用 React 技术栈",
 *   "team-alpha",
 *   "agent-fe",
 *   store,
 *   extractLoop,
 *   updater,
 * );
 * ```
 */
export async function ingestDocument(
  doc: string,
  teamId: string,
  agentId: string,
  store: TeamMemoryStore,
  extractLoop: ExtractLoop,
  updater: MemoryUpdater,
): Promise<void> {
  const hash = createHash("sha256").update(doc).digest("hex");

  // 去重检查
  if (await store.exists(teamId, hash)) return;

  // 记录哈希
  await store.saveRawCorpus(teamId, hash);

  // 提取记忆操作
  const operations = await extractLoop.extract(doc);

  // 应用操作
  if (operations.length > 0) {
    await updater.applyOperations(operations, agentId, teamId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/ingest.test.ts`
Expected: All tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/ingest.ts packages/memory/src/__tests__/ingest.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/ingest.ts packages/memory/src/__tests__/ingest.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add ingestDocument — SHA256 dedup + extract + write pipeline

TDD: tests covering new doc ingestion, duplicate skipping,
empty extraction, and error resilience.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Create memory-reaper.ts — MemoryReaper (TDD)

**Files:**
- Create: `packages/memory/src/memory-reaper.ts`
- Create: `packages/memory/src/__tests__/memory-reaper.test.ts`

- [ ] **Step 1: Create memory-reaper test**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/__tests__/memory-reaper.test.ts`:

Tests should cover:
- Exempt types (decisions, identity) are never archived
- Entries exceeding perTypeTtl are archived
- Entries with hotnessScore < 0.1 are archived
- Fresh high-access entries survive reaping
- reap() returns correct archived/skipped counts
- Empty store returns { archived: 0, skipped: 0 }

Uses FakeEmbedder + real TeamMemoryStore (sqlite-vec required).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/memory-reaper.test.ts`
Expected: FAIL

- [ ] **Step 3: Create memory-reaper.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/memory/src/memory-reaper.ts`:

```typescript
import type { MemoryConfig } from "@teamsland/types";
import { hotnessScore } from "./lifecycle.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

/**
 * 记忆回收器
 *
 * 定期清理过期和低热度的记忆条目。
 * 由 main.ts 每 24h 调用一次。
 *
 * 回收策略：
 * 1. 跳过 exemptTypes 中的类型
 * 2. 超过 perTypeTtl 的条目 → 归档
 * 3. hotnessScore < 0.1 的条目 → 归档
 *
 * @example
 * ```typescript
 * import { MemoryReaper } from "@teamsland/memory";
 *
 * const reaper = new MemoryReaper(store, memoryConfig);
 * const stats = await reaper.reap();
 * console.log(`归档 ${stats.archived} 条，跳过 ${stats.skipped} 条`);
 * ```
 */
export class MemoryReaper {
  constructor(
    private readonly store: TeamMemoryStore,
    private readonly config: MemoryConfig,
  ) {}

  /**
   * 执行回收
   *
   * @returns 回收统计 { archived, skipped }
   *
   * @example
   * ```typescript
   * const stats = await reaper.reap();
   * console.log(stats);
   * ```
   */
  async reap(): Promise<{ archived: number; skipped: number }> {
    const entries = await this.store.listAll();
    let archived = 0;
    let skipped = 0;

    const exemptSet = new Set(this.config.exemptTypes);

    for (const entry of entries) {
      // 豁免类型跳过
      if (exemptSet.has(entry.memoryType)) {
        skipped++;
        continue;
      }

      // TTL 检查
      const ttl = this.config.perTypeTtl[entry.memoryType];
      if (ttl !== undefined) {
        const ageDays = (Date.now() - entry.updatedAt.getTime()) / 86_400_000;
        if (ageDays > ttl) {
          await this.store.archive(entry.id);
          archived++;
          continue;
        }
      }

      // 热度检查
      const score = hotnessScore(entry.accessCount, entry.updatedAt, this.config.decayHalfLifeDays);
      if (score < 0.1) {
        await this.store.archive(entry.id);
        archived++;
      } else {
        skipped++;
      }
    }

    return { archived, skipped };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/src/__tests__/memory-reaper.test.ts`
Expected: All tests pass (or skip if no sqlite-vec)

- [ ] **Step 5: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/memory-reaper.ts packages/memory/src/__tests__/memory-reaper.test.ts`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/memory-reaper.ts packages/memory/src/__tests__/memory-reaper.test.ts && git commit -m "$(cat <<'EOF'
feat(memory): add MemoryReaper — TTL + hotness-based garbage collection

TDD: tests covering exempt types, TTL expiration, hotness threshold,
fresh entry survival, and empty store edge case.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Update barrel exports in index.ts

**Files:**
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/memory/src/index.ts`:

```typescript
// @teamsland/memory — TeamMemoryStore, ExtractLoop, embedder, lifecycle
// 团队记忆系统：向量检索 + FTS5 + 本地 Embedding + ReAct 提取 + 热度衰减回收

// 接口
export type { Embedder } from "./embedder.js";
export type {
  LlmClient,
  LlmMessage,
  LlmResponse,
  LlmToolCall,
  LlmToolDef,
  MemoryOperation,
  MemoryOperationType,
} from "./llm-client.js";

// 类
export { LocalEmbedder } from "./embedder.js";
export { TeamMemoryStore } from "./team-memory-store.js";
export { ExtractLoop } from "./extract-loop.js";
export { MemoryUpdater } from "./memory-updater.js";
export { MemoryReaper } from "./memory-reaper.js";

// 函数
export { hotnessScore } from "./lifecycle.js";
export { cosineSimilarity, entityMerge } from "./entity-merge.js";
export { retrieve } from "./retriever.js";
export { ingestDocument } from "./ingest.js";

// 常量
export { EXTRACT_TOOLS } from "./llm-client.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/memory/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/index.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/memory/src/index.ts && git commit -m "$(cat <<'EOF'
feat(memory): add barrel exports — full public API surface

Exports: TeamMemoryStore, ExtractLoop, MemoryUpdater, MemoryReaper,
LocalEmbedder, retrieve, ingestDocument, hotnessScore, entityMerge,
cosineSimilarity, EXTRACT_TOOLS, and all interface types.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Full Verification

- [ ] **Step 1: Run all memory tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/memory/`
Expected: All tests pass (lifecycle + entity-merge always pass; store-dependent tests pass if sqlite-vec available, skip otherwise)

- [ ] **Step 2: Run typecheck for memory package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/memory/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run typecheck for types package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Run lint on entire memory package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/memory/src/`
Expected: No errors

- [ ] **Step 5: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "
import {
  TeamMemoryStore, ExtractLoop, MemoryUpdater, MemoryReaper, LocalEmbedder,
  retrieve, ingestDocument, hotnessScore, entityMerge, cosineSimilarity, EXTRACT_TOOLS,
} from './packages/memory/src/index.ts';
console.log('TeamMemoryStore:', typeof TeamMemoryStore);
console.log('ExtractLoop:', typeof ExtractLoop);
console.log('MemoryUpdater:', typeof MemoryUpdater);
console.log('MemoryReaper:', typeof MemoryReaper);
console.log('LocalEmbedder:', typeof LocalEmbedder);
console.log('retrieve:', typeof retrieve);
console.log('ingestDocument:', typeof ingestDocument);
console.log('hotnessScore:', typeof hotnessScore);
console.log('entityMerge:', typeof entityMerge);
console.log('cosineSimilarity:', typeof cosineSimilarity);
console.log('EXTRACT_TOOLS:', Array.isArray(EXTRACT_TOOLS));
"`
Expected:
```
TeamMemoryStore: function
ExtractLoop: function
MemoryUpdater: function
MemoryReaper: function
LocalEmbedder: function
retrieve: function
ingestDocument: function
hotnessScore: function
entityMerge: function
cosineSimilarity: function
EXTRACT_TOOLS: true
```

- [ ] **Step 6: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/memory/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output (or only in type-safe positions like `catch (err: unknown)`)

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/memory/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No non-null assertions

- [ ] **Step 7: Verify file count**

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/memory/src/*.ts | wc -l`
Expected: 11 (embedder, lifecycle, entity-merge, llm-client, team-memory-store, retriever, extract-loop, memory-updater, ingest, memory-reaper, index)

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/memory/src/__tests__/*.test.ts | wc -l`
Expected: 8 test files

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/memory/` — all tests pass
2. `bunx tsc --noEmit --project packages/memory/tsconfig.json` — exits 0
3. `bunx tsc --noEmit --project packages/types/tsconfig.json` — exits 0
4. `bunx biome check packages/memory/src/` — no errors
5. All exported functions/classes have Chinese JSDoc with `@example`
6. No `any`, no `!` non-null assertions in source files
7. All 11 exports from barrel: TeamMemoryStore, ExtractLoop, MemoryUpdater, MemoryReaper, LocalEmbedder, retrieve, ingestDocument, hotnessScore, entityMerge, cosineSimilarity, EXTRACT_TOOLS
8. MemoryConfig in @teamsland/types extended with exemptTypes + perTypeTtl
9. config.json updated with reaper configuration
10. sqlite-vec dependent tests gracefully skip when extension unavailable
11. Two-step query pattern for vec0 (no JOINs)
12. FTS5 write failures in store are non-blocking (caught and logged)
13. ExtractLoop failures return [] (eventual consistency)
14. FakeEmbedder and FakeLlmClient used throughout tests (no real model required)
