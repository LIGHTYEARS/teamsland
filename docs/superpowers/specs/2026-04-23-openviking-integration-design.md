# Phase 3: OpenViking 集成详细设计

> Date: 2026-04-23
> Status: Design Approved
> Approach: 方案 B — OpenViking 作为外部服务，teamsland 仅做 client + 心跳检测

## 概述

将 teamsland 的记忆层从自建的 SQLite + sqlite-vec + node-llama-cpp 方案迁移到 OpenViking，获得：
- L0/L1/L2 三级上下文分层，按需加载，大幅降低 token 消耗
- 自动记忆提取（8 类记忆 + 去重合并），agent 越用越聪明
- 代码仓库/飞书文档的零配置导入与语义索引
- Session 管理与对话压缩内置支持

**核心决策**：
- OpenViking server 独立部署和运行，teamsland **不管理其生命周期**
- Embedding 和 VLM 均使用字节方舟平台（volcengine ark）
- teamsland 通过心跳检测 OpenViking 健康状态，不健康时自动降级

---

## 1. OpenViking 配置与连接

### 1.1 OpenViking Server 配置 (`config/openviking.conf`)

此文件由 OpenViking server 读取，teamsland 不解析。放在 teamsland 仓库中便于版本管理。

```json
{
  "storage": {
    "workspace": "./data/openviking"
  },
  "embedding": {
    "max_concurrent": 10,
    "dense": {
      "provider": "volcengine",
      "api_key": "${ARK_EMBEDDING_API_KEY}",
      "api_base": "https://ark-cn-beijing.bytedance.net/api/v3",
      "model": "ep-20260324224619-zgcl6",
      "dimension": 1024,
      "input": "multimodal"
    }
  },
  "vlm": {
    "provider": "volcengine",
    "api_key": "${ARK_VLM_API_KEY}",
    "api_base": "https://ark-cn-beijing.bytedance.net/api/v3",
    "model": "ep-20260320212524-n9bst",
    "max_concurrent": 10
  },
  "server": {
    "host": "127.0.0.1",
    "port": 1933,
    "auth_mode": "dev"
  },
  "log": {
    "level": "INFO",
    "output": "stdout"
  }
}
```

### 1.2 teamsland 配置类型 (`packages/types/src/config.ts`)

新增 `OpenVikingConfig` 接口：

```typescript
export interface OpenVikingConfig {
  /** OpenViking server HTTP 地址 */
  baseUrl: string;
  /** agent 标识（X-OpenViking-Agent header） */
  agentId: string;
  /** API Key（X-API-Key header，dev 模式可省略） */
  apiKey?: string;
  /** 请求超时（毫秒） */
  timeoutMs: number;
  /** 心跳检测间隔（毫秒） */
  heartbeatIntervalMs: number;
  /** 连续心跳失败几次后降级 */
  heartbeatFailThreshold: number;
}
```

在 `AppConfig` 中新增可选字段：

```typescript
export interface AppConfig {
  // ...existing...
  openViking?: OpenVikingConfig;
}
```

### 1.3 运行时配置 (`config/config.json`)

新增顶层 `openViking` 字段：

```json
{
  "openViking": {
    "baseUrl": "http://127.0.0.1:1933",
    "agentId": "teamsland",
    "timeoutMs": 30000,
    "heartbeatIntervalMs": 30000,
    "heartbeatFailThreshold": 3
  }
}
```

### 1.4 心跳机制

`main.ts` 启动定时器，每 `heartbeatIntervalMs` 毫秒调用 `GET /health`：
- 成功 → `failCount = 0`，标记 healthy
- 失败 → `failCount++`
- `failCount >= heartbeatFailThreshold` → 标记 unhealthy，切换到 `NullVikingMemoryClient`
- 恢复后自动切回 `VikingMemoryClient`


---

## 2. VikingMemoryClient 接口设计

### 2.1 接口定义 (`packages/memory/src/viking-memory-client.ts`)

抽取统一接口，真实 client 和降级 client 均实现：

