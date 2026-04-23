# Phase 4-5 技术方案：Skills 体系 + 观察者/打断/恢复

> 日期：2026-04-23
> 依赖：Phase 1（CLI + Server API）、Phase 0（队列）

---

## Phase 4: Skills 体系

### 4A: Worker Skills 定义

#### 4A-1: `lark-reply/SKILL.md`

Worker 完成任务后通过 `lark-cli` 回复群聊。

```yaml
---
name: lark-reply
description: 向飞书群聊或私聊发送消息。当任务完成、需要汇报进度、或需要向用户反馈结果时使用。
user-invocable: false
allowed-tools:
  - Bash(lark-cli im *)
---

# 飞书消息回复

通过 `lark-cli` 命令行工具向飞书发送消息。

## 发送群聊消息

```bash
lark-cli im +messages-send --as bot --chat-id "<chat_id>" --text "<消息内容>"
```

## 回复指定消息

```bash
lark-cli im +messages-reply --as bot --message-id "<message_id>" --text "<回复内容>"
```

## 发送私聊消息

```bash
lark-cli im +messages-send --as bot --user-id "<user_open_id>" --text "<消息内容>"
```

## 注意事项

- 消息内容超过 4000 字符时分段发送
- 代码片段用 markdown 代码块包裹
- 先说结论/结果，再展开细节
- 使用 `--text` 参数传递纯文本，特殊字符无需额外转义
- chat_id 和 user_id 在任务上下文中提供，不要自行编造
```

#### 4A-2: `meego-update/SKILL.md`

Worker 更新 Meego 工单状态和评论。

```yaml
---
name: meego-update
description: 更新 Meego 工单状态或添加评论。当任务关联了 Meego 工单、需要更新进度或关闭工单时使用。
user-invocable: false
allowed-tools:
  - Bash(curl *meego*)
---

# Meego 工单更新

通过 Meego OpenAPI 更新工单。API 基础地址和 Token 从环境变量读取。

## 环境变量

- `MEEGO_API_BASE`: Meego API 基础地址（如 `https://meego.example.com/open_api`）
- `MEEGO_PLUGIN_TOKEN`: 插件访问令牌

## 添加工单评论

```bash
curl -s -X POST "${MEEGO_API_BASE}/comment/create" \
  -H "X-PLUGIN-TOKEN: ${MEEGO_PLUGIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'PAYLOAD'
{
  "work_item_id": "<issue_id>",
  "content": "<评论内容，支持 markdown>"
}
PAYLOAD
)"
```

## 更新工单状态

```bash
curl -s -X PUT "${MEEGO_API_BASE}/work_item/<project_key>/<work_item_type_key>/<work_item_id>" \
  -H "X-PLUGIN-TOKEN: ${MEEGO_PLUGIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"current_status_key": "<target_status_key>"}'
```

## 注意事项

- 评论中说明做了什么、改了哪些文件、测试是否通过
- 状态流转需符合 Meego 工作流定义，不要跳跃状态
- issue_id 和 project_key 在任务上下文中提供
```

#### 4A-3: `teamsland-report/SKILL.md`

Worker 向 teamsland server 汇报进度。

```yaml
---
name: teamsland-report
description: 向 teamsland server 汇报任务进度或最终结果。在任务的关键节点（开始、阶段完成、最终完成、遇到阻塞）时使用。
user-invocable: false
allowed-tools:
  - Bash(curl *localhost:7860*)
---

# teamsland 进度汇报

通过 HTTP API 向 teamsland server 报告 Worker 状态。

## 汇报进度

```bash
curl -s -X POST "http://localhost:7860/api/workers/${WORKER_ID}/progress" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'PAYLOAD'
{
  "phase": "<当前阶段: analyzing | implementing | testing | completed>",
  "summary": "<50 字以内的阶段摘要>",
  "details": "<可选的详细说明>"
}
PAYLOAD
)"
```

## 汇报最终结果

```bash
curl -s -X POST "http://localhost:7860/api/workers/${WORKER_ID}/result" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'PAYLOAD'
{
  "status": "<success | failed | blocked>",
  "summary": "<结果摘要>",
  "artifacts": {
    "branch": "<git 分支名>",
    "filesChanged": ["<变更文件列表>"],
    "testsPassed": <true|false>
  }
}
PAYLOAD
)"
```

## 环境变量

- `WORKER_ID`: 当前 Worker 的唯一标识（由 teamsland server 注入）

