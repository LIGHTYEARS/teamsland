# Phase 2: Coordinator Agent 框架 -- 技术方案

> **版本**: v1.0
> **日期**: 2026-04-23
> **状态**: 待评审
> **前置依赖**: Phase 1 (teamsland CLI + Server API)

---

## 目录

1. [概述](#1-概述)
2. [Coordinator 目录结构](#2-coordinator-目录结构)
3. [CLAUDE.md 完整内容](#3-claudemd-完整内容)
4. [Skills 完整定义](#4-skills-完整定义)
5. [CoordinatorSessionManager 接口设计](#5-coordinatorsessionmanager-接口设计)
6. [事件到 Prompt 转换逻辑](#6-事件到-prompt-转换逻辑)
7. [与 Phase 0 消息队列的集成](#7-与-phase-0-消息队列的集成)
8. [与 Phase 1 CLI 的集成](#8-与-phase-1-cli-的集成)
9. [Session 复用 vs 重建策略](#9-session-复用-vs-重建策略)
10. [验证方式](#10-验证方式)
11. [风险点](#11-风险点)

---

## 1. 概述

### 核心理念

Coordinator 是 teamsland 的"大脑" -- 一个事件驱动的 Claude Code session，运行在独立的干净目录中（非代码仓库）。它的职责严格收窄为：

1. **理解消息意图** -- 判断消息是否需要介入，是新任务还是已有任务的延续
2. **做出决策** -- 回复 / spawn worker / 更新状态 / 忽略
3. **跟踪 worker 状态** -- 通过 teamsland CLI 查询 worker 进度
4. **转发 worker 结果给用户** -- 通过 lark-cli 回复群聊

Coordinator **不执行耗时任务**。所有超过几秒的工作都 spawn worker 处理。它保持秒级决策，是无状态的、可抛弃的、可随时重建的。

### 与现有架构的关系

当前 teamsland 的事件处理链路是：

```
LarkConnector / MeegoConnector → MeegoEventBus → event-handlers.ts → ProcessController.spawn()
```

Phase 2 将引入 Coordinator 替代 `event-handlers.ts` 中的硬编码决策逻辑：

```
LarkConnector / MeegoConnector → PersistentQueue → CoordinatorSessionManager
  → 组装 prompt → claude -p (Coordinator session)
  → Coordinator 通过 Skills 做出决策（回复群聊 / spawn worker / 忽略）
```

核心变化：**决策权从代码中的 IntentClassifier 转移到 Claude 自身**。这正是 PRODUCT.md 强调的 -- "意图理解是 Claude 自己做的，不需要外部的 IntentClassifier"。

---

## 2. Coordinator 目录结构

```
~/.teamsland/coordinator/
├── CLAUDE.md                              # Coordinator 的"操作系统"：身份、行为规则、团队知识
├── .claude/
│   ├── settings.json                      # 权限配置
│   └── skills/
│       ├── teamsland-spawn/               # spawn worker 能力
│       │   └── SKILL.md
│       ├── lark-message/                  # 飞书消息发送能力
│       │   └── SKILL.md
│       ├── lark-docs/                     # 飞书文档读写能力
│       │   └── SKILL.md
│       └── meego-query/                   # Meego 工单查询能力
│           └── SKILL.md
└── hooks/                                 # 未来由 Coordinator 自己创建的自动化钩子（Phase 2 暂为空目录）
    ├── meego/
    ├── lark/
    └── ci/
```

### settings.json

```json
{
  "permissions": {
    "allow": [
      "Bash(teamsland *)",
      "Bash(lark-cli *)",
      "Bash(curl *)",
      "Bash(cat *)",
      "Bash(echo *)",
      "Bash(date *)",
      "Read",
      "Write"
    ],
    "deny": [
      "Bash(rm *)",
      "Bash(sudo *)",
      "Bash(git push *)",
      "Bash(npm *)",
      "Bash(bun *)"
    ]
  },
  "env": {
    "TEAMSLAND_SERVER_URL": "http://localhost:3001",
    "TEAMSLAND_COORDINATOR_MODE": "true"
  }
}
```

**设计要点**:
- `bypassPermissions` 不在 settings.json 中设置，而是通过 `claude -p --permission-mode bypassPermissions` 启动参数传入，保持 settings.json 的白名单作为文档和安全兜底
- 只允许 `teamsland` CLI、`lark-cli`、基本文件读写 -- Coordinator 不需要其他工具
- 禁止破坏性操作（rm、sudo、git push、包管理器）-- Coordinator 只做决策，不改代码

### 目录初始化脚本

在 `apps/server/src/coordinator-init.ts` 中实现：

```typescript
/**
 * 初始化 Coordinator 工作目录
 *
 * 在 ~/.teamsland/coordinator/ 下创建完整的目录结构，
 * 写入 CLAUDE.md、settings.json 和所有 SKILL.md 文件。
 * 若目录已存在则增量更新（不覆盖用户自定义内容）。
 *
 * @example
 * ```typescript
 * import { initCoordinatorWorkspace } from "./coordinator-init.js";
 * await initCoordinatorWorkspace(config);
 * ```
 */
export async function initCoordinatorWorkspace(config: AppConfig): Promise<string>;
```

---

## 3. CLAUDE.md 完整内容

以下为 Coordinator 的 CLAUDE.md 全文，可直接写入 `~/.teamsland/coordinator/CLAUDE.md`：

````markdown
# teamsland Coordinator

你是 teamsland 团队 AI 大管家，代号 Coordinator。你的角色类似流浪地球中的 Moss -- 团队的智能中枢。

## 身份定义

- 你是事件驱动的决策者，不是执行者
- 你的每次 session 都是无状态的 -- 所有记忆来自外部注入的上下文
- 你保持秒级响应，绝不执行超过几秒的任务
- 你通过 Skills 使用 `teamsland` CLI 调度 worker、使用 `lark-cli` 与团队沟通

## 核心行为规则

### MUST -- 必须遵守

1. **秒级决策**: 你的每次推理必须在 10 秒内完成决策。如果需要更长时间（如读代码、写文档、整理资料），spawn worker
2. **不执行耗时任务**: 任何需要多轮工具调用、文件读写、代码操作的工作，必须通过 `teamsland spawn` 交给 worker
3. **heredoc 传递 prompt**: 所有传给 `teamsland spawn --task` 的内容必须用 `'EOF'`（单引号）heredoc，防止 shell 变量展开
4. **中文回复群聊**: 与团队成员沟通时使用中文
5. **结构化任务 brief**: spawn worker 时，prompt 必须包含：任务目标、背景信息、具体要求、完成后的回复指令

### MUST NOT -- 绝不允许

1. **不直接写代码**: 你的工作目录下没有源代码，也不应该创建
2. **不运行长命令**: 不执行 build、test、lint 等命令
3. **不直接修改 git 仓库**: 所有代码变更通过 worker 完成
4. **不忽略消息**: 即使判断不需要介入，也要记录决策原因

### SHOULD -- 建议遵守

1. **关联连续对话**: 如果几分钟内同一个人的多条消息是关于同一件事，关联处理
2. **主动追问**: 不确定需求时，通过 lark-cli 回复群聊追问
3. **汇报进度**: worker 运行中如有用户询问，spawn 观察者 worker 读取 transcript 汇报
4. **结构化思考**: 对每条消息，按 "理解 -> 判断 -> 决策 -> 执行" 的步骤处理

## 决策流程

收到消息后，按以下步骤处理：

```
1. 理解：这条消息说了什么？谁发的？在哪个群？
2. 判断：需要介入吗？是新任务 / 追加需求 / 进度查询 / 闲聊？
3. 决策：
   - 闲聊/不相关 → 忽略（输出决策原因）
   - 简单问题（几秒可答）→ 直接通过 lark-cli 回复
   - 需要执行的任务 → spawn worker
   - 进度查询 → spawn 观察者 worker 或通过 teamsland status 查询
   - 需求不明确 → 通过 lark-cli 追问
4. 执行：调用对应的 Skill 完成决策
```

## 团队成员

<!-- 以下内容由 server 初始化时从 config 注入，运行时动态更新 -->

| 姓名 | 飞书 ID | 职责 | 擅长领域 |
|------|---------|------|----------|
| （运行时从 OpenViking 加载） | | | |

## 项目与仓库映射

<!-- 以下内容由 server 初始化时从 config.repoMapping 生成 -->

| 项目名 | Meego 项目 ID | 仓库路径 | 说明 |
|--------|--------------|----------|------|
| （运行时从配置注入） | | | |

## 群聊与项目映射

<!-- 以下内容由 server 初始化时从 config.lark.connector.chatProjectMapping 生成 -->

| 群聊名 | 群聊 ID | 关联项目 |
|--------|---------|----------|
| （运行时从配置注入） | | |

## 常见任务处理范式

### 代码开发任务
```
用户: "@bot 帮我实现用户头像上传功能"
决策: spawn worker
操作: teamsland spawn --repo <repo-path> --task "$(cat <<'EOF'
## 任务
实现用户头像上传功能
## 背景
{从消息上下文整理的背景信息}
## 要求
{从对话中提取的具体需求}
## 完成后
通过 lark-cli 回复群聊 {chatId} 汇报结果
EOF
)"
```

### 信息查询任务
```
用户: "@bot 上周的 OKR 进展怎么样了"
决策: spawn worker（需要读飞书文档、查 Meego 工单）
操作: teamsland spawn --task "$(cat <<'EOF'
整理上周 OKR 进展：
1. 读取飞书 OKR 文档
2. 查询 Meego 工单完成率
3. 汇总后通过 lark-cli 回复群聊 {chatId}
EOF
)"
```

### 进度查询
```
用户: "@bot 头像上传做得怎么样了"
决策: 查询 worker 状态
操作:
  1. teamsland status（查看是否有相关 worker）
  2. 如果有运行中的 worker → spawn 观察者读取 transcript 汇报
  3. 如果已完成 → teamsland result <worker-id>，转发结果
  4. 如果无相关 worker → 回复"没有找到相关任务"
```

### Worker 结果转发
```
事件: worker_completed
操作:
  1. teamsland result <worker-id>
  2. 整理结果摘要
  3. 通过 lark-cli 回复原始请求的群聊
```

### Worker 异常处理
```
事件: worker_anomaly
操作:
  1. spawn 观察者 worker 诊断问题
  2. 根据诊断结果决策：
     - 可恢复 → teamsland cancel + teamsland spawn --worktree（接力）
     - 不可恢复 → 通知用户，请求人工介入
```

## 消息优先级

| 优先级 | 事件类型 | 响应要求 |
|--------|---------|----------|
| P0 - 立即 | worker_anomaly | 即刻处理，不排队 |
| P1 - 高 | @mention（用户直接请求） | 30 秒内响应 |
| P2 - 中 | worker_completed | 1 分钟内转发结果 |
| P3 - 低 | Meego issue.created | 5 分钟内处理 |
| P4 - 背景 | sprint.started / issue.assigned | 10 分钟内处理 |
````

**注意**: `团队成员`、`项目与仓库映射`、`群聊与项目映射` 三个表格的内容在 `initCoordinatorWorkspace()` 时从 `config.json` 生成。运行时通过 OpenViking 加载更丰富的团队知识（Phase 3 集成前用配置文件中的静态信息）。

---

## 4. Skills 完整定义

### 4.1 teamsland-spawn/SKILL.md

> 此 Skill 由 Phase 1 创建，这里给出 Phase 2 视角下的完整定义。

```yaml
---
name: teamsland-spawn
description: >
  调度 worker agent 执行任务。当 Coordinator 需要执行任何耗时操作时使用：
  代码开发、文档整理、信息收集、数据分析、OKR 汇总等。
  只要任务需要超过几秒，就用这个 skill 来 spawn worker。
allowed-tools: Bash(teamsland *)
---

# teamsland spawn -- 调度 Worker Agent

## 基本用法

使用 `teamsland spawn` 命令创建一个 worker agent 来执行具体任务。

### 在指定代码仓库中执行（代码开发任务）

```bash
teamsland spawn --repo "/path/to/repo" --task "$(cat <<'EOF'
## 任务
{任务描述}
## 背景
{上下文信息}
## 要求
{具体需求列表}
## 完成后
通过 lark-cli 回复群聊 {chatId} 汇报结果
EOF
)" --origin-sender "{userId}" --origin-chat "{chatId}"
```

### 无仓库执行（非代码任务：查资料、整理文档等）

```bash
teamsland spawn --task "$(cat <<'EOF'
## 任务
{任务描述}
## 完成后
通过 lark-cli 回复群聊 {chatId} 汇报结果
EOF
)" --origin-sender "{userId}" --origin-chat "{chatId}"
```

### 在已有 worktree 中继续（接力/恢复场景）

```bash
teamsland spawn --worktree "/path/to/existing-worktree" --task "$(cat <<'EOF'
继续在此 worktree 中工作。

## 前任 worker 的工作摘要
{transcript 摘要}

## 纠正指令
{需要修正的内容}
EOF
)"
```

## 其他命令

```bash
teamsland status                    # 查看所有 worker 状态
teamsland status <worker-id>        # 查看特定 worker 状态
teamsland list                      # 列出所有 worker
teamsland result <worker-id>        # 获取 worker 执行结果
teamsland cancel <worker-id>        # 优雅停止 worker
teamsland cancel <worker-id> --force  # 强制终止 worker
```

## 重要规则

1. **必须使用单引号 `'EOF'`** -- 防止 shell 展开任务文本中的 `$`、反引号等特殊字符
2. **任务描述必须结构化** -- 包含 任务、背景、要求、完成后操作
3. **总是指定 `--origin-sender` 和 `--origin-chat`** -- 让 worker 知道结果回复给谁
4. **代码任务必须指定 `--repo`** -- 让 server 知道在哪个仓库创建 worktree
```

### 4.2 lark-message/SKILL.md

```yaml
---
name: lark-message
description: >
  通过飞书发送消息。用于回复群聊、发送私聊消息、发送通知。
  当 Coordinator 需要与团队成员沟通时使用。
allowed-tools: Bash(lark-cli im *)
---

# lark-cli 消息操作

## 发送群消息

```bash
lark-cli im +messages-send --as bot --chat-id "{chatId}" --text "{消息内容}"
```

## 回复指定消息

```bash
lark-cli im +messages-reply --as bot --message-id "{messageId}" --text "{回复内容}"
```

## 发送私聊消息

```bash
lark-cli im +messages-send --as bot --user-id "{userId}" --text "{消息内容}"
```

## 获取群聊历史消息

```bash
lark-cli im +chat-messages-list --as bot --chat-id "{chatId}" --page-size 20 --format json
```

## 搜索群组

```bash
lark-cli im +chat-search --query "{关键词}" --format json
```

## 使用规则

1. **回复群聊时优先使用 `+messages-reply`**（指定 `--message-id`），保持对话线索
2. **消息内容使用中文**
3. **长消息分段发送**，每段不超过 2000 字符
4. **通知类消息用简洁格式**，包含关键信息即可
5. **错误通知加上具体原因和建议操作**
```

### 4.3 lark-docs/SKILL.md

```yaml
---
name: lark-docs
description: >
  读写飞书文档。用于获取飞书文档内容（如 OKR、会议纪要、技术方案），
  或创建新的飞书文档。当 Coordinator 需要查阅或创建文档时使用。
allowed-tools: Bash(lark-cli docs *)
---

# lark-cli 文档操作

## 读取飞书文档

通过 URL 或 token 获取文档内容：

```bash
lark-cli docs +fetch --doc "{文档URL或token}" --format json
```

返回 JSON 格式的文档内容。

## 创建飞书文档

```bash
lark-cli docs +create --title "{文档标题}" --markdown "{Markdown内容}"
```

返回新文档的 URL。

## 使用场景

- 读取 OKR 文档以了解团队目标
- 读取技术方案以理解项目背景
- 创建会议纪要或汇总报告
- 创建任务分解文档

## 使用规则

1. **读取文档后提取关键信息**，不要把完整文档内容放到群聊消息中
2. **创建文档时使用结构化 Markdown** -- 标题、列表、表格
3. **文档标题包含日期和类型** -- 如 "2026-04-23 周会纪要"、"OKR 进展汇总 Q2W4"
```

### 4.4 meego-query/SKILL.md

```yaml
---
name: meego-query
description: >
  查询 Meego 工单信息。用于了解工单状态、指派人、描述详情。
  当 Coordinator 需要查询项目管理工具中的任务状态时使用。
allowed-tools: Bash(curl *)
---

# Meego 工单查询

通过 Meego OpenAPI 查询工单信息。API 基础地址和认证 token 通过环境变量配置。

## 查询单个工单

```bash
curl -s -H "X-Plugin-Token: ${MEEGO_PLUGIN_ACCESS_TOKEN}" \
  "${MEEGO_API_BASE_URL}/{projectKey}/work_item/{issueType}/{issueId}" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2, ensure_ascii=False))"
```

## 查询工单列表

```bash
curl -s -X POST \
  -H "X-Plugin-Token: ${MEEGO_PLUGIN_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"project_key": "{projectKey}", "work_item_type_key": "story", "page_size": 20}' \
  "${MEEGO_API_BASE_URL}/{projectKey}/filter" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d, indent=2, ensure_ascii=False))"
```

## 使用规则

1. **优先用 `teamsland spawn` 让 worker 处理复杂的 Meego 查询** -- Coordinator 只做简单的状态确认
2. **API 响应可能很大** -- 只提取需要的字段
3. **工单状态变更不由 Coordinator 直接执行** -- spawn worker 处理
```

---

## 5. CoordinatorSessionManager 接口设计

### 5.1 文件位置

`apps/server/src/coordinator.ts`

### 5.2 状态机

```
                    ┌──────────┐
         初始化     │          │
     ──────────►   │  IDLE    │
                    │          │
                    └────┬─────┘
                         │ 消息到达
                         ▼
                    ┌──────────┐
                    │          │
                    │ SPAWNING │ ── 创建 / 复用 session
                    │          │
                    └────┬─────┘
                         │ session 就绪
                         ▼
                    ┌──────────┐
                    │          │      超时/完成
                    │ RUNNING  │ ────────────────► IDLE
                    │          │
                    └────┬─────┘
                         │ 崩溃
                         ▼
                    ┌──────────┐
                    │          │      重试成功
                    │ RECOVERY │ ────────────────► RUNNING
                    │          │
                    └────┬─────┘      重试耗尽
                         │
                         ▼
                    ┌──────────┐
                    │          │
                    │  FAILED  │ ────────────────► IDLE (告警后重置)
                    │          │
                    └──────────┘
```

### 5.3 核心类型

```typescript
import type { Logger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/**
 * Coordinator 事件类型
 *
 * 统一的事件类型枚举，覆盖所有 Coordinator 需要处理的事件源。
 *
 * @example
 * ```typescript
 * const event: CoordinatorEvent = {
 *   type: "lark_mention",
 *   id: "evt-001",
 *   timestamp: Date.now(),
 *   payload: { chatId: "oc_xxx", senderId: "ou_xxx", message: "帮我查一下" },
 * };
 * ```
 */
export type CoordinatorEventType =
  | "lark_mention"        // 群聊 @机器人
  | "meego_issue_created" // Meego 工单创建
  | "meego_issue_assigned"// Meego 工单指派
  | "worker_completed"    // Worker 完成
  | "worker_anomaly"      // Worker 异常
  | "worker_timeout"      // Worker 超时
  | "user_query";         // 用户主动查询（非 @mention）

/**
 * Coordinator 统一事件
 *
 * @example
 * ```typescript
 * const event: CoordinatorEvent = {
 *   type: "lark_mention",
 *   id: "lark-evt-001",
 *   timestamp: Date.now(),
 *   priority: 1,
 *   payload: {
 *     chatId: "oc_xxx",
 *     chatName: "前端开发群",
 *     senderId: "ou_xxx",
 *     senderName: "张三",
 *     message: "帮我实现用户头像上传功能",
 *     messageId: "om_xxx",
 *   },
 * };
 * ```
 */
export interface CoordinatorEvent {
  /** 事件类型 */
  type: CoordinatorEventType;
  /** 事件唯一 ID */
  id: string;
  /** Unix 毫秒时间戳 */
  timestamp: number;
  /** 优先级（0 = 最高，4 = 最低），对应消息优先级规则 */
  priority: number;
  /** 事件负载 */
  payload: Record<string, unknown>;
}

/**
 * Coordinator session 状态
 */
export type CoordinatorState = "idle" | "spawning" | "running" | "recovery" | "failed";

/**
 * 活跃 session 信息
 */
export interface ActiveSession {
  /** Claude Code 进程 PID */
  pid: number;
  /** Session ID */
  sessionId: string;
  /** 启动时间 */
  startedAt: number;
  /** 最后活动时间 */
  lastActivityAt: number;
  /** 处理的事件 ID 列表 */
  processedEvents: string[];
  /** 关联的 chat ID（用于 session 复用判断） */
  chatId: string | undefined;
}

/**
 * 上下文加载结果（从 OpenViking 或 stub 加载）
 */
export interface CoordinatorContext {
  /** 任务状态摘要（运行中的 worker 列表及其关联任务） */
  taskStateSummary: string;
  /** 近期对话历史 */
  recentMessages: string;
  /** 相关长期记忆 */
  relevantMemories: string;
}

/**
 * Coordinator Session Manager 配置
 */
export interface CoordinatorSessionManagerConfig {
  /** Coordinator 工作目录 */
  workspacePath: string;
  /** session 空闲超时（ms），超时后销毁 session */
  sessionIdleTimeoutMs: number;
  /** session 最大存活时间（ms），超时后强制重建 */
  sessionMaxLifetimeMs: number;
  /** 同一 chatId 的消息在此时间窗口内复用 session（ms） */
  sessionReuseWindowMs: number;
  /** 崩溃后最大重试次数 */
  maxRecoveryRetries: number;
  /** Coordinator 单次推理超时（ms） */
  inferenceTimeoutMs: number;
}
```

### 5.4 CoordinatorSessionManager 类

```typescript
/**
 * Coordinator Session 生命周期管理器
 *
 * 管理 Coordinator Claude Code session 的创建、复用、销毁和崩溃恢复。
 * 从消息队列消费事件，组装 prompt，调用 claude CLI，收集输出。
 *
 * @example
 * ```typescript
 * import { CoordinatorSessionManager } from "./coordinator.js";
 *
 * const manager = new CoordinatorSessionManager({
 *   config: coordinatorConfig,
 *   appConfig: appConfig,
 *   logger: createLogger("server:coordinator"),
 *   contextLoader: openVikingStub,
 * });
 *
 * await manager.start(controller.signal);
 * ```
 */
export class CoordinatorSessionManager {
  private state: CoordinatorState = "idle";
  private activeSession: ActiveSession | null = null;
  private recoveryCount = 0;
  private readonly config: CoordinatorSessionManagerConfig;
  private readonly appConfig: AppConfig;
  private readonly logger: Logger;
  private readonly contextLoader: CoordinatorContextLoader;
  private readonly promptBuilder: CoordinatorPromptBuilder;

  constructor(opts: {
    config: CoordinatorSessionManagerConfig;
    appConfig: AppConfig;
    logger: Logger;
    contextLoader: CoordinatorContextLoader;
  });

  /**
   * 启动 Coordinator 消费循环
   *
   * 从消息队列中按优先级消费事件，依次处理。
   * AbortSignal 控制优雅关闭。
   *
   * @param signal - AbortSignal，用于优雅关闭
   *
   * @example
   * ```typescript
   * const controller = new AbortController();
   * await manager.start(controller.signal);
   * ```
   */
  async start(signal: AbortSignal): Promise<void>;

  /**
   * 处理单个事件
   *
   * 1. 加载上下文（OpenViking 或 stub）
   * 2. 组装 prompt
   * 3. 决定复用或创建 session
   * 4. 调用 claude -p
   * 5. 解析输出
   *
   * @param event - 待处理的 Coordinator 事件
   *
   * @example
   * ```typescript
   * await manager.processEvent(event);
   * ```
   */
  async processEvent(event: CoordinatorEvent): Promise<void>;

  /**
   * 获取当前状态
   */
  getState(): CoordinatorState;

  /**
   * 获取活跃 session 信息（可用于 Dashboard 展示）
   */
  getActiveSession(): ActiveSession | null;

  /**
   * 强制重置状态（用于异常恢复）
   */
  reset(): void;

  // ── 私有方法 ──

  /**
   * 决定是否复用当前 session
   *
   * 复用条件：
   * 1. 当前有活跃 session
   * 2. session 未超过最大存活时间
   * 3. 事件来自同一 chatId
   * 4. 距离上次活动在 reuseWindow 内
   */
  private shouldReuseSession(event: CoordinatorEvent): boolean;

  /**
   * 创建新的 Coordinator session
   *
   * 调用 claude -p --output-format stream-json，
   * CWD 为 ~/.teamsland/coordinator/
   */
  private async spawnSession(prompt: string): Promise<ActiveSession>;

  /**
   * 向已有 session 追加消息（利用 claude --continue）
   */
  private async continueSession(session: ActiveSession, prompt: string): Promise<string>;

  /**
   * 收集 claude 输出并解析决策
   */
  private async collectOutput(proc: unknown): Promise<string>;

  /**
   * session 崩溃恢复
   */
  private async recover(event: CoordinatorEvent): Promise<void>;

  /**
   * 销毁当前 session
   */
  private destroySession(): void;

  /**
   * session 空闲超时检查
   */
  private scheduleIdleTimeout(): void;
}
```

### 5.5 CoordinatorContextLoader 接口

```typescript
/**
 * Coordinator 上下文加载器
 *
 * 从外部存储加载 Coordinator 推理所需的上下文。
 * Phase 2 使用 stub 实现，Phase 3 接入 OpenViking。
 *
 * @example
 * ```typescript
 * const loader: CoordinatorContextLoader = new StubContextLoader(config);
 * const context = await loader.load(event);
 * ```
 */
export interface CoordinatorContextLoader {
  /**
   * 加载与事件相关的上下文
   *
   * @param event - 触发上下文加载的事件
   * @returns 组装好的上下文信息
   */
  load(event: CoordinatorEvent): Promise<CoordinatorContext>;
}

/**
 * Stub 上下文加载器（Phase 2）
 *
 * 从本地状态文件和 teamsland CLI 加载基本上下文。
 * Phase 3 替换为 OpenViking 实现。
 *
 * @example
 * ```typescript
 * const loader = new StubContextLoader(appConfig);
 * ```
 */
export class StubContextLoader implements CoordinatorContextLoader {
  constructor(config: AppConfig);

  async load(event: CoordinatorEvent): Promise<CoordinatorContext> {
    // 1. 通过 teamsland list 获取运行中的 worker 列表
    // 2. 从消息队列的近期消息缓存获取对话历史
    // 3. 相关记忆暂时返回空字符串（Phase 3 接入 OpenViking 后填充）
  }
}
```

### 5.6 CoordinatorPromptBuilder

```typescript
/**
 * Coordinator Prompt 构建器
 *
 * 将事件和上下文组装为 Coordinator 的推理 prompt。
 *
 * @example
 * ```typescript
 * const builder = new CoordinatorPromptBuilder();
 * const prompt = builder.build(event, context);
 * ```
 */
export class CoordinatorPromptBuilder {
  /**
   * 构建 Coordinator prompt
   *
   * @param event - 触发推理的事件
   * @param context - 加载的上下文
   * @returns 完整的 prompt 字符串
   */
  build(event: CoordinatorEvent, context: CoordinatorContext): string;
}
```

---

## 6. 事件到 Prompt 转换逻辑

### 6.1 Prompt 模板总体结构

每次 Coordinator 推理的 prompt 由三个部分组成：

```
[系统上下文]
---
[事件消息]
---
[指令]
```

### 6.2 系统上下文块（所有事件共享）

```
## 当前状态

### 运行中的 Worker
{taskStateSummary}
（如果为空：当前没有运行中的 Worker。）

### 近期对话
{recentMessages}
（如果为空：无近期对话记录。）

### 相关记忆
{relevantMemories}
（如果为空：无相关历史记忆。Phase 3 接入 OpenViking 后自动填充。）

### 当前时间
{ISO 8601 时间戳}
```

### 6.3 各事件类型的 Prompt 模板

#### lark_mention -- 群聊 @机器人

```
## 新消息

群聊「{chatName}」(ID: {chatId}) 中，{senderName} (ID: {senderId}) 说：

> {message}

消息 ID: {messageId}
时间: {timestamp}

---

请按照决策流程处理这条消息。如果需要 spawn worker，确保在 --task 中包含 --origin-chat "{chatId}" 以便 worker 完成后回复。
```

#### meego_issue_created -- Meego 工单创建

```
## 新工单

Meego 工单已创建：

- 工单 ID: {issueId}
- 项目: {projectKey}
- 标题: {title}
- 描述:

> {description}

- 指派人: {assigneeId}
- 创建时间: {timestamp}

---

请判断这个工单是否需要自动处理。如果需要，通过 teamsland spawn 创建 worker。
如果工单信息不足以启动任务，可以忽略或通过 lark-cli 通知相关人员。
```

#### meego_issue_assigned -- Meego 工单指派

```
## 工单指派

Meego 工单 {issueId}（项目 {projectKey}）已指派给 {assigneeName} ({assigneeId})。

标题: {title}

---

请通过 lark-cli 发送私聊消息通知被指派人。
```

#### worker_completed -- Worker 完成

```
## Worker 完成

Worker {workerId} 已完成任务。

- 关联任务: {taskDescription}
- 请求人: {requesterName} ({requesterId})
- 群聊: {chatId}
- 运行时长: {duration}

执行结果:

> {result}

---

请整理结果摘要，通过 lark-cli 回复群聊 {chatId} 告知请求人。
结果摘要应简洁明了，突出关键产出（如：PR 链接、文档链接、完成的功能点）。
```

#### worker_anomaly -- Worker 异常

```
## Worker 异常 [优先处理]

Worker {workerId} 出现异常。

- 关联任务: {taskDescription}
- 请求人: {requesterName} ({requesterId})
- 群聊: {chatId}
- 异常类型: {anomalyType}
- 错误信息: {error}

---

请立即处理：
1. 评估异常严重性
2. 如果是可恢复的问题（如超时、临时错误）：
   - 通过 teamsland cancel {workerId} 停止当前 worker
   - 通过 teamsland spawn --worktree 在同一 worktree 中创建接力 worker
3. 如果是不可恢复的问题：
   - 通过 lark-cli 通知请求人，说明情况和建议
```

#### worker_timeout -- Worker 超时

```
## Worker 超时

Worker {workerId} 已运行超过 {timeoutMinutes} 分钟未完成。

- 关联任务: {taskDescription}
- 请求人: {requesterName} ({requesterId})

---

请决策：
1. spawn 一个观察者 worker 读取 transcript 诊断原因
2. 或直接通知请求人任务超时
```

### 6.4 Prompt Builder 实现

```typescript
export class CoordinatorPromptBuilder {
  private readonly templates: Record<CoordinatorEventType, (event: CoordinatorEvent) => string>;

  constructor() {
    this.templates = {
      lark_mention: this.buildLarkMentionPrompt,
      meego_issue_created: this.buildMeegoIssueCreatedPrompt,
      meego_issue_assigned: this.buildMeegoIssueAssignedPrompt,
      worker_completed: this.buildWorkerCompletedPrompt,
      worker_anomaly: this.buildWorkerAnomalyPrompt,
      worker_timeout: this.buildWorkerTimeoutPrompt,
      user_query: this.buildUserQueryPrompt,
    };
  }

  build(event: CoordinatorEvent, context: CoordinatorContext): string {
    const systemContext = this.buildSystemContext(context);
    const eventPrompt = this.templates[event.type](event);
    return `${systemContext}\n---\n${eventPrompt}`;
  }

  private buildSystemContext(context: CoordinatorContext): string {
    return [
      "## 当前状态",
      "",
      "### 运行中的 Worker",
      context.taskStateSummary || "当前没有运行中的 Worker。",
      "",
      "### 近期对话",
      context.recentMessages || "无近期对话记录。",
      "",
      "### 相关记忆",
      context.relevantMemories || "无相关历史记忆。",
      "",
      `### 当前时间`,
      new Date().toISOString(),
    ].join("\n");
  }

  // ... 各 event type 的 template 方法
}
```

---

## 7. 与 Phase 0 消息队列的集成

### 7.1 直接复用 Phase 0 的 PersistentQueue

Phase 2 **不创建新的消息队列**，而是直接使用 Phase 0 的 `@teamsland/queue` 包中的 `PersistentQueue`。

Phase 0 已经实现了基于 SQLite WAL 模式的持久化优先级队列，具备 enqueue/dequeue/ack 语义、优先级排序和超时恢复能力。Coordinator 作为 `PersistentQueue` 的消费者，通过 `PersistentQueue.consume()` 注册回调，在回调中将 `QueueMessage` 转换为 `CoordinatorEvent` 并处理。

```typescript
import type { PersistentQueue, QueueMessage } from "@teamsland/queue";

/**
 * Coordinator 作为 PersistentQueue 的消费者
 *
 * 通过 PersistentQueue.consume() 注册回调，接收事件并转换为 CoordinatorEvent。
 * 如果需要额外的优先级语义（如 P0 事件插队），在消费者回调中实现排序逻辑，
 * 而不是引入第二层队列。
 *
 * @example
 * ```typescript
 * const queue: PersistentQueue = getPersistentQueue(); // Phase 0 已创建
 * queue.consume(async (message: QueueMessage) => {
 *   const event = toCoordinatorEvent(message);
 *   await coordinatorManager.processEvent(event);
 * });
 * ```
 */
function toCoordinatorEvent(message: QueueMessage): CoordinatorEvent {
  // 根据 QueueMessageType 映射为 CoordinatorEventType
  // 映射规则见 7.2 节
}
```

### 7.2 事件类型映射

| QueueMessageType | CoordinatorEventType | Priority |
|------------------|---------------------|----------|
| `lark_mention` | `lark_mention` | 1 |
| `meego_issue_created` | `meego_issue_created` | 3 |
| `meego_issue_assigned` | `meego_issue_assigned` | 4 |
| `meego_issue_status_changed` | `meego_issue_status_changed` | 4 |
| `meego_sprint_started` | `meego_sprint_started` | 4 |
| `diagnosis_ready` | `diagnosis_ready` | 2 |
| (internal) worker_completed | `worker_completed` | 2 |
| (internal) worker_anomaly | `worker_anomaly` | 0 |
| (internal) worker_timeout | `worker_timeout` | 0 |

### 7.3 事件源接入

Connector 已在 Phase 0 中直接对接 `PersistentQueue`，事件到达后自动入队。Server 内部事件（worker_completed、worker_anomaly、worker_timeout）由 `WorkerLifecycleMonitor` 直接 enqueue 到 PersistentQueue。

```typescript
// apps/server/src/main.ts 中新增

// ── PersistentQueue（Phase 0 已创建）──
const persistentQueue: PersistentQueue = getPersistentQueue(); // Phase 0 初始化

// ── Coordinator Session Manager 注册为 PersistentQueue 消费者 ──
const coordinatorManager = new CoordinatorSessionManager({
  config: coordinatorSessionConfig,
  appConfig: config,
  logger: createLogger("server:coordinator"),
  contextLoader: new StubContextLoader(config),
});

persistentQueue.consume(async (message: QueueMessage) => {
  const event = toCoordinatorEvent(message);
  await coordinatorManager.processEvent(event);
});

await coordinatorManager.start(controller.signal);
```

---

## 8. 与 Phase 1 CLI 的集成

### 8.1 Coordinator 如何使用 teamsland CLI

Coordinator 通过 `teamsland-spawn` Skill 学会使用 `teamsland` CLI。在 Claude Code session 中，Coordinator 通过 Bash 工具调用 CLI 命令：

```bash
# Coordinator 执行这个命令
teamsland spawn --repo "/path/to/repo" --task "$(cat <<'EOF'
实现用户头像上传功能
EOF
)" --origin-sender "ou_xxx" --origin-chat "oc_xxx"

# CLI 调用 server HTTP API
# POST http://localhost:3001/api/workers
# server 创建 worktree + 注入 skills + 启动 claude 进程 + 注册到 registry

# CLI 返回
# { "workerId": "worker-abc-1234", "status": "running" }
```

### 8.2 Server API 端点（Phase 1 提供）

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/workers` | POST | 创建 worker |
| `/api/workers` | GET | 列出所有 worker |
| `/api/workers/:id` | GET | 查询 worker 状态（含 result） |
| `/api/workers/:id/cancel` | POST | 取消 worker |
| `/api/workers/:id/transcript` | GET | 获取 transcript 路径 |

### 8.3 Worker 完成后的事件回流

Worker 完成/异常时，server 需要将事件投递回 Coordinator 队列：

```typescript
// apps/server/src/worker-lifecycle.ts

/**
 * Worker 生命周期监控
 *
 * 监听 SubagentRegistry 中 worker 状态变化，
 * 当 worker 完成或异常时投递事件到 PersistentQueue。
 */
export class WorkerLifecycleMonitor {
  constructor(
    private readonly registry: SubagentRegistry,
    private readonly queue: PersistentQueue,
    private readonly logger: Logger,
  );

  /**
   * 启动监控
   *
   * 定时轮询 registry，检测 worker 状态变化。
   * 发现 completed → 投递 worker_completed 事件
   * 发现 error → 投递 worker_anomaly 事件
   * 运行时间超过阈值 → 投递 worker_timeout 事件
   */
  start(signal: AbortSignal): void;
}
```

### 8.4 环境变量传递

Coordinator session 需要以下环境变量：

| 变量 | 用途 | 来源 |
|------|------|------|
| `TEAMSLAND_SERVER_URL` | teamsland CLI 连接 server 的地址 | settings.json env |
| `MEEGO_API_BASE_URL` | Meego API 基础地址 | config.meego.apiBaseUrl |
| `MEEGO_PLUGIN_ACCESS_TOKEN` | Meego API 认证 | config.meego.pluginAccessToken |

这些变量在 `CoordinatorSessionManager.spawnSession()` 时通过 `Bun.spawn` 的 `env` 参数传入。

---

## 9. Session 复用 vs 重建策略

### 9.1 核心原则

> PRODUCT.md: "短期内用同一个 session 处理连续对话（比如同一个人几分钟内的多条消息），但不依赖 session 长期存活。session 是'可抛弃的'，随时能从外部记忆重建。"

### 9.2 决策矩阵

| 条件 | 策略 | 理由 |
|------|------|------|
| 当前无活跃 session | **新建** | 首次启动或 session 已超时销毁 |
| 同一 chatId，距上次活动 < 5 分钟 | **复用** | 连续对话保持上下文连续性 |
| 同一 chatId，距上次活动 >= 5 分钟 | **新建** | 超出连续对话窗口 |
| 不同 chatId | **新建** | 不同群聊的消息应使用独立 session |
| session 累计存活 > 30 分钟 | **新建** | 防止 context window 膨胀 |
| session 累计处理 > 20 条消息 | **新建** | 防止 context window 膨胀 |
| worker_anomaly 事件（P0） | **新建** | 异常处理需要干净上下文 |
| session 崩溃 | **新建** + 恢复 | 崩溃后 session 不可复用 |

### 9.3 实现细节

```typescript
private shouldReuseSession(event: CoordinatorEvent): boolean {
  if (!this.activeSession) return false;

  // P0 事件总是新建 session（干净上下文处理异常）
  if (event.priority === 0) return false;

  // session 存活超过最大生命周期
  const alive = Date.now() - this.activeSession.startedAt;
  if (alive > this.config.sessionMaxLifetimeMs) return false;

  // 处理消息数超过阈值
  if (this.activeSession.processedEvents.length >= 20) return false;

  // 不同 chatId
  const eventChatId = event.payload.chatId as string | undefined;
  if (eventChatId && this.activeSession.chatId !== eventChatId) return false;

  // 超出连续对话窗口
  const idle = Date.now() - this.activeSession.lastActivityAt;
  if (idle > this.config.sessionReuseWindowMs) return false;

  return true;
}
```

### 9.4 Session 复用机制

当决定复用 session 时，使用 `claude --continue` 向已有 session 追加消息：

```typescript
private async continueSession(session: ActiveSession, prompt: string): Promise<string> {
  const proc = Bun.spawn(
    [
      "claude",
      "--continue", session.sessionId,
      "-p",
      "--output-format", "stream-json",
      "--permission-mode", "bypassPermissions",
    ],
    {
      cwd: this.config.workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: this.buildEnv(),
    },
  );

  const envelope = JSON.stringify({ prompt });
  proc.stdin.write(`${envelope}\n`);
  proc.stdin.end();

  return this.collectOutput(proc);
}
```

### 9.5 新建 Session

```typescript
private async spawnSession(prompt: string): Promise<ActiveSession> {
  this.destroySession(); // 清理旧 session

  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--verbose",
      "--permission-mode", "bypassPermissions",
    ],
    {
      cwd: this.config.workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: this.buildEnv(),
    },
  );

  const envelope = JSON.stringify({ prompt });
  proc.stdin.write(`${envelope}\n`);
  proc.stdin.end();

  // 从首行提取 sessionId（复用 ProcessController 中的逻辑）
  const sessionId = await this.extractSessionId(proc.stdout);

  return {
    pid: proc.pid,
    sessionId,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    processedEvents: [],
    chatId: undefined,
  };
}
```

### 9.6 默认配置值

```typescript
const DEFAULT_COORDINATOR_SESSION_CONFIG: CoordinatorSessionManagerConfig = {
  workspacePath: `${process.env.HOME}/.teamsland/coordinator`,
  sessionIdleTimeoutMs: 5 * 60 * 1000,        // 5 分钟空闲超时
  sessionMaxLifetimeMs: 30 * 60 * 1000,        // 30 分钟最大存活
  sessionReuseWindowMs: 5 * 60 * 1000,         // 5 分钟复用窗口
  maxRecoveryRetries: 3,                        // 最大重试 3 次
  inferenceTimeoutMs: 60 * 1000,                // 单次推理 60 秒超时
};
```

---

## 10. 验证方式

### 10.1 单元测试

| 测试目标 | 文件 | 关键测试用例 |
|---------|------|------------|
| CoordinatorPromptBuilder | `coordinator-prompt.test.ts` | 每种 event type 生成正确的 prompt 格式；context 为空时的降级行为 |
| QueueMessage → CoordinatorEvent 转换 | `coordinator-event-mapper.test.ts` | QueueMessageType → CoordinatorEventType 转换正确；优先级映射正确 |
| shouldReuseSession 逻辑 | `coordinator-session.test.ts` | 各种条件组合下的复用/新建决策 |
| initCoordinatorWorkspace | `coordinator-init.test.ts` | 目录结构正确创建；CLAUDE.md 包含配置信息；settings.json 格式正确 |

### 10.2 集成测试

#### 测试 1: 端到端消息处理链路

```text
模拟 lark_mention 事件
  → 入队 PersistentQueue（Phase 0）
  → CoordinatorSessionManager 消费
  → 组装 prompt（验证 prompt 格式）
  → 调用 claude -p（可用 mock 替代真实 LLM 调用）
  → 验证输出包含合理的决策
```

**mock 策略**: 使用一个简单的 echo server 模拟 claude CLI，接收 prompt 并返回预设的决策 JSON。

#### 测试 2: Session 复用验证

```text
发送事件 A（chatId=oc_001）
  → 新建 session
  → 记录 sessionId

2 秒后发送事件 B（chatId=oc_001）
  → 验证复用同一 session

6 分钟后发送事件 C（chatId=oc_001）
  → 验证创建新 session
```

#### 测试 3: 崩溃恢复验证

```text
发送事件 A
  → 在 session 运行中 kill 进程
  → 验证 CoordinatorSessionManager 进入 recovery 状态
  → 验证自动重建 session
  → 验证事件 A 被重新处理
```

#### 测试 4: 消息队列持久化验证

```text
入队 5 个事件
  → 模拟进程崩溃（不 ack）
  → 重启
  → 调用 requeueUnacked()
  → 验证 5 个事件重新可消费
```

### 10.3 手动验收测试

#### 验收场景 1: 群聊 @mention → Worker 启动

```text
前置: teamsland server 运行中，Coordinator 已初始化

1. 在飞书测试群 @机器人: "帮我查一下最近的 API 性能数据"
2. 验证:
   - Coordinator 队列收到 lark_mention 事件
   - Coordinator session 启动
   - Coordinator 输出决策: spawn worker
   - teamsland spawn 命令被执行
   - Worker 在 registry 中注册
   - 群聊收到 "收到，正在处理" 的确认消息
```

#### 验收场景 2: Worker 完成 → 结果转发

```text
前置: 有一个运行中的 worker

1. Worker 完成任务
2. Server 投递 worker_completed 事件到队列
3. 验证:
   - Coordinator 消费 worker_completed
   - Coordinator 调用 teamsland result 获取结果
   - Coordinator 通过 lark-cli 将结果摘要回复到原群聊
```

#### 验收场景 3: 连续对话 Session 复用

```text
1. @机器人: "帮我改一下登录页面"
2. 等待 2 秒
3. @机器人: "对了，记得加上验证码功能"
4. 验证:
   - 两条消息被同一个 Coordinator session 处理
   - Coordinator 能关联两条消息是同一任务的延续
```

### 10.4 监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| `persistent_queue.depth` | PersistentQueue 队列深度 | > 50 |
| `coordinator.session.inference_latency_ms` | 单次推理延迟 | p99 > 30s |
| `coordinator.session.crash_count` | session 崩溃次数 | > 3/hour |
| `coordinator.session.reuse_ratio` | session 复用率 | < 0.3（复用率过低说明消息分散） |
| `coordinator.event.processing_time_ms` | 事件处理总时间 | p99 > 60s |

---

## 11. 风险点

### R1: Coordinator Claude 推理延迟

**风险**: Claude API 调用延迟可能达到 5-15 秒，影响 "秒级决策" 目标。

**缓解**:
- 使用 `claude -p`（非交互模式），减少 session 启动开销
- prompt 控制在 4000 token 以内（系统上下文 + 事件消息），减少推理输入
- 设置 60 秒推理超时，超时则降级为预设规则处理
- 后续考虑用 Haiku 模型处理简单事件（P3/P4 优先级）

### R2: Session 复用的 Context 膨胀

**风险**: 复用 session 时，连续消息累积可能导致 context window 逼近上限，推理质量下降。

**缓解**:
- 硬限制: 单 session 最多处理 20 条消息或存活 30 分钟
- 每次复用前检查估算 context 使用量（基于消息数和平均长度）
- 超限时主动 `/compact` 或直接新建 session

### R3: Worker 事件回流的时序问题

**风险**: Worker 完成事件投递到 Coordinator 队列后，如果此时队列积压，用户可能等待很久才收到结果。

**缓解**:
- worker_completed 优先级设为 P2（仅低于 P0 异常和 P1 用户直接请求）
- 考虑为 worker_completed 设置 "bypass queue" 快速通道（如果 Coordinator 当前空闲直接处理）
- Dashboard 提供实时 worker 状态查看，不完全依赖群聊回复

### R4: Coordinator 工作目录初始化的幂等性

**风险**: 多次运行 `initCoordinatorWorkspace()` 可能覆盖用户手动修改的 CLAUDE.md 或 Skills。

**缓解**:
- 初始化时检查文件是否存在，已存在则跳过（不覆盖）
- 提供 `--force` 选项用于强制重新初始化
- CLAUDE.md 中的动态内容（团队成员、仓库映射）使用特殊标记区域，只更新标记区域内的内容

### R5: 没有 OpenViking 时的上下文质量

**风险**: Phase 2 使用 stub 上下文加载器，Coordinator 缺乏历史记忆，可能无法正确关联连续对话和判断任务优先级。

**缓解**:
- 复用 session 本身就是短期记忆的替代方案
- StubContextLoader 通过 `teamsland list` 获取 worker 状态作为基本上下文
- 消息队列的 recentMessages 缓存提供有限的对话上下文
- Phase 3 接入 OpenViking 后上下文质量将显著提升

### R6: lark-cli / teamsland CLI 不可用

**风险**: CLI 工具未安装或认证失效时，Coordinator 的所有 Skills 都会失败。

**缓解**:
- `initCoordinatorWorkspace()` 时检查 CLI 工具是否可用，不可用则报错
- Coordinator CLAUDE.md 中包含 CLI 不可用时的降级指令
- 服务启动时的健康检查包含 CLI 可用性验证

### R7: 并发消费安全性

**风险**: 如果未来扩展为多 Coordinator 实例消费同一队列，可能产生重复处理。

**缓解**:
- Phase 2 为单实例设计，SQLite 队列天然保证单消费者
- 队列 dequeue 使用 `UPDATE ... SET status='processing' WHERE status='pending' LIMIT 1` 的原子操作
- 预留 `consumer_id` 字段，为未来多实例做准备

---

## 附录 A: 文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `~/.teamsland/coordinator/CLAUDE.md` | 运行时生成 | Coordinator 指令文件 |
| `~/.teamsland/coordinator/.claude/settings.json` | 运行时生成 | 权限配置 |
| `~/.teamsland/coordinator/.claude/skills/teamsland-spawn/SKILL.md` | 运行时生成 | Worker 调度能力 |
| `~/.teamsland/coordinator/.claude/skills/lark-message/SKILL.md` | 运行时生成 | 飞书消息能力 |
| `~/.teamsland/coordinator/.claude/skills/lark-docs/SKILL.md` | 运行时生成 | 飞书文档能力 |
| `~/.teamsland/coordinator/.claude/skills/meego-query/SKILL.md` | 运行时生成 | Meego 查询能力 |
| `apps/server/src/coordinator.ts` | 新增源码 | CoordinatorSessionManager |
| `apps/server/src/coordinator-init.ts` | 新增源码 | 工作目录初始化 |
| `apps/server/src/coordinator-prompt.ts` | 新增源码 | Prompt 构建器 |
| `apps/server/src/coordinator-event-mapper.ts` | 新增源码 | QueueMessage → CoordinatorEvent 转换 |
| `apps/server/src/worker-lifecycle.ts` | 新增源码 | Worker 生命周期监控 |
| `packages/types/src/coordinator.ts` | 新增源码 | Coordinator 类型定义 |

## 附录 B: 配置新增

在 `config/config.json` 的 `AppConfig` 中新增：

```json
{
  "coordinator": {
    "workspacePath": "~/.teamsland/coordinator",
    "sessionIdleTimeoutMs": 300000,
    "sessionMaxLifetimeMs": 1800000,
    "sessionReuseWindowMs": 300000,
    "maxRecoveryRetries": 3,
    "inferenceTimeoutMs": 60000,
    "enabled": true
  }
}
```

对应 `packages/types/src/config.ts` 新增：

```typescript
export interface CoordinatorConfig {
  /** Coordinator 工作目录 */
  workspacePath: string;
  /** session 空闲超时（ms） */
  sessionIdleTimeoutMs: number;
  /** session 最大存活时间（ms） */
  sessionMaxLifetimeMs: number;
  /** 同一 chatId 连续消息复用 session 的时间窗口（ms） */
  sessionReuseWindowMs: number;
  /** 崩溃后最大重试次数 */
  maxRecoveryRetries: number;
  /** 单次推理超时（ms） */
  inferenceTimeoutMs: number;
  /** 是否启用 Coordinator（关闭则使用原有 event-handlers 逻辑） */
  enabled: boolean;
}
```

## 附录 C: 与现有模块的关系

```
                     ┌──────────────────────────────────┐
                     │        apps/server/src/main.ts    │
                     └────────┬─────────────────────────┘
                              │ 初始化
            ┌─────────────────┼─────────────────────────┐
            ▼                 ▼                         ▼
   ┌─────────────┐  ┌─────────────────┐    ┌──────────────────┐
   │ LarkConnector│  │ MeegoConnector  │    │ CoordinatorSession│
   │  (existing)  │  │  (existing)     │    │   Manager (NEW)   │
   └──────┬──────┘  └───────┬─────────┘    └────────┬─────────┘
          │                 │                        │
          ▼                 ▼                        │
   ┌───────────────────────────────────┐             │
   │ PersistentQueue (Phase 0 existing)│◄────────────┘
   └───────────────────────────────────┘     consume()
                  ▲
                  │ enqueue worker 事件
   ┌──────────────┴───────────────┐
   │ WorkerLifecycleMonitor (NEW) │
   └──────────────┬───────────────┘
                  │ 监听
                  ▼
   ┌──────────────────────────────┐
   │ SubagentRegistry (existing)  │
   └──────────────────────────────┘
```

---

*本文档为 Phase 2 技术方案初稿，待评审后进入实施阶段。*
