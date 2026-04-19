# @teamsland/types — 共享类型定义包设计

> 日期：2026-04-19
> 状态：已批准
> 关联架构文档：[02-核心类型与团队记忆层](../../02-core-types-and-memory.md)

## 概述

`@teamsland/types` 是 monorepo 中所有包的依赖根节点，提供全系统共享的 TypeScript 类型定义。该包只包含 `interface`、`type alias` 和必要的字面量联合类型——不导出 class、常量或任何运行时代码。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 包内容 | 纯类型定义（interface / type alias） | 零运行时依赖，零副作用；下游包通过 `import type` 导入 |
| MemoryEntry 的 toDict/toVectorPoint | 保留为接口方法签名 | 具体实现由 `@teamsland/memory` 提供 |
| 文件组织 | 按领域分文件 | 避免单文件膨胀，符合 CLAUDE.md 800 行上限 |
| 配置类型 | 统一在 config.ts 中定义 | 与 11 个 YAML 配置文件一一对应，供 `@teamsland/config` 做类型安全返回 |
| 测试策略 | 仅 `tsc --noEmit` 类型检查 | 纯类型包无运行时行为可测试 |

## 文件结构

```
packages/types/src/
├── index.ts          # barrel re-export
├── memory.ts         # 记忆系统类型
├── message.ts        # 团队通讯消息
├── meego.ts          # Meego 事件与处理器
├── task.ts           # 任务配置与 Swarm 结果
├── sidecar.ts        # Agent 注册表与进程状态
├── context.ts        # 请求上下文、意图分类
└── config.ts         # 所有 YAML 配置对应的类型
```

## 类型清单

### memory.ts

```typescript
/**
 * 记忆类型枚举（12 类）
 * 来源：架构文档 §2.0 核心类型定义
 */
export type MemoryType =
  | "profile" | "preferences" | "entities" | "events"
  | "cases" | "patterns" | "tools" | "skills"
  | "decisions" | "project_context" | "soul" | "identity";

/**
 * 记忆条目
 * toDict() 和 toVectorPoint() 为方法签名，具体实现在 @teamsland/memory
 */
export interface MemoryEntry {
  id: string;
  teamId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
  toDict(): Record<string, unknown>;
  toVectorPoint(): { id: string; vector: number[]; payload: Record<string, unknown> };
}

/**
 * 记忆存储抽象
 */
export interface AbstractMemoryStore {
  vectorSearch(queryVec: number[], limit?: number): Promise<MemoryEntry[]>;
  writeEntry(entry: MemoryEntry): Promise<void>;
  exists(teamId: string, hash: string): Promise<boolean>;
  listAbstracts(teamId: string): Promise<MemoryEntry[]>;
}
```

### message.ts

```typescript
export type TeamMessageType = "task_result" | "delegation" | "status_update" | "query";

export interface TeamMessage {
  traceId: string;
  fromAgent: string;
  toAgent: string;
  type: TeamMessageType;
  payload: unknown;
  timestamp: number;
}
```

### meego.ts

```typescript
export type MeegoEventType =
  | "issue.created" | "issue.status_changed"
  | "issue.assigned" | "sprint.started";

export interface MeegoEvent {
  eventId: string;
  issueId: string;
  projectKey: string;
  type: MeegoEventType;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface EventHandler {
  process(event: MeegoEvent): Promise<void>;
}
```

### task.ts

```typescript
import type { MeegoEvent } from "./meego.js";

export interface TaskConfig {
  issueId: string;
  meegoEvent: MeegoEvent;
  meegoProjectId: string;
  description: string;
  triggerType: string;
  agentRole: string;
  worktreePath: string;
  assigneeId: string;
}

export interface ComplexTask extends TaskConfig {
  subtasks: TaskConfig[];
}

export interface SwarmResult {
  taskId: string;
  outputs: Record<string, unknown>[];
  failures: string[];
  successRatio: number;
}
```

### sidecar.ts

```typescript
export type AgentStatus = "running" | "completed" | "failed";

export interface AgentRecord {
  agentId: string;
  pid: number;
  sessionId: string;
  issueId: string;
  worktreePath: string;
  status: AgentStatus;
  retryCount: number;
  createdAt: number;
}

export interface RegistryState {
  agents: AgentRecord[];
  updatedAt: number;
}
```

### context.ts

```typescript
export interface RequestContext {
  userId: string;
  agentId: string;
  teamId: string;
}

export type IntentType =
  | "frontend_dev" | "tech_spec" | "design"
  | "query" | "status_sync" | "confirm";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: {
    modules: string[];
    owners: string[];
    domains: string[];
  };
}
```

### config.ts

与 11 个 YAML 配置文件一一对应：

