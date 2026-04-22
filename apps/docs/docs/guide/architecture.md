# 架构概览

本文档描述 Teamsland 的整体系统架构设计，帮助开发者快速理解各模块的职责边界与协作方式。

## 分层架构

Teamsland 采用严格的分层架构，每一层只能依赖其下方的层级，禁止跨层反向依赖。

### Layer 0 — 类型基础

**包名：** `@teamsland/types`

纯 TypeScript 类型定义，无任何运行时依赖。所有其他包都以此层为起点，通过 `import type` 引入共享的接口、枚举与工具类型。该层的存在确保了全局类型一致性，也使得各包在编译期就能发现接口不兼容的问题。

### Layer 1 — 基础设施

**包名：** `@teamsland/config`、`@teamsland/observability`、`@teamsland/session`

这一层提供所有上层包共同依赖的运行时基础能力：

- **Config**：读取 `config.json`，通过 Zod schema 做结构校验，支持环境变量替换（`${ENV_VAR}` 语法）。配置对象在进程启动时一次性加载，后续以只读方式被各模块使用。
- **Observability**：封装 pino logger 与 OpenTelemetry tracing。对外暴露 `initTracing()`、`withSpan()`、`getTracer()` 等接口。所有包必须通过本层写结构化日志，禁止直接使用 `console.log`。
- **Session**：基于 SQLite WAL 模式的持久化层，存储会话（session）、消息（message）与任务（task）记录。WAL 模式配合随机写入抖动（20–150ms）以支持多个子进程并发写入。

### Layer 2 — 核心能力

**包名：** `@teamsland/memory`、`@teamsland/lark`、`@teamsland/git`

在基础设施之上提供可复用的领域无关能力：

- **Memory**：本地向量记忆库，底层为 SQLite + sqlite-vec（`vec0` 扩展）+ FTS5 全文索引。使用 Qwen3-0.6B 本地嵌入模型生成向量。对外暴露 `retrieve()`、`store()`、`decay()` 接口，支持向量检索与全文检索混合查询。
- **Lark**：封装 `lark-cli` 二进制工具，提供私信/群消息发送、联系人搜索、文档操作等能力。底层通过子进程调用 CLI，错误时抛出 `LarkCliError` 并记录日志，通知投递失败不阻断主流程。
- **Git**：`WorktreeManager` 负责为每个任务创建、管理、回收隔离的 git worktree，确保并发代理互不干扰文件系统状态。

### Layer 3 — 领域逻辑

**包名：** `@teamsland/ingestion`、`@teamsland/meego`、`@teamsland/sidecar`、`@teamsland/context`、`@teamsland/swarm`

实现 Teamsland 核心业务逻辑，各包职责如下：

- **Ingestion**：`DocumentParser` 解析 Markdown/富文本工单内容；`IntentClassifier` 先走规则匹配，命中率不足时回退到 LLM 分类，输出结构化意图标签。
- **Meego**：`MeegoEventBus`（基于 SQLite 去重）+ `MeegoConnector`（支持 Webhook、Poll、SSE 三种接入模式）+ `ConfirmationWatcher`（监听人工确认信号）。负责将 Meego 平台事件可靠地送入系统内部处理队列。
- **Sidecar**：`ProcessController` 通过 `Bun.spawn` 启动 Claude Code 子进程；`SubagentRegistry` 管理所有存活代理的元数据；`SidecarDataPlane` 以 NDJSON 流方式处理代理输出；`ObservableMessageBus` 负责事件广播；`Alerter` 在关键状态变更时触发通知。
- **Context**：`DynamicContextAssembler` 动态构建代理初始 prompt，分为五个段落：§A 工单上下文、§B 团队记忆（向量+全文检索）、§C 技能路由、§D 仓库信息、§E 角色指令模板。
- **Swarm**：`TaskPlanner` 调用 LLM 将复杂任务分解为 `SubTask[]`；`runSwarm()` 对子任务做拓扑排序后按层级并行调度，每个 Worker 独立完成 assemble → spawn → processStream 的完整生命周期。

### Layer 4 — 应用

**包名：** `apps/server`、`apps/dashboard`、`apps/docs`