## 汇报时机

1. 开始分析代码结构时：`phase: "analyzing"`
2. 开始编写代码时：`phase: "implementing"`
3. 开始运行测试时：`phase: "testing"`
4. 全部完成时调用 result 接口
5. 遇到无法自行解决的阻塞时立即汇报 `status: "blocked"`
```

---

### 4B: SkillInjector

#### 接口设计

```typescript
// packages/sidecar/src/skill-injector.ts

import type { Logger } from "@teamsland/observability";

/**
 * Skill 注入配置
 *
 * @example
 * ```typescript
 * const manifest: SkillManifest = {
 *   name: "lark-reply",
 *   sourcePath: "/path/to/skills/lark-reply",
 * };
 * ```
 */
export interface SkillManifest {
  /** Skill 名称（即目录名） */
  name: string;
  /** Skill 源文件目录的绝对路径 */
  sourcePath: string;
}

/**
 * Worker 类型 → 需注入的 Skill 列表映射
 *
 * @example
 * ```typescript
 * const routing: SkillRouting = {
 *   coding: ["lark-reply", "meego-update", "teamsland-report"],
 *   research: ["lark-reply", "teamsland-report"],
 *   observer: ["teamsland-report"],
 * };
 * ```
 */
export type SkillRouting = Record<string, string[]>;

/**
 * Skill 注入器构造参数
 */
export interface SkillInjectorOpts {
  /** 所有可用 Skill 的清单 */
  skills: SkillManifest[];
  /** 任务类型 → Skill 路由表 */
  routing: SkillRouting;
  /** 日志器 */
  logger: Logger;
}

/**
 * 注入请求参数
 */
export interface InjectRequest {
  /** 目标 worktree 根路径 */
  worktreePath: string;
  /** 任务类型（用于路由选择 Skill） */
  taskType: string;
  /** 强制注入的额外 Skill 名称（不受路由限制） */
  extraSkills?: string[];
}

/**
 * 注入结果
 */
export interface InjectResult {
  /** 实际注入的 Skill 名称列表 */
  injected: string[];
  /** 跳过的 Skill 名称（源不存在等原因） */
  skipped: string[];
}
```

#### 核心逻辑

```typescript
export class SkillInjector {
  private readonly skillMap: Map<string, SkillManifest>;
  private readonly routing: SkillRouting;
  private readonly logger: Logger;

  constructor(opts: SkillInjectorOpts) { /* ... */ }

  /**
   * 将 Skills 注入目标 worktree
   *
   * 流程：
   * 1. 根据 taskType 查路由表，得到 Skill 名称列表
   * 2. 合并 extraSkills
   * 3. 对每个 Skill：复制 sourcePath 整个目录到
   *    <worktreePath>/.claude/skills/<skill-name>/
   * 4. 返回注入结果
   */
  async inject(req: InjectRequest): Promise<InjectResult> { /* ... */ }

  /**
   * 清理 worktree 中已注入的 Skills
   *
   * 删除 <worktreePath>/.claude/skills/ 下由 SkillInjector 注入的目录。
   * 保留 worktree 原有的 .claude/skills/（通过 manifest 标记文件区分）。
   */
  async cleanup(worktreePath: string): Promise<void> { /* ... */ }
}
```

#### 注入实现细节

- 使用 `Bun.file()` + `Bun.write()` 复制文件，不依赖 `node:fs`
- 在每个注入的 Skill 目录下写入 `.injected-by-teamsland` 标记文件，cleanup 时只删有标记的
- Skill 源目录位置：`~/.teamsland/skills/<skill-name>/`（server 启动时从项目内置模板同步）
- `.claude/skills/` 目录不存在时自动创建

#### Skill 路由配置

复用现有 `config.skillRouting`（`SkillRoutingConfig = Record<string, string[]>`），扩展为：

```json
{
  "coding": ["lark-reply", "meego-update", "teamsland-report"],
  "research": ["lark-reply", "teamsland-report"],
  "review": ["lark-reply", "meego-update", "teamsland-report"],
  "observer": ["teamsland-report"]
}
```

---

### 4C: Worker CLAUDE.md 注入

#### 设计思路

Server spawn worker 前，在 worktree 的 `CLAUDE.md` **末尾追加**任务上下文块（不覆盖项目原有 CLAUDE.md）。

#### CLAUDE.md 追加模板

```markdown
<!-- teamsland-task-context: DO NOT EDIT BELOW -->

