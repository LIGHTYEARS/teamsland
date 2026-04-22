# 包一览

Teamsland 的功能拆分为 12 个 `@teamsland/*` 作用域包，按职责分层组织。各包均为独立的 `package.json`，通过 Bun Workspace 统一管理。

---

## 依赖层级图

```
@teamsland/types (L0)
         ↑
@teamsland/config    @teamsland/observability    @teamsland/session (L1)
         ↑                      ↑                        ↑
@teamsland/memory    @teamsland/lark    @teamsland/git (L2)
         ↑                  ↑
@teamsland/ingestion  @teamsland/meego  @teamsland/sidecar  @teamsland/context  @teamsland/swarm (L3)
                                               ↑
                   apps/server  apps/dashboard  apps/docs (L4)
```

原则：**低层包不得引用高层包**。`types` 包零依赖，是整个系统的类型锚点。

---

## L0 — 基础类型

### @teamsland/types

**一句话描述：** 全项目共享类型定义，零运行时依赖。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `AppConfig` | interface | 完整应用配置结构 |
| `MeegoEvent` | interface | Meego 平台推送的事件载荷 |
| `TaskConfig` | interface | 单个任务的执行配置 |
| `AgentRecord` | interface | Agent 进程运行时快照 |
| `MemoryEntry` | interface | 团队记忆条目 |
| `SubTask` | interface | Swarm 分解后的子任务 |
| `SessionRow` | interface | 会话元数据行 |
| `MessageRow` | interface | 消息记录行 |

**依赖：** 无

**使用说明：**
所有跨包的数据结构均在此定义。任何需要共享类型的包只需 `import type { ... } from "@teamsland/types"`，不会引入任何运行时开销。

---

## L1 — 核心基础设施

### @teamsland/config

**一句话描述：** 配置文件加载、环境变量替换与 Zod 结构校验。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `loadConfig()` | function | 从磁盘读取并解析 `config/config.json` |
| `resolveEnvVars()` | function | 将配置对象中的 `${VAR}` 替换为环境变量值 |
| `AppConfigSchema` | Zod schema | 完整配置结构的 Zod 校验 schema |
| `RepoMapping` | type | `repoMapping` 字段的 TypeScript 类型 |

**依赖：** `@teamsland/types`、`zod`

**使用说明：**
应用启动时调用一次 `loadConfig()`，返回经过校验的 `AppConfig` 对象。校验失败时抛出包含详细字段错误的异常，便于快速定位配置错误。

```typescript
import { loadConfig } from "@teamsland/config";

const config = await loadConfig("config/config.json");
// config 类型为 AppConfig，所有字段已校验
```

---

### @teamsland/observability

**一句话描述：** 结构化日志（pino）与 OpenTelemetry 链路追踪的统一封装。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `createLogger()` | function | 创建带命名空间的 pino logger 实例 |
| `initTracing()` | function | 初始化 OpenTelemetry TracerProvider |
| `shutdownTracing()` | function | 优雅关闭追踪导出器，确保 span 全部上报 |
| `withSpan()` | function | 包裹异步操作，自动创建/关闭 span |
| `getTracer()` | function | 获取全局 Tracer 实例 |

**依赖：** `@opentelemetry/*`、`pino`

**使用说明：**
每个包在模块顶部创建自己的 logger，通过命名空间区分来源：

```typescript
import { createLogger } from "@teamsland/observability";

const logger = createLogger("meego");
logger.info({ eventId: "evt_001" }, "收到 Meego 事件");
```

追踪初始化应在 `apps/server` 入口处完成，其他包只需调用 `withSpan()` 包裹关键操作。

---

### @teamsland/session

**一句话描述：** 基于 SQLite WAL 模式的 Agent 会话持久化存储。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `SessionDB` | class | 会话与消息的 CRUD 操作封装 |
| `SessionDbError` | class | 会话数据库专用错误类型 |

**依赖：** `@teamsland/types`

**使用说明：**
`SessionDB` 使用 `bun:sqlite` 并启用 WAL 模式，支持多个 Agent 并发写入。写入时自动添加随机 jitter 延迟（由 `session.sqliteJitterRangeMs` 配置）以减少锁竞争。

```typescript
import { SessionDB } from "@teamsland/session";

const db = new SessionDB("data/sessions.db", config.session);
await db.insertMessage({ sessionId: "s1", role: "user", content: "帮我修复这个 bug" });
```

---

## L2 — 领域能力

### @teamsland/memory