```typescript
export interface IVikingMemoryClient {
  // 连通性
  healthCheck(): Promise<boolean>;

  // 语义搜索
  find(query: string, opts?: FindOptions): Promise<FindResult>;

  // 内容读写
  read(uri: string): Promise<string>;
  abstract(uri: string): Promise<string>;
  overview(uri: string): Promise<string>;
  write(uri: string, content: string, opts?: WriteOptions): Promise<void>;

  // 文件系统
  ls(uri: string): Promise<FsEntry[]>;
  mkdir(uri: string, description?: string): Promise<void>;
  rm(uri: string, recursive?: boolean): Promise<void>;

  // 资源导入
  addResource(path: string, opts: AddResourceOptions): Promise<ResourceResult>;

  // Session
  createSession(id?: string): Promise<string>;
  getSessionContext(id: string, tokenBudget?: number): Promise<SessionContext>;
  addMessage(sessionId: string, role: string, content: string): Promise<void>;
  commitSession(sessionId: string): Promise<CommitResult>;
  deleteSession(sessionId: string): Promise<void>;

  // 后台任务
  getTask(taskId: string): Promise<TaskStatus>;
}
```

精简为 16 个方法（原设计 21 个），砍掉当前用不到的：`search`、`waitReady`、`waitProcessed`、`markUsed`、`extractMemories`。

### 2.2 核心类型定义

```typescript
export interface FindResultItem {
  uri: string;
  context_type: "resource" | "memory" | "skill";
  is_leaf: boolean;
  abstract: string;
  category: string;
  score: number;
  match_reason: string;
}

export interface FindResult {
  memories: FindResultItem[];
  resources: FindResultItem[];
  skills: FindResultItem[];
  total: number;
}

export interface FindOptions {
  targetUri?: string;
  limit?: number;
  scoreThreshold?: number;
  since?: string;
  until?: string;
}

export interface WriteOptions {
  mode?: "replace" | "create";
  wait?: boolean;
  timeout?: number;
}

export interface AddResourceOptions {
  to: string;
  reason?: string;
  wait?: boolean;
  ignore_dirs?: string;
  include?: string;
  exclude?: string;
}

export interface ResourceResult {
  uri: string;
  task_id?: string;
}

export interface FsEntry {
  name: string;
  uri: string;
  is_dir: boolean;
  size?: number;
}

export interface SessionContext {
  latest_archive_overview: string;
  pre_archive_abstracts: Array<{ archive_id: string; abstract: string }>;
  messages: Array<{ id: string; role: string; parts: unknown[]; created_at: string }>;
  estimatedTokens: number;
}

export interface CommitResult {
  session_id: string;
  status: "accepted";
  task_id: string;
  archive_uri: string;
}

export interface TaskStatus {
  task_id: string;
  task_type: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: Record<string, unknown>;
}
```

### 2.3 HTTP 请求基础

```typescript
private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const headers = new Headers(init.headers ?? {});
    headers.set("X-OpenViking-Agent", this.agentId);
    if (this.apiKey) headers.set("X-API-Key", this.apiKey);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init, headers, signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      status?: string; result?: T;
      error?: { code?: string; message?: string };
    };
    if (!response.ok || payload.status === "error") {
      const code = payload.error?.code ? ` [${payload.error.code}]` : "";
      const msg = payload.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`OpenViking request failed${code}: ${msg}`);
    }
    return (payload.result ?? payload) as T;
  } finally {
    clearTimeout(timer);
  }
}
```

### 2.4 NullVikingMemoryClient（降级实现）

实现同一 `IVikingMemoryClient` 接口：
- `healthCheck()` → `false`
- `find()` → `{ memories: [], resources: [], skills: [], total: 0 }`
- `read()` / `abstract()` / `overview()` → `""`
- 所有写操作 → 静默成功（`Promise<void>` resolve）
- `createSession()` → `"null-session"`
- `getSessionContext()` → 空上下文
- `commitSession()` → `{ session_id: "", status: "accepted", task_id: "", archive_uri: "" }`