## teamsland 任务上下文

### 任务信息
- **Worker ID**: {{workerId}}
- **任务类型**: {{taskType}}
- **发起人**: {{requester}}
- **关联工单**: {{issueId}}
- **群聊 ID**: {{chatId}}
- **消息 ID**: {{messageId}}

### 任务指令
{{taskPrompt}}

### 工作约定
- 完成后必须通过 `teamsland-report` skill 汇报结果
- 如需回复群聊，使用 `lark-reply` skill
- 如关联了 Meego 工单，完成后通过 `meego-update` skill 更新状态
- 遇到无法解决的问题时，立即通过 `teamsland-report` 汇报 blocked 状态
- 不要自行 spawn 子进程或委派任务

### 环境变量
- `WORKER_ID={{workerId}}`
- `MEEGO_API_BASE={{meegoApiBase}}`
- `MEEGO_PLUGIN_TOKEN={{meegoPluginToken}}`
```

#### ClaudeMdInjector 接口

```typescript
// packages/sidecar/src/claude-md-injector.ts

export interface ClaudeMdContext {
  workerId: string;
  taskType: string;
  requester: string;
  issueId: string;
  chatId: string;
  messageId: string;
  taskPrompt: string;
  meegoApiBase: string;
  meegoPluginToken: string;
}

export class ClaudeMdInjector {
  /** 标记行，用于识别注入块 */
  private static readonly MARKER = "<!-- teamsland-task-context: DO NOT EDIT BELOW -->";

  /**
   * 向 worktree 的 CLAUDE.md 追加任务上下文
   *
   * 如果已存在注入块（通过 MARKER 识别），先移除再重新追加。
   */
  async inject(worktreePath: string, ctx: ClaudeMdContext): Promise<void> { /* ... */ }

  /**
   * 从 CLAUDE.md 移除注入块
   */
  async cleanup(worktreePath: string): Promise<void> { /* ... */ }
}
```

#### 环境变量注入

除了写入 CLAUDE.md，还需在 spawn 时通过 `Bun.spawn` 的 `env` 参数传递：

```typescript
Bun.spawn(["claude", "-p", ...], {
  cwd: worktreePath,
  env: {
    ...process.env,
    WORKER_ID: workerId,
    MEEGO_API_BASE: config.meego.apiBaseUrl,
    MEEGO_PLUGIN_TOKEN: config.meego.pluginAccessToken,
  },
});
```

---

### 4D: Spawn 完整流程（Skills 集成后）

```
teamsland spawn --task "..." --task-brief coding --origin-sender "张三" --origin-chat "oc_xxx"
  │
  ├─ 1. WorktreeManager.create() → 创建 git worktree
  ├─ 2. SkillInjector.inject({ worktreePath, taskType: "coding" })
  │     → 复制 lark-reply/, meego-update/, teamsland-report/ 到 .claude/skills/
  ├─ 3. ClaudeMdInjector.inject(worktreePath, context)
  │     → 在 CLAUDE.md 末尾追加任务上下文块
  ├─ 4. ProcessController.spawn({ worktreePath, initialPrompt })
  │     → 启动 claude -p，注入环境变量
  ├─ 5. SubagentRegistry.register(record)
  │     → 注册到内存索引
  └─ 6. SidecarDataPlane.processStream(agentId, stdout)
        → 消费 NDJSON 流，路由事件
```

---

## Phase 5: 观察者 + 打断/恢复

### 5A: TranscriptReader

#### Session Transcript 路径推算

```
~/.claude/projects/<project-hash>/<session-id>.jsonl
```

其中 `<project-hash>` 是 worktree 绝对路径的确定性哈希。teamsland 已知 worker 的 `worktreePath` 和 `sessionId`，可推算路径。

#### JSONL 行格式（Claude Code 输出）

每行是一个 JSON 对象，关键字段：

```typescript
interface TranscriptEntry {
  type: "user" | "assistant" | "system" | "tool_use" | "tool_result";
  timestamp?: string;
  message?: {
    role: string;
    content: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
  // tool_use 特有
  name?: string;
  input?: Record<string, unknown>;
  // tool_result 特有
  content?: string;
  is_error?: boolean;
}
```

#### TranscriptReader 接口设计

```typescript
// packages/sidecar/src/transcript-reader.ts

import type { Logger } from "@teamsland/observability";

/**
 * Transcript 条目（归一化后）
 */
export interface NormalizedEntry {
  /** 条目序号（从 0 开始） */
  index: number;
  /** 消息类型 */
  type: "user" | "assistant" | "tool_use" | "tool_result" | "system" | "unknown";
  /** 时间戳（ISO 字符串或 Unix 毫秒） */
  timestamp: number;
  /** 文本内容摘要（截断到 maxContentLength） */
  content: string;
  /** tool_use 时的工具名称 */
  toolName?: string;
  /** tool_result 时是否出错 */
  isError?: boolean;
}

/**
 * 增量读取结果
 */
export interface ReadResult {
  /** 本次读到的新条目 */
  entries: NormalizedEntry[];
  /** 当前已读到的总行数（下次增量读取的 offset） */
  offset: number;
  /** 文件是否仍在写入（进程是否存活） */
  isLive: boolean;
}

/**
 * Transcript 增量读取器
 *
 * 设计为无状态：调用方保存 offset，每次传入继续读取。
 */
export class TranscriptReader {
  private readonly logger: Logger;

