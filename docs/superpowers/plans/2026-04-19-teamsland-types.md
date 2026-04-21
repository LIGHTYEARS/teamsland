# @teamsland/types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/types` package — the shared TypeScript type definitions that every other package in the monorepo depends on. This is a pure-type package: interfaces, type aliases, and literal union types only. No runtime code.

**Architecture:** 8 source files organized by domain (memory, message, meego, task, sidecar, context, config) plus a barrel `index.ts`. Each file corresponds to a section of the architecture design spec. All exports use `export type` to satisfy Biome's `useExportType` rule. All cross-file imports use `import type`. Every exported type has a Chinese JSDoc with at least one `@example` block.

**Tech Stack:** TypeScript (strict), Bun, Biome 2.x (lint/format)

---

## File Map

### Files to create (replacing placeholder)

| File | Responsibility |
|------|---------------|
| `packages/types/src/memory.ts` | `MemoryType`, `MemoryEntry`, `AbstractMemoryStore` |
| `packages/types/src/message.ts` | `TeamMessageType`, `TeamMessage` |
| `packages/types/src/meego.ts` | `MeegoEventType`, `MeegoEvent`, `EventHandler` |
| `packages/types/src/task.ts` | `TaskConfig`, `ComplexTask`, `SwarmResult` |
| `packages/types/src/sidecar.ts` | `AgentStatus`, `AgentRecord`, `RegistryState` |
| `packages/types/src/context.ts` | `RequestContext`, `IntentType`, `IntentResult` |
| `packages/types/src/config.ts` | All YAML config types + `AppConfig` root |
| `packages/types/src/index.ts` | Barrel re-export of all types from all modules |

### Files to modify

None — this is a greenfield package. The existing `packages/types/src/index.ts` placeholder will be replaced.

---

### Task 1: memory.ts — Memory system types

**Files:**
- Create: `packages/types/src/memory.ts`

- [ ] **Step 1: Create `packages/types/src/memory.ts`**

```typescript
/**
 * 记忆类型枚举
 *
 * 团队记忆系统支持的 12 种记忆分类，覆盖从个体偏好到项目上下文的全部语义域。
 *
 * @example
 * ```typescript
 * import type { MemoryType } from "@teamsland/types";
 *
 * const category: MemoryType = "entities";
 * ```
 */
export type MemoryType =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "cases"
  | "patterns"
  | "tools"
  | "skills"
  | "decisions"
  | "project_context"
  | "soul"
  | "identity";

/**
 * 记忆条目
 *
 * 单条记忆的完整数据结构。`toDict()` 和 `toVectorPoint()` 为方法签名，
 * 具体实现由 `@teamsland/memory` 提供。
 *
 * @example
 * ```typescript
 * import type { MemoryEntry } from "@teamsland/types";
 *
 * function logEntry(entry: MemoryEntry): void {
 *   console.log(`[${entry.memoryType}] ${entry.content} (accessed ${entry.accessCount}x)`);
 * }
 * ```
 */
export interface MemoryEntry {
  /** 记忆唯一标识 */
  id: string;
  /** 所属团队 ID */
  teamId: string;
  /** 所属 Agent ID */
  agentId: string;
  /** 记忆分类 */
  memoryType: MemoryType;
  /** 记忆文本内容 */
  content: string;
  /** 访问计数，用于热度衰减计算 */
  accessCount: number;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 可选的扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 序列化为普通对象 */
  toDict(): Record<string, unknown>;
  /** 转换为向量存储点 */
  toVectorPoint(): { id: string; vector: number[]; payload: Record<string, unknown> };
}

/**
 * 记忆存储抽象接口
 *
 * 定义记忆读写的核心操作。具体实现（SQLite + Qdrant 混合存储）
 * 由 `@teamsland/memory` 包提供。
 *
 * @example
 * ```typescript
 * import type { AbstractMemoryStore, MemoryEntry } from "@teamsland/types";
 *
 * async function search(store: AbstractMemoryStore, vec: number[]): Promise<MemoryEntry[]> {
 *   return store.vectorSearch(vec, 10);
 * }
 * ```
 */
export interface AbstractMemoryStore {
  /** 向量相似度搜索 */
  vectorSearch(queryVec: number[], limit?: number): Promise<MemoryEntry[]>;
  /** 写入一条记忆 */
  writeEntry(entry: MemoryEntry): Promise<void>;
  /** 检查记忆是否已存在（按团队 + 内容哈希去重） */
  exists(teamId: string, hash: string): Promise<boolean>;
  /** 列出团队下所有记忆的摘要 */
  listAbstracts(teamId: string): Promise<MemoryEntry[]>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors (the file only exports types, no runtime code).

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/memory.ts`
Expected: no errors.