### 2.5 VikingHealthMonitor (`packages/memory/src/viking-health-monitor.ts`)

```typescript
export class VikingHealthMonitor {
  private failCount = 0;
  private healthy = false;
  private timer: Timer | null = null;

  constructor(
    private realClient: VikingMemoryClient,
    private nullClient: NullVikingMemoryClient,
    private config: { intervalMs: number; failThreshold: number },
  ) {}

  /** 当前应使用的 client */
  get client(): IVikingMemoryClient {
    return this.healthy ? this.realClient : this.nullClient;
  }

  /** 是否健康 */
  get isHealthy(): boolean {
    return this.healthy;
  }

  /** 启动心跳定时器 */
  start(): void {
    this.check(); // 立即检查一次
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async check(): Promise<void> {
    const ok = await this.realClient.healthCheck();
    if (ok) {
      if (!this.healthy) logger.info("OpenViking 连接已恢复");
      this.failCount = 0;
      this.healthy = true;
    } else {
      this.failCount++;
      if (this.failCount >= this.config.failThreshold && this.healthy) {
        logger.warn({ failCount: this.failCount }, "OpenViking 连续心跳失败，切换到降级模式");
        this.healthy = false;
      }
    }
  }
}
```


---

## 3. Coordinator 上下文加载适配

### 3.1 LiveContextLoader 改造 (`apps/server/src/coordinator-context.ts`)

**构造函数变化**：

```typescript
// 之前
constructor(opts: {
  registry: SubagentRegistry;
  queue: PersistentQueue;
  store: TeamMemoryStore | null;
  embedder: LocalEmbedder | NullEmbedder;
})

// 之后
constructor(opts: {
  registry: SubagentRegistry;
  queue: PersistentQueue;            // 保留：事件分发核心
  vikingClient: IVikingMemoryClient; // 新增：替代 store + embedder
})
```

移除 `store` 和 `embedder` 参数。`queue` 保留因为 `PersistentQueue` 仍是事件分发核心，但不再作为上下文来源。

### 3.2 上下文加载流程

每条消息触发 Coordinator session 时，并发加载 5 个数据源：

```typescript
const [registry, tasks, agentMemories, userMemories, sessionCtx] =
  await Promise.allSettled([
    // 1. 正在运行的 worker（实时状态，仅 registry 知道）
    this.registry.allRunning(),

    // 2. 活跃任务（含历史进度）
    this.vikingClient.find(query, {
      targetUri: "viking://resources/tasks/active/",
      limit: 5,
    }),

    // 3. Agent 长期记忆（案例/模式/工具/技能）
    this.vikingClient.find(query, {
      targetUri: "viking://agent/teamsland/memories/",
      limit: 5,
    }),

    // 4. 用户记忆（画像/偏好）
    this.vikingClient.find(query, {
      targetUri: `viking://user/${requesterId}/memories/`,
      limit: 3,
    }),

    // 5. 对话上下文（archive 摘要 + 最近消息）
    this.vikingClient.getSessionContext(coordSessionId, 8000),
  ]);
```

每个源独立容错（`Promise.allSettled`），任一失败回退空字符串。

### 3.3 替代关系

| 之前 | 之后 |
|------|------|
| `TeamMemoryStore.vectorSearch` + `ftsSearch` | `vikingClient.find()` 语义搜索 |
| `PersistentQueue.recentCompleted()` 最近消息 | `vikingClient.getSessionContext()` session 上下文 |
| `LocalEmbedder` 本地 embedding | OpenViking server 端完成 embedding |
| 五阶段检索管道 (L0→vector→FTS5→merge→rerank) | OpenViking 内置检索管道，一个 `find` 搞定 |

### 3.4 Coordinator Session 管理

**Session ID 格式**：`coord-{chatId}`（一个群聊一个持久 session，保持对话连贯性）。

每次处理消息时：
1. `addMessage(coordSessionId, "user", rawMessage)`
2. Coordinator 推理
3. `addMessage(coordSessionId, "assistant", response)`
4. 每 10 条消息 `commitSession()` → 触发异步记忆提取

```typescript
const COMMIT_THRESHOLD = 10;