  constructor(opts: { logger: Logger }) {
    this.logger = opts.logger;
  }

  /**
   * 推算 transcript 文件路径
   *
   * Claude Code 使用 worktreePath 的 SHA-256 前 16 字符作为 project hash。
   * 路径格式：~/.claude/projects/<hash>/<sessionId>.jsonl
   */
  resolveTranscriptPath(worktreePath: string, sessionId: string): string { /* ... */ }

  /**
   * 增量读取 transcript
   *
   * @param filePath - transcript .jsonl 文件路径
   * @param offset - 上次读取到的行数（0 = 从头读）
   * @param maxEntries - 单次最多读取的条目数（防止内存膨胀）
   */
  async read(filePath: string, offset: number, maxEntries?: number): Promise<ReadResult> { /* ... */ }

  /**
   * 读取 transcript 尾部（最近 N 条）
   *
   * 用于快速诊断：只读最后 N 行，不需要从头遍历。
   */
  async tail(filePath: string, count: number): Promise<NormalizedEntry[]> { /* ... */ }

  /**
   * 生成 transcript 摘要
   *
   * 提取关键里程碑：tool_use 调用列表、error 条目、最后的 assistant 输出。
   * 不做 LLM 推理，纯结构化提取。
   */
  summarizeStructured(entries: NormalizedEntry[]): TranscriptSummary { /* ... */ }
}

/**
 * 结构化 Transcript 摘要
 */
export interface TranscriptSummary {
  /** 总条目数 */
  totalEntries: number;
  /** 工具调用列表（按时间排序） */
  toolCalls: Array<{ name: string; timestamp: number; isError: boolean }>;
  /** 错误条目 */
  errors: NormalizedEntry[];
  /** 最后一条 assistant 消息的内容 */
  lastAssistantMessage: string;
  /** 时间跨度（毫秒） */
  durationMs: number;
}
```

#### project-hash 推算实现

```typescript
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

function projectHash(worktreePath: string): string {
  // Claude Code 内部使用的哈希算法：SHA-256 取前 16 hex
  return createHash("sha256").update(worktreePath).digest("hex").slice(0, 16);
}

function resolveTranscriptPath(worktreePath: string, sessionId: string): string {
  const hash = projectHash(worktreePath);
  return join(homedir(), ".claude", "projects", hash, `${sessionId}.jsonl`);
}
```

> **注意**：project-hash 的具体算法需要验证。实现时应先用已知的 worktreePath + sessionId 组合校验推算路径是否匹配实际文件。备选方案：直接扫描 `~/.claude/projects/` 下所有目录匹配 sessionId。

---

### 5B: 观察者 Worker 模式

#### 设计原则

观察者本身是一个 Claude Code Worker（与任务 Worker 同构），区别在于：
- **不创建新 worktree**，运行在临时目录（只需要文件读取能力）
- **taskType 为 `observer`**，注入精简 Skill 集
- **prompt 包含目标 transcript 路径和分析指令**

#### 观察者 Prompt 模板

##### 进度查询

```
读取以下 Worker 的 session transcript 文件并总结当前进展：

文件路径：{{transcriptPath}}

要求：
1. 列出已完成的步骤（读了哪些文件、做了什么修改、运行了什么命令）
2. 识别当前正在进行的操作
3. 列出尚未开始的工作（基于原始任务描述推断）
4. 估算完成度百分比

原始任务描述：
{{originalTaskPrompt}}

输出格式：
- 用中文回答
- 已完成/进行中/待做 三段式
- 100 字以内的一句话总结放在最前面
```

##### 质量审查

```
审查以下 Worker 的工作质量：

Session transcript：{{transcriptPath}}
Worktree 代码变更：{{worktreePath}}

要求：
1. 读取 transcript 了解 Worker 的推理过程和决策
2. 检查 worktree 中的代码变更（git diff）
3. 对照原始任务需求评估：
   - 是否偏离了需求
   - 代码质量是否符合项目规范
   - 是否有遗漏的边界情况
   - 测试是否充分

原始任务描述：
{{originalTaskPrompt}}

输出 JSON：
{
  "verdict": "on_track" | "drifted" | "blocked" | "low_quality",
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1"],
  "summary": "一句话总结"
}
```

##### 卡住诊断

```
诊断以下 Worker 为何卡住或表现异常：

Session transcript：{{transcriptPath}}

重点分析 transcript 的最后 50 条记录，关注：
1. 是否在重复相同的操作（重试循环）
2. 是否遇到了持续的错误
3. 是否在等待外部输入
4. 最后一次有效操作是什么

输出 JSON：
{
  "diagnosis": "retry_loop" | "persistent_error" | "stuck" | "waiting_input" | "unknown",
  "rootCause": "根因分析",
  "recommendation": "interrupt" | "let_continue" | "inject_hint",
  "details": "详细说明"
}
```

#### 观察者 Spawn 参数

```typescript
interface ObserverSpawnRequest {
  /** 观察类型 */
  observeType: "progress" | "quality" | "diagnosis";
  /** 目标 Worker 的 AgentRecord */
  targetWorker: AgentRecord;
  /** 目标 Worker 的原始任务描述 */
  originalTaskPrompt: string;
  /** 结果回调：群聊 ID（progress 类型需要） */
  replyToChatId?: string;
}
```

---

### 5C: 打断（Interrupt）

#### 打断流程

```
触发条件：
  a) 用户在群聊中说 "停掉那个任务"
  b) 观察者诊断为 retry_loop / persistent_error
  c) Server 检测到 Worker 超时