**一句话描述：** 团队长期记忆的存储、检索、衰减与实体合并。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `TeamMemoryStore` | class | 记忆条目的向量存储与 FTS5 全文检索 |
| `LocalEmbedder` | class | 使用本地 GGUF 模型生成 Embedding |
| `NullEmbedder` | class | 不生成向量的空实现，用于测试 |
| `NullMemoryStore` | class | 内存中记忆存储的空实现，用于测试 |
| `ExtractLoop` | class | 从对话中抽取记忆条目的迭代流程 |
| `MemoryReaper` | class | 按 TTL 和衰减策略删除过期记忆 |
| `MemoryUpdater` | class | 增量更新已有记忆条目 |
| `ingestDocument()` | function | 将文档切片并写入向量库 |
| `retrieve()` | function | 按语义相似度检索相关记忆 |
| `entityMerge()` | function | 合并余弦相似度超过阈值的重复实体 |
| `checkVec0Available()` | function | 检测 sqlite-vec 扩展是否可用 |
| `hotnessScore()` | function | 计算记忆条目的当前热度分数 |
| `EXTRACT_TOOLS` | const | ExtractLoop 使用的工具定义列表 |

**依赖：** `@teamsland/types`、`@teamsland/session`、`@teamsland/observability`、`node-llama-cpp`

**使用说明：**
`TeamMemoryStore` 依赖 `sqlite-vec` 原生扩展提供向量搜索能力。若扩展不可用，`checkVec0Available()` 返回 `false`，系统将退回到纯 FTS5 全文检索模式。

```typescript
import { TeamMemoryStore, LocalEmbedder } from "@teamsland/memory";

const embedder = new LocalEmbedder(config.storage.embedding);
const store = new TeamMemoryStore("data/memory.db", embedder, config.storage);
const results = await retrieve(store, "上周的架构决策");
```

---

### @teamsland/lark

**一句话描述：** 飞书消息发送与 Bot 命令行交互封装。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `LarkCli` | class | 封装飞书消息发送的命令行工具接口 |
| `LarkNotifier` | class | 向指定群组发送结构化通知消息 |
| `LarkCliError` | class | 飞书 CLI 调用失败的专用错误类型 |
| `BunCommandRunner` | class | 基于 `Bun.spawn()` 的通用命令执行器 |

**依赖：** `@teamsland/types`

**使用说明：**
`LarkNotifier` 用于向团队频道发送 Agent 操作结果、告警等通知。`LarkCli` 封装飞书 SDK 的命令行调用，`BunCommandRunner` 提供底层进程执行能力。

```typescript
import { LarkNotifier } from "@teamsland/lark";

const notifier = new LarkNotifier(config.lark);
await notifier.send(config.lark.notification.teamChannelId, "Agent 已完成代码审查任务");
```

---

### @teamsland/git

**一句话描述：** Git Worktree 生命周期管理，为 Agent 提供隔离的代码工作区。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `WorktreeManager` | class | 创建、列举、删除 Git Worktree |
| `BunCommandRunner` | class | 基于 `Bun.spawn()` 的 Git 命令执行器 |

**依赖：** `@teamsland/types`

**使用说明：**
每个 Agent 任务分配独立的 Worktree，避免多个 Agent 并发修改同一工作目录造成冲突。任务完成后由 `WorktreeManager` 自动清理。

```typescript
import { WorktreeManager } from "@teamsland/git";

const manager = new WorktreeManager("/path/to/repo");
const worktreePath = await manager.create("feature/fix-issue-42");
// Agent 在 worktreePath 下工作
await manager.remove(worktreePath);
```

---

## L3 — 应用逻辑

### @teamsland/ingestion

**一句话描述：** 文档格式解析与用户意图分类。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `DocumentParser` | class | 解析多种格式的文档（Markdown、纯文本等）为结构化片段 |
| `IntentClassifier` | class | 对传入事件/消息进行意图分类，输出 8 种意图类型之一 |

**依赖：** `@teamsland/types`、`@teamsland/observability`

**使用说明：**
`IntentClassifier` 是事件管道的入口。`apps/server` 收到 Meego/Lark 事件后，先经过 `IntentClassifier` 分类，再按 `skillRouting` 配置路由到对应工具。

```typescript
import { IntentClassifier } from "@teamsland/ingestion";

const classifier = new IntentClassifier(config.skillRouting);
const intent = await classifier.classify(event);
// intent.type => "code_review" | "bug_fix" | ...
```

---

### @teamsland/meego

**一句话描述：** Meego 平台的事件接入：Webhook、轮询与 SSE 长连接三种模式。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `MeegoEventBus` | class | 统一事件总线，对外暴露事件订阅接口 |
| `MeegoConnector` | class | 管理 Webhook/Poll/SSE 三种连接模式的生命周期 |
| `ConfirmationWatcher` | class | 监控需要人工确认的任务，到期发送飞书提醒 |

**依赖：** `@teamsland/types`、`@teamsland/lark`、`@teamsland/session`、`@teamsland/observability`

**使用说明：**
`MeegoConnector` 根据 `config.meego.eventMode` 自动启动对应的连接器。所有事件统一通过 `MeegoEventBus` 发布，下游订阅者无需关心事件来源。