async function maybeCommitCoordinatorSession(
  client: IVikingMemoryClient,
  sessionId: string,
  messageCount: number,
): Promise<void> {
  if (messageCount > 0 && messageCount % COMMIT_THRESHOLD === 0) {
    const result = await client.commitSession(sessionId);
    logger.info({ sessionId, taskId: result.task_id }, "Coordinator session 已 commit");
  }
}
```


---

## 4. Worker 记忆写回 + 知识导入

### 4.1 Worker 完成写回 (`apps/server/src/event-handlers.ts`)

`worker_completed` 处理中新增两步写回：

```typescript
async function writebackToViking(
  client: IVikingMemoryClient,
  task: TaskRecord,
  result: WorkerResult,
): Promise<void> {
  // Step 1: 写任务状态 → completed
  const taskMd = formatTaskMarkdown(task, result);
  const completedUri = `viking://resources/tasks/completed/task-${task.id}.md`;
  const activeUri = `viking://resources/tasks/active/task-${task.id}.md`;

  await client.write(completedUri, taskMd, { mode: "create" });
  await client.rm(activeUri).catch(() => {}); // active 可能不存在

  // Step 2: Session 提交 → 触发记忆提取
  const sessionId = await client.createSession(`worker-${task.id}`);
  await client.addMessage(sessionId, "user", task.brief);
  await client.addMessage(sessionId, "assistant", result.summary);
  await client.commitSession(sessionId);
  // 异步提取 → 自动填充 viking://agent/teamsland/memories/cases/
}
```

容错：写回失败不影响主流程（`try/catch` + 日志告警），`NullClient` 静默跳过。

### 4.2 Worker 启动时写活跃任务

在 `teamsland-spawn` skill 触发 worker spawn 后：

```typescript
await client.write(
  `viking://resources/tasks/active/task-${task.id}.md`,
  formatActiveTaskMarkdown(task),
  { mode: "create" },
);
```

### 4.3 任务 Markdown 格式

```markdown
# task-{uuid}

- **status**: in_progress | completed | failed | cancelled
- **requester**: {user_name} ({user_id})
- **chat_id**: {lark_chat_id}
- **created_at**: 2026-04-23T10:00:00+08:00
- **updated_at**: 2026-04-23T11:30:00+08:00
- **worker_id**: worker-{id}

## Brief

用户原始需求的结构化整理...

## Progress

- [x] 读取代码结构
- [x] 实现组件
- [ ] 编写测试

## Result

最终输出结果...
```

### 4.4 知识导入脚本 (`scripts/viking-init.ts`)

一次性手动执行，不在 `main.ts` 启动时自动运行：

```typescript
async function initializeKnowledge(
  client: IVikingMemoryClient,
  config: AppConfig,
): Promise<void> {
  // 1. 确保目录结构
  await client.mkdir("viking://resources/tasks/active/", "进行中的任务");
  await client.mkdir("viking://resources/tasks/completed/", "已完成的任务");
  await client.mkdir("viking://resources/lark-docs/", "飞书文档归档");

  // 2. 从 config.repoMapping 导入代码仓库
  for (const mapping of config.repoMapping) {
    for (const repo of mapping.repos) {
      await client.addResource(repo.path, {
        to: `viking://resources/${repo.name}/`,
        reason: `代码仓库: ${repo.name}`,
        wait: false,
      });
    }
  }

  logger.info("知识导入已提交，语义处理将在后台完成");
}
```

### 4.5 飞书文档导入

暂不在本次实现范围。OpenViking 原生支持飞书文档 URL 导入（需在 `ov.conf` 配置 `feishu.app_id` + `feishu.app_secret`），后续按需添加。


---

## 5. Coordinator Viking Skill + Server 代理端点

### 5.1 Server 代理端点

新增 `apps/server/src/viking-routes.ts`（或追加到 `file-routes.ts`），teamsland server 作为 OpenViking 的薄代理：

```
POST   /api/viking/resource    → vikingClient.addResource(path, opts)
POST   /api/viking/find        → vikingClient.find(query, opts)
GET    /api/viking/read?uri=   → vikingClient.read(uri)
GET    /api/viking/ls?uri=     → vikingClient.ls(uri)
POST   /api/viking/write       → vikingClient.write(uri, content, opts)
DELETE /api/viking/fs?uri=     → vikingClient.rm(uri, recursive)
```

Server 层职责：
- 自动注入 `X-OpenViking-Agent` header
- `vikingClient` 为 `NullClient` 时直接返回 HTTP 503 `{ "error": "OpenViking unavailable" }`
- 记录操作日志（通过 `@teamsland/observability`）

### 5.2 Coordinator Skill (`config/coordinator-skills/skills/viking-manage/SKILL.md`)

```markdown
# viking-manage