执行流程：
  1. Server 查找目标 Worker 的 AgentRecord
  2. ProcessController.interrupt(pid, hard=false)
     → 发送 SIGINT，Claude Code 优雅退出
  3. 等待 10 秒，检查 isAlive(pid)
  4. 若仍存活：ProcessController.interrupt(pid, hard=true)
     → 发送 SIGKILL，强制终止
  5. 更新 AgentRecord.status = "interrupted"
  6. 保留 worktree 和 transcript（不清理）
  7. SubagentRegistry.persist() → 写入磁盘
  8. 发送队列消息 "worker_interrupted"
```

#### 新增 AgentRecord 字段

```typescript
// packages/types/src/sidecar.ts 扩展

export type AgentStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"    // Phase 5 新增
  | "observing";     // Phase 5 新增：观察者专用状态

export interface AgentRecord {
  // ... 现有字段 ...

  // ── Phase 5 新增 ──
  /** Worker 类型 */
  workerType?: "task" | "observer";
  /** 观察者关联的目标 Worker ID（仅 observer 类型） */
  observeTargetId?: string;
  /** 前任 Worker ID（恢复场景，新 Worker 记录前任） */
  predecessorId?: string;
  /** 打断原因 */
  interruptReason?: string;
  /** 原始任务描述（用于恢复时传递给新 Worker） */
  taskPrompt?: string;
  /** 进度汇报列表 */
  progressReports?: Array<{
    phase: string;
    summary: string;
    timestamp: number;
  }>;
}
```

#### InterruptController 接口

```typescript
// packages/sidecar/src/interrupt-controller.ts

export interface InterruptRequest {
  /** 目标 Worker 的 agentId */
  agentId: string;
  /** 打断原因 */
  reason: string;
  /** 优雅退出等待时间（毫秒），默认 10000 */
  graceMs?: number;
}

export interface InterruptResult {
  /** 是否成功终止 */
  terminated: boolean;
  /** 终止方式 */
  method: "sigint" | "sigkill" | "already_dead";
  /** 保留的 worktree 路径 */
  worktreePath: string;
  /** 保留的 transcript 路径 */
  transcriptPath: string;
}

export class InterruptController {
  constructor(
    private readonly processCtrl: ProcessController,
    private readonly registry: SubagentRegistry,
    private readonly transcriptReader: TranscriptReader,
    private readonly logger: Logger,
  ) {}