---

### Task 2: message.ts — Team communication types

**Files:**
- Create: `packages/types/src/message.ts`

- [ ] **Step 1: Create `packages/types/src/message.ts`**

```typescript
/**
 * 团队消息类型枚举
 *
 * Agent 间通讯的消息分类。
 *
 * @example
 * ```typescript
 * import type { TeamMessageType } from "@teamsland/types";
 *
 * const msgType: TeamMessageType = "task_result";
 * ```
 */
export type TeamMessageType = "task_result" | "delegation" | "status_update" | "query";

/**
 * 团队消息
 *
 * Agent 间传递的结构化消息，通过 `ObservableMessageBus` 路由。
 *
 * @example
 * ```typescript
 * import type { TeamMessage } from "@teamsland/types";
 *
 * const msg: TeamMessage = {
 *   traceId: "trace-001",
 *   fromAgent: "agent-a",
 *   toAgent: "agent-b",
 *   type: "delegation",
 *   payload: { issueId: "ISSUE-42" },
 *   timestamp: Date.now(),
 * };
 * ```
 */
export interface TeamMessage {
  /** 链路追踪 ID */
  traceId: string;
  /** 发送方 Agent ID */
  fromAgent: string;
  /** 接收方 Agent ID */
  toAgent: string;
  /** 消息类型 */
  type: TeamMessageType;
  /** 消息负载 */
  payload: unknown;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/message.ts`
Expected: no errors.

---

### Task 3: meego.ts — Meego event types

**Files:**
- Create: `packages/types/src/meego.ts`

- [ ] **Step 1: Create `packages/types/src/meego.ts`**

```typescript
/**
 * Meego 事件类型枚举
 *
 * Meego 项目管理工具推送的事件分类。
 *
 * @example
 * ```typescript
 * import type { MeegoEventType } from "@teamsland/types";
 *
 * const eventType: MeegoEventType = "issue.created";
 * ```
 */
export type MeegoEventType =
  | "issue.created"
  | "issue.status_changed"
  | "issue.assigned"
  | "sprint.started";

/**
 * Meego 事件
 *
 * 从 Meego webhook / 轮询 / 长连接接收到的原始事件数据。
 *
 * @example
 * ```typescript
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * const event: MeegoEvent = {
 *   eventId: "evt-001",
 *   issueId: "ISSUE-42",
 *   projectKey: "FE",
 *   type: "issue.created",
 *   payload: { title: "新增登录页面" },
 *   timestamp: Date.now(),
 * };
 * ```
 */
export interface MeegoEvent {
  /** 事件唯一 ID */
  eventId: string;
  /** 关联的 Issue ID */
  issueId: string;
  /** 项目标识 */
  projectKey: string;
  /** 事件类型 */
  type: MeegoEventType;
  /** 事件原始负载 */
  payload: Record<string, unknown>;
  /** Unix 毫秒时间戳 */
  timestamp: number;
}

/**
 * 事件处理器接口
 *
 * 由 `MeegoEventBus` 调度，每种事件类型对应一个处理器实现。
 *
 * @example
 * ```typescript
 * import type { EventHandler, MeegoEvent } from "@teamsland/types";
 *
 * const handler: EventHandler = {
 *   async process(event: MeegoEvent): Promise<void> {
 *     console.log(`处理事件: ${event.type} for ${event.issueId}`);
 *   },
 * };
 * ```
 */
export interface EventHandler {
  /** 处理单个 Meego 事件 */
  process(event: MeegoEvent): Promise<void>;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/meego.ts`
Expected: no errors.

- [ ] **Step 4: Commit Tasks 1-3**

```bash
git add packages/types/src/memory.ts packages/types/src/message.ts packages/types/src/meego.ts
git commit -m "feat(types): add memory, message, and meego type definitions"
```

---

### Task 4: task.ts — Task and Swarm types

**Files:**
- Create: `packages/types/src/task.ts`

- [ ] **Step 1: Create `packages/types/src/task.ts`**