管理 OpenViking 知识库资源。

## 能力

- 添加代码仓库：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "/path/to/repo", "to": "viking://resources/{name}/", "wait": false}'

- 添加飞书文档：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "https://xxx.feishu.cn/docx/xxx", "to": "viking://resources/lark-docs/{title}/", "wait": false}'

- 搜索知识库：
  curl -X POST http://localhost:3001/api/viking/find \
    -H "Content-Type: application/json" \
    -d '{"query": "搜索关键词", "limit": 5}'

- 查看目录：
  curl "http://localhost:3001/api/viking/ls?uri=viking://resources/"

- 读取内容：
  curl "http://localhost:3001/api/viking/read?uri=viking://resources/{name}/README.md"

## 使用场景

当用户要求：
- "帮我加一个仓库" → addResource
- "导入这个飞书文档" → addResource
- "搜一下关于 xxx 的知识" → find
- "看看知识库里有什么" → ls

## 注意

- addResource 是异步操作（wait: false），导入后语义处理在后台进行
- 仓库路径必须是部署机器上的绝对路径
- URI 命名遵循 viking://resources/{name}/ 格式
```


---

## 6. URI 命名约定

```
viking://
├── resources/
│   ├── teamsland/                    # teamsland 项目源码
│   ├── {repo-name}/                 # 其他代码仓库（从 config.repoMapping 导入）
│   ├── lark-docs/{doc-title}/       # 飞书文档（后续支持）
│   └── tasks/
│       ├── active/task-{uuid}.md    # 进行中的任务
│       └── completed/task-{uuid}.md # 已完成的任务
│
├── user/{user_id}/memories/         # 按飞书 user_id
│   ├── profile.md                   # 成员画像
│   ├── preferences/                 # 偏好
│   ├── entities/                    # 实体记忆
│   └── events/                      # 事件/决策记录
│
├── agent/teamsland/memories/        # agent_id = "teamsland"
│   ├── cases/                       # 问题+解法（worker 完成时写入）
│   ├── patterns/                    # 可复用模式
│   ├── tools/                       # 工具使用经验
│   └── skills/                      # 技能执行知识
│
└── session/
    ├── coord-{chatId}/              # Coordinator session（一个群聊一个持久 session）
    └── worker-{taskId}/             # Worker session
```

| 场景 | URI 格式 |
|------|---------|
| 代码仓库 | `viking://resources/{repo-name}/` |
| 飞书文档 | `viking://resources/lark-docs/{doc-title}/` |
| 活跃任务 | `viking://resources/tasks/active/task-{uuid}.md` |
| 已完成任务 | `viking://resources/tasks/completed/task-{uuid}.md` |
| 用户记忆 | `viking://user/{user_id}/memories/{category}/` |
| Agent 案例 | `viking://agent/teamsland/memories/cases/` |
| Coordinator session | `viking://session/coord-{chatId}/` |
| Worker session | `viking://session/worker-{taskId}/` |


---

## 7. 迁移策略

### Stage 1: 并行运行

