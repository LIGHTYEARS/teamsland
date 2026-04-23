# Phase 3: OpenViking 记忆层集成

> 状态: 待实施 | 前置: Phase 0 (队列基础设施), Phase 1 (CLI/Server API)
> 日期: 2026-04-23

## 目标

将 teamsland 的记忆层从自建的 SQLite + sqlite-vec 方案迁移到 OpenViking，获得：
- L0/L1/L2 三级上下文分层，按需加载，大幅降低 token 消耗
- 自动记忆提取（8 类记忆 + 去重合并），agent 越用越聪明
- 代码仓库/飞书文档的零配置导入与语义索引
- Session 管理与对话压缩内置支持

---

## 3A: OpenViking Server 生命周期管理

### 配置文件设计

`config/openviking.conf`（JSON，由 teamsland 管理，非 OpenViking 默认的 `~/.openviking/ov.conf`）：

```json
{
  "storage": {
    "workspace": "./data/openviking"
  },
  "log": {
    "level": "INFO",
    "output": "file"
  },
  "embedding": {
    "dense": {
      "provider": "ollama",
      "model": "nomic-embed-text",
      "api_base": "http://localhost:11434",
      "dimension": 768
    },
    "max_concurrent": 5
  },
  "vlm": {
    "provider": "ollama",
    "model": "qwen2.5-coder:14b",
    "api_base": "http://localhost:11434",
    "max_concurrent": 10
  },
  "server": {
    "host": "127.0.0.1",
    "port": 1933
  }
}
```

> 若环境有外网访问能力，`vlm` 可改为 `volcengine` / `openai` provider 以提升 L0/L1 生成质量。

### 配置类型扩展

在 `@teamsland/types` 的 `config.ts` 中新增：

```typescript
export interface OpenVikingConfig {
  /** OpenViking 配置文件路径（相对项目根目录） */
  confPath: string;
  /** openviking-server 可执行文件路径（默认从 PATH 搜索） */
  serverBin?: string;
  /** HTTP 端口 */
  port: number;
  /** 健康检查超时（毫秒） */
  readyTimeoutMs: number;
  /** 是否由 teamsland 管理 server 生命周期（false = 外部启动） */
  managed: boolean;
  /** agent 标识（用于 X-OpenViking-Agent header） */
  agentId: string;
}
```

在 `AppConfig` 中增加可选字段：

```typescript
export interface AppConfig {
  // ...existing...
  openViking?: OpenVikingConfig;
}
```

### 子进程管理（`apps/server/src/openviking-launcher.ts`）

```typescript
import { createLogger } from "@teamsland/observability";
import type { OpenVikingConfig } from "@teamsland/types";

const logger = createLogger("server:openviking");

export class OpenVikingLauncher {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenVikingConfig) {
    this.baseUrl = `http://127.0.0.1:${config.port}`;
  }

  /** 启动 openviking-server 子进程并等待 /ready */
  async start(signal: AbortSignal): Promise<void>;

  /** 轮询 GET /ready，指数退避，超时抛出 */
  private async waitReady(timeoutMs: number, signal: AbortSignal): Promise<void>;

  /** 优雅关闭：SIGTERM → 5s → SIGKILL */
  async stop(): Promise<void>;
}
```

**启动流程**：

```
teamsland server 启动
  → 读取 config.openViking
  → if managed:
      → 设置 OPENVIKING_CONFIG_FILE=config/openviking.conf
      → Bun.spawn(["openviking-server"], { env, stdout: "pipe", stderr: "pipe" })
      → 流式读取 stdout/stderr → logger
      → 轮询 GET /ready（间隔 500ms，指数退避至 2s，总超时 readyTimeoutMs）
      → /ready 200 → 启动完成
  → else:
      → 仅检查 /ready 确认外部 server 已运行