```typescript
import type { MeegoEvent } from "./meego.js";

/**
 * 任务配置
 *
 * 描述一个待执行任务的完整上下文，由 Meego 事件触发后组装。
 *
 * @example
 * ```typescript
 * import type { TaskConfig, MeegoEvent } from "@teamsland/types";
 *
 * const task: TaskConfig = {
 *   issueId: "ISSUE-42",
 *   meegoEvent: {} as MeegoEvent,
 *   meegoProjectId: "project_xxx",
 *   description: "实现登录页面",
 *   triggerType: "issue.created",
 *   agentRole: "frontend_dev",
 *   worktreePath: "/tmp/worktrees/issue-42",
 *   assigneeId: "user-001",
 * };
 * ```
 */
export interface TaskConfig {
  /** 关联的 Issue ID */
  issueId: string;
  /** 触发此任务的 Meego 事件 */
  meegoEvent: MeegoEvent;
  /** Meego 项目 ID，用于查找 repo 映射 */
  meegoProjectId: string;
  /** 任务描述 */
  description: string;
  /** 触发类型（对应 MeegoEventType） */
  triggerType: string;
  /** Agent 角色 */
  agentRole: string;
  /** Git worktree 路径 */
  worktreePath: string;
  /** 指派人 ID */
  assigneeId: string;
}

/**
 * 复杂任务（可拆分为子任务）
 *
 * 由 Architect Agent 拆解后的任务，包含多个子任务供 Worker Swarm 并行执行。
 *
 * @example
 * ```typescript
 * import type { ComplexTask, TaskConfig, MeegoEvent } from "@teamsland/types";
 *
 * const complex: ComplexTask = {
 *   issueId: "ISSUE-42",
 *   meegoEvent: {} as MeegoEvent,
 *   meegoProjectId: "project_xxx",
 *   description: "重构认证模块",
 *   triggerType: "issue.created",
 *   agentRole: "frontend_dev",
 *   worktreePath: "/tmp/worktrees/issue-42",
 *   assigneeId: "user-001",
 *   subtasks: [],
 * };
 * ```
 */
export interface ComplexTask extends TaskConfig {
  /** 拆分后的子任务列表 */
  subtasks: TaskConfig[];
}

/**
 * Swarm 执行结果
 *
 * 多 Agent 并行执行后的聚合结果，包含成功率和失败详情。
 *
 * @example
 * ```typescript
 * import type { SwarmResult } from "@teamsland/types";
 *
 * const result: SwarmResult = {
 *   taskId: "ISSUE-42",
 *   outputs: [{ summary: "页面拆分完成" }],
 *   failures: [],
 *   successRatio: 1.0,
 * };
 * ```
 */
export interface SwarmResult {
  /** 任务 ID */
  taskId: string;
  /** 各 Worker 的输出 */
  outputs: Record<string, unknown>[];
  /** 失败的 Worker 错误信息 */
  failures: string[];
  /** 成功率（0.0 ~ 1.0） */
  successRatio: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/task.ts`
Expected: no errors.

---

### Task 5: sidecar.ts — Agent registry types

**Files:**
- Create: `packages/types/src/sidecar.ts`

- [ ] **Step 1: Create `packages/types/src/sidecar.ts`**