  async interrupt(req: InterruptRequest): Promise<InterruptResult> { /* ... */ }
}
```

---

### 5D: 恢复（接力）

#### 恢复流程

```
前提：Worker-A 已被打断，worktree 保留在 /repos/fe/.worktrees/task-42

恢复步骤：
  1. TranscriptReader.read() → 读取 Worker-A 的完整 transcript
  2. TranscriptReader.summarizeStructured() → 结构化摘要
  3. [可选] spawn 观察者生成 LLM 摘要（更高质量但耗时）
  4. SkillInjector.inject() → 重新注入 Skills（可能已被清理）
  5. ClaudeMdInjector.inject() → 注入新的任务上下文（含前任摘要+纠正指令）
  6. ProcessController.spawn({ worktreePath: 已有路径 })
     → 不创建新 worktree，复用现有
  7. 新 Worker 的 prompt 包含：
     - 前任 Worker 的工作摘要
     - 纠正指令（为什么打断、需要怎么改）
     - 原始任务描述
```

#### 恢复 Prompt 模板

```
你是一个接力 Worker，继续在此 worktree 中完成前任未完成的工作。

## 前任 Worker 的工作摘要
{{predecessorSummary}}

## 前任被打断的原因
{{interruptReason}}

## 纠正指令
{{correctionInstructions}}

## 原始任务描述
{{originalTaskPrompt}}

## 你需要做的
1. 先用 `git diff` 和 `git status` 了解当前代码状态
2. 读取前任已修改的文件，理解已完成的工作
3. 基于纠正指令调整方向
4. 继续完成剩余工作
5. 完成后通过 teamsland-report 汇报结果

注意：
- 不要重复前任已正确完成的工作
- 如果前任的修改有问题，先修正再继续
- 保持代码风格与项目 CLAUDE.md 一致
```

#### ResumeController 接口

```typescript
// packages/sidecar/src/resume-controller.ts

export interface ResumeRequest {
  /** 被打断的 Worker 的 agentId */
  predecessorId: string;
  /** 纠正指令（为什么打断、需要怎么改） */
  correctionInstructions: string;
  /** 是否使用 LLM 生成高质量摘要（否则用结构化摘要） */
  useLlmSummary?: boolean;
}

export interface ResumeResult {
  /** 新 Worker 的 agentId */
  newAgentId: string;
  /** 新 Worker 的 PID */
  pid: number;
  /** 复用的 worktree 路径 */
  worktreePath: string;
}

export class ResumeController {
  constructor(
    private readonly registry: SubagentRegistry,
    private readonly transcriptReader: TranscriptReader,
    private readonly skillInjector: SkillInjector,
    private readonly claudeMdInjector: ClaudeMdInjector,
    private readonly processCtrl: ProcessController,
    private readonly logger: Logger,
  ) {}

  async resume(req: ResumeRequest): Promise<ResumeResult> { /* ... */ }
}
```

---

### 5E: 自动化链条

#### 异常检测策略

Server 端持续监控，以下情况触发异常事件：

| 异常类型 | 检测方式 | 触发条件 |
|---------|---------|---------|
| **超时** | 定时器 | Worker 运行时间 > `sidecar.workerTimeoutSeconds` |
| **进程意外退出** | orphan monitor | `isAlive(pid)` 返回 false 且 status 仍为 running |
| **错误频率过高** | DataPlane 计数 | 最近 5 分钟内 error 事件 >= 3 次 |
| **无活动** | transcript mtime | transcript 文件 mtime 超过 5 分钟无更新 |
| **进度停滞** | progress report | 最后一次 progress report 超过 10 分钟 |

#### AnomalyDetector 接口

```typescript
// packages/sidecar/src/anomaly-detector.ts

export type AnomalyType =
  | "timeout"
  | "unexpected_exit"
  | "high_error_rate"
  | "inactive"
  | "progress_stall";

export interface Anomaly {
  type: AnomalyType;
  agentId: string;
  detectedAt: number;
  details: string;
}

export class AnomalyDetector {
  private readonly intervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(
    private readonly registry: SubagentRegistry,
    private readonly config: SidecarConfig,
    private readonly logger: Logger,
  ) {}

  /** 开始监控一个 Worker */
  startMonitoring(agentId: string): void { /* ... */ }

  /** 停止监控 */
  stopMonitoring(agentId: string): void { /* ... */ }