```

**关闭流程**：

```
teamsland 收到 SIGTERM/SIGINT
  → 调用 launcher.stop()
  → proc.kill("SIGTERM")
  → setTimeout 5000 → proc.kill("SIGKILL")
  → 等待进程退出
```

### 集成到 main.ts

在步骤 6（Embedding 初始化之前）插入：

```typescript
// ── 5.5. OpenViking Server ──
let vikingLauncher: OpenVikingLauncher | null = null;
if (config.openViking?.managed) {
  vikingLauncher = new OpenVikingLauncher(config.openViking);
  await vikingLauncher.start(controller.signal);
  logger.info("OpenViking server 已就绪");
}
```

在 `shutdown()` 中增加：

```typescript
if (vikingLauncher) await vikingLauncher.stop();
```

---

## 3B: VikingMemoryClient 完整接口设计

### 类签名

新建文件 `packages/memory/src/viking-memory-client.ts`：

```typescript
import { createLogger } from "@teamsland/observability";
import type { OpenVikingConfig } from "@teamsland/types";

/**
 * OpenViking REST API 的 TypeScript 封装
 *
 * 封装所有 teamsland 需要的 OpenViking 操作，提供类型安全的调用接口。
 * 参考 OpenViking 的 claude-code-memory-plugin 实现。
 *
 * @example
 * ```typescript
 * const client = new VikingMemoryClient({
 *   port: 1933, agentId: "teamsland",
 *   confPath: "config/openviking.conf",
 *   readyTimeoutMs: 30000, managed: true,
 * });
 * await client.healthCheck();
 * const results = await client.find("React hooks 最佳实践");
 * ```
 */
export class VikingMemoryClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly timeoutMs: number;

  constructor(config: OpenVikingConfig, options?: { timeoutMs?: number });
}
```

### 方法与 HTTP 映射

| 方法 | HTTP 调用 | 说明 |
|------|----------|------|
| `healthCheck(): Promise<boolean>` | `GET /health` | 连通性检查 |
| `waitReady(timeoutMs): Promise<void>` | `GET /ready` (轮询) | 等待语义引擎就绪 |
| `find(query, opts): Promise<FindResult>` | `POST /api/v1/search/find` | 语义搜索 |
| `search(query, opts): Promise<FindResult>` | `POST /api/v1/search/search` | 带 session 上下文的搜索 |
| `read(uri): Promise<string>` | `GET /api/v1/content/read?uri=` | 读取 L2 完整内容 |
| `abstract(uri): Promise<string>` | `GET /api/v1/content/abstract?uri=` | 读取 L0 摘要 |
| `overview(uri): Promise<string>` | `GET /api/v1/content/overview?uri=` | 读取 L1 概览 |
| `write(uri, content, opts): Promise<WriteResult>` | `POST /api/v1/content/write` | 写入/更新内容 |
| `ls(uri): Promise<FsEntry[]>` | `GET /api/v1/fs/ls?uri=` | 列出目录 |
| `mkdir(uri, desc?): Promise<void>` | `POST /api/v1/fs/mkdir` | 创建目录 |
| `rm(uri, recursive?): Promise<void>` | `DELETE /api/v1/fs?uri=` | 删除 |
| `addResource(path, opts): Promise<ResourceResult>` | `POST /api/v1/resources` | 导入资源 |
| `waitProcessed(): Promise<void>` | `POST /api/v1/system/wait` | 等待语义处理完成 |
| `createSession(id?): Promise<string>` | `POST /api/v1/sessions` | 创建 session |
| `getSession(id): Promise<SessionInfo>` | `GET /api/v1/sessions/{id}` | 获取 session 详情 |
| `getSessionContext(id, tokenBudget?): Promise<SessionContext>` | `GET /api/v1/sessions/{id}/context` | 获取组装好的 session 上下文 |
| `addMessage(sessionId, role, content): Promise<void>` | `POST /api/v1/sessions/{id}/messages` | 添加消息 |
| `markUsed(sessionId, contexts): Promise<void>` | `POST /api/v1/sessions/{id}/used` | 记录使用的上下文 |
| `commitSession(sessionId): Promise<CommitResult>` | `POST /api/v1/sessions/{id}/commit` | 提交 session（触发记忆提取） |
| `extractMemories(sessionId): Promise<unknown[]>` | `POST /api/v1/sessions/{id}/extract` | 立即提取记忆 |
| `deleteSession(sessionId): Promise<void>` | `DELETE /api/v1/sessions/{id}` | 删除 session |
| `getTask(taskId): Promise<TaskStatus>` | `GET /api/v1/tasks/{taskId}` | 查询后台任务状态 |

### 核心类型定义

```typescript
/** 搜索结果项 */
export interface FindResultItem {
  uri: string;
  context_type: "resource" | "memory" | "skill";
  is_leaf: boolean;
  abstract: string;
  category: string;
  score: number;
  match_reason: string;
  level?: number;
  overview?: string;
}