```typescript
// --- meego.yaml ---
export interface MeegoSpaceConfig {
  spaceId: string;
  name: string;
}
export type MeegoEventMode = "webhook" | "poll" | "both";
export interface MeegoWebhookConfig {
  host: string;
  port: number;
  path: string;
}
export interface MeegoPollConfig {
  intervalSeconds: number;
  lookbackMinutes: number;
}
export interface MeegoLongConnectionConfig {
  enabled: boolean;
  reconnectIntervalSeconds: number;
}
export interface MeegoConfig {
  spaces: MeegoSpaceConfig[];
  eventMode: MeegoEventMode;
  webhook: MeegoWebhookConfig;
  poll: MeegoPollConfig;
  longConnection: MeegoLongConnectionConfig;
}

// --- lark.yaml ---
export interface LarkBotConfig {
  historyContextCount: number;
}
export interface LarkNotificationConfig {
  teamChannelId: string;
}
export interface LarkConfig {
  appId: string;
  appSecret: string;
  bot: LarkBotConfig;
  notification: LarkNotificationConfig;
}

// --- session.yaml ---
export interface SessionConfig {
  compactionTokenThreshold: number;
  sqliteJitterRangeMs: [number, number];
  busyTimeoutMs: number;
}

// --- sidecar.yaml ---
export interface SidecarConfig {
  maxConcurrentSessions: number;
  maxRetryCount: number;
  maxDelegateDepth: number;
  workerTimeoutSeconds: number;
  healthCheckTimeoutMs: number;
  minSwarmSuccessRatio: number;
}

// --- memory.yaml ---
export interface MemoryConfig {
  decayHalfLifeDays: number;
  extractLoopMaxIterations: number;
}

// --- storage.yaml ---
export interface SqliteVecConfig {
  dbPath: string;
  busyTimeoutMs: number;
  vectorDimensions: number;
}
export interface EmbeddingConfig {
  model: string;
  contextSize: number;
}
export interface EntityMergeConfig {
  cosineThreshold: number;
}
export interface Fts5Config {
  optimizeIntervalHours: number;
}
export interface StorageConfig {
  sqliteVec: SqliteVecConfig;
  embedding: EmbeddingConfig;
  entityMerge: EntityMergeConfig;
  fts5: Fts5Config;
}

// --- confirmation.yaml ---
export interface ConfirmationConfig {
  reminderIntervalMin: number;
  maxReminders: number;
  pollIntervalMs: number;
}

// --- dashboard.yaml ---
export interface DashboardAuthConfig {
  provider: string;
  sessionTtlHours: number;
  allowedDepartments: string[];
}
export interface DashboardConfig {
  port: number;
  auth: DashboardAuthConfig;
}

// --- repo_mapping.yaml ---
export interface RepoEntry {
  path: string;
  name: string;
}
export interface RepoMappingEntry {
  meegoProjectId: string;
  repos: RepoEntry[];
}
export type RepoMappingConfig = RepoMappingEntry[];

// --- skill_routing.yaml ---
export type SkillRoutingConfig = Record<string, string[]>;

// --- 聚合根类型 ---
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
}
```

### index.ts

barrel re-export，聚合所有子模块的导出：

```typescript
export type { MemoryType, MemoryEntry, AbstractMemoryStore } from "./memory.js";
export type { TeamMessageType, TeamMessage } from "./message.js";
export type { MeegoEventType, MeegoEvent, EventHandler } from "./meego.js";
export type { TaskConfig, ComplexTask, SwarmResult } from "./task.js";
export type { AgentStatus, AgentRecord, RegistryState } from "./sidecar.js";
export type { RequestContext, IntentType, IntentResult } from "./context.js";
export type {
  // meego config
  MeegoSpaceConfig, MeegoEventMode, MeegoWebhookConfig,
  MeegoPollConfig, MeegoLongConnectionConfig, MeegoConfig,
  // lark config
  LarkBotConfig, LarkNotificationConfig, LarkConfig,
  // session/sidecar/memory config
  SessionConfig, SidecarConfig, MemoryConfig,
  // storage config
  SqliteVecConfig, EmbeddingConfig, EntityMergeConfig, Fts5Config, StorageConfig,
  // confirmation/dashboard config
  ConfirmationConfig, DashboardAuthConfig, DashboardConfig,
  // repo mapping / skill routing
  RepoEntry, RepoMappingEntry, RepoMappingConfig, SkillRoutingConfig,
  // root config
  AppConfig,
} from "./config.js";
```

## 验证标准

- `bun run typecheck` 通过（零错误）
- `bun run lint` 通过（Biome 严格规则）
- 所有导出类型均有中文 JSDoc + `@example`
- 无运行时代码、无 `any`、无 `!` 非空断言