  /** 注册异常回调 */
  onAnomaly(handler: (anomaly: Anomaly) => void): void { /* ... */ }
}
```

#### 完整自动化链条

```
Worker 运行中
  │
  ├─ AnomalyDetector 持续监控
  │  └─ 检测到异常 → 生成 Anomaly 事件
  │
  ├─ Server 收到 Anomaly
  │  └─ 投递 { type: "worker_anomaly", payload: anomaly } 到消息队列
  │
  ├─ Coordinator 消费 "worker_anomaly"
  │  └─ 决策：spawn 观察者诊断
  │     teamsland spawn --task-brief observer --task "诊断 worker-abc ..."
  │
  ├─ 观察者 Worker 运行
  │  ├─ 读取目标 transcript
  │  ├─ 分析问题
  │  └─ 通过 teamsland-report 汇报诊断结果
  │
  ├─ Server 收到观察者 result
  │  └─ 投递 { type: "diagnosis_ready", payload: diagnosis } 到队列
  │
  ├─ Coordinator 消费 "diagnosis_ready"
  │  ├─ diagnosis.recommendation == "interrupt"
  │  │  └─ teamsland cancel <worker-id>
  │  │     teamsland spawn --worktree <path> --task "接力..."
  │  ├─ diagnosis.recommendation == "let_continue"
  │  │  └─ 不操作，继续监控
  │  └─ diagnosis.recommendation == "inject_hint"
  │     └─ [未来] 通过 stdin 向 Worker 注入提示
  │
  └─ 新 Worker 带纠正指令继续工作
```

#### 消息队列新事件类型

```typescript
// packages/types/src/message-bus.ts 扩展

export type TeamMessageType =
  | "task_result"
  | "task_error"
  // Phase 5 新增
  | "worker_anomaly"
  | "worker_interrupted"
  | "diagnosis_ready"
  | "worker_resumed";
