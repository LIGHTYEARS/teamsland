# @teamsland/memory Design Spec

> **TL;DR**: 团队记忆系统 — sqlite-vec 向量检索 + FTS5 全文索引 + 本地 Qwen3 Embedding + ReAct 提取循环 + 热度衰减回收。10 个源文件，2 个可注入接口（Embedder、LlmClient）保障可测试性。

---

## 目录

- [概述](#概述)
- [依赖关系](#依赖关系)
- [文件结构](#文件结构)
- [类型扩展（@teamsland/types）](#类型扩展teamslantypes)
- [配置扩展（config.json）](#配置扩展configjson)
- [核心接口：Embedder](#核心接口embedder)
- [核心接口：LlmClient](#核心接口llmclient)
- [LocalEmbedder](#localembedder)
- [hotnessScore](#hotnessscore)
- [entityMerge](#entitymerge)
- [TeamMemoryStore](#teammemorystore)
- [retrieve](#retrieve)
- [ExtractLoop](#extractloop)
- [MemoryUpdater](#memoryupdater)
- [ingestDocument](#ingestdocument)
- [MemoryReaper](#memoryreaper)
- [Barrel Exports](#barrel-exports)
- [测试策略](#测试策略)
- [约束与限制](#约束与限制)

---

## 概述

`@teamsland/memory` 是团队记忆系统的完整实现，覆盖从文档摄入到记忆检索、从向量索引到垃圾回收的全链路。它是 `@teamsland/context`、`@teamsland/sidecar` 和 `@teamsland/swarm` 的前置依赖。

**核心能力：**
- 基于 sqlite-vec 的向量相似度检索（cosine distance, float[512]）
- 基于 FTS5 的 BM25 全文检索
- L0（全量摘要）+ L1（向量索引）+ L2（原始语料）三层记忆模型
- 本地 Qwen3-Embedding-0.6B 推理（node-llama-cpp, ~30-100ms/query）
- ReAct 提取循环（ExtractLoop）从文档中自动提取结构化记忆
- 基于 shifted sigmoid 的热度衰减 + TTL 的记忆回收

---

## 依赖关系

```
@teamsland/types      — MemoryEntry, AbstractMemoryStore, MemoryType, StorageConfig, MemoryConfig 等
@teamsland/session    — 无直接代码依赖（package.json 声明用于 monorepo 构建顺序）
node-llama-cpp        — LocalEmbedder 的 Qwen3 GGUF 本地推理
sqlite-vec            — SQLite 可加载扩展，提供 vec0 虚拟表
```

**package.json 新增依赖：**
- `node-llama-cpp`: runtime dependency（模型首次 init() 时懒下载）
- `yaml`: runtime dependency（YAML 序列化用于 toDict() 输出）

---

## 文件结构

```
packages/memory/src/
├── embedder.ts           # Embedder 接口 + LocalEmbedder (node-llama-cpp)
├── lifecycle.ts          # hotnessScore() 纯函数
├── entity-merge.ts       # entityMerge() — 余弦相似度去重
├── team-memory-store.ts  # TeamMemoryStore implements AbstractMemoryStore
├── retriever.ts          # retrieve() — L0 + 向量 + FTS5 + 合并 + 重排
├── llm-client.ts         # LlmClient 接口 + MemoryOperation 类型 + 工具定义
├── extract-loop.ts       # ExtractLoop — ReAct LLM 工具调用循环
├── memory-updater.ts     # MemoryUpdater — 批量应用提取操作到 store
├── ingest.ts             # ingestDocument() — SHA256 去重 + 提取 + 写入
├── memory-reaper.ts      # MemoryReaper — TTL + 热度垃圾回收
├── index.ts              # Barrel re-exports
└── __tests__/
    ├── lifecycle.test.ts
    ├── entity-merge.test.ts
    ├── team-memory-store.test.ts
    ├── retriever.test.ts
    ├── extract-loop.test.ts
    ├── memory-updater.test.ts
    ├── ingest.test.ts
    └── memory-reaper.test.ts
```

---

## 类型扩展（@teamsland/types）

需要在 `@teamsland/types` 中修改 `MemoryConfig`，增加 reaper 配置字段：

```typescript
// packages/types/src/config.ts — MemoryConfig 修改

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

注意：`MemoryConfig` 引用了 `MemoryType`，需要在 config.ts 中添加 `import type { MemoryType } from "./memory.js"`。

---

## 配置扩展（config.json）

更新 `config/config.json` 中的 `memory` 段：

```json
{
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
  }
}
```

---

## 核心接口：Embedder

```typescript
// packages/memory/src/embedder.ts

/**
 * Embedding 生成器接口
 *
 * 抽象向量嵌入生成，允许测试中注入 FakeEmbedder。
 */
export interface Embedder {
  /** 初始化模型（首次调用时加载） */
  init(): Promise<void>;
  /** 生成单条文本的 embedding 向量 */
  embed(text: string): Promise<number[]>;
  /** 批量生成 embedding 向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

**LocalEmbedder** 实现 `Embedder` 接口，使用 `node-llama-cpp`：

- 模型 URI: `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf`
- context size: 从 `EmbeddingConfig.contextSize` 读取（默认 2048）
- Qwen3 查询格式: `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`
- `init()` 懒加载模型（仅首次调用下载/加载）
- `embedBatch()` 内部串行调用 `embed()`（node-llama-cpp 不支持批量 embedding context）
- 若未调用 `init()` 即调用 `embed()`，抛出 `Error("Embedder not initialized")`

---

## 核心接口：LlmClient

```typescript
// packages/memory/src/llm-client.ts

/**
 * LLM 调用结果中的工具调用
 */
export interface LlmToolCall {
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

/**
 * LLM 调用返回值
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
  /** 工具调用列表（如有） */
  toolCalls?: LlmToolCall[];
}

/**
 * LLM 消息
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
 */
export interface LlmClient {
  /** 发送对话并获取回复 */
  chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse>;
}

/**
 * 记忆操作类型
 */
export type MemoryOperationType = "create" | "update" | "delete";

/**
 * 单条记忆操作，由 ExtractLoop 提取产生
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
```

ExtractLoop 使用 3 个工具：

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `memory_read` | 读取指定 ID 的记忆条目 | `{ entryId: string }` |
| `memory_search` | 按关键词搜索记忆 | `{ query: string, limit?: number }` |
| `memory_ls` | 列出团队所有 L0 摘要 | `{ teamId: string }` |

---

## LocalEmbedder

```typescript
// packages/memory/src/embedder.ts (LocalEmbedder 部分)

export class LocalEmbedder implements Embedder {
  private ctx: LlamaEmbeddingContext | null = null;
  private readonly config: EmbeddingConfig;

  constructor(config: EmbeddingConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    const { getLlama } = await import("node-llama-cpp");
    const llama = await getLlama();
    const model = await llama.loadModel({ modelUri: this.config.model });
    this.ctx = await model.createEmbeddingContext({
      contextSize: this.config.contextSize,
    });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ctx) throw new Error("Embedder not initialized");
    const formatted = `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`;
    const result = await this.ctx.getEmbeddingFor(formatted);
    return Array.from(result.vector);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}
```

---

## hotnessScore

```typescript
// packages/memory/src/lifecycle.ts

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
 */
export function hotnessScore(
  accessCount: number,
  updatedAt: Date,
  halfLifeDays = 7,
): number {
  const ageDays = (Date.now() - updatedAt.getTime()) / 86_400_000;
  const k = Math.log(2) / halfLifeDays;
  return accessCount / (1 + Math.exp(k * (ageDays - 2 * halfLifeDays)));
}
```

纯函数，无依赖，无副作用。易于单元测试。

---

## entityMerge

```typescript
// packages/memory/src/entity-merge.ts

/**
 * 实体合并去重（移植自 mem0）
 *
 * 对候选记忆条目按 embedding 余弦相似度去重。
 * 当两个条目的 cosine similarity >= threshold 时视为同一实体，保留 accessCount 更高的条目。
 *
 * @param entries - 候选记忆条目（必须带 embedding 向量）
 * @param embeddings - 条目对应的 embedding 向量（与 entries 索引一一对应）
 * @param threshold - 余弦相似度阈值，默认 0.95
 * @returns 去重后的条目列表
 */
export function entityMerge(
  entries: MemoryEntry[],
  embeddings: Map<string, number[]>,
  threshold = 0.95,
): MemoryEntry[]
```

实现细节：
- 对每对条目计算余弦相似度：`cosine(a, b) = dot(a,b) / (|a| * |b|)`
- 相似度 >= threshold 时，保留 `accessCount` 更高的一方
- 使用 union-find 或简单的标记数组实现（条目数量 < 100，O(n²) 可接受）
- `cosineSimilarity(a: number[], b: number[]): number` 作为内部纯函数导出用于测试

---

## TeamMemoryStore

```typescript
// packages/memory/src/team-memory-store.ts

/**
 * 团队记忆存储
 *
 * 基于 bun:sqlite + sqlite-vec + FTS5 的完整记忆存储实现。
 * 实现 AbstractMemoryStore 接口。
 */
export class TeamMemoryStore implements AbstractMemoryStore {
  constructor(
    teamId: string,
    config: StorageConfig,
    embedder: Embedder,
  )
}
```

**构造函数行为：**
1. 打开 SQLite 数据库（`config.sqliteVec.dbPath`），设置 WAL + busy_timeout
2. 加载 sqlite-vec 扩展：`db.loadExtension("vec0")`
3. 创建表：
   - `memory_vec` — vec0 虚拟表 (`entry_id TEXT PRIMARY KEY, embedding float[N] distance_metric=cosine`)，N 从 `config.sqliteVec.vectorDimensions` 读取
   - `memory_entries` — 元数据表 (`entry_id, team_id, agent_id, memory_type, content, access_count, created_at, updated_at`)
   - `memory_fts` — FTS5 虚拟表 (`content, team_id UNINDEXED, entry_id UNINDEXED`)
   - `raw_corpus` — 去重表 (`team_id TEXT, sha256_hash TEXT, created_at INTEGER, PRIMARY KEY(team_id, sha256_hash)`)

**方法：**

| 方法 | 签名 | 描述 |
|------|------|------|
| `vectorSearch` | `(queryVec: number[], limit?: number): Promise<MemoryEntry[]>` | 两步查询：先查 vec0 拿 ID+distance，再查 memory_entries。按距离升序排列。 |
| `writeEntry` | `(entry: MemoryEntry): Promise<void>` | 生成 embedding → 写 vec0 → 写 metadata → 写 FTS5（FTS5 失败不阻断）。 |
| `exists` | `(teamId: string, hash: string): Promise<boolean>` | 查 raw_corpus 表。 |
| `listAbstracts` | `(teamId: string): Promise<MemoryEntry[]>` | 查 memory_type IN ('profile','preferences','entities','soul','identity') 的条目（L0 层）。 |
| `listAll` | `(): Promise<MemoryEntry[]>` | 查当前 teamId 的所有条目（供 MemoryReaper 使用）。 |
| `archive` | `(id: string): Promise<void>` | 从 memory_entries、memory_vec、memory_fts 三表删除条目。 |
| `saveRawCorpus` | `(teamId: string, hash: string): Promise<void>` | 写入 raw_corpus 去重记录。 |
| `ftsSearch` | `(query: string, limit?: number): Promise<MemoryEntry[]>` | FTS5 MATCH 搜索，返回匹配条目。 |
| `getEntry` | `(entryId: string): Promise<MemoryEntry \| null>` | 按 ID 查单条。 |
| `optimizeFts5` | `(): void` | `INSERT INTO memory_fts(memory_fts) VALUES('optimize')`。 |

**关键约束：**
- vec0 虚拟表 **不能 JOIN** 其他表（会无限 hang），必须两步查询
- `writeEntry` 中 FTS5 写入失败时 catch 错误并记录日志，不抛出（非阻断性写入）
- 所有行的 `created_at`、`updated_at` 存储为 Unix 毫秒整数
- `MemoryEntry` 的 `toDict()` 和 `toVectorPoint()` 方法在 store 内部实现（构建返回对象时赋值）

**MemoryEntry 构建：**

从 SQLite 行到 `MemoryEntry` 需要一个 `mapRow()` 内部函数。`toDict()` 返回扁平对象，`toVectorPoint()` 返回 `{ id, vector: [], payload: { content, memoryType, ... } }`。注意 `toVectorPoint()` 中 `vector` 默认为空数组（读取时不回查 vec0 表的向量数据，因为向量仅用于写入时的索引）。

---

## retrieve

```typescript
// packages/memory/src/retriever.ts

/**
 * 记忆检索 Pipeline
 *
 * 融合 L0 全量 + 向量语义搜索 + FTS5 BM25 + 实体合并 + hotnessScore 重排。
 *
 * @param store - TeamMemoryStore 实例
 * @param embedder - Embedder 实例（用于生成查询向量）
 * @param query - 检索查询文本
 * @param teamId - 团队 ID
 * @param topK - 返回最多 topK 条结果，默认 10
 * @param mergeThreshold - entityMerge 余弦相似度阈值，默认 0.95
 * @returns 排序后的 MemoryEntry 列表，总数 <= topK
 */
export async function retrieve(
  store: TeamMemoryStore,
  embedder: Embedder,
  query: string,
  teamId: string,
  topK = 10,
  mergeThreshold = 0.95,
): Promise<MemoryEntry[]>
```

**Pipeline 步骤：**

1. **L0 全量注入** — `store.listAbstracts(teamId)`，始终包含
2. **向量语义搜索** — `embedder.embed(query)` → `store.vectorSearch(queryVec, 50)`
3. **FTS5 BM25 搜索** — `store.ftsSearch(query, 50)`
4. **合并 + 去重** — 合并步骤 2、3 的结果，用 `entityMerge()` 按 cosine >= threshold 去重
5. **hotnessScore 重排** — 按 `hotnessScore(entry.accessCount, entry.updatedAt)` 降序排列
6. **topK 截断** — `rankedLimit = Math.max(0, topK - l0Context.length)`，返回 `[...l0Context, ...ranked.slice(0, rankedLimit)]`

L0 条目始终在结果最前面，ranked 条目补齐到 topK 上限。总返回数永远 <= topK。

---

## ExtractLoop

```typescript
// packages/memory/src/extract-loop.ts

/**
 * ReAct 记忆提取循环
 *
 * 使用 LLM tool-use 从文档中提取结构化记忆操作。
 * 移植自 OpenViking extract_loop.py。
 *
 * 最多执行 maxIterations 轮工具调用。每轮：
 * 1. 发送当前消息历史给 LLM（含可用工具定义）
 * 2. 如果 LLM 返回工具调用 → 执行工具 → 将结果追加到消息历史 → 继续
 * 3. 如果 LLM 返回纯文本（无工具调用）→ 解析为 MemoryOperation[] → 结束
 *
 * 失败时静默返回空数组（最终一致性策略 — 下次摄入时重试）。
 */
export class ExtractLoop {
  constructor(opts: {
    llm: LlmClient;
    store: TeamMemoryStore;
    maxIterations: number;
  })

  /**
   * 从文档中提取记忆操作
   * @returns 提取的操作列表，失败时返回 []
   */
  async extract(doc: string): Promise<MemoryOperation[]>
}
```

**工具执行逻辑：**
- `memory_read({ entryId })` → `store.getEntry(entryId)` → 返回 JSON
- `memory_search({ query, limit })` → `store.ftsSearch(query, limit)` → 返回 JSON 数组
- `memory_ls({ teamId })` → `store.listAbstracts(teamId)` → 返回 JSON 数组

**系统提示词要求 LLM：**
1. 阅读文档，识别值得记忆的信息（实体、决策、模式、偏好等）
2. 使用工具检查现有记忆，避免重复
3. 返回 JSON 格式的 `MemoryOperation[]`

**错误处理：** 所有异常 catch 后返回 `[]`，不抛出。日志记录错误。

---

## MemoryUpdater

```typescript
// packages/memory/src/memory-updater.ts

/**
 * 记忆操作批量执行器
 *
 * 将 ExtractLoop 提取的 MemoryOperation[] 应用到 TeamMemoryStore。
 */
export class MemoryUpdater {
  constructor(store: TeamMemoryStore)

  /**
   * 批量应用记忆操作
   *
   * - create: 构建 MemoryEntry 并调用 store.writeEntry()
   * - update: 先 getEntry() 读取现有条目，合并内容后 writeEntry()
   * - delete: 调用 store.archive()
   */
  async applyOperations(
    operations: MemoryOperation[],
    agentId: string,
    teamId: string,
  ): Promise<void>
}
```

**MemoryEntry 构建（create 操作）：**
- `id`: `crypto.randomUUID()`
- `teamId`, `agentId`: 从参数传入
- `memoryType`: 从 operation 传入
- `content`: 从 operation 传入
- `accessCount`: 0
- `createdAt`, `updatedAt`: `new Date()`
- `metadata`: 从 operation 传入
- `toDict()` / `toVectorPoint()`: 由 store 内部的 mapRow 赋值（此处构建时可传空实现，写入后 store 管理生命周期）

实际上，为了简化 MemoryEntry 的构建，我们定义一个内部辅助函数 `createMemoryEntry()`，它返回完整的 MemoryEntry 对象（包含 toDict 和 toVectorPoint 的闭包实现）。

---

## ingestDocument

```typescript
// packages/memory/src/ingest.ts

/**
 * 文档摄入入口
 *
 * SHA256 去重 → ExtractLoop 提取 → MemoryUpdater 写入。
 */
export async function ingestDocument(
  doc: string,
  teamId: string,
  agentId: string,
  store: TeamMemoryStore,
  extractLoop: ExtractLoop,
  updater: MemoryUpdater,
): Promise<void>
```

**流程：**
1. `createHash("sha256").update(doc).digest("hex")` 计算哈希
2. `store.exists(teamId, hash)` — 若已存在则 return（去重）
3. `store.saveRawCorpus(teamId, hash)` — 记录哈希
4. `extractLoop.extract(doc)` — 提取操作（失败返回 []，不中断）
5. `updater.applyOperations(operations, agentId, teamId)` — 写入记忆

所有参数通过函数参数注入，无全局状态。

---

## MemoryReaper

```typescript
// packages/memory/src/memory-reaper.ts

/**
 * 记忆回收器
 *
 * 定期清理过期和低热度的记忆条目。
 * 由 main.ts 每 24h 调用一次。
 */
export class MemoryReaper {
  constructor(store: TeamMemoryStore, config: MemoryConfig)

  /**
   * 执行回收
   * @returns 回收统计
   */
  async reap(): Promise<{ archived: number; skipped: number }>
}
```

**回收策略：**
1. `store.listAll()` 获取所有条目
2. 跳过 `config.exemptTypes` 中的类型（如 `decisions`、`identity`）
3. 检查 `config.perTypeTtl[entry.memoryType]` — 若 age > TTL 则归档
4. 检查 `hotnessScore(entry.accessCount, entry.updatedAt, config.decayHalfLifeDays) < 0.1` — 低于阈值则归档
5. 归档调用 `store.archive(entry.id)`

---

## Barrel Exports

```typescript
// packages/memory/src/index.ts

// @teamsland/memory — TeamMemoryStore, ExtractLoop, embedder, lifecycle
// 团队记忆系统：向量检索 + FTS5 + 本地 Embedding + ReAct 提取 + 热度衰减回收

// 接口
export type { Embedder } from "./embedder.js";
export type { LlmClient, LlmMessage, LlmResponse, LlmToolCall, LlmToolDef, MemoryOperation, MemoryOperationType } from "./llm-client.js";

// 类
export { LocalEmbedder } from "./embedder.js";
export { TeamMemoryStore } from "./team-memory-store.js";
export { ExtractLoop } from "./extract-loop.js";
export { MemoryUpdater } from "./memory-updater.js";
export { MemoryReaper } from "./memory-reaper.js";

// 函数
export { hotnessScore } from "./lifecycle.js";
export { entityMerge } from "./entity-merge.js";
export { retrieve } from "./retriever.js";
export { ingestDocument } from "./ingest.js";
```

---

## 测试策略

### 测试工具

- **FakeEmbedder** — 返回确定性向量（基于输入字符串的简单哈希映射到固定维度向量）
- **FakeLlmClient** — 返回预编程的 LlmResponse 序列（支持工具调用和纯文本回复）

### 各文件测试重点

| 文件 | 测试策略 | 需要 sqlite-vec |
|------|----------|-----------------|
| `lifecycle.test.ts` | 纯函数测试：各衰减阶段的数值验证 | 否 |
| `entity-merge.test.ts` | 纯函数测试：相同/不同向量的去重行为 | 否 |
| `team-memory-store.test.ts` | 集成测试：真实 bun:sqlite + sqlite-vec，temp 文件 | **是** |
| `retriever.test.ts` | 集成测试：FakeEmbedder + 真实 store | **是** |
| `extract-loop.test.ts` | 单元测试：FakeLlmClient + FakeEmbedder + 真实 store | **是** |
| `memory-updater.test.ts` | 单元测试：FakeEmbedder + 真实 store | **是** |
| `ingest.test.ts` | 单元测试：FakeLlmClient + FakeEmbedder + 真实 store | **是** |
| `memory-reaper.test.ts` | 单元测试：FakeEmbedder + 真实 store | **是** |

### sqlite-vec 测试前置条件

需要 sqlite-vec 扩展可用。如果 `db.loadExtension("vec0")` 失败，相关测试应 skip 而非 fail（使用 vitest 的条件跳过）。

### 运行命令

```bash
# 需要 bun 运行时（bun:sqlite）
bunx --bun vitest run packages/memory/
```

---

## 约束与限制

1. **sqlite-vec 不支持 JOIN** — 向量查询必须分两步：先查 vec0 拿 ID，再查元数据表。任何尝试 JOIN 都会导致查询无限 hang。

2. **node-llama-cpp 模型下载** — 首次 `LocalEmbedder.init()` 会下载 ~630MB GGUF 模型。CI 环境需预缓存或使用 FakeEmbedder。

3. **FTS5 默认分词器** — 与 SessionDB 相同的 CJK 限制。短中文查询（< 3 字符）可能无法 MATCH。`ftsSearch` 在 MATCH 失败时可 fallback 到 LIKE 搜索。

4. **ExtractLoop 静默失败** — 提取失败不中断摄入流程。这是设计决策（最终一致性），不是 bug。

5. **toVectorPoint().vector 为空数组** — 读取 MemoryEntry 时不回查向量数据。向量仅在写入时生成并索引。

6. **hotnessScore 公式中 halfLifeDays 的含义** — 配置中的 `decayHalfLifeDays` 是 sigmoid 半衰期，不是 50% 衰减点。50% 衰减点在 `2 * halfLifeDays`。文档中的 `halfLifeDays = 7` 表示 14 天后分数降至 accessCount 的 50%。