- 新增 `VikingMemoryClient` + `NullVikingMemoryClient` + `VikingHealthMonitor`
- `LiveContextLoader` 接受 `vikingClient` 参数
- `main.ts` 同时初始化旧的 `TeamMemoryStore` 和新的 `vikingClient`
- 旧存储只读，新写入全走 OpenViking
- **回滚方式**：`config.openViking` 字段不配 → 自动用 `NullClient` → 回退到旧路径

### Stage 2: 切换主存储

- `LiveContextLoader` 不再依赖 `store` / `embedder`
- Event handlers 的 worker 写回走 OpenViking
- 运行 `scripts/viking-migrate.ts` 将 `memory_entries` 存量数据写入 OpenViking
- 验证端到端：飞书 @bot → coordinator 推理能召回 OpenViking 记忆

### Stage 3: 清理旧代码

删除文件：
- `packages/memory/src/team-memory-store.ts`
- `packages/memory/src/embedder.ts`
- `packages/memory/src/retriever.ts`
- `packages/memory/src/extract-loop.ts`
- `packages/memory/src/memory-reaper.ts`
- `packages/memory/src/memory-updater.ts`
- `packages/memory/src/entity-merge.ts`
- `packages/memory/src/ingest.ts`
- `packages/memory/src/llm-client.ts`
- `packages/memory/src/null-embedder.ts`
- `packages/memory/src/lifecycle.ts`

删除依赖：`sqlite-vec`、`sqlite-vec-darwin-arm64`、`node-llama-cpp`

`@teamsland/memory` 包最终只保留：
- `viking-memory-client.ts` — VikingMemoryClient + NullVikingMemoryClient
- `viking-health-monitor.ts` — VikingHealthMonitor
- `null-memory-store.ts` — 保留作为薄封装
- `index.ts` — 重新导出

### 不删的东西

| 保留 | 原因 |
|------|------|
| `PersistentQueue` | 事件分发核心 |
| `SessionDB` | Dashboard session 列表、FTS5 搜索 |
| `SubagentRegistry` | 运行中 worker 的实时状态 |


---

## 8. 集成到 main.ts

在现有启动流程中插入 OpenViking 初始化（Phase 1 和 Phase 4 之间）：

```
Phase 1: initStorage（保留旧的 SQLite/memory，Stage 3 后移除）

Phase 1.5: initViking（新增）
  if config.openViking:
    realClient = new VikingMemoryClient(config.openViking)
    nullClient = new NullVikingMemoryClient()
    healthMonitor = new VikingHealthMonitor(realClient, nullClient, {
      intervalMs: config.openViking.heartbeatIntervalMs,
      failThreshold: config.openViking.heartbeatFailThreshold,
    })
    healthMonitor.start()
  else:
    healthMonitor = null  // 不启用 OpenViking

Phase 4: initContext
  LiveContextLoader 传入 healthMonitor?.client ?? new NullVikingMemoryClient()

Phase 5.5: initCoordinator
  CoordinatorSessionManager 传入 vikingClient

shutdown():
  healthMonitor?.stop()
```

### Viking 代理路由注册

在 `initDashboard`（Phase 6）中注册 `/api/viking/*` 路由，传入 `healthMonitor`。

---

## 9. 测试策略

| 层级 | 覆盖内容 | 依赖 |
|------|---------|------|
| 单元测试 | `VikingMemoryClient.request()` mock HTTP 响应 | 无外部依赖 |
| 单元测试 | `NullVikingMemoryClient` 所有方法不抛异常 | 无外部依赖 |
| 单元测试 | `VikingHealthMonitor` 状态切换：healthy ↔ unhealthy | mock client |
| 单元测试 | `LiveContextLoader` 传入 mock vikingClient | mock client |
| 集成测试 | `write → find → read` 全链路 | 运行中的 OpenViking server |
| 集成测试 | Session 生命周期 `create → addMessage → commit → getTask` | 运行中的 OpenViking server |
| E2E | 飞书 @bot → coordinator 推理（含 OpenViking 上下文）→ spawn → 完成 → 写回 → 下次召回 | 全部服务 |