```

---

### 5F: Server API 扩展

> **注意**: 以下端点需要在 Phase 1 的 Server API 基础上扩展。Phase 1 已定义了 `/api/workers` (POST/GET)、`/api/workers/:id` (GET)、`/api/workers/:id/cancel` (POST)、`/api/workers/:id/transcript` (GET) 五个基础端点。本 Phase 新增以下端点：

**新增端点（Phase 4-5）：**

```
POST   /api/workers/:id/progress        Worker 上报进度（teamsland-report Skill 调用）
POST   /api/workers/:id/result          Worker 上报最终结果（teamsland-report Skill 调用）
POST   /api/workers/:id/interrupt       打断 Worker
POST   /api/workers/:id/resume          恢复（接力）Worker
POST   /api/workers/:id/observe         Spawn 观察者
GET    /api/workers/:id/progress        获取进度汇报列表
```

**已有端点（Phase 1 定义，本 Phase 复用）：**

```
GET    /api/workers/:id/transcript      获取 transcript 摘要（Phase 1 已有）
```

---

## 验证方式

### Phase 4 验证

| 验证项 | 方法 |
|-------|------|
| Skill 文件格式 | 将 SKILL.md 放入测试项目 `.claude/skills/`，启动 Claude Code 验证自动发现（`/` 菜单可见） |
| SkillInjector | 单元测试：inject 后检查目标目录文件一致性；cleanup 后检查标记文件被删除 |
| ClaudeMdInjector | 单元测试：inject 后读取 CLAUDE.md 验证追加内容；二次 inject 验证幂等性 |
| 端到端 | `teamsland spawn --task "在 CLAUDE.md 中列出你看到的 skills" --task-brief coding`，验证 Worker 输出中包含注入的 skill 名称 |

### Phase 5 验证

| 验证项 | 方法 |
|-------|------|
| TranscriptReader | 集成测试：spawn 一个真实 Claude session，读取其 transcript，验证解析正确性 |
| project-hash 推算 | 用已知 session 验证推算路径是否匹配 `~/.claude/projects/` 下的实际文件 |
| 打断流程 | 集成测试：spawn Worker → 等 5 秒 → interrupt → 验证 isAlive=false 且 worktree 保留 |
| 恢复流程 | 集成测试：打断后 resume → 验证新 Worker 在同一 worktree 启动且 prompt 包含前任摘要 |
| 异常检测 | 单元测试：mock 超时/退出条件，验证 AnomalyDetector 正确触发回调 |
| 观察者 | 手动测试：spawn 一个长任务 Worker，中途 spawn 观察者，验证观察者能读取 transcript 并输出摘要 |

---

## 风险点

### Phase 4

1. **Skill 自动发现失败** -- Claude Code 的 Skill 发现依赖目录结构和 `SKILL.md` 格式。如果格式不完全符合预期，Skill 可能不被加载。**缓解**：用实际 Claude Code session 验证每个 SKILL.md。

2. **环境变量泄露** -- `MEEGO_PLUGIN_TOKEN` 通过环境变量传递，Worker 的 Bash 工具可能意外暴露。**缓解**：在 `.claude/settings.json` 中配置 PreToolUse hook 拦截包含 token 的 echo/env 命令。

3. **CLAUDE.md 冲突** -- 注入上下文可能与项目原有 CLAUDE.md 产生语义冲突（如不同的代码风格要求）。**缓解**：注入内容明确标注为"任务上下文"，用 HTML 注释标记边界。

4. **Skill 路由粒度不足** -- 当前按 taskType 路由可能过于粗糙，同一类型任务可能需要不同 Skill 组合。**缓解**：支持 `extraSkills` 参数覆盖路由。

### Phase 5

5. **project-hash 算法不确定** -- Claude Code 内部的 project hash 算法未公开文档化，可能随版本变更。**缓解**：实现时先做校验；备选方案用 sessionId 全局扫描。

6. **Transcript 文件锁** -- Worker 正在写入 transcript 时观察者同时读取，可能读到不完整的 JSON 行。**缓解**：TranscriptReader 对最后一行做容错处理（忽略 JSON parse 失败的尾行）。

7. **观察者开销** -- 每次异常都 spawn 一个完整的 Claude Code session 做观察，token 开销较大。**缓解**：先用 TranscriptReader.summarizeStructured() 做轻量结构化分析，仅在需要深度诊断时才 spawn 观察者。

8. **打断时机不准** -- SIGINT 可能在 Claude Code 执行文件写入中途到达，导致文件损坏。**缓解**：Claude Code 内部有 SIGINT 处理逻辑（优雅退出）；Git worktree 可通过 `git checkout .` 恢复。

9. **恢复摘要质量** -- 结构化摘要可能不足以让新 Worker 完全理解前任状态。**缓解**：提供 `useLlmSummary` 选项，用 LLM 生成更详细的摘要；新 Worker 可自行读取 `git log` 和 `git diff` 补充理解。

10. **自动化链条的无限循环** -- 异常检测 → 打断 → 恢复 → 新 Worker 再次异常 → 再打断...。**缓解**：在 AgentRecord 中跟踪 `retryCount`，达到 `maxRetryCount` 后停止自动恢复，通知人工介入。

---

## 实现优先级

```
Phase 4A (Skills 定义)     ← 可立即开始，不依赖代码
Phase 4B (SkillInjector)   ← 依赖 4A 的文件内容
Phase 4C (ClaudeMdInjector) ← 与 4B 并行
Phase 4D (集成到 Spawn)     ← 依赖 4B + 4C

Phase 5A (TranscriptReader) ← 可与 Phase 4 并行
Phase 5C (打断)             ← 依赖 ProcessController（已有）
Phase 5D (恢复)             ← 依赖 5A + 5C
Phase 5B (观察者)           ← 依赖 5A
Phase 5E (自动化链条)       ← 依赖 5B + 5C + 5D，最后集成
```

---

## 文件清单

### 新增文件

```
~/.teamsland/skills/
├── lark-reply/SKILL.md
├── meego-update/SKILL.md
└── teamsland-report/SKILL.md

packages/sidecar/src/
├── skill-injector.ts
├── claude-md-injector.ts
├── transcript-reader.ts
├── interrupt-controller.ts
├── resume-controller.ts
├── anomaly-detector.ts
└── __tests__/
    ├── skill-injector.test.ts
    ├── claude-md-injector.test.ts
    ├── transcript-reader.test.ts
    ├── interrupt-controller.test.ts
    ├── resume-controller.test.ts
    └── anomaly-detector.test.ts
```

### 修改文件

```
packages/types/src/sidecar.ts    → 扩展 AgentStatus, AgentRecord
packages/types/src/message-bus.ts → 扩展 TeamMessageType
packages/sidecar/src/index.ts    → 导出新模块
apps/server/src/main.ts          → 注册新 API 路由
config/config.json               → 扩展 skillRouting
```