- **apps/server**：主进程入口，负责启动事件管道、定时任务、HTTP/WebSocket 服务，并对上述所有包进行组装与生命周期管理。
- **apps/dashboard**：基于 rspack + React + shadcn/ui + TailwindCSS 的管理界面，通过 WebSocket 实时展示代理状态。
- **apps/docs**：基于 Rspress 的文档站点（即本站）。

---

## 数据流

以下是一条 Meego 事件从接入到代理执行的完整数据流：

```
Meego 事件 (Webhook / Poll / SSE)
    │
    ▼
MeegoConnector → MeegoEventBus (SQLite 去重)
    │
    ▼
EventHandler: issue.created
    │
    ├─→ DocumentParser.parseMarkdown()
    ├─→ IntentClassifier.classify() [规则 → LLM]
    ├─→ WorktreeManager.create()
    ├─→ [异步] ingestDocument → ExtractLoop → MemoryUpdater
    │
    ├─→ [复杂任务] runSwarm()
    │       ├─→ TaskPlanner.decompose() → SubTask[]
    │       ├─→ topoSort → 层级并行
    │       └─→ 每个 Worker: assemble + spawn + processStream
    │
    └─→ [简单任务]
            ├─→ DynamicContextAssembler.buildInitialPrompt()
            │       §A 工单上下文
            │       §B 团队记忆 (向量+全文检索)
            │       §C 技能路由
            │       §D 仓库信息
            │       §E 角色指令模板
            ├─→ ProcessController.spawn()
            ├─→ SubagentRegistry.register()
            └─→ SidecarDataPlane.processStream()
                    │
                    ├─→ assistant → SessionDB
                    ├─→ tool_use → [拦截禁止工具] → SessionDB
                    ├─→ result → SessionDB + MessageBus
                    └─→ error → SessionDB + MessageBus
```

---

## 包依赖关系

```
types ← config, session, observability
         ↑
memory, lark, git
         ↑
ingestion, meego, sidecar, context, swarm
         ↑
    apps/server
```

所有包均以 `@teamsland/types` 为最终基础。`apps/server` 位于依赖图顶端，是唯一允许同时依赖 Layer 1–3 所有包的模块。

---

## 优雅降级

Teamsland 针对外部依赖不可用的场景设计了完善的降级策略，确保核心流程在部分组件缺失时仍能运行：

| 故障场景 | 降级行为 |
|---|---|
| `LocalEmbedder` 初始化失败 | 切换为 `NullEmbedder`，写入全零向量，向量检索退化为全文检索 |
| `sqlite-vec` 扩展不可用 | 切换为 `NullMemoryStore`，跳过向量检索，仅保留 FTS5 全文检索 |
| LLM 未配置 | `IntentClassifier` 仅使用规则匹配；禁用 Swarm 任务规划；禁用 `ExtractLoop` 记忆提取 |
| `lark-cli` 未安装 | 抛出 `LarkCliError` 并记录结构化日志，通知投递静默跳过，不阻断主流程 |
| `MEEGO_PLUGIN_ACCESS_TOKEN` 为空 | `ConfirmationWatcher` 始终返回 `"pending"`，人工确认环节跳过 |

降级行为均通过结构化日志（`@teamsland/observability`）记录，可在 Dashboard 或日志聚合平台中观测到具体降级原因。

---

## 并发模型

Teamsland 运行在**单个 Bun 进程**中，不使用多线程或多进程集群。并发能力来自以下两个维度：

- **子进程并发**：每个 Claude Code 代理通过 `Bun.spawn()` 作为独立子进程运行，主进程通过 NDJSON 管道与其通信。子进程数量由 `SubagentRegistry` 追踪，支持在 Dashboard 实时展示。
- **SQLite 并发写入**：`SessionDB` 使用 WAL（Write-Ahead Logging）模式，并在写入前随机抖动 20–150ms，以分散多个子进程同时写入时的锁竞争。`SubagentRegistry` 的内存状态通过 写临时文件 + 原子重命名（write-tmp + rename）方式持久化，避免部分写入导致数据损坏。
- **实时推送**：Dashboard 通过 WebSocket 订阅 `ObservableMessageBus`，代理状态变更即时推送，无需轮询。

---

## 下一步

- 深入了解各核心概念：[核心概念](./concepts.md)
- 查看事件管道的详细设计：[事件管道深度解析](./event-pipeline.md)