```typescript
import { MeegoEventBus, MeegoConnector } from "@teamsland/meego";

const bus = new MeegoEventBus();
const connector = new MeegoConnector(config.meego, bus);
await connector.start();

bus.subscribe((event) => {
  // 处理所有来源的 Meego 事件
});
```

---

### @teamsland/sidecar

**一句话描述：** Agent 进程池管理、消息总线、容量控制与告警。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `ProcessController` | class | 启动、停止、监控 Agent 子进程 |
| `SubagentRegistry` | class | 维护当前所有 Agent 的注册表，支持订阅变更 |
| `SidecarDataPlane` | class | Agent 与主进程之间的数据通道 |
| `ObservableMessageBus` | class | 带 OpenTelemetry span 注入的可观测消息总线 |
| `Alerter` | class | 任务失败/超时时通过飞书发送告警 |
| `CapacityError` | class | Agent 池容量满时抛出的专用错误类型 |

**依赖：** `@teamsland/types`、`@teamsland/memory`、`@teamsland/lark`、`@teamsland/session`、`@teamsland/observability`

**使用说明：**
`SubagentRegistry.subscribe()` 供 Dashboard WebSocket 订阅 Agent 状态变更，每次 Agent 注册或注销时推送最新列表。`CapacityError` 应在调用方捕获，决定是排队等待还是拒绝任务。

```typescript
import { ProcessController, SubagentRegistry } from "@teamsland/sidecar";

const registry = new SubagentRegistry();
registry.subscribe((agents) => {
  // agents: AgentRecord[] — 推送给 WebSocket 客户端
});

const controller = new ProcessController(config.sidecar, registry);
await controller.spawn(taskConfig);
```

---

### @teamsland/context

**一句话描述：** 动态构建 Agent 的系统提示词，融合角色模板与长期记忆。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `DynamicContextAssembler` | class | 组合模板、记忆片段、任务信息，生成最终 system prompt |
| `loadTemplate()` | function | 从 `templateBasePath` 加载指定角色的 Markdown 模板 |

**依赖：** `@teamsland/types`、`@teamsland/memory`、`@teamsland/config`、`@teamsland/observability`

**使用说明：**
`DynamicContextAssembler` 在 Agent 启动前调用，将角色模板与从 `TeamMemoryStore` 检索到的相关记忆片段拼装为完整的 system prompt，使 Agent 具备团队历史知识。

```typescript
import { DynamicContextAssembler } from "@teamsland/context";

const assembler = new DynamicContextAssembler(memoryStore, config);
const systemPrompt = await assembler.assemble({
  role: "code-reviewer",
  taskDescription: "Review PR #42",
  repoName: "后端服务",
});
```

---

### @teamsland/swarm

**一句话描述：** 多 Agent 协作框架：任务分解、并发执行与结果聚合。

**关键导出：**

| 名称 | 类别 | 说明 |
|------|------|------|
| `TaskPlanner` | class | 将复杂任务分解为并行/串行的 `SubTask` 列表 |
| `runSwarm()` | function | 调度多个 Worker Agent 并发执行，聚合结果 |
| `runWorker()` | function | 单个 Worker Agent 的执行入口，处理一个 `SubTask` |

**依赖：** `@teamsland/types`、`@teamsland/sidecar`、`@teamsland/context`、`@teamsland/observability`

**使用说明：**
`runSwarm()` 内部使用 `ProcessController` 管理 Worker 进程，并按 `config.sidecar.minSwarmSuccessRatio` 评估整体任务是否成功。部分 Worker 失败不一定导致整体失败。

```typescript
import { TaskPlanner, runSwarm } from "@teamsland/swarm";

const planner = new TaskPlanner();
const subTasks = await planner.decompose(taskConfig);

const result = await runSwarm({
  subTasks,
  config: config.sidecar,
  contextAssembler: assembler,
});
// result.successRatio >= config.sidecar.minSwarmSuccessRatio => 成功
```

---

## 各包速查表

| 包名 | 层级 | 核心职责 | 关键依赖 |
|------|------|----------|----------|
| `@teamsland/types` | L0 | 类型定义 | — |
| `@teamsland/config` | L1 | 配置加载与校验 | types, zod |
| `@teamsland/observability` | L1 | 日志与追踪 | opentelemetry, pino |
| `@teamsland/session` | L1 | SQLite 会话存储 | types |
| `@teamsland/memory` | L2 | 向量记忆系统 | types, session, observability |
| `@teamsland/lark` | L2 | 飞书通信 | types |
| `@teamsland/git` | L2 | Worktree 管理 | types |
| `@teamsland/ingestion` | L3 | 文档解析与意图分类 | types, observability |
| `@teamsland/meego` | L3 | Meego 事件接入 | types, lark, session, observability |
| `@teamsland/sidecar` | L3 | Agent 进程管理 | types, memory, lark, session, observability |
| `@teamsland/context` | L3 | 动态上下文组装 | types, memory, config, observability |
| `@teamsland/swarm` | L3 | 多 Agent 协作 | types, sidecar, context, observability |