---

## 10. 文件清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `packages/memory/src/viking-memory-client.ts` | IVikingMemoryClient 接口 + VikingMemoryClient 实现 + NullVikingMemoryClient + 所有类型定义 |
| `packages/memory/src/viking-health-monitor.ts` | VikingHealthMonitor 心跳管理器 |
| `apps/server/src/viking-routes.ts` | OpenViking 代理 API 路由 |
| `config/openviking.conf` | OpenViking server 配置文件 |
| `config/coordinator-skills/skills/viking-manage/SKILL.md` | Coordinator 知识库管理 skill |
| `scripts/viking-init.ts` | 知识导入脚本 |
| `scripts/viking-migrate.ts` | 存量数据迁移脚本（Stage 2） |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/types/src/config.ts` | 新增 `OpenVikingConfig`，`AppConfig` 增加 `openViking?` 字段 |
| `config/config.json` | 新增 `openViking` 配置块 |
| `apps/server/src/main.ts` | 插入 Phase 1.5 initViking；shutdown 增加 healthMonitor.stop()；LiveContextLoader 传入 vikingClient |
| `apps/server/src/coordinator-context.ts` | `LiveContextLoader` 构造函数移除 store/embedder，新增 vikingClient；上下文加载改为 OpenViking find + getSessionContext |
| `apps/server/src/event-handlers.ts` | `worker_completed` 增加 Viking 写回；`worker spawn` 增加活跃任务写入 |
| `packages/memory/src/index.ts` | 重新导出 Viking 相关模块 |

### 删除文件（Stage 3）

| 文件 | 原因 |
|------|------|
| `packages/memory/src/team-memory-store.ts` | 被 VikingMemoryClient 替代 |
| `packages/memory/src/embedder.ts` | 被 OpenViking 内置 embedding 替代 |
| `packages/memory/src/retriever.ts` | 被 vikingClient.find 替代 |
| `packages/memory/src/extract-loop.ts` | 被 OpenViking session commit 替代 |
| `packages/memory/src/memory-reaper.ts` | 被 OpenViking 内置管理替代 |
| `packages/memory/src/memory-updater.ts` | 被 vikingClient.write 替代 |
| `packages/memory/src/entity-merge.ts` | 被 OpenViking 内置去重替代 |
| `packages/memory/src/ingest.ts` | 被 OpenViking addResource 替代 |
| `packages/memory/src/llm-client.ts` | 被 OpenViking VLM 替代 |
| `packages/memory/src/null-embedder.ts` | 不再需要 |
| `packages/memory/src/lifecycle.ts` | 不再需要 |

### 依赖变更（Stage 3）

`packages/memory/package.json` 最终 dependencies：

```json
{
  "dependencies": {
    "@teamsland/observability": "workspace:*",
    "@teamsland/types": "workspace:*"
  }
}
```

移除：`sqlite-vec`、`sqlite-vec-darwin-arm64`、`node-llama-cpp`。

---

## 11. 风险点

| 风险 | 缓解 |
|------|------|
| R1: OpenViking server 未启动或崩溃 | 心跳检测 + NullClient 自动降级；恢复后自动切回 |
| R2: 方舟 API 配额/限流 | OpenViking 内置 circuit breaker + 指数退避重试 |
| R3: 大型仓库首次导入延迟 | `wait: false` 异步处理，不阻塞；Coordinator 搜索结果不足时旧系统兜底（Stage 1） |
| R4: 并行运行期数据不一致 | 旧存储只读，新写入全走 OpenViking；过渡期不超过 2 周 |
| R5: AGPLv3 许可证 | HTTP API 调用，进程完全隔离，不修改 OpenViking 源码 |
| R6: Python 运行时依赖 | 外部服务模式，teamsland 不管理 OpenViking 进程；环境要求中明确 Python >= 3.10 |
| R7: 方舟内网域名仅字节内网可达 | 部署机器必须在字节内网；ov.conf 中 api_base 可按环境切换 |

