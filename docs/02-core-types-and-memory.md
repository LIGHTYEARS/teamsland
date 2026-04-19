# 核心类型定义与团队记忆层（Core Types & Team Memory）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.0–§2.2
>
> 整体分层架构请参阅 [01-整体分层架构](01-layered-architecture-overview.md)（Layer 2: Team Memory）。动态上下文组装延续于 [03-动态上下文组装](03-dynamic-context-assembly.md)。

> **TL;DR**
> - 定义 10 个核心 TypeScript 接口（MemoryEntry、SubTask、AgentConfig 等），作为全系统共享类型
> - 团队记忆分三层：L0 全局摘要（始终注入）、L1 向量索引（BM25 + 余弦相似度混合召回）、L2 原始语料
> - ExtractLoop 负责从对话中提取记忆，hotnessScore 按指数衰减管理记忆热度
> - 存储适配器支持 sqlite-vec（向量）+ 本地文件系统（FS），全部嵌入同一 SQLite 文件
> - Embedding 使用 Qwen3-Embedding-0.6B (GGUF Q8_0) 本地推理，支持中英混合文档

---

## 目录

- [核心类型定义（Core Type Definitions）](#核心类型定义core-type-definitions)
- [团队记忆：原始语料存储 (L2)](#团队记忆原始语料存储-l2)
- [团队记忆：分层存储与召回（移植 OpenViking 逻辑为 TypeScript）](#团队记忆分层存储与召回移植-openviking-逻辑为-typescript)

---

## 核心类型定义（Core Type Definitions）

> 以下接口在多个模块中引用，集中定义以保证一致性。

```typescript
// src/types/core.ts

/** 记忆条目 */
export interface MemoryEntry {
  id: string;
  teamId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  toDict(): Record<string, unknown>;
  toVectorPoint(): { id: string; vector: number[]; payload: Record<string, unknown> };
}

export type MemoryType =
  | "profile" | "preferences" | "entities" | "events"
  | "cases" | "patterns" | "tools" | "skills"
  | "decisions" | "project_context" | "soul" | "identity";

/** 记忆存储抽象 */
export interface AbstractMemoryStore {
  vectorSearch(queryVec: number[], limit?: number): Promise<MemoryEntry[]>;
  writeEntry(entry: MemoryEntry): Promise<void>;
  exists(teamId: string, hash: string): Promise<boolean>;
  listAbstracts(teamId: string): Promise<MemoryEntry[]>;
}

/** 团队通讯消息 */
export interface TeamMessage {
  traceId: string;
  fromAgent: string;
  toAgent: string;
  type: "task_result" | "delegation" | "status_update" | "query";
  payload: unknown;
  timestamp: number;
}

/** Meego 事件 */
export interface MeegoEvent {
  eventId: string;
  issueId: string;
  projectKey: string;
  type: MeegoEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type MeegoEventType =
  | "issue.created" | "issue.status_changed"
  | "issue.assigned" | "sprint.started";

/** 事件处理器 */
export interface EventHandler {
  process(event: MeegoEvent): Promise<void>;
}

/** 请求上下文 */
export interface RequestContext {
  userId: string;
  agentId: string;
  teamId: string;
}

/** 任务配置 */
export interface TaskConfig {
  issueId: string;
  meegoEvent: MeegoEvent; // Meego 触发事件（含 issue 上下文）
  meegoProjectId: string;
  description: string;
  triggerType: string;
  agentRole: string;
  worktreePath: string;
  assigneeId: string; // 负责人飞书 user_id，用于私聊通知
}

/** Sidecar 注册表状态 */
export interface RegistryState {
  agents: AgentRecord[];
  updatedAt: number;
}

export interface AgentRecord {
  agentId: string;
  pid: number;              // Claude CLI 进程 PID
  sessionId: string;
  issueId: string;
  worktreePath: string;
  status: "running" | "completed" | "failed";
  retryCount: number;
  createdAt: number;
}

/** Swarm 复杂任务（由 TaskPlanner 生成） */
export interface ComplexTask extends TaskConfig {
  subtasks: TaskConfig[];
}

/** Swarm 执行结果 */
export interface SwarmResult {
  taskId: string;
  outputs: Record<string, unknown>[];
  failures: string[];
  successRatio: number;
}
```

> `MeegoEvent` 与 `EventHandler` 的具体使用详见 [04-Meego 状态监听与意图识别](04-meego-and-intent.md)。`TeamMessage` 的通讯总线实现详见 [07-通讯与可观测](07-communication-observability-dataflows.md)。`AgentRecord` / `RegistryState` 的管理详见 [06-Sidecar 与 Session](06-sidecar-and-session.md)。

---

## 团队记忆：原始语料存储 (L2)

**设计原则**：append-only，不修改原始语料，SHA256 去重，保留溯源链路。

```text
存储结构:
memory://team/{team_id}/agent/{agent_id}/
├── raw/
│   ├── {sha256[:8]}.prd.md          # PRD 原文
│   ├── {sha256[:8]}.tech-spec.md    # 技术方案
│   ├── {sha256[:8]}.design.md       # 设计稿描述
│   └── {sha256[:8]}.meego.json      # Meego 原始事件
├── extracted/
│   ├── entities.yml                 # 提取的实体（模块/人员/项目）
│   ├── decisions.yml               # 架构决策记录 (ADR)
│   └── project_context.yml         # 项目上下文摘要
└── index/
    └── fts5.db                      # SQLite FTS5 全文索引
```

**写入流程（移植 OpenViking `ExtractLoop` 核心逻辑为 TypeScript）**：

```typescript
// src/memory/ingest.ts
import { createHash } from "crypto";
import { ExtractLoop } from "./extract-loop.js";
import { MemoryUpdater } from "./memory-updater.js";

export async function ingestDocument(doc: string, teamId: string): Promise<void> {
  // Step 1: SHA256 去重
  const hash = createHash("sha256").update(doc).digest("hex");
  if (await rawStore.exists(teamId, hash)) return;
  await rawStore.write(teamId, hash, doc);

  // Step 2: ExtractLoop ReAct 提取（移植自 OpenViking extract_loop.py）
  // 最多 3 轮 tool-use 迭代；工具集：MemoryReadTool / MemorySearchTool / MemoryLsTool
  // 失败时静默跳过（不中断任务），下次摄入同一文档时重试（最终一致性策略）
  const loop = new ExtractLoop({
    llm: llmClient,
    memoryStore: teamMemoryStore(teamId),
    maxIterations: 3,
  });
  const operations = await loop.extract(doc);

  // Step 3: 批量写入结构化记忆（原子写入）
  const updater = new MemoryUpdater({ store: teamMemoryStore(teamId) });
  await updater.applyOperations(operations);

  // Step 4: 更新 FTS5 索引（bun:sqlite 内置）
  fts5Index.update(teamId, hash, doc);
}
```

---

## Embedding 模型（本地 GGUF 推理）

**选型：Qwen3-Embedding-0.6B (Q8_0 量化)**

| 属性 | 值 |
|------|-----|
| HuggingFace URI | `hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf` |
| 模型大小 | ~630MB（Q8_0 量化） |
| 输出维度 | 可配置（推荐 512） |
| 最大 token | 32,768 |
| 查询延迟 | 30-100ms（Apple Silicon） |
| 中英混合 | 良好（多语言模型） |

> 选择 Qwen3 而非 bge-small-zh-v1.5 的原因：前端团队的技术文档大量包含英文（API 名、组件名、代码片段），bge-small 在混合语言文档上检索精度下降 15-20%。Qwen3 的 C-MTEB 检索分高 ~10 分，且支持 32K context（减少分块需求）。

**实现（参考 qmd `llm.ts` 模式）**：

```typescript
// src/memory/embedder.ts
import { getLlama, LlamaModel, LlamaEmbeddingContext } from "node-llama-cpp";

export class LocalEmbedder {
  private model: LlamaModel | null = null;
  private ctx: LlamaEmbeddingContext | null = null;

  async init(): Promise<void> {
    const llama = await getLlama();
    this.model = await llama.loadModel({
      modelUri: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
    });
    this.ctx = await this.model.createEmbeddingContext({ contextSize: 2048 });
  }

  async embed(text: string): Promise<number[]> {
    if (!this.ctx) throw new Error("Embedder not initialized");
    // Qwen3-Embedding 查询格式：添加 Instruct 前缀
    const formatted = `Instruct: Retrieve relevant documents for the query\nQuery: ${text}`;
    const result = await this.ctx.getEmbeddingFor(formatted);
    return result.vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
```

> Embedding 生成在写入时同步执行（本地推理 30-100ms/chunk，无需异步队列）。参考 qmd 的 `LlamaCpp` 类实现模型加载、并行上下文、Qwen3 格式处理。

---

## 团队记忆：分层存储与召回（移植 OpenViking 逻辑为 TypeScript）

**三层模型（OpenViking `openviking/session/memory/` 移植）**：

| 层级 | 文件 | 大小限制 | 加载时机 |
|---|---|---|---|
| L0 Abstract | `.abstract.md` | ≤50字/topic | 每次 Session 启动，全量加载（零延迟） |
| L1 Overview | `.overview.md` | ~500字 | 按需加载（任务规划时） |
| L2 Full | `.{sha256[:8]}.md` | 无限制 | 向量检索命中后按需拉取 |

**动态上下文预取（移植自 OpenViking `SessionExtractContextProvider`）**：

```typescript
// src/memory/context-provider.ts
import { SessionExtractContextProvider } from "./session-extract-context-provider.js";
import { ExtractLoop } from "./extract-loop.js";

const provider = new SessionExtractContextProvider({
  memoryStore: teamMemoryStore(teamId),
  extractLoop: new ExtractLoop({ llm: llmClient, maxIterations: 3 }),
});

// Session 启动时：L0 全量加载 + 按 query 预取 L1
const context = await provider.prefetch({
  sessionId,
  query: taskDescription, // 当前任务描述作为检索 query
});
// context.l0Abstracts: 全量注入
// context.l1Overview:  任务相关片段
// context.l2Refs:      向量命中的 L2 引用（懒加载）
```

**记忆衰减（移植自 OpenViking `memory_lifecycle.py`）**：

```typescript
// src/memory/lifecycle.ts
// 衰减公式（shifted sigmoid）：score = accessCount / (1 + e^(k*(age - 2*halfLife)))
// 移植自 openviking/retrieve/memory_lifecycle.py:19
// 使用 2*halfLife 作为 sigmoid 中心点（默认 halfLife=7）：
// age = 0       → score ≈ 0.80 * accessCount（新条目保留大部分权重）
// age = halfLife → score ≈ 0.67 * accessCount（平缓衰减）
// age = 2*halfLife → score = 0.50 * accessCount（拐点）
// age = 3*halfLife → score ≈ 0.33 * accessCount（快速衰减）
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

```yaml
# config/memory.yaml
memory_decay:
  enabled: true
  half_life_days: 7
  exempt_types:
    - decisions
    - identity
  per_type_ttl:
    events: 90
    cases: 365
    patterns: 365
    preferences: 180
```

**记忆清理（Memory Reaper）**：

```typescript
// src/memory/memory-reaper.ts
import { hotnessScore } from "./lifecycle.js";

/**
 * 定期清理低分记忆条目（由 main.ts 每 24h 调用）。
 * 执行 per_type_ttl 策略 + hotnessScore 阈值淘汰。
 */
export class MemoryReaper {
  constructor(
    private store: TeamMemoryStore,
    private config: MemoryDecayConfig,
  ) {}

  async reap(): Promise<{ archived: number; skipped: number }> {
    let archived = 0;
    let skipped = 0;
    const entries = await this.store.listAll();
    for (const entry of entries) {
      // 豁免类型不清理
      if (this.config.exemptTypes.includes(entry.memoryType)) { skipped++; continue; }
      // TTL 硬过期
      const ttlDays = this.config.perTypeTtl[entry.memoryType];
      const ageDays = (Date.now() - entry.updatedAt.getTime()) / 86_400_000;
      if (ttlDays && ageDays > ttlDays) {
        await this.store.archive(entry.id);
        archived++;
        continue;
      }
      // hotnessScore 软淘汰（阈值 0.1）
      if (hotnessScore(entry.accessCount, entry.updatedAt) < 0.1) {
        await this.store.archive(entry.id);
        archived++;
      }
    }
    return { archived, skipped };
  }
}
```

**team_id 隔离（TypeScript 接口定义）**：

```typescript
// src/memory/types.ts
// RequestContext 定义见上方 §2.0 核心类型定义（src/types/core.ts），此处仅示意 URI 模板用法
import type { RequestContext } from "../types/core.js";

// URI 模板：memory://team/{teamId}/agent/{agentId}/{memoryType}/{entryId}
export const MEMORY_URI_TEMPLATE =
  "memory://team/{teamId}/agent/{agentId}/{memoryType}/{entryId}";
```

**召回 Pipeline（OpenViking Memory Tools 移植 + mem0 实体合并逻辑）**：

```typescript
// src/memory/retriever.ts
import { MemoryLsTool, MemorySearchTool } from "./tools.js";
import { hotnessScore } from "./lifecycle.js";
import { entityMerge } from "./entity-merge.js"; // 移植自 mem0

export async function retrieve(
  query: string,
  teamId: string,
  topK = 10,
): Promise<MemoryEntry[]> {
  const ctx: RequestContext = { teamId, agentId: "orchestrator", userId: "team" };

  // Step 1: L0 全量注入
  const l0Context = await new MemoryLsTool(ctx).listAbstracts();

  // Step 2: 向量语义搜索（sqlite-vec）
  const vectorResults = await new MemorySearchTool(ctx).search(query, { limit: 50 });

  // Step 3: BM25 粗排补充（bun:sqlite FTS5）
  const bm25Results = await fts5Search(query, teamId, 50);

  // Step 4: 融合 + 实体合并去重（cosine ≥ 0.95）
  const merged = entityMerge([...vectorResults, ...bm25Results], { threshold: 0.95 });

  // Step 5: hotnessScore 重排
  const ranked = merged.sort(
    (a, b) => hotnessScore(b.accessCount, b.updatedAt) - hotnessScore(a.accessCount, a.updatedAt),
  );

  // 注意：总返回数 = l0 全量 + ranked 补齐至 topK，避免 prompt token 膨胀
  const rankedLimit = Math.max(0, topK - l0Context.length);
  return [...l0Context, ...ranked.slice(0, rankedLimit)];
}
```

**存储适配器（Bun 原生实现）**：

```typescript
// src/memory/team-memory-store.ts
import yaml from "yaml";
import { Database } from "bun:sqlite";
import { LocalEmbedder } from "./embedder.js";

export class TeamMemoryStore implements AbstractMemoryStore {
  private teamId: string;
  private db: Database;
  private embedder: LocalEmbedder;
  private basePath: string;

  constructor(teamId: string, basePath: string) {
    this.teamId = teamId;
    this.basePath = `${basePath}/${teamId}`;
    this.embedder = new LocalEmbedder();
    // bun:sqlite 内置，需加载 Homebrew SQLite 以支持 sqlite-vec 扩展（macOS）
    this.db = new Database(`${this.basePath}/index/memory.sqlite`);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 5000");
    // FTS5 全文索引
    this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
      USING fts5(content, team_id UNINDEXED, entry_id UNINDEXED)`);
    // sqlite-vec 向量索引
    // 注意：sqlite-vec 的 vec0 虚拟表不能和其他表 JOIN（会无限 hang）
    // 必须使用两步查询：先查 vec0 拿 ID，再用 ID 查元数据表
    this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
      entry_id TEXT PRIMARY KEY,
      embedding float[512] distance_metric=cosine
    )`);
    // 元数据表（非虚拟表，可正常 JOIN）
    this.db.run(`CREATE TABLE IF NOT EXISTS memory_entries (
      entry_id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      agent_id TEXT,
      memory_type TEXT,
      content TEXT,
      access_count INTEGER DEFAULT 0,
      created_at INTEGER,
      updated_at INTEGER
    )`);
  }

  async vectorSearch(queryVec: number[], limit = 50): Promise<MemoryEntry[]> {
    // ⚠️ 两步查询（sqlite-vec vec0 表 JOIN 会 hang，这是已知限制）
    // Step 1: 查 vec0 表，只取 entry_id + distance
    const vecResults = this.db.query(
      "SELECT entry_id, distance FROM memory_vec WHERE embedding MATCH ? AND k = ?",
      [new Float32Array(queryVec), limit],
    ).all() as { entry_id: string; distance: number }[];

    if (vecResults.length === 0) return [];

    // Step 2: 用 entry_id 查元数据（普通表，可正常查询）
    const ids = vecResults.map((r) => r.entry_id);
    const placeholders = ids.map(() => "?").join(",");
    const entries = this.db.query(
      `SELECT * FROM memory_entries WHERE entry_id IN (${placeholders})`,
      ids,
    ).all();

    // 按向量距离排序（distance 越小越相似）
    const distanceMap = new Map(vecResults.map((r) => [r.entry_id, r.distance]));
    return entries.sort(
      (a, b) => (distanceMap.get(a.entry_id) ?? 1) - (distanceMap.get(b.entry_id) ?? 1),
    );
  }

  async writeEntry(entry: MemoryEntry): Promise<void> {
    // 写 YAML 文件
    const path = `${this.basePath}/${entry.memoryType}/${entry.id}.yml`;
    await Bun.write(path, yaml.stringify(entry.toDict()));

    // 生成 embedding（本地推理，同步执行 ~30-100ms）
    const vector = await this.embedder.embed(entry.content);

    // 写入 sqlite-vec 向量表
    this.db.run(
      "INSERT OR REPLACE INTO memory_vec (entry_id, embedding) VALUES (?, ?)",
      [entry.id, new Float32Array(vector)],
    );

    // 写入元数据表
    this.db.run(
      `INSERT OR REPLACE INTO memory_entries
       (entry_id, team_id, agent_id, memory_type, content, access_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.id, this.teamId, entry.agentId, entry.memoryType, entry.content,
       entry.accessCount, entry.createdAt.getTime(), entry.updatedAt.getTime()],
    );

    // 更新 FTS5（失败时记录不一致状态，不阻断写入）
    try {
      this.db.run(
        "INSERT OR REPLACE INTO memory_fts(content, team_id, entry_id) VALUES (?,?,?)",
        [entry.content, this.teamId, entry.id],
      );
    } catch (err) {
      console.error("[TeamMemoryStore] FTS5 write failed:", entry.id, err);
    }
  }

  /** 执行 FTS5 OPTIMIZE，减少索引碎片（由 main.ts 定时调用） */
  optimizeFts5(): void {
    this.db.run("INSERT INTO memory_fts(memory_fts) VALUES('optimize')");
  }
}
```

**记忆类型（12类）**：

```yaml
memory_types:
  - profile
  - preferences
  - entities
  - events
  - cases
  - patterns
  - tools
  - skills
  - decisions        # [扩展]
  - project_context  # [扩展]
  - soul
  - identity
```

---

[← 上一篇: 整体分层架构](01-layered-architecture-overview.md) | [目录](README.md) | [下一篇: 动态上下文组装 →](03-dynamic-context-assembly.md)
