# Phase 0: 清理 + 消息队列 — 详细技术方案

> 日期: 2026-04-23
> 状态: 草案
> 前置条件: 无（Phase 0 是所有后续重构的前置步骤）

---

## 目录

1. [总览](#1-总览)
2. [0A: 从 spawn 路径移除 IntentClassifier](#2-0a-从-spawn-路径移除-intentclassifier)
3. [0B: 简化 DynamicContextAssembler](#3-0b-简化-dynamiccontextassembler)
4. [0C: 标记 Swarm 为 deprecated](#4-0c-标记-swarm-为-deprecated)
5. [0D: 创建持久化消息队列 @teamsland/queue](#5-0d-创建持久化消息队列-teamslandqueue)
6. [0E: 重新布线事件流](#6-0e-重新布线事件流)
7. [数据模型](#7-数据模型)
8. [迁移步骤](#8-迁移步骤)
9. [验证方式](#9-验证方式)
10. [风险点](#10-风险点)

---

## 1. 总览

### 当前架构

```
LarkConnector ─┐
                ├→ MeegoEventBus.handle() → registerEventHandlers → issue.created handler
MeegoConnector ─┘                              ├→ Lark @mention → 直接 spawn Agent
                                               └→ Meego 工单 → IntentClassifier → confidence check → Swarm/单 Agent spawn
```

### 目标架构

```
LarkConnector ──┐
                ├→ PersistentQueue.enqueue()  → 队列消费者 → 统一 spawn Agent
MeegoConnector ─┘
```

所有事件源统一进入持久化消息队列，由 Coordinator（后续 Phase 实现）按顺序消费。
IntentClassifier 从 spawn 路径移除，Swarm 标记 deprecated，上下文组装简化为 3 段。

---

## 2. 0A: 从 spawn 路径移除 IntentClassifier

### 改动清单

| 文件 | 操作 | 具体改动 |
|------|------|----------|
| `apps/server/src/event-handlers.ts` | **修改** | (1) 删除 `CONFIDENCE_THRESHOLD` 常量; (2) 从 `EventHandlerDeps` 接口移除 `intentClassifier` 字段; (3) 删除 `resolveAndNotifyOwners()` 函数; (4) 重写 `processMeegoTicket()` — 移除意图分类调用、置信度检查、owner 通知，改为与 Lark @mention 一致的直接路径; (5) 从 `createIssueCreatedHandler()` 移除 Lark/Meego 双路径分支，统一为一条路径 |
| `apps/server/src/main.ts` | **修改** | (1) 从 `registerEventHandlers()` 的 deps 对象中移除 `intentClassifier` 字段; (2) 如果 `IntentClassifier` 不再有其他消费者，移除 `intentClassifier` 实例化（第 169 行 `const intentClassifier = new IntentClassifier({ llm: llmClient })`）; (3) 保留 `llmClient` 的构建（后续 Phase 会复用） |
| `packages/ingestion/src/intent-classifier.ts` | **不改** | 代码保留在 `@teamsland/ingestion` 包中，可用于日志分析或未来用途 |
| `packages/types/src/config.ts` | **不改** | `SkillRoutingConfig` 类型定义保留（后续 0B 会清理 assembler 对它的使用） |

### processMeegoTicket 重写后的逻辑

```typescript
async function processMeegoTicket(deps: EventHandlerDeps, event: MeegoEvent): Promise<void> {
  // 1. 解析仓库路径
  const repoPath = resolveRepoPath(deps.config, event.projectKey);
  if (!repoPath) {
    // ... 同原有逻辑：warn + DM 通知
    return;
  }

  // 2. 创建 worktree
  const worktreePath = await deps.worktreeManager.create(repoPath, event.issueId);

  // 3. 构建 TaskConfig（不再依赖 intentResult）
  const description = extractDescription(event);
  const assigneeId = extractAssigneeId(event);
  const taskConfig: TaskConfig = {
    issueId: event.issueId,
    meegoEvent: event,
    meegoProjectId: event.projectKey,
    description,
    triggerType: "meego_issue",   // 统一为事件源类型，不再是 intentResult.type
    agentRole: "general",         // 统一角色，不再由 IntentClassifier 决定
    worktreePath,
    assigneeId,
  };

  const agentId = `agent-${event.issueId}-${randomUUID().slice(0, 8)}`;

  // 4. 文档解析 + 记忆注入（保留，不依赖 IntentClassifier）
  const rawDescription = extractDescription(event);
  const parsedDocument = rawDescription ? deps.documentParser.parseMarkdown(rawDescription) : null;
  scheduleMemoryIngestion(deps, event, agentId, parsedDocument);

  // 5. 组装初始提示词（简化后的 assembler，见 0B）
  const prompt = await deps.assembler.buildInitialPrompt(taskConfig, deps.teamId);

  // 6. 启动 Agent 子进程
  const spawnResult = await deps.processController.spawn({
    issueId: event.issueId,
    worktreePath,
    initialPrompt: prompt,
  });

  // 7. 注册到注册表
  await registerAgent(deps, {
    agentId,
    pid: spawnResult.pid,
    sessionId: spawnResult.sessionId,
    issueId: event.issueId,
    worktreePath,
    assigneeId,
    stdout: spawnResult.stdout,
  });
}
```

### EventHandlerDeps 改动

```typescript
export interface EventHandlerDeps {
  // 移除: intentClassifier: IntentClassifier;
  processController: ProcessController;
  dataPlane: SidecarDataPlane;
  assembler: DynamicContextAssembler;
  registry: SubagentRegistry;
  worktreeManager: WorktreeManager;
  notifier: LarkNotifier;
  larkCli: LarkCli;
  config: AppConfig;
  teamId: string;
  documentParser: DocumentParser;
  memoryStore: TeamMemoryStore | null;
  extractLoop: ExtractLoop | null;
  memoryUpdater: MemoryUpdater | null;
  // 移除: taskPlanner: TaskPlanner | null;  (0C 中移除)
  confirmationWatcher: ConfirmationWatcher;
}
```

---

## 3. 0B: 简化 DynamicContextAssembler

### 改动清单

| 文件 | 操作 | 具体改动 |
|------|------|----------|
| `packages/context/src/assembler.ts` | **修改** | (1) 删除 `buildSectionC()` 方法（§C 可用技能）; (2) 删除 `buildSectionE()` 方法（§E 角色指令）; (3) 修改 `buildInitialPrompt()` 从 5 段并发改为 3 段并发（§A/§B/§D）; (4) 从 `AssemblerOptions` 接口移除 `templateBasePath` 字段; (5) 从构造函数移除 `this.templateBasePath` 赋值; (6) 更新 JSDoc |
| `packages/context/src/template-loader.ts` | **标记 deprecated** | 添加 `@deprecated` JSDoc 注释，后续清理。不删除以防有外部引用 |
| `apps/server/src/main.ts` | **修改** | 从 `DynamicContextAssembler` 构造参数中移除 `templateBasePath` |
| `packages/types/src/config.ts` | **修改** | 从 `AppConfig` 接口中移除 `templateBasePath?: string` 字段 |
| `packages/config/src/schema.ts` | **修改** | 从配置 schema 验证中移除 `templateBasePath` 相关校验（如有） |

### 简化后的 assembler.ts 核心

```typescript
export class DynamicContextAssembler {
  private readonly config: AppConfig;
  private readonly repoMapping: RepoMapping;
  private readonly memoryStore: AbstractMemoryStore;
  private readonly embedder: Embedder;

  constructor(opts: AssemblerOptions) {
    this.config = opts.config;
    this.repoMapping = opts.repoMapping;
    this.memoryStore = opts.memoryStore;
    this.embedder = opts.embedder;
  }

  /**
   * 组装 Agent 启动时的初始提示词（3 段结构）
   *
   * - §A — Issue 上下文
   * - §B — 历史记忆
   * - §D — 仓库信息
   *
   * @example
   * ```typescript
   * const prompt = await assembler.buildInitialPrompt(task, "team-001");
   * ```
   */
  async buildInitialPrompt(task: TaskConfig, teamId: string): Promise<string> {
    return withSpan("context:assembler", "DynamicContextAssembler.buildInitialPrompt", async (span) => {
      span.setAttribute("issue.id", task.issueId);
      span.setAttribute("team.id", teamId);
      logger.info({ issueId: task.issueId, teamId }, "开始组装初始提示词");

      const [sectionA, sectionB, sectionD] = await Promise.all([
        this.buildSectionA(task),
        this.buildSectionB(task, teamId),
        this.buildSectionD(task),
      ]);

      const prompt = [sectionA, sectionB, sectionD].join("\n\n");
      span.setAttribute("prompt.length", prompt.length);
      span.setAttribute("prompt.sections", 3);
      logger.info({ issueId: task.issueId, promptLength: prompt.length }, "初始提示词组装完成");
      return prompt;
    });
  }

  // buildSectionA, buildSectionB, buildSectionD 保持不变
}
```

### AssemblerOptions 改动

```typescript
export interface AssemblerOptions {
  /** 全局应用配置 */
  config: AppConfig;
  /** Meego 项目到 Git 仓库的映射 */
  repoMapping: RepoMapping;
  /** 团队记忆存储 */
  memoryStore: AbstractMemoryStore;
  /** Embedding 生成器 */
  embedder: Embedder;
  // 移除: templateBasePath
}
```

---

## 4. 0C: 标记 Swarm 为 deprecated

### 改动清单

| 文件 | 操作 | 具体改动 |
|------|------|----------|
| `apps/server/src/event-handlers.ts` | **修改** | (1) 删除 `SWARM_ENTITY_THRESHOLD` 常量; (2) 删除 `shouldUseSwarm()` 函数; (3) 删除 `dispatchSwarm()` 函数; (4) 从 `EventHandlerDeps` 移除 `taskPlanner` 字段; (5) 在 `processMeegoTicket()` 中移除步骤 4.6 复杂任务检测 |
| `apps/server/src/main.ts` | **修改** | (1) 从 `registerEventHandlers()` deps 移除 `taskPlanner`; (2) 保留 `TaskPlanner` 实例化代码但添加 `@deprecated` 注释（或直接移除，因为唯一消费者是 event-handlers） |
| `packages/swarm/src/index.ts` | **修改** | 在 barrel export 处添加 `@deprecated` JSDoc 注释 |
| `packages/swarm/src/swarm.ts` | **修改** | 在 `runSwarm()` 函数顶部添加 `@deprecated` JSDoc |
| `packages/swarm/src/worker.ts` | **修改** | 在 `runWorker()` 函数顶部添加 `@deprecated` JSDoc |
| `packages/swarm/src/task-planner.ts` | **修改** | 在 `TaskPlanner` 类顶部添加 `@deprecated` JSDoc |
| `packages/swarm/package.json` | **修改** | 在 `description` 字段追加 `[DEPRECATED]` 标记 |

### deprecated 注释格式

```typescript
/**
 * @deprecated 将在 Coordinator 架构下被 teamsland CLI 的多 worker spawn 替代。
 * 参见 PRODUCT.md "大脑 + 手脚" 章节。
 */
```

---

## 5. 0D: 创建持久化消息队列 @teamsland/queue

### 新建文件清单

| 文件 | 说明 |
|------|------|
| `packages/queue/package.json` | 包配置 |
| `packages/queue/tsconfig.json` | TypeScript 配置（继承根 tsconfig） |
| `packages/queue/src/index.ts` | Barrel export |
| `packages/queue/src/persistent-queue.ts` | 核心队列实现 |
| `packages/queue/src/types.ts` | 消息类型定义 |
| `packages/queue/src/__tests__/persistent-queue.test.ts` | 单元测试 |

### 需修改的已有文件

| 文件 | 操作 | 改动 |
|------|------|------|
| `package.json` (根) | **修改** | `workspaces` 数组添加 `"packages/queue"` |
| `packages/types/src/index.ts` | **修改** | 导出新增的队列消息类型（或在 queue 包内自定义类型） |

### 接口设计

#### `packages/queue/src/types.ts`

```typescript
import type { MeegoEvent } from "@teamsland/types";

/**
 * 队列消息优先级
 *
 * @example
 * ```typescript
 * import type { QueuePriority } from "@teamsland/queue";
 * const p: QueuePriority = "normal";
 * ```
 */
export type QueuePriority = "high" | "normal" | "low";

/**
 * 队列消息状态
 *
 * @example
 * ```typescript
 * import type { QueueMessageStatus } from "@teamsland/queue";
 * const s: QueueMessageStatus = "pending";
 * ```
 */
export type QueueMessageStatus = "pending" | "processing" | "completed" | "failed" | "dead";

/**
 * 队列消息类型枚举
 *
 * 覆盖所有事件源和内部控制消息。
 *
 * @example
 * ```typescript
 * import type { QueueMessageType } from "@teamsland/queue";
 * const t: QueueMessageType = "lark_mention";
 * ```
 */
export type QueueMessageType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_status_changed"
  | "meego_issue_assigned"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "diagnosis_ready";

/**
 * 队列消息
 *
 * 所有进入消息队列的数据必须实现此接口。
 * `payload` 是类型安全的联合类型，根据 `type` 字段区分。
 *
 * @example
 * ```typescript
 * import type { QueueMessage } from "@teamsland/queue";
 *
 * const msg: QueueMessage = {
 *   id: "msg-001",
 *   type: "lark_mention",
 *   payload: { event: meegoEvent, chatId: "oc_xxx", senderId: "ou_xxx" },
 *   priority: "normal",
 *   status: "pending",
 *   retryCount: 0,
 *   maxRetries: 3,
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   scheduledAt: Date.now(),
 *   traceId: "trace-001",
 * };
 * ```
 */
export interface QueueMessage {
  /** 消息唯一 ID（UUID） */
  id: string;
  /** 消息类型 */
  type: QueueMessageType;
  /** 消息负载（JSON 序列化后存储） */
  payload: QueuePayload;
  /** 优先级 */
  priority: QueuePriority;
  /** 当前状态 */
  status: QueueMessageStatus;
  /** 已重试次数 */
  retryCount: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 创建时间（Unix ms） */
  createdAt: number;
  /** 最后更新时间（Unix ms） */
  updatedAt: number;
  /** 计划执行时间（Unix ms），支持延迟投递 */
  scheduledAt: number;
  /** 链路追踪 ID */
  traceId: string;
  /** 失败原因（最后一次） */
  lastError?: string;
}

/**
 * 消息负载联合类型
 *
 * @example
 * ```typescript
 * const payload: QueuePayload = {
 *   event: meegoEvent,
 *   chatId: "oc_xxx",
 *   senderId: "ou_xxx",
 *   messageId: "msg_xxx",
 * };
 * ```
 */
export type QueuePayload =
  | LarkMentionPayload
  | MeegoEventPayload
  | WorkerCompletedPayload
  | WorkerAnomalyPayload
  | DiagnosisReadyPayload;

/** 飞书 @mention 事件负载 */
export interface LarkMentionPayload {
  /** 桥接后的 MeegoEvent */
  event: MeegoEvent;
  /** 群聊 ID */
  chatId: string;
  /** 发送者 ID */
  senderId: string;
  /** 消息 ID */
  messageId: string;
}

/** Meego 事件负载 */
export interface MeegoEventPayload {
  /** 原始 MeegoEvent */
  event: MeegoEvent;
}

/** Worker 完成事件负载 */
export interface WorkerCompletedPayload {
  /** Worker ID */
  workerId: string;
  /** Worker session ID */
  sessionId: string;
  /** 关联的任务 ID */
  issueId: string;
  /** 执行结果摘要 */
  resultSummary: string;
}

/** Worker 异常事件负载 */
export interface WorkerAnomalyPayload {
  /** Worker ID */
  workerId: string;
  /** 异常类型 */
  anomalyType: "timeout" | "error_spike" | "stuck" | "crash";
  /** 详情 */
  details: string;
}

/** 诊断完成事件负载 */
export interface DiagnosisReadyPayload {
  /** 被诊断的 Worker ID */
  targetWorkerId: string;
  /** 诊断者 Worker ID */
  observerWorkerId: string;
  /** 诊断报告 */
  report: string;
}

/**
 * 队列配置
 *
 * @example
 * ```typescript
 * import type { QueueConfig } from "@teamsland/queue";
 *
 * const config: QueueConfig = {
 *   dbPath: "data/queue.sqlite",
 *   busyTimeoutMs: 5000,
 *   visibilityTimeoutMs: 60000,
 *   maxRetries: 3,
 *   deadLetterEnabled: true,
 *   pollIntervalMs: 100,
 * };
 * ```
 */
export interface QueueConfig {
  /** SQLite 数据库文件路径 */
  dbPath: string;
  /** SQLite busy_timeout（毫秒） */
  busyTimeoutMs: number;
  /** 消息处理超时（毫秒），超时后自动 nack */
  visibilityTimeoutMs: number;
  /** 默认最大重试次数 */
  maxRetries: number;
  /** 是否启用死信队列 */
  deadLetterEnabled: boolean;
  /** 消费轮询间隔（毫秒） */
  pollIntervalMs: number;
}
```

#### `packages/queue/src/persistent-queue.ts`

```typescript
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type {
  QueueConfig,
  QueueMessage,
  QueueMessageStatus,
  QueueMessageType,
  QueuePayload,
  QueuePriority,
} from "./types.js";

const logger = createLogger("queue:persistent");

/**
 * 入队参数
 *
 * @example
 * ```typescript
 * import type { EnqueueOptions } from "@teamsland/queue";
 *
 * const opts: EnqueueOptions = {
 *   type: "lark_mention",
 *   payload: { event, chatId: "oc_xxx", senderId: "ou_xxx", messageId: "msg_xxx" },
 *   priority: "high",
 * };
 * ```
 */
export interface EnqueueOptions {
  /** 消息类型 */
  type: QueueMessageType;
  /** 消息负载 */
  payload: QueuePayload;
  /** 优先级（默认 "normal"） */
  priority?: QueuePriority;
  /** 延迟投递时间（Unix ms，默认为当前时间 = 立即可消费） */
  scheduledAt?: number;
  /** 最大重试次数（覆盖配置默认值） */
  maxRetries?: number;
  /** 链路追踪 ID（默认自动生成） */
  traceId?: string;
}

/**
 * 基于 SQLite WAL 模式的持久化消息队列
 *
 * 核心特性：
 * - 持久化：消息写入 SQLite WAL，进程崩溃后不丢失
 * - 顺序消费：按 priority（high > normal > low）+ scheduledAt + createdAt 排序
 * - 可见性超时：dequeue 后消息进入 "processing" 状态，超时未 ack 自动恢复为 "pending"
 * - 重试 + 死信：超过 maxRetries 的消息自动进入 dead letter
 * - 消费回调：注册 handler 后自动轮询消费
 *
 * @example
 * ```typescript
 * import { PersistentQueue } from "@teamsland/queue";
 *
 * const queue = new PersistentQueue({
 *   dbPath: "data/queue.sqlite",
 *   busyTimeoutMs: 5000,
 *   visibilityTimeoutMs: 60000,
 *   maxRetries: 3,
 *   deadLetterEnabled: true,
 *   pollIntervalMs: 100,
 * });
 *
 * // 入队
 * const msgId = queue.enqueue({
 *   type: "lark_mention",
 *   payload: { event, chatId: "oc_xxx", senderId: "ou_xxx", messageId: "msg_xxx" },
 * });
 *
 * // 消费
 * queue.consume(async (msg) => {
 *   // 处理消息
 *   console.log(msg.type, msg.payload);
 * });
 *
 * // 优雅关闭
 * queue.close();
 * ```
 */
export class PersistentQueue {
  private readonly db: Database;
  private readonly config: QueueConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: ((msg: QueueMessage) => Promise<void>) | null = null;
  private processing = false;

  constructor(config: QueueConfig) { /* ... */ }

  /**
   * 入队一条消息
   *
   * @returns 消息 ID
   *
   * @example
   * ```typescript
   * const id = queue.enqueue({ type: "meego_issue_created", payload: { event } });
   * ```
   */
  enqueue(opts: EnqueueOptions): string { /* ... */ }

  /**
   * 取出一条待处理消息（原子操作）
   *
   * 使用 SQLite 事务保证并发安全。
   * 消息状态从 "pending" 变为 "processing"，并设置 visibilityTimeout。
   *
   * @returns 消息对象，无可用消息时返回 null
   *
   * @example
   * ```typescript
   * const msg = queue.dequeue();
   * if (msg) {
   *   await processMessage(msg);
   *   queue.ack(msg.id);
   * }
   * ```
   */
  dequeue(): QueueMessage | null { /* ... */ }

  /**
   * 查看队首消息但不取出
   *
   * @example
   * ```typescript
   * const next = queue.peek();
   * if (next) console.log("下一条:", next.type);
   * ```
   */
  peek(): QueueMessage | null { /* ... */ }

  /**
   * 确认消息处理成功
   *
   * 将消息状态设置为 "completed"。
   *
   * @example
   * ```typescript
   * queue.ack(msg.id);
   * ```
   */
  ack(messageId: string): void { /* ... */ }

  /**
   * 消息处理失败，放回队列
   *
   * retryCount +1，如果超过 maxRetries 且启用死信则移入死信队列。
   * 否则状态恢复为 "pending"，可被再次消费。
   *
   * @param messageId - 消息 ID
   * @param error - 失败原因
   *
   * @example
   * ```typescript
   * queue.nack(msg.id, "LLM 调用超时");
   * ```
   */
  nack(messageId: string, error: string): void { /* ... */ }

  /**
   * 获取死信队列中的消息
   *
   * @param limit - 返回条数（默认 100）
   *
   * @example
   * ```typescript
   * const deadLetters = queue.deadLetters(50);
   * ```
   */
  deadLetters(limit?: number): QueueMessage[] { /* ... */ }

  /**
   * 注册消费回调并启动轮询
   *
   * 注册后队列会以 pollIntervalMs 间隔轮询，取到消息时调用 handler。
   * handler 正常返回视为 ack，抛异常视为 nack。
   *
   * @example
   * ```typescript
   * queue.consume(async (msg) => {
   *   if (msg.type === "lark_mention") {
   *     await handleLarkMention(msg.payload as LarkMentionPayload);
   *   }
   * });
   * ```
   */
  consume(handler: (msg: QueueMessage) => Promise<void>): void { /* ... */ }

  /**
   * 恢复超时的 processing 消息
   *
   * 定期调用（由内部 timer 驱动），将超过 visibilityTimeout 的
   * processing 消息恢复为 pending 或移入死信。
   *
   * @example
   * ```typescript
   * queue.recoverTimeouts();
   * ```
   */
  recoverTimeouts(): number { /* ... */ }

  /**
   * 获取队列统计信息
   *
   * @example
   * ```typescript
   * const stats = queue.stats();
   * // { pending: 5, processing: 1, completed: 100, failed: 2, dead: 0 }
   * ```
   */
  stats(): Record<QueueMessageStatus, number> { /* ... */ }

  /**
   * 清理已完成的消息（保留最近 N 天）
   *
   * @param retentionDays - 保留天数（默认 7）
   *
   * @example
   * ```typescript
   * const purged = queue.purgeCompleted(3);
   * ```
   */
  purgeCompleted(retentionDays?: number): number { /* ... */ }

  /**
   * 优雅关闭
   *
   * 停止轮询，关闭数据库连接。
   *
   * @example
   * ```typescript
   * queue.close();
   * ```
   */
  close(): void { /* ... */ }
}
```

#### `packages/queue/src/index.ts`

```typescript
export { PersistentQueue } from "./persistent-queue.js";
export type {
  EnqueueOptions,
} from "./persistent-queue.js";
export type {
  DiagnosisReadyPayload,
  LarkMentionPayload,
  MeegoEventPayload,
  QueueConfig,
  QueueMessage,
  QueueMessageStatus,
  QueueMessageType,
  QueuePayload,
  QueuePriority,
  WorkerAnomalyPayload,
  WorkerCompletedPayload,
} from "./types.js";
```

#### `packages/queue/package.json`

```json
{
  "name": "@teamsland/queue",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "dependencies": {
    "@teamsland/observability": "workspace:*",
    "@teamsland/types": "workspace:*"
  },
  "devDependencies": {
    "vitest": "workspace:*"
  }
}
```

---

## 6. 0E: 重新布线事件流

### 改动清单

| 文件 | 操作 | 具体改动 |
|------|------|----------|
| `apps/server/src/main.ts` | **修改** | (1) 新增 `PersistentQueue` 实例化; (2) 新增 `QueueConfig` 配置项（添加到 `AppConfig` 或独立读取）; (3) 修改 LarkConnector/MeegoConnector 的集成方式 — 不再直接绑定 eventBus + handler，改为绑定 enqueue 回调; (4) 新增队列消费者注册; (5) 优雅关闭中添加 `queue.close()` |
| `apps/server/src/event-handlers.ts` | **修改** | (1) `registerEventHandlers()` 签名改变 — 不再接收 `MeegoEventBus`，改为接收 `PersistentQueue`; (2) 函数内部从 `bus.on(type, handler)` 改为 `queue.consume(handler)` 的统一消费者模式; (3) 消费者内部根据 `QueueMessageType` 分发到不同处理逻辑 |
| `packages/lark/src/connector.ts` | **修改** | (1) `LarkConnectorOpts` 中的 `eventBus: MeegoEventBus` 替换为 `enqueue: (opts: EnqueueOptions) => string`; (2) `handleLine()` 中原来的 `this.eventBus.handle(event)` 改为 `this.enqueue({ type: "lark_mention", payload: {...} })` |
| `packages/meego/src/connector.ts` | **修改** | (1) `MeegoConnector` 构造参数新增 `enqueue` 回调; (2) webhook handler / poll / longConnection 中原来的 `eventBus.handle(event)` 改为 `enqueue({ type: mapEventType(event.type), payload: { event } })` |
| `packages/meego/src/event-bus.ts` | **标记 deprecated** | `MeegoEventBus` 添加 `@deprecated` 注释。它的去重能力迁移到 `PersistentQueue`（通过 eventId 唯一约束实现） |
| `packages/types/src/config.ts` | **修改** | `AppConfig` 新增 `queue?: QueueConfig` 字段 |
| `packages/config/src/schema.ts` | **修改** | 新增 `queue` 配置项的 schema 验证和默认值 |
| `config/config.json` | **修改** | 新增 `queue` 配置段 |

### main.ts 关键变更

```typescript
// ── 现有 MeegoEventBus（保留用于向后兼容，标记 deprecated） ──
const eventDb = new Database(":memory:");
const eventBus = new MeegoEventBus(eventDb);

// ── 新增: PersistentQueue ──
import { PersistentQueue } from "@teamsland/queue";
import type { QueueConfig } from "@teamsland/queue";

const queueConfig: QueueConfig = config.queue ?? {
  dbPath: "data/queue.sqlite",
  busyTimeoutMs: 5000,
  visibilityTimeoutMs: 60_000,
  maxRetries: 3,
  deadLetterEnabled: true,
  pollIntervalMs: 100,
};
const queue = new PersistentQueue(queueConfig);
logger.info("PersistentQueue 已初始化");

// ── 注册队列消费者（替代原有 registerEventHandlers） ──
registerQueueConsumer(queue, {
  processController,
  dataPlane,
  assembler,
  registry,
  worktreeManager,
  notifier,
  larkCli,
  config,
  teamId: TEAM_ID,
  documentParser,
  memoryStore: memoryStore instanceof TeamMemoryStore ? memoryStore : null,
  extractLoop,
  memoryUpdater,
  confirmationWatcher,
});

// ── MeegoConnector（改为 enqueue） ──
const connector = new MeegoConnector({
  config: config.meego,
  eventBus,                                    // 保留（deprecated 兼容）
  enqueue: (opts) => queue.enqueue(opts),       // 新增
});

// ── LarkConnector（改为 enqueue） ──
if (config.lark.connector?.enabled) {
  const larkConnector = new LarkConnector({
    config: config.lark.connector,
    larkCli,
    enqueue: (opts) => queue.enqueue(opts),     // 替代 eventBus
    historyContextCount: config.lark.bot.historyContextCount,
  });
  await larkConnector.start(controller.signal);
}

// ── 优雅关闭中新增 ──
const shutdown = async () => {
  // ... 原有逻辑 ...
  queue.close();
  // ...
};
```

### event-handlers.ts 重构为队列消费者

```typescript
/**
 * 注册队列消费者
 *
 * 替代原有的 registerEventHandlers，从 MeegoEventBus 订阅模式
 * 转变为 PersistentQueue 消费者模式。
 *
 * @example
 * ```typescript
 * registerQueueConsumer(queue, deps);
 * ```
 */
export function registerQueueConsumer(queue: PersistentQueue, deps: EventHandlerDeps): void {
  queue.consume(async (msg) => {
    logger.info({ msgId: msg.id, type: msg.type, traceId: msg.traceId }, "消费队列消息");

    switch (msg.type) {
      case "lark_mention":
        await handleLarkMention(deps, msg.payload as LarkMentionPayload);
        break;
      case "meego_issue_created":
        await handleMeegoIssueCreated(deps, msg.payload as MeegoEventPayload);
        break;
      case "meego_issue_status_changed":
        await handleStatusChanged(deps, msg.payload as MeegoEventPayload);
        break;
      case "meego_issue_assigned":
        await handleAssigned(deps, msg.payload as MeegoEventPayload);
        break;
      case "meego_sprint_started":
        await handleSprintStarted(msg.payload as MeegoEventPayload);
        break;
      case "worker_completed":
        await handleWorkerCompleted(deps, msg.payload as WorkerCompletedPayload);
        break;
      case "worker_anomaly":
        await handleWorkerAnomaly(deps, msg.payload as WorkerAnomalyPayload);
        break;
      default:
        logger.warn({ type: msg.type }, "未知的队列消息类型");
    }
  });

  logger.info("队列消费者注册完成");
}
```

### LarkConnector 改动

```typescript
// 修改前
export interface LarkConnectorOpts {
  config: LarkConnectorConfig;
  larkCli: LarkCli;
  eventBus: MeegoEventBus;
  historyContextCount: number;
}

// 修改后
export interface LarkConnectorOpts {
  config: LarkConnectorConfig;
  larkCli: LarkCli;
  enqueue: (opts: EnqueueOptions) => string;
  historyContextCount: number;
}

// handleLine 中修改
private async handleLine(line: string): Promise<void> {
  // ... 解析逻辑不变 ...

  const event = await this.buildBridgeEvent(mention);
  if (!event) return;

  // 修改前: await this.eventBus.handle(event);
  // 修改后:
  this.enqueue({
    type: "lark_mention",
    payload: {
      event,
      chatId: mention.chatId,
      senderId: mention.senderId,
      messageId: mention.messageId,
    },
    priority: "high",
    traceId: event.eventId,
  });
  logger.info({ eventId: event.eventId }, "Lark 消息已入队");
}
```

### MeegoConnector 改动

```typescript
// 构造函数新增 enqueue
constructor(opts: {
  config: MeegoConfig;
  eventBus: MeegoEventBus;       // 保留（deprecated 兼容）
  enqueue?: (opts: EnqueueOptions) => string;  // 新增
}) { ... }

// webhook / poll / longConnection 中的事件分发改为：
private dispatchEvent(event: MeegoEvent): void {
  if (this.enqueue) {
    this.enqueue({
      type: mapMeegoEventType(event.type),
      payload: { event },
      traceId: event.eventId,
    });
  } else {
    // deprecated 回退路径
    this.eventBus.handle(event);
  }
}

/**
 * 将 MeegoEventType 映射为 QueueMessageType
 */
function mapMeegoEventType(type: MeegoEventType): QueueMessageType {
  const mapping: Record<MeegoEventType, QueueMessageType> = {
    "issue.created": "meego_issue_created",
    "issue.status_changed": "meego_issue_status_changed",
    "issue.assigned": "meego_issue_assigned",
    "sprint.started": "meego_sprint_started",
  };
  return mapping[type];
}
```

---

## 7. 数据模型

### SQLite Schema（queue.sqlite）

```sql
-- WAL 模式（在 PersistentQueue 构造函数中执行）
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS messages (
  id            TEXT    PRIMARY KEY,                           -- UUID
  type          TEXT    NOT NULL,                              -- QueueMessageType
  payload       TEXT    NOT NULL,                              -- JSON string
  priority      TEXT    NOT NULL DEFAULT 'normal',             -- high | normal | low
  status        TEXT    NOT NULL DEFAULT 'pending',            -- QueueMessageStatus
  retry_count   INTEGER NOT NULL DEFAULT 0,
  max_retries   INTEGER NOT NULL DEFAULT 3,
  created_at    INTEGER NOT NULL,                              -- Unix ms
  updated_at    INTEGER NOT NULL,                              -- Unix ms
  scheduled_at  INTEGER NOT NULL,                              -- Unix ms
  trace_id      TEXT    NOT NULL DEFAULT '',
  last_error    TEXT,
  processing_at INTEGER                                       -- dequeue 时记录，用于 visibility timeout
);

-- 消费查询索引：按优先级排序、只取 pending 且到期的
CREATE INDEX IF NOT EXISTS idx_messages_consume
  ON messages (status, priority, scheduled_at, created_at)
  WHERE status = 'pending';

-- 超时恢复索引
CREATE INDEX IF NOT EXISTS idx_messages_processing
  ON messages (status, processing_at)
  WHERE status = 'processing';

-- 事件去重索引（替代原 MeegoEventBus 的 seen_events 表）
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_trace_id
  ON messages (trace_id)
  WHERE trace_id != '';

-- 死信查询
CREATE INDEX IF NOT EXISTS idx_messages_dead
  ON messages (status, updated_at)
  WHERE status = 'dead';
```

### 优先级排序规则

```sql
-- dequeue 查询
SELECT * FROM messages
WHERE status = 'pending'
  AND scheduled_at <= :now
ORDER BY
  CASE priority
    WHEN 'high'   THEN 0
    WHEN 'normal' THEN 1
    WHEN 'low'    THEN 2
  END,
  created_at ASC
LIMIT 1;
```

### 去重策略

利用 `trace_id` 的唯一索引实现幂等入队。`trace_id` 由事件源的 eventId 填充：
- LarkConnector: `lark-{eventId}`
- MeegoConnector: `poll-{spaceId}-{itemId}-{updatedAt}` 或 webhook 原始 eventId
- 内部消息（worker_completed 等）: 使用 UUID，不去重

入队时使用 `INSERT OR IGNORE` 语义，重复 trace_id 静默忽略并返回已有消息的 ID。

---

## 8. 迁移步骤

### 执行顺序与每步系统可运行性保证

```
Step 1: 0A（移除 IntentClassifier）
  ↓  系统可运行 ✓（Meego 工单走直接路径，行为等价于 Lark @mention 路径）
Step 2: 0B（简化 Assembler）
  ↓  系统可运行 ✓（prompt 少了两段，不影响 Agent 启动）
Step 3: 0C（标记 Swarm deprecated）
  ↓  系统可运行 ✓（仅移除分支 + 添加注释，主路径不变）
Step 4: 0D（创建 queue 包）
  ↓  系统可运行 ✓（新包不影响现有代码，独立开发 + 测试）
Step 5: 0E（重新布线事件流）
  ↓  系统可运行 ✓（双写过渡：同时走 eventBus + queue，确认 queue 正常后摘除 eventBus）
```

### 详细步骤

#### Step 1: 0A — 移除 IntentClassifier 的 spawn 路径调用

1. 修改 `apps/server/src/event-handlers.ts`:
   - 删除 `CONFIDENCE_THRESHOLD`、`resolveAndNotifyOwners()`
   - 重写 `processMeegoTicket()` 为直接路径
   - 合并 `handleLarkMention()` 和 `processMeegoTicket()` 的共同逻辑到一个 `spawnAgent()` 辅助函数
   - 更新 `EventHandlerDeps` 接口
2. 修改 `apps/server/src/main.ts`:
   - 从 deps 对象移除 `intentClassifier`
   - 保留 `IntentClassifier` 的 import（不改 ingestion 包）
3. 运行 `bun run lint && bun run test:run` 验证

#### Step 2: 0B — 简化 DynamicContextAssembler

1. 修改 `packages/context/src/assembler.ts`:
   - 删除 `buildSectionC()`、`buildSectionE()`
   - 修改 `buildInitialPrompt()` 为 3 段
   - 更新 `AssemblerOptions`
2. 在 `packages/context/src/template-loader.ts` 添加 `@deprecated`
3. 修改 `apps/server/src/main.ts` 中的 assembler 构造参数
4. 从 `AppConfig` 移除 `templateBasePath`
5. 更新 `packages/config/src/schema.ts`
6. 运行 `bun run lint && bun run test:run` 验证

#### Step 3: 0C — 标记 Swarm deprecated

1. 修改 `apps/server/src/event-handlers.ts`:
   - 删除 `SWARM_ENTITY_THRESHOLD`、`shouldUseSwarm()`、`dispatchSwarm()`
   - 从 `EventHandlerDeps` 移除 `taskPlanner`
2. 修改 `apps/server/src/main.ts`:
   - 从 deps 移除 `taskPlanner`
   - 可选：移除 `TaskPlanner` 实例化
3. 在 swarm 包所有导出的类/函数添加 `@deprecated` 注释
4. 运行 `bun run lint && bun run test:run` 验证

#### Step 4: 0D — 创建 @teamsland/queue

1. 创建 `packages/queue/` 目录结构
2. 实现 `types.ts`
3. 实现 `persistent-queue.ts` 核心逻辑
4. 实现 `index.ts` barrel export
5. 编写 `__tests__/persistent-queue.test.ts` 单元测试:
   - enqueue + dequeue 基本流程
   - 优先级排序
   - ack / nack / 重试 / 死信
   - visibility timeout + recoverTimeouts
   - 去重（trace_id 冲突）
   - stats / purgeCompleted
   - 关闭后不可操作
6. 更新根 `package.json` 的 workspaces
7. 运行 `bun install` 安装新包依赖
8. 运行 `bun run test:run --filter queue` 验证队列包
9. 运行全量 `bun run lint && bun run test:run` 验证无副作用

#### Step 5: 0E — 重新布线事件流（分两阶段）

**阶段 A: 双写过渡**

1. 修改 `LarkConnectorOpts` — 新增 `enqueue` 字段（可选，与 `eventBus` 并存）
2. 修改 `MeegoConnector` — 新增 `enqueue` 字段（可选）
3. 修改 `main.ts`:
   - 实例化 `PersistentQueue`
   - 同时传入 `eventBus` 和 `enqueue` 给 Connector
   - Connector 内部双写：同时调用 eventBus.handle() 和 enqueue()
4. 新建 `registerQueueConsumer()` — 注册队列消费者但仅记录日志（不执行）
5. 运行验证：确认 queue 表有数据写入，现有 eventBus 路径正常

**阶段 B: 切换**

1. 修改 Connector — 移除 `eventBus` 依赖，只保留 `enqueue`
2. 修改 `registerQueueConsumer()` — 启用真正的消息处理
3. 修改 `main.ts` — 移除 `registerEventHandlers(eventBus, deps)` 调用
4. 标记 `MeegoEventBus` 为 `@deprecated`
5. 更新 `AppConfig` — 新增 `queue` 配置
6. 更新 `config/config.json` — 新增 queue 配置段
7. 更新优雅关闭流程 — 添加 `queue.close()`
8. 运行全量 `bun run lint && bun run test:run` 验证
9. 手动发送测试事件，确认端到端流程正常

---

## 9. 验证方式

### 0A: IntentClassifier 移除

| 验证项 | 方法 |
|--------|------|
| 编译通过 | `bun run lint` 无错误 |
| 现有测试通过 | `bun run test:run` 全绿 |
| Meego 工单事件可正常 spawn Agent | 手动触发 `issue.created` 事件，观察日志确认 Agent 启动（不经过意图分类） |
| Lark @mention 路径不受影响 | 群聊 @机器人，确认 Agent 启动且收到回复 |
| IntentClassifier 仍可独立使用 | `import { IntentClassifier } from "@teamsland/ingestion"` 编译通过 |

### 0B: Assembler 简化

| 验证项 | 方法 |
|--------|------|
| prompt 只有 3 段 | 启动 Agent，在日志中检查 prompt 内容只含 §A/§B/§D |
| prompt.sections span attribute = 3 | 检查 tracing span 中的 `prompt.sections` 属性 |
| 不再有 "§C" 和 "§E" 关键字 | `grep -r "§C\|§E\|sectionC\|sectionE" packages/context/src/assembler.ts` 无结果 |

### 0C: Swarm deprecated

| 验证项 | 方法 |
|--------|------|
| 不再有 Swarm 分支 | `grep -r "shouldUseSwarm\|dispatchSwarm" apps/server/` 无结果 |
| deprecated 标记存在 | `grep -r "@deprecated" packages/swarm/src/` 每个导出文件至少一个 |

### 0D: PersistentQueue

| 验证项 | 方法 |
|--------|------|
| 单元测试全部通过 | `bun run test:run --filter queue` 全绿 |
| enqueue → dequeue 基本流程 | 测试用例覆盖 |
| priority 排序正确 | 测试用例: enqueue high/normal/low → dequeue 顺序为 high, normal, low |
| ack 后消息不再被 dequeue | 测试用例覆盖 |
| nack 后 retryCount 递增 | 测试用例覆盖 |
| 超过 maxRetries 进入 dead letter | 测试用例覆盖 |
| visibility timeout 恢复 | 测试用例: dequeue 后不 ack，调用 recoverTimeouts，消息恢复为 pending |
| trace_id 去重 | 测试用例: 相同 trace_id 入队两次，只有一条 |
| 数据库持久化 | 测试用例: 关闭 + 重新打开同一数据库文件，消息仍在 |
| WAL 模式生效 | 测试用例: 检查 `PRAGMA journal_mode` 返回 `wal` |

### 0E: 事件流重布线

| 验证项 | 方法 |
|--------|------|
| LarkConnector 事件进入 queue | 发送 @mention，检查 `queue.stats()` 中 pending 数增加 |
| MeegoConnector 事件进入 queue | 触发 Meego 事件，检查 queue 表数据 |
| 队列消费者正确分发 | 观察日志：消费者 switch case 命中对应类型 |
| 端到端 Lark @mention 正常 | @机器人发消息 → 队列入队 → 消费者处理 → Agent 启动 → 群聊回复 |
| 端到端 Meego 工单正常 | 创建工单 → 队列入队 → 消费者处理 → Agent 启动 |
| 队列崩溃恢复 | 入队后 kill 进程 → 重启 → 消费者继续消费队列中的消息 |
| MeegoEventBus 标记 deprecated | `grep "@deprecated" packages/meego/src/event-bus.ts` 有结果 |

---

## 10. 风险点

### 风险 1: 移除 IntentClassifier 后 Meego 工单噪音增加

**现象**: 之前 IntentClassifier 的 confidence < 0.5 会过滤低质量事件。移除后所有 Meego 工单都会 spawn Agent。

**应对**:
- Phase 0 暂时接受这个行为变化 — 因为目标架构中 Coordinator 会承担意图判断职责
- 短期缓解: 在 `processMeegoTicket()` 中增加简单的白名单过滤（只处理特定 Meego space/project 的事件）
- 这是有意为之的设计: PRODUCT.md 明确指出"意图理解是 Claude 本身擅长的，不应该用外部规则引擎替它做决策"

### 风险 2: SQLite WAL 并发写入冲突

**现象**: Connector 入队（写）和消费者处理（读+写）并发操作同一个 SQLite 文件，可能出现 `SQLITE_BUSY`。

**应对**:
- WAL 模式天然支持一写多读
- 设置 `busy_timeout = 5000ms`，足以处理短暂的写锁等待
- dequeue 使用 `BEGIN IMMEDIATE` 事务，确保原子性
- 单进程架构下不会有多写者竞争（一个 server 进程 = 一个写者）

### 风险 3: 消费者处理速度跟不上入队速度

**现象**: 大量事件同时到达，队列积压。

**应对**:
- 优先级机制: Lark @mention 设为 high，Meego 批量轮询设为 normal
- `pollIntervalMs = 100ms` 保证 10 msg/s 的消费速率
- 队列积压监控: `stats()` 接口暴露 pending 计数，`startHealthCheck` 中新增队列深度告警
- 后续 Phase 引入 Coordinator 后，轻量事件（通知类）直接由 Hooks 层处理，不经过队列

### 风险 4: 双写过渡期数据不一致

**现象**: 0E 阶段 A 中，eventBus 和 queue 同时处理，可能出现重复 spawn。

**应对**:
- 阶段 A 中 queue 消费者只记录日志不执行，不会重复 spawn
- 阶段 B 切换是原子的: 一次代码变更移除 eventBus 路径 + 启用 queue 路径
- 如果需要更安全的过渡: 可以用 feature flag（环境变量 `TEAMSLAND_USE_QUEUE=1`）控制

### 风险 5: 消息负载序列化/反序列化类型安全

**现象**: `QueuePayload` 存储为 JSON 字符串，反序列化后类型信息丢失，消费者需要 type assertion。

**应对**:
- 使用 `msg.type` 字段作为 discriminant，在 switch 中做 type narrowing
- 编写 runtime 校验函数 `assertLarkMentionPayload(payload: unknown): asserts payload is LarkMentionPayload`
- 在入队时校验 payload 结构，拒绝不合规消息
- 消费者中使用 `as` type assertion 前先做 runtime check，不合格的消息 nack 并记录错误

### 风险 6: Swarm 包测试引用了被移除的代码路径

**现象**: `packages/swarm/src/__tests__/` 中的测试可能引用了 event-handlers 中的 Swarm 调用。

**应对**:
- Swarm 包本身的单元测试（`swarm.test.ts`, `worker.test.ts`, `task-planner.test.ts`）不受影响 — 它们测试的是包内部逻辑
- 需要检查是否有 server 级集成测试引用了 `shouldUseSwarm` / `dispatchSwarm`，如有则更新或删除

### 风险 7: LarkConnector 接口变更导致现有测试失败

**现象**: `LarkConnectorOpts` 新增/替换字段后，已有的 `LarkConnector` 测试需要更新 mock。

**应对**:
- 0E 阶段 A 使用可选字段（`enqueue?`）渐进式引入，不破坏现有测试
- 阶段 B 切换时统一更新测试 mock
- `packages/lark/src/__tests__/` 中的测试需要同步更新

---

## 附录 A: 文件改动汇总表

| 文件路径 | Phase | 操作 |
|----------|-------|------|
| `apps/server/src/event-handlers.ts` | 0A, 0C, 0E | 修改 |
| `apps/server/src/main.ts` | 0A, 0B, 0C, 0E | 修改 |
| `packages/context/src/assembler.ts` | 0B | 修改 |
| `packages/context/src/template-loader.ts` | 0B | 标记 deprecated |
| `packages/types/src/config.ts` | 0B, 0E | 修改 |
| `packages/config/src/schema.ts` | 0B, 0E | 修改 |
| `packages/swarm/src/index.ts` | 0C | 标记 deprecated |
| `packages/swarm/src/swarm.ts` | 0C | 标记 deprecated |
| `packages/swarm/src/worker.ts` | 0C | 标记 deprecated |
| `packages/swarm/src/task-planner.ts` | 0C | 标记 deprecated |
| `packages/swarm/package.json` | 0C | 修改 |
| `packages/queue/` (全部) | 0D | 新建 |
| `packages/lark/src/connector.ts` | 0E | 修改 |
| `packages/meego/src/connector.ts` | 0E | 修改 |
| `packages/meego/src/event-bus.ts` | 0E | 标记 deprecated |
| `config/config.json` | 0E | 修改 |
| `package.json` (根) | 0D | 修改 |

## 附录 B: 配置变更

### config/config.json 新增段

```json
{
  "queue": {
    "dbPath": "data/queue.sqlite",
    "busyTimeoutMs": 5000,
    "visibilityTimeoutMs": 60000,
    "maxRetries": 3,
    "deadLetterEnabled": true,
    "pollIntervalMs": 100
  }
}
```

### AppConfig 类型变更

```typescript
export interface AppConfig {
  meego: MeegoConfig;
  lark: LarkConfig;
  session: SessionConfig;
  sidecar: SidecarConfig;
  memory: MemoryConfig;
  storage: StorageConfig;
  confirmation: ConfirmationConfig;
  dashboard: DashboardConfig;
  repoMapping: RepoMappingConfig;
  skillRouting: SkillRoutingConfig;
  // 移除: templateBasePath?: string;
  llm?: LlmConfig;
  queue?: QueueConfig;  // 新增
}
```

## 附录 C: 依赖关系图

```
@teamsland/queue (新)
  ├── bun:sqlite (runtime)
  ├── @teamsland/observability (日志)
  └── @teamsland/types (MeegoEvent 类型)

@teamsland/lark (修改)
  ├── @teamsland/queue (新增: EnqueueOptions 类型)  // 或通过回调函数注入，无直接依赖
  └── ... (其他不变)

@teamsland/meego (修改)
  ├── @teamsland/queue (新增: EnqueueOptions 类型)  // 同上
  └── ... (其他不变)
```

**注意**: 为避免 `@teamsland/lark` 和 `@teamsland/meego` 对 `@teamsland/queue` 的直接依赖，Connector 通过回调函数 `enqueue: (opts: EnqueueOptions) => string` 注入队列能力。`EnqueueOptions` 类型定义在 `@teamsland/queue` 包中，但 Connector 只在构造函数签名中引用此类型。由于 TypeScript 的结构类型系统，Connector 也可以直接定义兼容的内联类型，完全解除编译期依赖。

**推荐做法**: 在 `@teamsland/types` 中定义一个通用的 `EnqueueFn` 类型签名，Connector 和 Queue 都引用此类型，避免循环依赖。

```typescript
// packages/types/src/queue.ts (新建)

/**
 * 入队函数签名
 *
 * 由 PersistentQueue.enqueue 实现，注入给 Connector。
 * 定义在 types 包中以避免 Connector → Queue 的直接依赖。
 *
 * @example
 * ```typescript
 * import type { EnqueueFn } from "@teamsland/types";
 *
 * const enqueue: EnqueueFn = (opts) => queue.enqueue(opts);
 * ```
 */
export type EnqueueFn = (opts: {
  type: string;
  payload: unknown;
  priority?: string;
  scheduledAt?: number;
  maxRetries?: number;
  traceId?: string;
}) => string;
```
