# Phase 1: teamsland CLI + Server API 技术方案

> 状态：草案 | 作者：技术方案设计 | 日期：2026-04-23

## 目录

- [1. 概述](#1-概述)
- [2. 改动清单](#2-改动清单)
- [3. 1A: Server HTTP API 扩展](#3-1a-server-http-api-扩展)
- [4. 1B: `@teamsland/cli` 包](#4-1b-teamslandcli-包)
- [5. 1C: Coordinator Spawn Skill](#5-1c-coordinator-spawn-skill)
- [6. 1D: AgentRecord 类型扩展](#6-1d-agentrecord-类型扩展)
- [7. 迁移步骤](#7-迁移步骤)
- [8. 验证方式](#8-验证方式)
- [9. 风险点](#9-风险点)

---

## 1. 概述

Phase 1 建立 Coordinator（大脑）到 Worker 的调度通道。大脑是一个运行在 `~/.teamsland/coordinator/` 的 Claude Code session，通过 Skill 学会使用 `teamsland` CLI 命令，CLI 通过 HTTP 调用 Server API，Server 内部调用已有的 ProcessController + WorktreeManager + SubagentRegistry 完成 Worker 的生命周期管理。

```
Coordinator (Claude Code session)
  → Skill: teamsland-spawn
    → Bash: teamsland spawn --repo /path --task "..."
      → HTTP POST http://localhost:<port>/api/workers
        → Server: WorktreeManager.create() + ProcessController.spawn() + Registry.register()
          → Worker (Claude Code subprocess in worktree)
```

---

## 2. 改动清单

### 修改的文件

| 文件 | 改动 |
|------|------|
| `packages/types/src/sidecar.ts` | 扩展 `AgentRecord` 接口：新增 `origin`、`taskBrief`、`parentAgentId`、`result`、`completedAt` 字段 |
| `apps/server/src/dashboard.ts` | 在 `handleApiRoutes()` 中新增 5 个 `/api/workers` 路由 |
| `apps/server/src/main.ts` | 将 `processController`、`worktreeManager` 注入到 `startDashboard()` deps |
| `packages/sidecar/src/process-controller.ts` | 扩展 `SpawnParams` 接口：`issueId` 改为可选，新增 `repoPath`、`task` 字段 |

### 新建的文件

| 文件 | 说明 |
|------|------|
| `packages/cli/package.json` | CLI 包配置，`bin` 字段声明 `teamsland` 命令 |
| `packages/cli/src/index.ts` | CLI 入口，参数解析 + HTTP 调用 |
| `packages/cli/src/http-client.ts` | 封装对 Server API 的 HTTP 请求 |
| `packages/cli/src/commands/spawn.ts` | `spawn` 子命令实现 |
| `packages/cli/src/commands/list.ts` | `list` 子命令实现 |
| `packages/cli/src/commands/status.ts` | `status` 子命令实现 |
| `packages/cli/src/commands/result.ts` | `result` 子命令实现 |
| `packages/cli/src/commands/cancel.ts` | `cancel` 子命令实现 |
| `packages/cli/src/commands/transcript.ts` | `transcript` 子命令实现 |
| `packages/cli/tsconfig.json` | TypeScript 配置 |
| `packages/cli/src/__tests__/cli.test.ts` | CLI 单元测试 |
| `apps/server/src/worker-routes.ts` | Worker API 路由处理逻辑（从 dashboard.ts 解耦） |
| `apps/server/src/__tests__/worker-routes.test.ts` | Worker API 集成测试 |
| `~/.teamsland/coordinator/.claude/skills/teamsland-spawn/SKILL.md` | Coordinator 的 spawn skill |

---

## 3. 1A: Server HTTP API 扩展

### 3.1 路由总览

所有 Worker API 路由前缀为 `/api/workers`，与现有 `/api/agents` 并存（后者为 Dashboard WebSocket 推送用，保持兼容）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/workers` | 创建 Worker |
| `GET` | `/api/workers` | 列出所有 Worker |
| `GET` | `/api/workers/:id` | 查询单个 Worker 状态 |
| `POST` | `/api/workers/:id/cancel` | 取消 Worker |
| `GET` | `/api/workers/:id/transcript` | 获取 transcript 路径 |

### 3.2 API 端点详细规格

#### POST /api/workers

创建并启动一个 Worker。

**请求体 (JSON):**

```typescript
interface CreateWorkerRequest {
  /** 任务提示词（必填） */
  task: string;
  /** 目标仓库路径（与 worktree 二选一，用于新建 worktree 场景） */
  repo?: string;
  /** 已有 worktree 路径（与 repo 二选一，用于恢复/接力场景） */
  worktree?: string;
  /** 任务简述（可选，用于 Dashboard 展示） */
  taskBrief?: string;
  /** 事件来源信息（可选） */
  origin?: {
    chatId?: string;
    messageId?: string;
    senderId?: string;
    assigneeId?: string;
    source?: "meego" | "lark_mention" | "coordinator";
  };
  /** 父 Agent ID（可选，观察者场景） */
  parentAgentId?: string;
}
```

**响应 (201 Created):**

```typescript
interface CreateWorkerResponse {
  /** Worker（Agent）唯一标识 */
  workerId: string;
  /** 进程 PID */
  pid: number;
  /** Session ID */
  sessionId: string;
  /** Worktree 路径 */
  worktreePath: string;
  /** 创建时间 */
  createdAt: number;
}
```

**错误响应:**

| 状态码 | 场景 |
|--------|------|
| `400` | `task` 为空、`repo` 和 `worktree` 都缺失或都提供 |
| `409` | 容量已满（CapacityError） |
| `500` | worktree 创建失败、进程启动失败等 |

**Server 内部流程:**

```
1. 校验请求参数
2. 如果提供 repo:
   a. 生成 issueId = `cli-${randomUUID().slice(0,8)}`
   b. worktreePath = await worktreeManager.create(repo, issueId)
3. 如果提供 worktree:
   a. 验证路径存在
   b. worktreePath = worktree
   c. issueId = 从路径推导或生成
4. agentId = `worker-${randomUUID().slice(0,8)}`
5. spawnResult = await processController.spawn({ worktreePath, initialPrompt: task })
6. registry.register({ agentId, pid, sessionId, worktreePath, status: "running", ... })
7. dataPlane.processStream(agentId, stdout)  // 异步消费输出流
8. 返回 201 + workerId
```

#### GET /api/workers

**响应 (200 OK):**

```typescript
interface ListWorkersResponse {
  workers: WorkerSummary[];
  total: number;
}

interface WorkerSummary {
  workerId: string;
  pid: number;
  sessionId: string;
  status: "running" | "completed" | "failed";
  worktreePath: string;
  taskBrief?: string;
  origin?: AgentRecord["origin"];
  parentAgentId?: string;
  createdAt: number;
  completedAt?: number;
}
```

**实现:** 调用 `registry.allRunning()` 返回所有已注册 agent。

#### GET /api/workers/:id

**响应 (200 OK):**

```typescript
interface WorkerDetailResponse {
  workerId: string;
  pid: number;
  sessionId: string;
  status: "running" | "completed" | "failed";
  worktreePath: string;
  taskBrief?: string;
  origin?: AgentRecord["origin"];
  parentAgentId?: string;
  createdAt: number;
  completedAt?: number;
  result?: string;
  /** 进程是否仍存活（实时探测） */
  alive: boolean;
}
```

**错误:** `404` 如果 workerId 不存在。

**实现:** `registry.get(id)` + `processController.isAlive(record.pid)`.

#### POST /api/workers/:id/cancel

**请求体 (JSON):**

```typescript
interface CancelWorkerRequest {
  /** 是否强制终止，默认 false（SIGINT） */
  force?: boolean;
}
```

**响应 (200 OK):**

```typescript
interface CancelWorkerResponse {
  workerId: string;
  signal: "SIGINT" | "SIGKILL";
  /** cancel 前的状态 */
  previousStatus: string;
}
```

**错误:** `404` 如果不存在，`409` 如果已完成/已失败。

**实现:** `processController.interrupt(record.pid, force)`.

#### GET /api/workers/:id/transcript

**响应 (200 OK):**

```typescript
interface TranscriptResponse {
  workerId: string;
  sessionId: string;
  /** transcript JSONL 文件的绝对路径 */
  transcriptPath: string;
  /** 文件是否存在 */
  exists: boolean;
}
```

**Transcript 路径推算逻辑:**

```typescript
// Claude Code 的 transcript 存储规则:
// ~/.claude/projects/<project-hash>/<session-id>.jsonl
// project-hash 由 worktreePath 决定

import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";

function getTranscriptPath(worktreePath: string, sessionId: string): string {
  // Claude Code 使用路径的 base64 编码作为 project 目录名
  // 实际规则：将绝对路径中的 / 替换为 - ，取前 64 字符
  const projectDir = worktreePath.replaceAll("/", "-").slice(1, 65);
  return join(homedir(), ".claude", "projects", projectDir, `${sessionId}.jsonl`);
}
```

> 注意：transcript 路径推算需要实际验证 Claude Code 的命名规则。上述为推导，实现时需启动一个测试 session 确认。如果无法准确推算，可改为在 spawn 时通过 `--output-file` 参数显式指定输出路径。

### 3.3 新建文件：`apps/server/src/worker-routes.ts`

将 Worker API 路由逻辑独立为单独模块，避免 `dashboard.ts` 过度膨胀。

```typescript
// apps/server/src/worker-routes.ts

import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { WorktreeManager } from "@teamsland/git";
import type { ProcessController, SubagentRegistry, SidecarDataPlane } from "@teamsland/sidecar";
import { CapacityError } from "@teamsland/sidecar";

const logger = createLogger("server:worker-routes");

export interface WorkerRouteDeps {
  registry: SubagentRegistry;
  processController: ProcessController;
  worktreeManager: WorktreeManager;
  dataPlane: SidecarDataPlane;
}

/**
 * 处理 /api/workers 路由请求
 *
 * @returns Response 或 null（不匹配时）
 */
export function handleWorkerRoutes(
  req: Request,
  url: URL,
  deps: WorkerRouteDeps,
): Response | Promise<Response> | null {
  // POST /api/workers
  // GET  /api/workers
  // GET  /api/workers/:id
  // POST /api/workers/:id/cancel
  // GET  /api/workers/:id/transcript
  // ... 路由分发逻辑
}
```

### 3.4 `dashboard.ts` 改动

在 `handleApiRoutes()` 函数中新增一行委托到 `handleWorkerRoutes()`：

```typescript
// dashboard.ts — handleApiRoutes 内新增：

function handleApiRoutes(req: Request, url: URL, registry: SubagentRegistry, sessionDb: SessionDB): Response | null {
  // ... 现有路由 ...

  // 新增：Worker API 路由
  const workerResult = handleWorkerRoutes(req, url, workerDeps);
  if (workerResult) return workerResult;

  return null;
}
```

### 3.5 `DashboardDeps` 扩展

```typescript
export interface DashboardDeps {
  registry: SubagentRegistry;
  sessionDb: SessionDB;
  config: DashboardConfig;
  authManager?: LarkAuthManager;
  // 新增
  processController: ProcessController;
  worktreeManager: WorktreeManager;
  dataPlane: SidecarDataPlane;
}
```

### 3.6 `main.ts` 改动

修改 `startDashboard()` 调用，注入新依赖：

```typescript
// main.ts 第 239 行附近
const dashboardServer = startDashboard(
  {
    registry,
    sessionDb,
    config: config.dashboard,
    authManager,
    // 新增
    processController,
    worktreeManager,
    dataPlane,
  },
  controller.signal,
);
```

---

## 4. 1B: `@teamsland/cli` 包

### 4.1 包结构

```
packages/cli/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # 入口：参数解析 + 子命令分发
    ├── http-client.ts        # 封装 HTTP 请求
    ├── output.ts             # 输出格式化（JSON / 人类可读）
    ├── commands/
    │   ├── spawn.ts
    │   ├── list.ts
    │   ├── status.ts
    │   ├── result.ts
    │   ├── cancel.ts
    │   └── transcript.ts
    └── __tests__/
        ├── http-client.test.ts
        └── cli.test.ts
```

### 4.2 `package.json`

```json
{
  "name": "@teamsland/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "teamsland": "./src/index.ts"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

> Bun 原生支持直接执行 `.ts` 文件作为 bin，不需要编译步骤。通过 `bun link` 注册全局命令。

### 4.3 CLI 参数设计

不引入 yargs/commander 等第三方依赖，使用 Bun 的 `process.argv` + 手写轻量解析器。

```
teamsland <command> [options]

Commands:
  spawn       创建并启动 Worker
  list        列出所有 Worker
  status      查询 Worker 状态
  result      获取 Worker 结果
  cancel      取消 Worker
  transcript  获取 transcript 路径

Global Options:
  --server <url>    Server 地址（默认 http://localhost:3000）
  --json            以 JSON 格式输出（默认人类可读格式）
  --help            显示帮助信息
```

#### spawn

```
teamsland spawn [options]

Options:
  --repo <path>         目标仓库路径（新建 worktree）
  --worktree <path>     已有 worktree 路径（恢复场景）
  --task <prompt>       任务提示词（必填）
  --task-brief <text>   任务简述（可选）
  --parent <id>         父 Agent ID（观察者场景）
  --origin-chat <id>    来源群聊 ID
  --origin-sender <id>  来源发送者 ID
```

**使用示例:**

```bash
# 标准 spawn（新建 worktree）
teamsland spawn --repo /path/to/repo --task "$(cat <<'EOF'
实现用户头像上传功能
EOF
)"

# 恢复场景（复用已有 worktree）
teamsland spawn --worktree /path/to/existing-worktree --task "$(cat <<'EOF'
继续前任 worker 的工作...
EOF
)"

# 带来源信息
teamsland spawn --repo /path/to/repo \
  --task "整理 OKR" \
  --task-brief "整理本季度 OKR 进展" \
  --origin-chat "oc_xxx" \
  --origin-sender "ou_xxx"
```

#### list

```
teamsland list [options]

Options:
  --status <status>     按状态过滤（running|completed|failed）
```

**输出示例（人类可读）:**

```
ID              STATUS     PID    TASK                    CREATED
worker-a1b2c3   running   12345  整理本季度 OKR           2m ago
worker-d4e5f6   completed 12346  实现头像上传功能          15m ago
worker-g7h8i9   failed    12347  重构 AuthService          1h ago

Total: 3 workers (1 running, 1 completed, 1 failed)
```

#### status / result

```
teamsland status <worker-id>
teamsland result <worker-id>
```

`status` 输出完整状态信息。`result` 仅输出 result 字段内容（纯文本，方便管道处理）。

#### cancel

```
teamsland cancel <worker-id> [--force]
```

#### transcript

```
teamsland transcript <worker-id>
```

输出 transcript JSONL 文件的绝对路径。

### 4.4 `http-client.ts` 接口

```typescript
/**
 * teamsland Server HTTP 客户端
 *
 * 使用 Bun 原生 fetch，不引入额外依赖。
 *
 * @example
 * ```typescript
 * const client = new TeamslandClient("http://localhost:3000");
 * const worker = await client.spawnWorker({ task: "...", repo: "/path" });
 * ```
 */
export class TeamslandClient {
  constructor(private readonly baseUrl: string) {}

  /** 创建 Worker */
  async spawnWorker(params: CreateWorkerRequest): Promise<CreateWorkerResponse> { ... }

  /** 列出所有 Worker */
  async listWorkers(): Promise<ListWorkersResponse> { ... }

  /** 查询 Worker 状态 */
  async getWorker(workerId: string): Promise<WorkerDetailResponse> { ... }

  /** 取消 Worker */
  async cancelWorker(workerId: string, force?: boolean): Promise<CancelWorkerResponse> { ... }

  /** 获取 transcript 路径 */
  async getTranscript(workerId: string): Promise<TranscriptResponse> { ... }
}
```

HTTP 错误统一封装为 `TeamslandApiError`：

```typescript
export class TeamslandApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "TeamslandApiError";
  }
}
```

### 4.5 Server 地址发现

CLI 按以下优先级确定 Server 地址：

1. `--server` 命令行参数
2. `TEAMSLAND_SERVER` 环境变量
3. `~/.teamsland/config.json` 中的 `serverUrl` 字段
4. 默认值 `http://localhost:3000`

```typescript
function resolveServerUrl(cliArg?: string): string {
  if (cliArg) return cliArg;
  const env = process.env.TEAMSLAND_SERVER;
  if (env) return env;
  // 尝试读取配置文件
  try {
    const configPath = join(homedir(), ".teamsland", "config.json");
    const file = Bun.file(configPath);
    // 同步检查 — CLI 启动时只做一次
    const config = JSON.parse(/* ... */);
    if (typeof config.serverUrl === "string") return config.serverUrl;
  } catch { /* ignore */ }
  return "http://localhost:3000";
}
```

### 4.6 构建和安装方式

**开发环境（monorepo 内）：**

```bash
# 在 monorepo 根目录执行
bun link --cwd packages/cli
```

这会将 `teamsland` 命令注册到 Bun 的全局 bin 目录。

**验证安装：**

```bash
teamsland --help
```

**替代方案（不使用 bun link）：**

在根 `package.json` 的 scripts 中添加：

```json
{
  "scripts": {
    "teamsland": "bun run packages/cli/src/index.ts"
  }
}
```

或者直接用绝对路径调用（Coordinator Skill 中可以这样用）：

```bash
bun run /path/to/teamsland/packages/cli/src/index.ts spawn --repo ...
```

**推荐方案：** 使用 `bun link`，因为 Coordinator 的 Skill 需要在 `~/.teamsland/coordinator/` 目录下通过 Bash 调用 `teamsland` 命令，全局可用最简单。

### 4.7 CLI 入口 `index.ts` 骨架

```typescript
#!/usr/bin/env bun

/**
 * teamsland CLI 入口
 *
 * @example
 * ```bash
 * teamsland spawn --repo /path/to/repo --task "实现功能"
 * teamsland list
 * teamsland status worker-abc
 * ```
 */

import { handleSpawn } from "./commands/spawn.js";
import { handleList } from "./commands/list.js";
import { handleStatus } from "./commands/status.js";
import { handleResult } from "./commands/result.js";
import { handleCancel } from "./commands/cancel.js";
import { handleTranscript } from "./commands/transcript.js";
import { TeamslandClient } from "./http-client.js";

const args = process.argv.slice(2);
const command = args[0];

// 解析全局选项
function parseGlobalOpts(args: string[]): { serverUrl?: string; json: boolean } {
  let serverUrl: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--server" && args[i + 1]) {
      serverUrl = args[i + 1];
    }
    if (args[i] === "--json") {
      json = true;
    }
  }
  return { serverUrl, json };
}

async function main(): Promise<void> {
  const opts = parseGlobalOpts(args);
  const client = new TeamslandClient(resolveServerUrl(opts.serverUrl));
  const subArgs = args.slice(1);

  switch (command) {
    case "spawn":
      await handleSpawn(client, subArgs, opts.json);
      break;
    case "list":
      await handleList(client, subArgs, opts.json);
      break;
    case "status":
      await handleStatus(client, subArgs, opts.json);
      break;
    case "result":
      await handleResult(client, subArgs, opts.json);
      break;
    case "cancel":
      await handleCancel(client, subArgs, opts.json);
      break;
    case "transcript":
      await handleTranscript(client, subArgs, opts.json);
      break;
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

---

## 5. 1C: Coordinator Spawn Skill

### 5.1 Skill 文件完整内容

**路径:** `~/.teamsland/coordinator/.claude/skills/teamsland-spawn/SKILL.md`

```markdown
---
name: teamsland-spawn
description: Spawn and manage teamsland workers. Use when you need to delegate a task to a worker agent, check worker status, get results, or cancel a running worker. Workers run as independent Claude Code sessions in isolated git worktrees.
allowed-tools: Bash(teamsland *)
---

# teamsland Worker Management

You can spawn, monitor, and manage worker agents using the `teamsland` CLI.

## Spawning a Worker

To delegate a task to a worker, use `teamsland spawn`. The task prompt MUST be passed via single-quoted heredoc to prevent shell expansion.

### New task (creates a fresh worktree):

```bash
teamsland spawn --repo <repo-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

### Resume / continue in existing worktree:

```bash
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
<task prompt with context from previous worker>
EOF
)"
```

### With metadata:

```bash
teamsland spawn --repo <repo-path> \
  --task-brief "简短描述" \
  --origin-chat "oc_xxx" \
  --origin-sender "ou_xxx" \
  --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

## CRITICAL: Heredoc quoting

Always use `'EOF'` (single-quoted) — NOT `EOF` (unquoted). Task prompts may contain `$variables`, backticks, and special characters that must NOT be expanded by the shell.

```bash
# CORRECT — single-quoted EOF prevents all expansion
teamsland spawn --repo /path --task "$(cat <<'EOF'
Check $revenue and `conversion_rate`
EOF
)"

# WRONG — unquoted EOF causes $revenue to expand and backticks to execute
teamsland spawn --repo /path --task "$(cat <<EOF
Check $revenue and `conversion_rate`
EOF
)"
```

## Checking Worker Status

```bash
# List all workers
teamsland list

# Get detailed status of a specific worker
teamsland status <worker-id>

# Get only the result (for completed workers)
teamsland result <worker-id>

# Get transcript file path (for observation)
teamsland transcript <worker-id>
```

## Cancelling a Worker

```bash
# Graceful stop (SIGINT)
teamsland cancel <worker-id>

# Force kill (SIGKILL)
teamsland cancel <worker-id> --force
```

## Spawning an Observer Worker

To check on a running worker's progress, spawn an observer:

```bash
TRANSCRIPT=$(teamsland transcript <target-worker-id> | grep transcriptPath | cut -d'"' -f4)

teamsland spawn --repo <same-repo> \
  --parent <target-worker-id> \
  --task "$(cat <<'EOF'
Read the session transcript at: $TRANSCRIPT_PATH
Summarize current progress and report back.
EOF
)"
```

## Workflow: Cancel and Resume

When a worker needs correction:

```bash
# 1. Cancel the running worker
teamsland cancel <worker-id>

# 2. Get the worktree path
WORKTREE=$(teamsland status <worker-id> --json | grep worktreePath)

# 3. Spawn a new worker in the same worktree
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
Continue in this worktree. Previous worker summary:
[summary from observer]

Correction: [what to fix]
EOF
)"
```

## Output Format

By default, output is human-readable. Add `--json` for machine-parseable JSON output:

```bash
teamsland list --json
teamsland status <worker-id> --json
```

## Available Repos

Refer to CLAUDE.md for the list of team repositories and their paths.
```

### 5.2 Skill 设计说明

- **`name: teamsland-spawn`** -- 遵循 Skills 官方规范的命名约定
- **`description`** -- 包含关键动词（spawn, manage, delegate, check, cancel），确保 Claude 能根据意图自动匹配到此 Skill
- **`allowed-tools: Bash(teamsland *)`** -- 预授权所有 `teamsland` 命令，Worker 操作无需逐个确认
- **没有设置 `disable-model-invocation: true`** -- 允许 Coordinator 根据对话上下文自动触发（大脑需要自主决定何时 spawn）
- **没有设置 `context: fork`** -- Coordinator 的 spawn 决策需要当前对话上下文，不应在子 agent 中隔离运行

### 5.3 Coordinator 工作目录初始化

首次部署时需要创建 Coordinator 工作目录结构：

```bash
mkdir -p ~/.teamsland/coordinator/.claude/skills/teamsland-spawn
# 将 SKILL.md 写入上述目录

# 创建 Coordinator 的 CLAUDE.md（团队知识）
cat > ~/.teamsland/coordinator/CLAUDE.md << 'INIT_EOF'
# Coordinator 大脑

你是团队的 AI 大管家。你的职责是：
1. 理解消息意图
2. 决策：回复 / spawn worker / 更新状态 / 忽略
3. 跟踪 worker 状态
4. 转发 worker 结果给用户

## 团队项目

（由运维配置，列出仓库路径和说明）

## 工作规范

- 永远保持轻量、快速响应
- 所有耗时超过几秒的工作都 spawn worker
- spawn worker 时用 teamsland CLI
INIT_EOF
```

---

## 6. 1D: AgentRecord 类型扩展

### 6.1 修改 `packages/types/src/sidecar.ts`

```typescript
/**
 * Agent 事件来源信息
 *
 * 记录触发 Agent 创建的原始事件来源。
 *
 * @example
 * ```typescript
 * import type { AgentOrigin } from "@teamsland/types";
 *
 * const origin: AgentOrigin = {
 *   chatId: "oc_xxx",
 *   senderId: "ou_xxx",
 *   source: "lark_mention",
 * };
 * ```
 */
export interface AgentOrigin {
  /** 来源群聊 ID */
  chatId?: string;
  /** 来源消息 ID */
  messageId?: string;
  /** 发送者 ID */
  senderId?: string;
  /** 被指派者 ID */
  assigneeId?: string;
  /** 事件源类型 */
  source?: "meego" | "lark_mention" | "coordinator";
}

export interface AgentRecord {
  /** Agent 唯一标识 */
  agentId: string;
  /** Claude CLI 进程 PID */
  pid: number;
  /** 关联的 Session ID */
  sessionId: string;
  /** 关联的 Issue ID（CLI spawn 时为自动生成的 ID） */
  issueId: string;
  /** Git worktree 工作目录路径 */
  worktreePath: string;
  /** 当前状态 */
  status: AgentStatus;
  /** 重试次数 */
  retryCount: number;
  /** 创建时间戳（Unix 毫秒） */
  createdAt: number;
  // ── Phase 1 新增字段 ──
  /** 事件来源（可选） */
  origin?: AgentOrigin;
  /** 任务简述，用于 Dashboard 展示和 CLI list 输出（可选） */
  taskBrief?: string;
  /** 父 Agent ID，用于观察者场景的层级关系（可选） */
  parentAgentId?: string;
  /** Worker 执行结果摘要（completed 后由 DataPlane 填充） */
  result?: string;
  /** 完成时间戳（Unix 毫秒） */
  completedAt?: number;
}
```

### 6.2 向后兼容性

所有新字段均为 `optional`（`?` 后缀），不会破坏现有代码：

- 现有的 `event-handlers.ts` 中的 `registerAgent()` 调用不需要修改（新字段不传即 undefined）
- 现有的 `registry.json` 持久化数据在反序列化时自然忽略缺失字段
- Dashboard WebSocket 推送的 `agents_update` 消息结构向后兼容（新字段只是多了几个可选 key）

### 6.3 关联改动

`SpawnParams` 接口（`process-controller.ts`）需要适配新的 CLI spawn 场景。现有 `SpawnParams` 要求 `issueId` 为必填，但 CLI spawn 场景可能没有关联的 Meego Issue。

**修改方案：** 保持 `issueId` 必填，但语义从"Meego Issue ID"扩展为"任务关联 ID"。CLI spawn 时 Server 生成 `cli-{uuid}` 格式的 ID。

---

## 7. 迁移步骤

按依赖顺序，分 5 步实现：

### Step 1: 类型扩展（1D）

**改动文件:** `packages/types/src/sidecar.ts`

1. 新增 `AgentOrigin` 接口
2. 在 `AgentRecord` 中新增 `origin?`、`taskBrief?`、`parentAgentId?`、`result?`、`completedAt?`
3. 运行 `bun run typecheck` 确保全项目编译通过（所有新字段 optional，应零错误）
4. 运行 `bun run test:run` 确保现有测试不被破坏

### Step 2: Server Worker API（1A）

**改动文件:** `apps/server/src/worker-routes.ts`（新建）、`apps/server/src/dashboard.ts`、`apps/server/src/main.ts`

1. 新建 `worker-routes.ts`，实现 5 个路由处理函数
2. 扩展 `DashboardDeps` 接口，新增 `processController`、`worktreeManager`、`dataPlane`
3. 在 `dashboard.ts` 的 `handleApiRoutes()` 中添加 `handleWorkerRoutes()` 委托
4. 在 `main.ts` 的 `startDashboard()` 调用中注入新依赖
5. 编写 `worker-routes.test.ts` 单元测试（mock registry/controller/worktreeManager）
6. 手动测试：`curl -X POST http://localhost:3000/api/workers -H 'Content-Type: application/json' -d '{"task":"echo hello","repo":"/tmp/test-repo"}'`

### Step 3: CLI 包（1B）

**改动文件:** `packages/cli/`（新建整个包）

1. 创建 `packages/cli/` 目录结构和 `package.json`
2. 实现 `http-client.ts`（TeamslandClient 类）
3. 实现 `index.ts`（参数解析 + 分发）
4. 逐个实现 6 个子命令
5. 编写 `http-client.test.ts`（mock fetch 验证请求构造）
6. `bun link --cwd packages/cli` 注册全局命令
7. 手动测试：`teamsland list`、`teamsland spawn --repo /tmp/test --task "hello"`

### Step 4: Coordinator Skill（1C）

**改动文件:** `~/.teamsland/coordinator/.claude/skills/teamsland-spawn/SKILL.md`（新建）

1. 创建目录结构
2. 写入 SKILL.md
3. 创建 `~/.teamsland/coordinator/CLAUDE.md`
4. 验证：在 `~/.teamsland/coordinator/` 目录下启动 Claude Code，确认 skill 被发现

### Step 5: 端到端验证

1. 启动 teamsland server（`bun run dev`）
2. 在终端测试 CLI 全链路
3. 在 `~/.teamsland/coordinator/` 启动 Claude Code session 测试 Coordinator 通过 Skill 调用 CLI

---

## 8. 验证方式

### 8.1 单元测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `packages/cli/src/__tests__/http-client.test.ts` | TeamslandClient 的请求构造、错误处理、URL 拼接 |
| `apps/server/src/__tests__/worker-routes.test.ts` | 各路由的参数校验、成功/错误响应、与 mock 依赖的交互 |

### 8.2 集成测试（手动）

#### 测试 1: Server API 直接调用

```bash
# 启动 server
bun run dev

# 准备测试仓库
mkdir -p /tmp/test-repo && cd /tmp/test-repo && git init && git commit --allow-empty -m "init"

# 创建 worker
curl -s -X POST http://localhost:3000/api/workers \
  -H 'Content-Type: application/json' \
  -d '{"task":"列出当前目录的文件","repo":"/tmp/test-repo"}' | jq .

# 列出 workers
curl -s http://localhost:3000/api/workers | jq .

# 查询状态（替换 worker-id）
curl -s http://localhost:3000/api/workers/worker-xxx | jq .

# 取消
curl -s -X POST http://localhost:3000/api/workers/worker-xxx/cancel \
  -H 'Content-Type: application/json' -d '{}' | jq .

# 获取 transcript
curl -s http://localhost:3000/api/workers/worker-xxx/transcript | jq .
```

#### 测试 2: CLI 全链路

```bash
# 确保 CLI 已安装
teamsland --help

# spawn
teamsland spawn --repo /tmp/test-repo --task "$(cat <<'EOF'
列出当前目录下的所有文件，然后创建一个名为 hello.txt 的文件，写入 "Hello from worker"
EOF
)"

# list
teamsland list

# status（使用上面返回的 worker-id）
teamsland status <worker-id>

# 等待完成后获取结果
teamsland result <worker-id>

# transcript
teamsland transcript <worker-id>
```

#### 测试 3: Coordinator Skill 端到端

```bash
# 在 coordinator 工作目录启动 Claude Code
cd ~/.teamsland/coordinator
claude

# 在 Claude Code session 中输入：
# "帮我在 /tmp/test-repo 仓库里创建一个 README.md 文件，内容是项目介绍"
# 观察 Claude 是否自动使用 teamsland-spawn skill 调用 CLI
```

#### 测试 4: 恢复场景

```bash
# 1. spawn 一个 worker
teamsland spawn --repo /tmp/test-repo --task "创建 hello.txt"

# 2. 取消它
teamsland cancel <worker-id>

# 3. 获取 worktree 路径
teamsland status <worker-id> --json

# 4. 在同一 worktree 中 spawn 新 worker
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
继续工作。上一个 worker 被取消了。
请检查 hello.txt 是否已创建，如果没有，请创建它。
EOF
)"
```

#### 测试 5: 特殊字符传递验证

```bash
# 确保 heredoc 正确传递特殊字符
teamsland spawn --repo /tmp/test-repo --task "$(cat <<'EOF'
创建文件 test.sh，内容包含：
#!/bin/bash
echo "Price: $100"
echo `date`
echo 'single quotes'
echo "double \"quotes\""
EOF
)"

# 验证 worker 的 prompt 是否收到原始内容（无展开）
```

### 8.3 CI 集成

在 `package.json` 中添加 CLI 包的 typecheck：

```json
{
  "scripts": {
    "typecheck": "bun run --filter '*' typecheck"
  }
}
```

这会自动包含新的 `@teamsland/cli` 包。

---

## 9. 风险点

### R1: Transcript 路径推算不准确

**风险:** Claude Code 的 session transcript 存储路径规则可能与我们的推导不一致。

**缓解:** 
- 实现时优先通过实际 spawn 一个测试 session 确认路径规则
- 备选方案：ProcessController spawn 时增加 `--output-file` 参数，显式指定 transcript 输出路径，而非依赖推算
- 最坏情况：transcript 端点返回 `exists: false`，不影响其他功能

### R2: ProcessController.spawn 的 issueId 强耦合

**风险:** 现有 `SpawnParams` 的 `issueId` 语义是 Meego Issue ID，CLI spawn 场景没有真正的 Issue。

**缓解:**
- 语义扩展为"任务关联 ID"，CLI 生成 `cli-{uuid}` 格式
- 调试文件路径从 `/tmp/req-{issueId}.jsonl` 变为 `/tmp/req-cli-xxx.jsonl`，仍可区分
- 长期：将 `issueId` 重命名为 `taskId`，但 Phase 1 保持兼容

### R3: CLI 全局安装的环境差异

**风险:** `bun link` 创建的全局命令依赖 Bun 运行时。如果 Coordinator 的 Claude Code session 使用的 shell 环境中 Bun 不在 PATH 中，命令会失败。

**缓解:**
- 在 SKILL.md 中不写 `teamsland` 而是写完整路径作为 fallback
- Coordinator 的 CLAUDE.md 中记录 Bun 安装路径
- 或者在 CLI 的 shebang 使用绝对路径 `#!/usr/bin/env bun`

### R4: Server 未运行时 CLI 报错不友好

**风险:** Server 没启动时，CLI 的 fetch 会抛 `ConnectionRefused`，错误信息对 Claude 不够友好。

**缓解:** 在 `http-client.ts` 中捕获网络错误，输出明确的提示：

```
Error: Cannot connect to teamsland server at http://localhost:3000
Is the server running? Start it with: bun run dev
```

### R5: 并发 spawn 的容量竞争

**风险:** Coordinator 快速连续 spawn 多个 worker 时可能触发 CapacityError。

**缓解:**
- Server API 返回 `409 Conflict` + 明确的错误消息和当前容量信息
- Skill 中指导 Coordinator 检查 `teamsland list` 的 running 数量后再决定是否 spawn
- 长期：实现排队机制

### R6: worktree 路径存在性验证

**风险:** `--worktree` 参数传入的路径可能不存在或不是有效的 git worktree。

**缓解:** Server 在 spawn 前验证：
1. 路径存在
2. 路径是 git worktree（`git -C <path> rev-parse --is-inside-work-tree`）
3. 验证失败返回 `400 Bad Request`

### R7: Dashboard 认证对 CLI 的影响

**风险:** 如果 Dashboard 启用了 Lark OAuth 认证，`/api/workers` 路由也需要认证。但 CLI 运行在本地，不走 OAuth 流程。

**缓解:**
- Worker API 路由 (`/api/workers`) 跳过认证检查 -- 因为 teamsland 是单机部署，CLI 和 Server 在同一台机器上，不需要额外鉴权
- 在 `checkApiAuth()` 中将 `/api/workers` 加入白名单
- 长期：引入 API key 机制用于 CLI 认证

---

## 附录 A: 目录结构全览

### 新增/修改文件清单

```
teamsland/
├── packages/
│   ├── types/src/sidecar.ts                          # [修改] AgentRecord 扩展
│   └── cli/                                          # [新建] CLI 包
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── http-client.ts
│           ├── output.ts
│           ├── commands/
│           │   ├── spawn.ts
│           │   ├── list.ts
│           │   ├── status.ts
│           │   ├── result.ts
│           │   ├── cancel.ts
│           │   └── transcript.ts
│           └── __tests__/
│               ├── http-client.test.ts
│               └── cli.test.ts
├── apps/server/src/
│   ├── worker-routes.ts                              # [新建] Worker API 路由
│   ├── dashboard.ts                                  # [修改] 集成 worker-routes
│   ├── main.ts                                       # [修改] 注入新依赖
│   └── __tests__/
│       └── worker-routes.test.ts                     # [新建] 路由测试

~/.teamsland/coordinator/
├── CLAUDE.md                                          # [新建] 团队知识
└── .claude/skills/teamsland-spawn/
    └── SKILL.md                                       # [新建] Spawn Skill
```

### 依赖关系图

```
@teamsland/cli
  └── @teamsland/types (仅类型引用)

apps/server
  ├── @teamsland/sidecar (ProcessController, SubagentRegistry, SidecarDataPlane)
  ├── @teamsland/git (WorktreeManager)
  └── @teamsland/types (AgentRecord, AgentOrigin)
```

## 附录 B: 与现有基础设施的集成方式

### ProcessController 集成

Worker API 的 `POST /api/workers` 直接调用 `processController.spawn()`。当前 `SpawnParams` 接口：

```typescript
interface SpawnParams {
  issueId: string;
  worktreePath: string;
  initialPrompt: string;
}
```

CLI spawn 时 Server 负责：
1. 如果传入 `repo`，先调 `worktreeManager.create()` 获得 `worktreePath`
2. 生成 `issueId`（`cli-{uuid}` 格式）
3. 组装 `SpawnParams`，调用 `processController.spawn()`

**不修改 ProcessController 接口。** 所有新逻辑在 `worker-routes.ts` 中完成。

### SubagentRegistry 集成

Worker API 使用 Registry 的以下方法：
- `register(record)` -- spawn 后注册
- `get(agentId)` -- 查询单个 worker
- `allRunning()` -- 列出所有 worker
- `unregister(agentId)` -- cancel 后可选清理

**不修改 Registry 接口。**

### WorktreeManager 集成

Worker API 的 `POST /api/workers`（`repo` 模式）调用 `worktreeManager.create(repoPath, issueId)`。

**不修改 WorktreeManager 接口。**

### SidecarDataPlane 集成

Worker spawn 成功后，调用 `dataPlane.processStream(agentId, stdout)` 消费 Claude CLI 输出流。这与现有 `event-handlers.ts` 中的模式一致。

**不修改 DataPlane 接口。**

---

## 10. 接口扩展预留

后续 Phase 会在 Phase 1 定义的 CLI 和 API 基础上进行扩展。本节列出已知的扩展计划，作为接口演进路线图。

### 10.1 CLI 参数扩展

| 参数 | 扩展 Phase | 说明 |
|------|-----------|------|
| `--task-brief <type>` | Phase 4-5 | 任务类型标识（如 `coding`、`research`、`observer`），用于 SkillInjector 路由选择注入的 Skill 集合 |

### 10.2 API 端点扩展

| 方法 | 路径 | 扩展 Phase | 说明 |
|------|------|-----------|------|
| `POST` | `/api/workers/:id/progress` | Phase 4-5 | Worker 上报阶段进度（由 teamsland-report Skill 调用） |
| `POST` | `/api/workers/:id/result` | Phase 4-5 | Worker 上报最终结果（由 teamsland-report Skill 调用） |
| `POST` | `/api/workers/:id/interrupt` | Phase 5 | 打断正在运行的 Worker（发送 SIGINT/SIGKILL） |
| `POST` | `/api/workers/:id/resume` | Phase 5 | 恢复（接力）被打断的 Worker，在同一 worktree 中启动新 Worker |
| `POST` | `/api/workers/:id/observe` | Phase 5 | Spawn 观察者 Worker，读取目标 Worker 的 transcript 进行诊断 |
| `GET` | `/api/hooks/status` | Phase 6 | 查询 Hook Engine 状态（已加载的 hooks 列表、加载时间等） |

### 10.3 AgentStatus 扩展值

Phase 1 定义的 `AgentStatus` 为 `"running" | "completed" | "failed"`。后续 Phase 将扩展：

| 状态值 | 扩展 Phase | 说明 |
|--------|-----------|------|
| `"interrupted"` | Phase 4-5 | Worker 被打断（SIGINT/SIGKILL 终止），worktree 保留等待恢复 |
| `"observing"` | Phase 4-5 | 观察者 Worker 专用状态，表示该 Worker 正在观测另一个 Worker |

> **实现建议**: `AgentStatus` 类型应设计为可扩展的联合类型，避免在 `packages/types/src/sidecar.ts` 中硬编码字面量。后续 Phase 扩展时通过 union 追加即可，无需修改已有代码。

---

*本方案设计为最小改动原则：不修改现有基础设施的接口，所有新逻辑通过新文件（worker-routes.ts、packages/cli/）和类型扩展（AgentRecord 新增可选字段）实现，确保对现有事件驱动流水线零影响。*
