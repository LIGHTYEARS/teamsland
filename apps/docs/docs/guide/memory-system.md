# 记忆系统

Teamsland 维护一套持久化的团队记忆，智能体（Agent）可以对其进行读写，从而实现跨会话的知识积累。无论是团队的编码偏好、历史决策，还是关键实体信息，都会被统一存储并在后续任务中自动检索。

## 三层记忆架构

记忆系统采用三层架构，平衡了"始终可用"与"按需检索"两种需求：

**L0 — 常驻记忆 (Always Loaded)**

类型包括：`profile`、`preferences`、`entities`、`soul`、`identity`。

这些记忆条目会通过 `listAbstracts` 完整加载进每个智能体的上下文，无需检索，始终存在。

**L1 — 向量检索 (Vector Search)**

使用 sqlite-vec（vec0 扩展）进行余弦距离（cosine distance）相似度搜索，向量维度为 512。每次查询最多返回 Top-50 候选条目。

**L2 — 全文检索 (FTS5)**

基于 SQLite FTS5 虚拟表，索引字段为 `content` 和 `team_id`。每次查询最多返回 Top-50 候选条目，结果与 L1 向量检索结果合并（排除 L0 条目 ID）。

## 存储架构

记忆系统使用四张 SQLite 表：

| 表 | 用途 |
|---|------|
| `memory_entries` | 元数据：entry_id, team_id, agent_id, memory_type, content, access_count, timestamps |
| `memory_vec` | vec0 虚拟表：entry_id TEXT PK, embedding float[512] distance_metric=cosine |
| `memory_fts` | FTS5 虚拟表：content, team_id, entry_id |
| `raw_corpus` | SHA-256 去重索引：team_id, sha256_hash |

> **重要提示**：vec0 虚拟表无法与其他表直接 JOIN（会导致无限挂起）。所有向量查询必须采用两步模式：先从 vec0 获取 ID 列表，再批量从 `memory_entries` 中查询完整数据。

## 记忆类型

系统在 `MemoryType` 中定义了 12 种记忆类型：

| 类型 | 说明 | 层级 |
|------|------|------|
| `profile` | 团队/项目概况 | L0 |
| `preferences` | 编码偏好、工具配置 | L0 |
| `entities` | 关键实体（人、模块、服务） | L0 |
| `soul` | 团队文化与价值观 | L0 |
| `identity` | 身份与权限信息 | L0 |
| `events` | 历史事件记录 | L1/L2 |
| `cases` | 案例与解决方案 | L1/L2 |
| `patterns` | 代码模式与最佳实践 | L1/L2 |
| `tools` | 工具使用经验 | L1/L2 |
| `skills` | 技能与能力记录 | L1/L2 |
| `decisions` | 决策记录 | L1/L2 |
| `project_context` | 项目上下文 | L1/L2 |

## Embedding 模型

`LocalEmbedder` 使用 `node-llama-cpp` 在本地运行 Qwen3-Embedding-0.6B GGUF 模型，无需 GPU。

- 查询前缀格式：`"Instruct: Retrieve relevant documents for the query\nQuery: {text}"`
- `embedBatch` 使用 4 个并发 worker 并行处理批量嵌入任务
- 若模型加载失败（超时阈值为 5 秒），自动回退到 `NullEmbedder`（返回零向量）

## 检索流程

`retrieve(store, embedder, query, teamId, topK=10)` 的执行步骤如下：

1. 获取所有 L0 常驻记忆条目（始终包含）
2. 对查询文本进行 Embedding → 向量检索（从 vec0 取 Top-50）
3. FTS5 全文检索（取 Top-50，出错时静默降级）
4. 合并向量检索与 FTS5 检索结果，排除 L0 条目 ID
5. 对候选条目批量 Embed，执行 `entityMerge`（余弦相似度 >= 0.95 时去重）
6. 对所有命中条目递增 `access_count`
7. 按 `hotnessScore` 降序排列
8. 返回 `[...l0, ...ranked.slice(0, topK - l0.length)]`

## 记忆摄取 (Ingestion)

`ingestDocument(doc, teamId, agentId, store, extractLoop, updater)` 的执行步骤：

1. 对文档内容计算 SHA-256 哈希
2. 调用 `store.exists(teamId, hash)` 检查是否已存在 — 重复则跳过
3. 调用 `store.saveRawCorpus(teamId, hash)` — 在提取前先记录原始语料
4. 调用 `extractLoop.extract(doc)` — 以 ReAct 风格的 LLM 循环进行知识提取

**ExtractLoop 工作机制：**

系统提示词指示 LLM 使用三个只读工具进行分析：
- `memory_read` — 读取指定条目
- `memory_search` — FTS5 全文搜索
- `memory_ls` — 调用 `listAbstracts` 列出常驻记忆

循环最多执行 `extractLoopMaxIterations` 次（默认 3 次）工具调用迭代。当 LLM 停止使用工具后，返回 `MemoryOperation[]` 类型的 JSON 数组（包含 create/update/delete 操作）。最后由 `MemoryUpdater.applyOperations()` 将结果写回存储。

## 衰减与淘汰

系统使用基于移位 Sigmoid 的热度评分公式：

```
score = accessCount / (1 + exp(k * (ageDays - 2 * halfLifeDays)))
```

其中 `k = ln(2) / halfLifeDays`，默认半衰期（halfLife）为 30 天。

`MemoryReaper` 每 24 小时运行一次，执行以下淘汰逻辑：

- 跳过豁免类型（`exemptTypes`）：`["decisions", "identity"]`
- 归档超过 `perTypeTtl` 时限的条目（例如：events 为 90 天，cases 为 365 天）
- 归档 `hotnessScore < 0.1` 的低热度条目

## 实体合并

`entityMerge(entries, embeddings, threshold=0.95)` 执行 O(n²) 的两两余弦相似度计算。当两个条目的相似度达到或超过阈值时，保留 `accessCount` 较高的那一个，避免记忆库中积累重复的实体条目。

## 优雅降级

记忆系统在各组件不可用时均有对应的降级策略，确保系统整体可用性：

| 故障场景 | 降级行为 |
|----------|----------|
| sqlite-vec 不可用 | 使用 `NullMemoryStore`（读取返回空，写入为空操作） |
| `LocalEmbedder` 加载超时 | 回退到 `NullEmbedder`（返回配置维度的零向量） |
| FTS5 查询出错 | 在 `retrieve()` 中静默跳过，不影响向量检索结果 |
| `ExtractLoop` 解析失败 | 返回空操作列表 |
| 文档已摄取过 | SHA-256 去重，跳过重复处理 |