/** 搜索结果 */
export interface FindResult {
  memories: FindResultItem[];
  resources: FindResultItem[];
  skills: FindResultItem[];
  total: number;
}

/** 搜索选项 */
export interface FindOptions {
  targetUri?: string;
  limit?: number;
  scoreThreshold?: number;
  since?: string;
  until?: string;
}

/** Session 上下文 */
export interface SessionContext {
  latest_archive_overview: string;
  pre_archive_abstracts: Array<{ archive_id: string; abstract: string }>;
  messages: Array<{ id: string; role: string; parts: unknown[]; created_at: string }>;
  estimatedTokens: number;
  stats: {
    totalArchives: number;
    includedArchives: number;
    activeTokens: number;
    archiveTokens: number;
  };
}

/** Commit 结果 */
export interface CommitResult {
  session_id: string;
  status: "accepted";
  task_id: string;
  archive_uri: string;
  archived: boolean;
}

/** 后台任务状态 */
export interface TaskStatus {
  task_id: string;
  task_type: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: Record<string, unknown>;
}
```

### HTTP 请求基础实现

```typescript
private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), this.timeoutMs);
  try {
    const headers = new Headers(init.headers ?? {});
    headers.set("X-OpenViking-Agent", this.agentId);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as {
      status?: string;
      result?: T;
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

### NullVikingMemoryClient（降级方案）

```typescript
/**
 * OpenViking 不可用时的降级实现
 *
 * 所有读操作返回空结果，写操作静默成功。
 * 配合 NullMemoryStore 一起使用，确保系统可无 OpenViking 运行。
 *
 * @example
 * ```typescript
 * const client: VikingMemoryClient | NullVikingMemoryClient = config.openViking
 *   ? new VikingMemoryClient(config.openViking)
 *   : new NullVikingMemoryClient();
 * ```
 */
export class NullVikingMemoryClient {
  async healthCheck(): Promise<boolean> { return false; }
  async find(): Promise<FindResult> { return { memories: [], resources: [], skills: [], total: 0 }; }
  async read(): Promise<string> { return ""; }
  // ... 其余方法同理
}
```

---

## 3C: URI 命名约定

### 目录结构

```
viking://
├── resources/
│   ├── teamsland/                    # teamsland 项目源码
│   │   ├── .abstract.md             # L0: 项目概述
│   │   ├── .overview.md             # L1: 架构概览
│   │   └── src/...                  # L2: 完整代码
│   ├── {repo-name}/                 # 其他代码仓库
│   └── tasks/                       # 任务状态（结构化 markdown）
│       ├── active/
│       │   ├── task-{uuid}.md       # 进行中的任务
│       │   └── ...
│       ├── completed/
│       │   └── task-{uuid}.md       # 已完成的任务
│       └── .overview.md             # 任务全局概览（自动生成）
│
├── user/
│   └── {user_id}/                   # 按飞书 user_id
│       └── memories/
│           ├── profile.md           # 成员画像（追加式）
│           ├── preferences/         # 偏好
│           ├── entities/            # 实体记忆
│           └── events/              # 事件/决策记录
│
├── agent/
│   └── teamsland/                   # agent_id = "teamsland"
│       ├── memories/
│       │   ├── cases/              # 问题+解法（worker 完成时写入）
│       │   ├── patterns/           # 可复用模式
│       │   ├── tools/              # 工具使用经验
│       │   └── skills/             # 技能执行知识
│       └── instructions/           # agent 指令（从 CLAUDE.md 同步）
│
└── session/
    └── {session_id}/               # 每次 Coordinator 推理一个 session
        ├── messages.jsonl
        ├── history/
        └── ...
```

### URI 约定规则

| 场景 | URI 格式 | 示例 |
|------|---------|------|
| 代码仓库 | `viking://resources/{repo-name}/` | `viking://resources/teamsland/` |
| 飞书文档 | `viking://resources/lark-docs/{doc-title}/` | `viking://resources/lark-docs/Q1-OKR/` |
| 活跃任务 | `viking://resources/tasks/active/task-{uuid}.md` | `viking://resources/tasks/active/task-a1b2.md` |
| 已完成任务 | `viking://resources/tasks/completed/task-{uuid}.md` | `viking://resources/tasks/completed/task-a1b2.md` |
| 用户记忆 | `viking://user/{user_id}/memories/{category}/` | `viking://user/ou_abc/memories/preferences/` |
| Agent 案例 | `viking://agent/teamsland/memories/cases/` | `viking://agent/teamsland/memories/cases/` |
| Coordinator session | `viking://session/coord-{msg_id}/` | `viking://session/coord-ev_123/` |
| Worker session | `viking://session/worker-{task_id}/` | `viking://session/worker-a1b2/` |

### 任务状态 Markdown 结构

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
- [x] 实现头像上传组件
- [ ] 编写测试
- [ ] 代码审查

## Result

最终输出结果...
```

---

## 3D: 知识导入管道

### 初始化导入脚本（`scripts/viking-init.ts`）

teamsland server 首次启动（或 `teamsland viking init` 命令）时执行：

```typescript
async function initializeKnowledge(client: VikingMemoryClient, config: AppConfig): Promise<void> {
  // 1. 确保目录结构
  await client.mkdir("viking://resources/tasks/", "团队任务状态存储");
  await client.mkdir("viking://resources/tasks/active/", "进行中的任务");
  await client.mkdir("viking://resources/tasks/completed/", "已完成的任务");
  await client.mkdir("viking://resources/lark-docs/", "飞书文档归档");

  // 2. 导入代码仓库
  for (const mapping of config.repoMapping) {
    for (const repo of mapping.repos) {
      const targetUri = `viking://resources/${repo.name}/`;
      await client.addResource(repo.path, {
        to: targetUri,
        reason: `代码仓库: ${repo.name}`,
        wait: false,  // 异步处理，不阻塞启动
      });
    }
  }

  // 3. 等待语义处理完成（后台）
  // 不在启动时阻塞等待，由后台任务跟踪
  logger.info("知识导入已提交，语义处理将在后台完成");
}
```

### 飞书文档导入

OpenViking 原生支持飞书文档 URL 导入（需配置 `FEISHU_APP_ID` + `FEISHU_APP_SECRET`）：

```typescript
async function importLarkDoc(
  client: VikingMemoryClient,
  docUrl: string,
  title: string,
): Promise<void> {
  await client.addResource(docUrl, {
    to: `viking://resources/lark-docs/${title}/`,
    reason: `飞书文档: ${title}`,
    wait: false,
  });
}
```

### 增量更新策略

利用 OpenViking 的 `add_resource` 增量更新机制：

- **代码仓库**：定时（如每小时）重新调用 `addResource` 相同 `to` URI，OpenViking 自动 diff 仅处理变更文件
- **飞书文档**：使用 `watch_interval` 参数，OpenViking 自动定时拉取更新
- **任务状态**：通过 `write()` 直接覆盖，语义索引自动刷新

```typescript
// 仓库增量更新（定时任务）
async function syncRepositories(client: VikingMemoryClient, config: AppConfig): Promise<void> {
  for (const mapping of config.repoMapping) {
    for (const repo of mapping.repos) {
      await client.addResource(repo.path, {
        to: `viking://resources/${repo.name}/`,
        reason: `增量同步: ${repo.name}`,
        wait: false,
      });
    }
  }
}
```

---

## 3E: Coordinator 上下文加载

### 加载流程

每条消息触发 Coordinator session 时，按以下顺序加载上下文：

```
新消息到达 (event)
│
├─ 1. 加载任务状态
│   find("相关任务关键词", { targetUri: "viking://resources/tasks/active/", limit: 5 })
│   → 返回 L0 摘要，仅对最相关的 1-2 个任务 read() L2 全文
│
├─ 2. 加载长期记忆
│   find(消息内容, { targetUri: "viking://agent/teamsland/memories/", limit: 5 })
│   find(消息内容, { targetUri: "viking://user/{requester}/memories/", limit: 3 })
│   → 返回 agent 案例/模式 + 用户偏好/画像
│
├─ 3. 加载对话上下文
│   getSessionContext(coordSessionId, { tokenBudget: 8000 })
│   → 返回 archive overview + 最近消息
│
├─ 4. 组装 prompt
│   将上述结果拼接到系统提示中
│   → Claude 推理
│
└─ 5. 写回状态
    addMessage(coordSessionId, "user", 原始消息)
    addMessage(coordSessionId, "assistant", 推理结果)
    → 每 N 轮或 session 过长时 commitSession()
```

### 上下文组装器适配

修改 `DynamicContextAssembler`，增加 OpenViking 上下文源：

```typescript
export class DynamicContextAssembler {
  constructor(opts: {
    // ...existing...
    vikingClient?: VikingMemoryClient;
  });

  /** 从 OpenViking 加载任务 + 记忆 + 对话上下文 */
  async loadVikingContext(event: IncomingEvent): Promise<VikingContext> {
    const [tasks, agentMemories, userMemories, sessionCtx] = await Promise.all([
      this.vikingClient.find(event.summary, {
        targetUri: "viking://resources/tasks/active/",
        limit: 5,
      }),
      this.vikingClient.find(event.summary, {
        targetUri: "viking://agent/teamsland/memories/",
        limit: 5,
      }),
      this.vikingClient.find(event.summary, {
        targetUri: `viking://user/${event.requesterId}/memories/`,
        limit: 3,
      }),
      this.vikingClient.getSessionContext(event.sessionId, 8000),
    ]);
    return { tasks, agentMemories, userMemories, sessionCtx };
  }
}
```

---

## 3F: Worker 记忆写回

### 任务完成记录

Worker 完成后，server 负责写回：

```typescript
async function onWorkerCompleted(
  client: VikingMemoryClient,
  task: TaskRecord,
  result: WorkerResult,
): Promise<void> {
  // 1. 更新任务状态 → completed
  const taskMd = formatTaskMarkdown(task, result);
  const activeUri = `viking://resources/tasks/active/task-${task.id}.md`;
  const completedUri = `viking://resources/tasks/completed/task-${task.id}.md`;

  // 写入 completed，删除 active
  await client.write(completedUri, taskMd, { mode: "create" });
  await client.rm(activeUri);

  // 2. 通过 session 提取案例记忆
  const sessionId = await client.createSession(`worker-${task.id}`);
  await client.addMessage(sessionId, "user", task.brief);
  await client.addMessage(sessionId, "assistant", result.summary);
  const commitResult = await client.commitSession(sessionId);
  // Phase 2 异步提取 → cases/patterns 自动写入 viking://agent/teamsland/memories/

  logger.info(
    { taskId: task.id, commitTaskId: commitResult.task_id },
    "Worker 结果已写回 OpenViking",
  );
}
```

### Coordinator Session Commit 策略

```typescript
const COMMIT_THRESHOLD = 10; // 每 10 条消息 commit 一次

async function maybeCommitCoordinatorSession(
  client: VikingMemoryClient,
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

## 迁移路径

### 阶段 1: 并行运行（Phase 3A + 3B）

- 保留现有 `TeamMemoryStore` + `NullMemoryStore`
- 新增 `VikingMemoryClient` + `NullVikingMemoryClient`
- `main.ts` 中两套记忆系统同时初始化
- 所有新的记忆读写走 OpenViking，旧的 SQLite 存储只读

### 阶段 2: 数据迁移（Phase 3C）

- 运行 `scripts/viking-migrate.ts` 将 `memory_entries` 中的存量数据迁移：
  - 按 `memory_type` 分类写入对应 `viking://` URI
  - profile/preferences/entities/events → `viking://user/default/memories/`
  - cases/patterns/tools/skills → `viking://agent/teamsland/memories/`
- 导入代码仓库和飞书文档

### 阶段 3: 切换主存储（Phase 3D + 3E）

- `DynamicContextAssembler` 切换为从 OpenViking 加载上下文
- Event handler 切换为使用 OpenViking session 管理
- Worker 完成回调写入 OpenViking

### 阶段 4: 清理旧代码

- 移除 `TeamMemoryStore`、`LocalEmbedder`、`ExtractLoop` 等自建记忆组件
- 移除 `sqlite-vec`、`node-llama-cpp` 依赖
- `@teamsland/memory` 包精简为 `VikingMemoryClient` + `NullVikingMemoryClient`
- `NullMemoryStore` 保留作为降级方案的薄封装

### package.json 变化

迁移后 `@teamsland/memory` 的 dependencies：

```json
{
  "dependencies": {
    "@teamsland/observability": "workspace:*",
    "@teamsland/types": "workspace:*"
  }
}
```

移除：`sqlite-vec`、`sqlite-vec-darwin-arm64`、`node-llama-cpp`、`@teamsland/session`（记忆包不再需要）。

---

## 验证方式

### 3A 验证

| 检查项 | 方法 |
|--------|------|
| openviking-server 随 teamsland 启动 | `curl http://localhost:1933/health` 返回 200 |
| 健康检查等待 | 启动日志出现 "OpenViking server 已就绪" |
| 优雅关闭 | SIGTERM teamsland 后，openviking-server 进程消失 |
| 外部模式 | `managed: false` 时不启动子进程，仅检查连通性 |

### 3B 验证

| 检查项 | 方法 |
|--------|------|
| find 语义搜索 | 导入 README 后 `find("项目架构")` 返回相关结果 |
| write + read 一致性 | `write(uri, content)` 后 `read(uri)` 返回相同内容 |
| session 生命周期 | create → addMessage x N → commit → getTask → completed |
| L0/L1/L2 分级读取 | `abstract()` < `overview()` < `read()` 内容量递增 |
| 降级 | `NullVikingMemoryClient` 所有方法不抛异常 |

### 3C 验证

| 检查项 | 方法 |
|--------|------|
| 仓库导入 | `ls viking://resources/teamsland/` 显示项目目录结构 |
| L0 自动生成 | `abstract viking://resources/teamsland/` 返回项目摘要 |
| 增量更新 | 修改文件后重新 addResource，仅变更文件重新处理 |

### 3D + 3E 验证

| 检查项 | 方法 |
|--------|------|
| 上下文加载 | Coordinator 推理时日志显示加载了 tasks/memories/session |
| Worker 写回 | 任务完成后 `ls viking://resources/tasks/completed/` 包含对应文件 |
| 记忆提取 | commit 后 `find` 在 `agent/memories/cases/` 下能搜到相关案例 |
| 端到端 | 飞书 @机器人 → 大脑推理 → spawn worker → 完成 → 记忆写回 → 下次推理能召回 |

### 集成测试脚本

```typescript
// tests/integration/openviking.test.ts
describe("OpenViking Integration", () => {
  it("应能完成 write → find → read 全链路", async () => {
    await client.write("viking://resources/tasks/active/test-task.md", taskContent, { mode: "create" });
    await client.waitProcessed();
    const results = await client.find("测试任务", { targetUri: "viking://resources/tasks/" });
    expect(results.total).toBeGreaterThan(0);
    const content = await client.read("viking://resources/tasks/active/test-task.md");
    expect(content).toContain("测试任务");
  });

  it("应能完成 session 生命周期", async () => {
    const sessionId = await client.createSession();
    await client.addMessage(sessionId, "user", "帮我改登录页");
    await client.addMessage(sessionId, "assistant", "好的，我来处理");
    const result = await client.commitSession(sessionId);
    expect(result.status).toBe("accepted");
    // 等待后台记忆提取
    let task = await client.getTask(result.task_id);
    while (task.status === "pending" || task.status === "running") {
      await Bun.sleep(1000);
      task = await client.getTask(result.task_id);
    }
    expect(task.status).toBe("completed");
  });
});
```

---

## 风险点

### R1: OpenViking 启动耗时

**风险**：openviking-server 首次启动需要构建 C++ 核心扩展和 Go AGFS 组件，可能耗时数分钟。
**缓解**：`readyTimeoutMs` 默认设为 120s；首次安装在 README 中明确说明 `pip install openviking` 的预编译时间。

### R2: Ollama 模型下载

**风险**：本地部署依赖 Ollama，首次需下载 embedding 和 VLM 模型（GB 级）。
**缓解**：提供 `scripts/viking-setup.sh` 预拉取模型；支持 `managed: false` 模式跳过自动启动。

### R3: L0/L1 生成质量

**风险**：本地 Ollama 模型生成的 L0/L1 摘要质量可能不如云 API。
**缓解**：配置文件支持灵活切换 `vlm.provider`（ollama/volcengine/openai）；关键仓库导入后人工审查 L1 质量。

### R4: 语义处理延迟

**风险**：大型仓库首次导入的语义处理（L0/L1 + 向量索引）可能耗时较长，期间搜索结果不完整。
**缓解**：导入使用 `wait: false` 异步处理，不阻塞服务启动；Dashboard 展示语义处理进度；Coordinator 在搜索结果不足时回退到原始记忆系统。

### R5: 磁盘空间

**风险**：OpenViking workspace 存储所有 L0/L1/L2 内容 + 向量索引，大型仓库可能占用数 GB。
**缓解**：`config/openviking.conf` 中 `storage.workspace` 可指向大容量磁盘；定期清理已归档的 completed tasks。

### R6: AGPLv3 许可证

**风险**：OpenViking 主体代码为 AGPLv3，teamsland 若作为网络服务需注意合规。
**缓解**：teamsland 通过 HTTP API 调用 OpenViking（独立进程），不修改 OpenViking 源码，不存在代码链接。参考 OpenViking 官方示例（Apache 2.0）。teamsland 内部使用无合规风险，若未来开源需评估。

### R7: Python 运行时依赖

**风险**：OpenViking server 是 Python 进程，teamsland 主体是 Bun/TypeScript，引入了异构运行时。
**缓解**：仅通过 HTTP API 交互，进程完全隔离；`managed` 模式下由 teamsland 管理生命周期；环境要求中明确 Python >= 3.10。

### R8: 与现有 TeamMemoryStore 的过渡期一致性

**风险**：并行运行期间，两套记忆系统的数据可能不一致。
**缓解**：过渡期旧存储设为只读；所有新写入走 OpenViking；提供一次性迁移脚本；过渡期不超过 2 周。