```typescript
/**
 * Agent 运行状态枚举
 *
 * @example
 * ```typescript
 * import type { AgentStatus } from "@teamsland/types";
 *
 * const status: AgentStatus = "running";
 * ```
 */
export type AgentStatus = "running" | "completed" | "failed";

/**
 * Agent 注册记录
 *
 * SubagentRegistry 中保存的单个 Agent 进程信息，
 * 序列化到 `registry.json` 用于崩溃恢复。
 *
 * @example
 * ```typescript
 * import type { AgentRecord } from "@teamsland/types";
 *
 * const record: AgentRecord = {
 *   agentId: "agent-001",
 *   pid: 12345,
 *   sessionId: "session-abc",
 *   issueId: "ISSUE-42",
 *   worktreePath: "/tmp/worktrees/issue-42",
 *   status: "running",
 *   retryCount: 0,
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface AgentRecord {
  /** Agent 唯一标识 */
  agentId: string;
  /** 操作系统进程 ID */
  pid: number;
  /** 关联的 tmux session ID */
  sessionId: string;
  /** 关联的 Issue ID */
  issueId: string;
  /** Git worktree 路径 */
  worktreePath: string;
  /** 当前运行状态 */
  status: AgentStatus;
  /** 已重试次数 */
  retryCount: number;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
}

/**
 * 注册表状态快照
 *
 * 所有活跃 Agent 的完整状态，原子写入 `registry.json`。
 *
 * @example
 * ```typescript
 * import type { RegistryState } from "@teamsland/types";
 *
 * const state: RegistryState = {
 *   agents: [],
 *   updatedAt: Date.now(),
 * };
 * ```
 */
export interface RegistryState {
  /** 所有 Agent 记录 */
  agents: AgentRecord[];
  /** 最后更新时间（Unix 毫秒时间戳） */
  updatedAt: number;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/sidecar.ts`
Expected: no errors.

---

### Task 6: context.ts — Request context and intent types

**Files:**
- Create: `packages/types/src/context.ts`

- [ ] **Step 1: Create `packages/types/src/context.ts`**

```typescript
/**
 * 请求上下文
 *
 * 贯穿整个请求生命周期的身份信息，用于隔离不同团队/Agent 的数据。
 *
 * @example
 * ```typescript
 * import type { RequestContext } from "@teamsland/types";
 *
 * const ctx: RequestContext = {
 *   userId: "user-001",
 *   agentId: "agent-frontend",
 *   teamId: "team-alpha",
 * };
 * ```
 */
export interface RequestContext {
  /** 发起请求的用户 ID */
  userId: string;
  /** 处理请求的 Agent ID */
  agentId: string;
  /** 所属团队 ID（二维隔离的关键维度） */
  teamId: string;
}

/**
 * 意图分类枚举
 *
 * IntentClassifier 输出的意图类型，决定后续的处理管线。
 *
 * @example
 * ```typescript
 * import type { IntentType } from "@teamsland/types";
 *
 * const intent: IntentType = "frontend_dev";
 * ```
 */
export type IntentType =
  | "frontend_dev"
  | "tech_spec"
  | "design"
  | "query"
  | "status_sync"
  | "confirm";

/**
 * 意图分类结果
 *
 * IntentClassifier 的输出，包含意图类型、置信度和提取的实体。
 *
 * @example
 * ```typescript
 * import type { IntentResult } from "@teamsland/types";
 *
 * const result: IntentResult = {
 *   type: "frontend_dev",
 *   confidence: 0.92,
 *   entities: {
 *     modules: ["login-page"],
 *     owners: ["user-001"],
 *     domains: ["auth"],
 *   },
 * };
 * ```
 */
export interface IntentResult {
  /** 分类出的意图类型 */
  type: IntentType;
  /** 置信度（0.0 ~ 1.0） */
  confidence: number;
  /** 从输入中提取的实体 */
  entities: {
    /** 涉及的模块列表 */
    modules: string[];
    /** 涉及的负责人 */
    owners: string[];
    /** 涉及的业务域 */
    domains: string[];
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/context.ts`
Expected: no errors.

- [ ] **Step 4: Commit Tasks 4-6**

```bash
git add packages/types/src/task.ts packages/types/src/sidecar.ts packages/types/src/context.ts
git commit -m "feat(types): add task, sidecar, and context type definitions"
```

---

### Task 7: config.ts — Configuration types for all 11 YAML files

**Files:**
- Create: `packages/types/src/config.ts`

This is the largest file. It defines TypeScript interfaces matching each YAML config file's structure, plus the `AppConfig` aggregate root. The `test.yaml` config is excluded from the aggregate root because it's only used in test infrastructure — a `TestConfig` type is defined standalone.

- [ ] **Step 1: Create `packages/types/src/config.ts`**

```typescript
// ─── meego.yaml ───

/**
 * Meego Space 配置
 *
 * 单个 Meego 空间的标识信息。
 *
 * @example
 * ```typescript
 * import type { MeegoSpaceConfig } from "@teamsland/types";
 *
 * const space: MeegoSpaceConfig = { spaceId: "xxx", name: "开放平台前端" };
 * ```
 */
export interface MeegoSpaceConfig {
  /** 空间 ID */
  spaceId: string;
  /** 空间名称 */
  name: string;
}

/**
 * Meego 事件接入模式
 *
 * @example
 * ```typescript
 * import type { MeegoEventMode } from "@teamsland/types";
 *
 * const mode: MeegoEventMode = "both";
 * ```
 */
export type MeegoEventMode = "webhook" | "poll" | "both";

/**
 * Meego Webhook 配置
 *
 * @example
 * ```typescript
 * import type { MeegoWebhookConfig } from "@teamsland/types";
 *
 * const webhook: MeegoWebhookConfig = { host: "0.0.0.0", port: 8080, path: "/meego/webhook" };
 * ```
 */
export interface MeegoWebhookConfig {
  /** 监听地址 */
  host: string;
  /** 监听端口 */
  port: number;
  /** Webhook 路径 */
  path: string;
}

/**
 * Meego 轮询配置
 *
 * @example
 * ```typescript
 * import type { MeegoPollConfig } from "@teamsland/types";
 *
 * const poll: MeegoPollConfig = { intervalSeconds: 60, lookbackMinutes: 5 };
 * ```
 */
export interface MeegoPollConfig {
  /** 轮询间隔（秒） */
  intervalSeconds: number;
  /** 回溯窗口（分钟） */
  lookbackMinutes: number;
}

/**
 * Meego 长连接配置
 *
 * @example
 * ```typescript
 * import type { MeegoLongConnectionConfig } from "@teamsland/types";
 *
 * const lc: MeegoLongConnectionConfig = { enabled: true, reconnectIntervalSeconds: 10 };
 * ```
 */
export interface MeegoLongConnectionConfig {
  /** 是否启用长连接 */
  enabled: boolean;
  /** 断线重连间隔（秒） */
  reconnectIntervalSeconds: number;
}

/**
 * Meego 完整配置
 *
 * 对应 `config/meego.yaml`。
 *
 * @example
 * ```typescript
 * import type { MeegoConfig } from "@teamsland/types";
 *
 * const config: MeegoConfig = {
 *   spaces: [{ spaceId: "xxx", name: "前端" }],
 *   eventMode: "both",
 *   webhook: { host: "0.0.0.0", port: 8080, path: "/meego/webhook" },
 *   poll: { intervalSeconds: 60, lookbackMinutes: 5 },
 *   longConnection: { enabled: true, reconnectIntervalSeconds: 10 },
 * };
 * ```
 */
export interface MeegoConfig {
  /** 监控的 Meego 空间列表 */
  spaces: MeegoSpaceConfig[];
  /** 事件接入模式 */
  eventMode: MeegoEventMode;
  /** Webhook 配置 */
  webhook: MeegoWebhookConfig;
  /** 轮询配置 */
  poll: MeegoPollConfig;
  /** 长连接配置 */
  longConnection: MeegoLongConnectionConfig;
}

// ─── lark.yaml ───

/**
 * 飞书 Bot 配置
 *
 * @example
 * ```typescript
 * import type { LarkBotConfig } from "@teamsland/types";
 *
 * const bot: LarkBotConfig = { historyContextCount: 20 };
 * ```
 */
export interface LarkBotConfig {
  /** 引用的历史消息条数 */
  historyContextCount: number;
}

/**
 * 飞书通知配置
 *
 * @example
 * ```typescript
 * import type { LarkNotificationConfig } from "@teamsland/types";
 *
 * const notif: LarkNotificationConfig = { teamChannelId: "oc_xxx" };
 * ```
 */
export interface LarkNotificationConfig {
  /** 团队通知频道 ID */
  teamChannelId: string;
}

/**
 * 飞书完整配置
 *
 * 对应 `config/lark.yaml`。
 *
 * @example
 * ```typescript
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const config: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "" },
 * };
 * ```
 */
export interface LarkConfig {
  /** 飞书应用 ID */
  appId: string;
  /** 飞书应用密钥 */
  appSecret: string;
  /** Bot 行为配置 */
  bot: LarkBotConfig;
  /** 通知配置 */
  notification: LarkNotificationConfig;
}

// ─── session.yaml ───

/**
 * Session 配置
 *
 * 对应 `config/session.yaml`。控制上下文压缩阈值和 SQLite 并发参数。
 *
 * @example
 * ```typescript
 * import type { SessionConfig } from "@teamsland/types";
 *
 * const config: SessionConfig = {
 *   compactionTokenThreshold: 80000,
 *   sqliteJitterRangeMs: [20, 150],
 *   busyTimeoutMs: 5000,
 * };
 * ```
 */
export interface SessionConfig {
  /** 触发上下文压缩的 token 阈值 */
  compactionTokenThreshold: number;
  /** SQLite WAL 写入抖动范围（毫秒），[min, max] */
  sqliteJitterRangeMs: [number, number];
  /** SQLite busy timeout（毫秒） */
  busyTimeoutMs: number;
}

// ─── sidecar.yaml ───

/**
 * Sidecar 配置
 *
 * 对应 `config/sidecar.yaml`。控制并发 Agent 数、重试策略和 Swarm 参数。
 *
 * @example
 * ```typescript
 * import type { SidecarConfig } from "@teamsland/types";
 *
 * const config: SidecarConfig = {
 *   maxConcurrentSessions: 20,
 *   maxRetryCount: 3,
 *   maxDelegateDepth: 2,
 *   workerTimeoutSeconds: 300,
 *   healthCheckTimeoutMs: 30000,
 *   minSwarmSuccessRatio: 0.5,
 * };
 * ```
 */
export interface SidecarConfig {
  /** 最大并发 Agent 数 */
  maxConcurrentSessions: number;
  /** 单个 Agent 最大重试次数 */
  maxRetryCount: number;
  /** 委派最大深度 */
  maxDelegateDepth: number;
  /** Worker 超时时间（秒） */
  workerTimeoutSeconds: number;
  /** 健康检查超时（毫秒） */
  healthCheckTimeoutMs: number;
  /** Swarm 最低成功率 */
  minSwarmSuccessRatio: number;
}

// ─── memory.yaml ───

/**
 * 记忆系统配置
 *
 * 对应 `config/memory.yaml`。控制记忆衰减和提取循环参数。
 *
 * @example
 * ```typescript
 * import type { MemoryConfig } from "@teamsland/types";
 *
 * const config: MemoryConfig = { decayHalfLifeDays: 30, extractLoopMaxIterations: 3 };
 * ```
 */
export interface MemoryConfig {
  /** 热度衰减半衰期（天） */
  decayHalfLifeDays: number;
  /** ExtractLoop 最大迭代次数 */
  extractLoopMaxIterations: number;
}

// ─── storage.yaml ───

/**
 * SQLite + sqlite-vec 存储配置
 *
 * @example
 * ```typescript
 * import type { SqliteVecConfig } from "@teamsland/types";
 *
 * const config: SqliteVecConfig = {
 *   dbPath: "./data/memory.sqlite",
 *   busyTimeoutMs: 5000,
 *   vectorDimensions: 512,
 * };
 * ```
 */
export interface SqliteVecConfig {
  /** 数据库文件路径 */
  dbPath: string;
  /** busy timeout（毫秒） */
  busyTimeoutMs: number;
  /** 向量维度 */
  vectorDimensions: number;
}

/**
 * 嵌入模型配置
 *
 * @example
 * ```typescript
 * import type { EmbeddingConfig } from "@teamsland/types";
 *
 * const config: EmbeddingConfig = {
 *   model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
 *   contextSize: 2048,
 * };
 * ```
 */
export interface EmbeddingConfig {
  /** 模型标识符 */
  model: string;
  /** 上下文窗口大小 */
  contextSize: number;
}

/**
 * 实体合并配置
 *
 * @example
 * ```typescript
 * import type { EntityMergeConfig } from "@teamsland/types";
 *
 * const config: EntityMergeConfig = { cosineThreshold: 0.95 };
 * ```
 */
export interface EntityMergeConfig {
  /** 余弦相似度合并阈值 */
  cosineThreshold: number;
}

/**
 * FTS5 全文搜索配置
 *
 * @example
 * ```typescript
 * import type { Fts5Config } from "@teamsland/types";
 *
 * const config: Fts5Config = { optimizeIntervalHours: 24 };
 * ```
 */
export interface Fts5Config {
  /** OPTIMIZE 执行间隔（小时） */
  optimizeIntervalHours: number;
}

/**
 * 存储层完整配置
 *
 * 对应 `config/storage.yaml`。
 *
 * @example
 * ```typescript
 * import type { StorageConfig } from "@teamsland/types";
 *
 * const config: StorageConfig = {
 *   sqliteVec: { dbPath: "./data/memory.sqlite", busyTimeoutMs: 5000, vectorDimensions: 512 },
 *   embedding: { model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf", contextSize: 2048 },
 *   entityMerge: { cosineThreshold: 0.95 },
 *   fts5: { optimizeIntervalHours: 24 },
 * };
 * ```
 */
export interface StorageConfig {
  /** SQLite + sqlite-vec 配置 */
  sqliteVec: SqliteVecConfig;
  /** 嵌入模型配置 */
  embedding: EmbeddingConfig;
  /** 实体合并配置 */
  entityMerge: EntityMergeConfig;
  /** FTS5 配置 */
  fts5: Fts5Config;
}

// ─── confirmation.yaml ───

/**
 * 确认机制配置
 *
 * 对应 `config/confirmation.yaml`。控制 ConfirmationWatcher 的提醒策略。
 *
 * @example
 * ```typescript
 * import type { ConfirmationConfig } from "@teamsland/types";
 *
 * const config: ConfirmationConfig = {
 *   reminderIntervalMin: 30,
 *   maxReminders: 3,
 *   pollIntervalMs: 60000,
 * };
 * ```
 */
export interface ConfirmationConfig {
  /** 提醒间隔（分钟） */
  reminderIntervalMin: number;
  /** 最大提醒次数 */
  maxReminders: number;
  /** 轮询间隔（毫秒） */
  pollIntervalMs: number;
}

// ─── dashboard.yaml ───

/**
 * Dashboard 认证配置
 *
 * @example
 * ```typescript
 * import type { DashboardAuthConfig } from "@teamsland/types";
 *
 * const auth: DashboardAuthConfig = {
 *   provider: "lark_oauth",
 *   sessionTtlHours: 8,
 *   allowedDepartments: [],
 * };
 * ```
 */
export interface DashboardAuthConfig {
  /** 认证提供者 */
  provider: string;
  /** Session 有效期（小时） */
  sessionTtlHours: number;
  /** 允许的部门列表（空 = 不限） */
  allowedDepartments: string[];
}

/**
 * Dashboard 完整配置
 *
 * 对应 `config/dashboard.yaml`。
 *
 * @example
 * ```typescript
 * import type { DashboardConfig } from "@teamsland/types";
 *
 * const config: DashboardConfig = {
 *   port: 3000,
 *   auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] },
 * };
 * ```
 */
export interface DashboardConfig {
  /** Dashboard 服务端口 */
  port: number;
  /** 认证配置 */
  auth: DashboardAuthConfig;
}

// ─── repo_mapping.yaml ───

/**
 * 仓库条目
 *
 * @example
 * ```typescript
 * import type { RepoEntry } from "@teamsland/types";
 *
 * const repo: RepoEntry = { path: "/home/user/repos/frontend", name: "前端主仓库" };
 * ```
 */
export interface RepoEntry {
  /** 本地仓库路径 */
  path: string;
  /** 仓库名称 */
  name: string;
}

/**
 * Meego 项目与仓库的映射条目
 *
 * @example
 * ```typescript
 * import type { RepoMappingEntry } from "@teamsland/types";
 *
 * const entry: RepoMappingEntry = {
 *   meegoProjectId: "project_xxx",
 *   repos: [{ path: "/home/user/repos/frontend", name: "前端主仓库" }],
 * };
 * ```
 */
export interface RepoMappingEntry {
  /** Meego 项目 ID */
  meegoProjectId: string;
  /** 关联的仓库列表 */
  repos: RepoEntry[];
}

/**
 * 仓库映射配置
 *
 * 对应 `config/repo_mapping.yaml`。项目 ID 到仓库路径的映射数组。
 *
 * @example
 * ```typescript
 * import type { RepoMappingConfig } from "@teamsland/types";
 *
 * const config: RepoMappingConfig = [
 *   { meegoProjectId: "project_xxx", repos: [{ path: "/repos/fe", name: "前端" }] },
 * ];
 * ```
 */
export type RepoMappingConfig = RepoMappingEntry[];

// ─── skill_routing.yaml ───

/**
 * 技能路由配置
 *
 * 对应 `config/skill_routing.yaml`。意图类型到可用工具列表的映射。
 *
 * @example
 * ```typescript
 * import type { SkillRoutingConfig } from "@teamsland/types";
 *
 * const config: SkillRoutingConfig = {
 *   frontend_dev: ["figma-reader", "lark-docs", "git-tools"],
 *   code_review: ["git-diff", "lark-comment"],
 * };
 * ```
 */
export type SkillRoutingConfig = Record<string, string[]>;

// ─── test.yaml (standalone, not in AppConfig) ───

/**
 * 测试配置
 *
 * 对应 `config/test.yaml`。仅在测试基础设施中使用，不包含在 AppConfig 中。
 *
 * @example
 * ```typescript
 * import type { TestConfig } from "@teamsland/types";
 *
 * const config: TestConfig = {
 *   memoryCorpusPath: "test/fixtures/corpus/",
 *   memoryQueriesPath: "test/fixtures/queries/",
 *   precisionThreshold: 0.8,
 *   sidecarRecoveryTimeoutMs: 60000,
 *   concurrentWriteAgents: 10,
 * };
 * ```
 */
export interface TestConfig {
  /** 记忆语料库路径 */
  memoryCorpusPath: string;
  /** 记忆查询集路径 */
  memoryQueriesPath: string;
  /** 精度阈值 */
  precisionThreshold: number;
  /** Sidecar 恢复超时（毫秒） */
  sidecarRecoveryTimeoutMs: number;
  /** 并发写入 Agent 数 */
  concurrentWriteAgents: number;
}

// ─── 聚合根类型 ───

/**
 * 应用完整配置
 *
 * 聚合所有配置文件的根类型，由 `@teamsland/config` 包在启动时加载并返回。
 *
 * @example
 * ```typescript
 * import type { AppConfig } from "@teamsland/types";
 *
 * function startServer(config: AppConfig): void {
 *   console.log(`Dashboard on port ${config.dashboard.port}`);
 *   console.log(`Meego mode: ${config.meego.eventMode}`);
 * }
 * ```
 */
export interface AppConfig {
  /** Meego 项目管理配置 */
  meego: MeegoConfig;
  /** 飞书配置 */
  lark: LarkConfig;
  /** Session 配置 */
  session: SessionConfig;
  /** Sidecar 配置 */
  sidecar: SidecarConfig;
  /** 记忆系统配置 */
  memory: MemoryConfig;
  /** 存储层配置 */
  storage: StorageConfig;
  /** 确认机制配置 */
  confirmation: ConfirmationConfig;
  /** Dashboard 配置 */
  dashboard: DashboardConfig;
  /** 仓库映射配置 */
  repoMapping: RepoMappingConfig;
  /** 技能路由配置 */
  skillRouting: SkillRoutingConfig;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/src/config.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/config.ts
git commit -m "feat(types): add configuration types for all 11 YAML config files"
```

---

### Task 8: index.ts — Barrel re-export

**Files:**
- Replace: `packages/types/src/index.ts`

- [ ] **Step 1: Replace `packages/types/src/index.ts` with barrel exports**

```typescript
export type { MemoryType, MemoryEntry, AbstractMemoryStore } from "./memory.js";
export type { TeamMessageType, TeamMessage } from "./message.js";
export type { MeegoEventType, MeegoEvent, EventHandler } from "./meego.js";
export type { TaskConfig, ComplexTask, SwarmResult } from "./task.js";
export type { AgentStatus, AgentRecord, RegistryState } from "./sidecar.js";
export type { RequestContext, IntentType, IntentResult } from "./context.js";
export type {
  // meego config
  MeegoSpaceConfig,
  MeegoEventMode,
  MeegoWebhookConfig,
  MeegoPollConfig,
  MeegoLongConnectionConfig,
  MeegoConfig,
  // lark config
  LarkBotConfig,
  LarkNotificationConfig,
  LarkConfig,
  // session / sidecar / memory config
  SessionConfig,
  SidecarConfig,
  MemoryConfig,
  // storage config
  SqliteVecConfig,
  EmbeddingConfig,
  EntityMergeConfig,
  Fts5Config,
  StorageConfig,
  // confirmation / dashboard config
  ConfirmationConfig,
  DashboardAuthConfig,
  DashboardConfig,
  // repo mapping / skill routing
  RepoEntry,
  RepoMappingEntry,
  RepoMappingConfig,
  SkillRoutingConfig,
  // test config (standalone)
  TestConfig,
  // root config
  AppConfig,
} from "./config.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/types && bunx tsc --noEmit`
Expected: no errors. All re-exports resolve.

- [ ] **Step 3: Run lint on entire package**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint -- packages/types/`
Expected: no errors across all 8 files.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/index.ts
git commit -m "feat(types): add barrel re-export index for all type modules"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run root-level typecheck with project references**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --build`
Expected: no errors. All 14 project references resolve (including downstream packages that depend on `@teamsland/types`).

- [ ] **Step 2: Run root-level lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint`
Expected: no errors.

- [ ] **Step 3: Verify no `any` usage**

Run: `cd /Users/bytedance/workspace/teamsland && grep -r ': any' packages/types/src/ || echo "CLEAN: no 'any' found"`
Expected: `CLEAN: no 'any' found`

- [ ] **Step 4: Verify no non-null assertions**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/types/src/ || echo "CLEAN: no '!' assertions found"`
Expected: `CLEAN: no '!' assertions found`

- [ ] **Step 5: Verify all exports have JSDoc**

Run: `cd /Users/bytedance/workspace/teamsland && grep -c '^\*\*/' packages/types/src/*.ts`
Expected: every domain file (memory, message, meego, task, sidecar, context, config) has multiple JSDoc blocks. Index.ts has none (barrel only, which is correct).

- [ ] **Step 6: Verify export count**

Run: `cd /Users/bytedance/workspace/teamsland && grep -c 'export ' packages/types/src/index.ts`
Expected: 8 (one `export type` statement per source module, some combined with commas — the barrel has 8 `export type { ... } from` statements).

- [ ] **Step 7: Count total exported types**

Run: `cd /Users/bytedance/workspace/teamsland && grep -oP '\b\w+(?=\s*[,}])' packages/types/src/index.ts | sort -u | wc -l`
Expected: 40+ unique type names.
