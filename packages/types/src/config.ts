import type { MemoryType } from "./memory.js";

// ─── meego.yaml ───

/**
 * Meego 监听空间配置
 *
 * @example
 * ```typescript
 * import type { MeegoSpaceConfig } from "@teamsland/types";
 *
 * const space: MeegoSpaceConfig = { spaceId: "xxx", name: "开放平台前端" };
 * ```
 */
export interface MeegoSpaceConfig {
  /** Meego space_id */
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
 * Meego Webhook 服务配置
 *
 * @example
 * ```typescript
 * import type { MeegoWebhookConfig } from "@teamsland/types";
 *
 * const cfg: MeegoWebhookConfig = { host: "0.0.0.0", port: 8080, path: "/meego/webhook" };
 * ```
 */
export interface MeegoWebhookConfig {
  /** 监听地址 */
  host: string;
  /** 监听端口 */
  port: number;
  /** Webhook 路径 */
  path: string;
  /** HMAC-SHA256 签名密钥（可选，未配置时跳过验签） */
  secret?: string;
}

/**
 * Meego 轮询配置
 *
 * @example
 * ```typescript
 * import type { MeegoPollConfig } from "@teamsland/types";
 *
 * const cfg: MeegoPollConfig = { intervalSeconds: 60, lookbackMinutes: 5 };
 * ```
 */
export interface MeegoPollConfig {
  /** 轮询间隔（秒） */
  intervalSeconds: number;
  /** 每次拉取最近 N 分钟的变更 */
  lookbackMinutes: number;
}

/**
 * Meego 长连接配置
 *
 * @example
 * ```typescript
 * import type { MeegoLongConnectionConfig } from "@teamsland/types";
 *
 * const cfg: MeegoLongConnectionConfig = { enabled: true, reconnectIntervalSeconds: 10 };
 * ```
 */
export interface MeegoLongConnectionConfig {
  /** 是否启用长连接 */
  enabled: boolean;
  /** 断线重连间隔（秒） */
  reconnectIntervalSeconds: number;
}

/**
 * Meego 完整配置，对应 config/meego.yaml
 *
 * @example
 * ```typescript
 * import type { MeegoConfig } from "@teamsland/types";
 *
 * const cfg: MeegoConfig = {
 *   spaces: [{ spaceId: "xxx", name: "开放平台前端" }],
 *   eventMode: "both",
 *   webhook: { host: "0.0.0.0", port: 8080, path: "/meego/webhook" },
 *   poll: { intervalSeconds: 60, lookbackMinutes: 5 },
 *   longConnection: { enabled: true, reconnectIntervalSeconds: 10 },
 * };
 * ```
 */
export interface MeegoConfig {
  /** 监听的 Meego 空间列表 */
  spaces: MeegoSpaceConfig[];
  /** 事件接入模式 */
  eventMode: MeegoEventMode;
  /** Webhook 配置 */
  webhook: MeegoWebhookConfig;
  /** 轮询配置 */
  poll: MeegoPollConfig;
  /** 长连接配置 */
  longConnection: MeegoLongConnectionConfig;
  /** Meego OpenAPI 基础地址 */
  apiBaseUrl: string;
  /** 插件访问令牌（Plugin Access Token） */
  pluginAccessToken: string;
  /** 调用者 user_key（在飞书项目中双击头像获取，API CRUD 操作必需） */
  userKey?: string;
}

// ─── lark.yaml ───

/**
 * 飞书 Bot 配置
 *
 * @example
 * ```typescript
 * import type { LarkBotConfig } from "@teamsland/types";
 *
 * const cfg: LarkBotConfig = { historyContextCount: 20 };
 * ```
 */
export interface LarkBotConfig {
  /** @mention 时读取的历史消息条数 */
  historyContextCount: number;
}

/**
 * 飞书通知配置
 *
 * @example
 * ```typescript
 * import type { LarkNotificationConfig } from "@teamsland/types";
 *
 * const cfg: LarkNotificationConfig = { teamChannelId: "oc_xxxx" };
 * ```
 */
export interface LarkNotificationConfig {
  /** 团队通知群 ID */
  teamChannelId: string;
}

/**
 * 飞书完整配置，对应 config/lark.yaml
 *
 * @example
 * ```typescript
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const cfg: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "oc_xxxx" },
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
  /** 飞书事件连接器配置（可选，启用后通过 lark-cli 订阅实时事件） */
  connector?: LarkConnectorConfig;
}

/**
 * 飞书事件连接器配置
 *
 * 通过 `lark-cli event +subscribe` 订阅飞书实时事件（WebSocket），
 * 将群聊中 @机器人 的消息桥接到现有事件管线触发 Agent。
 *
 * @example
 * ```typescript
 * import type { LarkConnectorConfig } from "@teamsland/types";
 *
 * const cfg: LarkConnectorConfig = {
 *   enabled: true,
 *   eventTypes: ["im.message.receive_v1"],
 *   chatProjectMapping: { "oc_xxx": "project_xxx" },
 * };
 * ```
 */
export interface LarkConnectorConfig {
  /** 是否启用飞书事件连接器 */
  enabled: boolean;
  /** 订阅的飞书事件类型列表 */
  eventTypes: string[];
  /** 群聊 ID → Meego 项目 ID 映射 */
  chatProjectMapping: Record<string, string>;
}

// ─── session.yaml ───

/**
 * Session 持久化配置，对应 config/session.yaml
 *
 * @example
 * ```typescript
 * import type { SessionConfig } from "@teamsland/types";
 *
 * const cfg: SessionConfig = {
 *   compactionTokenThreshold: 80000,
 *   sqliteJitterRangeMs: [20, 150],
 *   busyTimeoutMs: 5000,
 * };
 * ```
 */
export interface SessionConfig {
  /** 触发 compaction 的 token 数阈值 */
  compactionTokenThreshold: number;
  /** SQLite 写入随机 jitter 范围（毫秒），[min, max] */
  sqliteJitterRangeMs: [number, number];
  /** SQLite busy_timeout 毫秒 */
  busyTimeoutMs: number;
}

// ─── sidecar.yaml ───

/**
 * Sidecar 进程管理配置，对应 config/sidecar.yaml
 *
 * @example
 * ```typescript
 * import type { SidecarConfig } from "@teamsland/types";
 *
 * const cfg: SidecarConfig = {
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
  /** 最大并发 Claude Code 实例数 */
  maxConcurrentSessions: number;
  /** Agent 最大重试次数 */
  maxRetryCount: number;
  /** 最大委派深度（防递归） */
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
 * 记忆衰减与回收配置，对应 config/memory.yaml
 *
 * @example
 * ```typescript
 * import type { MemoryConfig } from "@teamsland/types";
 *
 * const cfg: MemoryConfig = {
 *   decayHalfLifeDays: 30,
 *   extractLoopMaxIterations: 3,
 *   exemptTypes: ["decisions", "identity"],
 *   perTypeTtl: { events: 90, cases: 365 },
 * };
 * ```
 */
export interface MemoryConfig {
  /** 记忆热度衰减半衰期（天） */
  decayHalfLifeDays: number;
  /** ExtractLoop 最大迭代次数 */
  extractLoopMaxIterations: number;
  /** 豁免类型，不参与自动回收 */
  exemptTypes: MemoryType[];
  /** 按类型的硬过期天数，超过即归档 */
  perTypeTtl: Partial<Record<MemoryType, number>>;
}

// ─── storage.yaml ───

/**
 * SQLite-vec 向量存储配置
 *
 * @example
 * ```typescript
 * import type { SqliteVecConfig } from "@teamsland/types";
 *
 * const cfg: SqliteVecConfig = { dbPath: "./data/memory.sqlite", busyTimeoutMs: 5000, vectorDimensions: 512 };
 * ```
 */
export interface SqliteVecConfig {
  /** SQLite 数据库文件路径 */
  dbPath: string;
  /** busy_timeout 毫秒 */
  busyTimeoutMs: number;
  /** 向量维度 */
  vectorDimensions: number;
}

/**
 * Embedding 模型配置
 *
 * @example
 * ```typescript
 * import type { EmbeddingConfig } from "@teamsland/types";
 *
 * const cfg: EmbeddingConfig = {
 *   model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
 *   contextSize: 2048,
 * };
 * ```
 */
export interface EmbeddingConfig {
  /** GGUF 模型 URI */
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
 * const cfg: EntityMergeConfig = { cosineThreshold: 0.95 };
 * ```
 */
export interface EntityMergeConfig {
  /** 余弦相似度阈值，大于等于此值视为同一实体 */
  cosineThreshold: number;
}

/**
 * FTS5 全文索引配置
 *
 * @example
 * ```typescript
 * import type { Fts5Config } from "@teamsland/types";
 *
 * const cfg: Fts5Config = { optimizeIntervalHours: 24 };
 * ```
 */
export interface Fts5Config {
  /** FTS5 OPTIMIZE 执行间隔（小时） */
  optimizeIntervalHours: number;
}

/**
 * 存储完整配置，对应 config/storage.yaml
 *
 * @example
 * ```typescript
 * import type { StorageConfig } from "@teamsland/types";
 *
 * const cfg: StorageConfig = {
 *   sqliteVec: { dbPath: "./data/memory.sqlite", busyTimeoutMs: 5000, vectorDimensions: 512 },
 *   embedding: { model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf", contextSize: 2048 },
 *   entityMerge: { cosineThreshold: 0.95 },
 *   fts5: { optimizeIntervalHours: 24 },
 * };
 * ```
 */
export interface StorageConfig {
  /** sqlite-vec 向量存储 */
  sqliteVec: SqliteVecConfig;
  /** Embedding 模型 */
  embedding: EmbeddingConfig;
  /** 实体合并 */
  entityMerge: EntityMergeConfig;
  /** FTS5 全文索引 */
  fts5: Fts5Config;
}

// ─── confirmation.yaml ───

/**
 * 人工确认流程配置，对应 config/confirmation.yaml
 *
 * @example
 * ```typescript
 * import type { ConfirmationConfig } from "@teamsland/types";
 *
 * const cfg: ConfirmationConfig = { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 };
 * ```
 */
export interface ConfirmationConfig {
  /** 提醒间隔（分钟） */
  reminderIntervalMin: number;
  /** 最大提醒次数 */
  maxReminders: number;
  /** 确认状态轮询间隔（毫秒） */
  pollIntervalMs: number;
}

// ─── dashboard.yaml ───

/**
 * Dashboard 鉴权配置
 *
 * @example
 * ```typescript
 * import type { DashboardAuthConfig } from "@teamsland/types";
 *
 * const cfg: DashboardAuthConfig = {
 *   provider: "lark_oauth",
 *   sessionTtlHours: 8,
 *   allowedDepartments: [],
 * };
 * ```
 */
export interface DashboardAuthConfig {
  /** 认证提供方 */
  provider: string;
  /** Session 过期时间（小时） */
  sessionTtlHours: number;
  /** 允许访问的部门列表（空 = 全员可访问） */
  allowedDepartments: string[];
}

/**
 * Dashboard 完整配置，对应 config/dashboard.yaml
 *
 * @example
 * ```typescript
 * import type { DashboardConfig } from "@teamsland/types";
 *
 * const cfg: DashboardConfig = {
 *   port: 3000,
 *   auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] },
 * };
 * ```
 */
export interface DashboardConfig {
  /** 服务端口 */
  port: number;
  /** 鉴权配置 */
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
 * const repo: RepoEntry = { path: "/home/user/repos/frontend-main", name: "前端主仓库" };
 * ```
 */
export interface RepoEntry {
  /** 仓库本地路径 */
  path: string;
  /** 仓库显示名称 */
  name: string;
}

/**
 * Meego 项目到仓库的映射条目
 *
 * @example
 * ```typescript
 * import type { RepoMappingEntry } from "@teamsland/types";
 *
 * const entry: RepoMappingEntry = {
 *   meegoProjectId: "project_xxx",
 *   repos: [{ path: "/repos/frontend", name: "前端主仓库" }],
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
 * 仓库映射配置，对应 config/repo_mapping.yaml
 *
 * @example
 * ```typescript
 * import type { RepoMappingConfig } from "@teamsland/types";
 *
 * const cfg: RepoMappingConfig = [
 *   { meegoProjectId: "project_xxx", repos: [{ path: "/repos/fe", name: "前端" }] },
 * ];
 * ```
 */
export type RepoMappingConfig = RepoMappingEntry[];

// ─── skill_routing.yaml ───

/**
 * Skill 路由配置，trigger_type → 可用 Skill 名称列表
 *
 * @example
 * ```typescript
 * import type { SkillRoutingConfig } from "@teamsland/types";
 *
 * const cfg: SkillRoutingConfig = {
 *   frontend_dev: ["figma-reader", "lark-docs", "git-tools"],
 *   code_review: ["git-diff", "lark-comment"],
 * };
 * ```
 */
export type SkillRoutingConfig = Record<string, string[]>;

// ─── LLM 配置 ───

/**
 * LLM 客户端配置
 *
 * @example
 * ```typescript
 * import type { LlmConfig } from "@teamsland/types";
 *
 * const cfg: LlmConfig = {
 *   provider: "anthropic",
 *   apiKey: "sk-ant-...",
 *   model: "claude-sonnet-4-20250514",
 *   baseUrl: "https://api.anthropic.com",
 *   maxTokens: 4096,
 * };
 * ```
 */
export interface LlmConfig {
  /** LLM 提供商 */
  provider: "anthropic";
  /** API 密钥 */
  apiKey: string;
  /** 模型标识 */
  model: string;
  /** API 基础地址（可选，用于代理） */
  baseUrl?: string;
  /** 最大输出 Token 数 */
  maxTokens: number;
}

// ─── queue 配置 ───

/**
 * 持久化消息队列配置
 *
 * 控制 PersistentQueue 的运行参数，可选配置。
 * 未提供时 init/events.ts 使用内置默认值。
 *
 * @example
 * ```typescript
 * import type { QueueConfig } from "@teamsland/types";
 *
 * const cfg: QueueConfig = {
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

// ─── coordinator 配置 ───

/**
 * Coordinator 配置
 *
 * 控制 Coordinator 的 session 管理、超时策略和启用状态。
 *
 * @example
 * ```typescript
 * import type { CoordinatorConfig } from "@teamsland/types";
 *
 * const cfg: CoordinatorConfig = {
 *   workspacePath: "~/.teamsland/coordinator",
 *   sessionIdleTimeoutMs: 300_000,
 *   sessionMaxLifetimeMs: 1_800_000,
 *   sessionReuseWindowMs: 300_000,
 *   maxRecoveryRetries: 3,
 *   inferenceTimeoutMs: 60_000,
 *   enabled: false,
 * };
 * ```
 */
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
  /** 是否启用 Coordinator */
  enabled: boolean;
}

// ─── hooks 配置 ───

/**
 * Hook 引擎配置
 *
 * 控制 hook 文件目录、默认超时和多匹配行为。
 *
 * @example
 * ```typescript
 * import type { HooksConfig } from "@teamsland/types";
 *
 * const cfg: HooksConfig = {
 *   hooksDir: "./hooks",
 *   defaultTimeoutMs: 30000,
 *   multiMatch: false,
 * };
 * ```
 */
export interface HooksConfig {
  /** hooks 文件目录路径 */
  hooksDir: string;
  /** handle 超时时间（毫秒），默认 30000 */
  defaultTimeoutMs: number;
  /** 是否允许多个 hook 匹配同一事件，默认 false */
  multiMatch: boolean;
  /** 待审批 hooks 文件目录路径 */
  pendingDir?: string;
  /** 自动生成的 hook 是否需要人工审批 */
  requireApproval?: boolean;
}

// ─── OpenViking 配置 ───

/**
 * OpenViking 外部服务连接配置
 *
 * teamsland 通过 HTTP 调用独立部署的 OpenViking server，
 * 心跳检测健康状态，不健康时自动降级到 NullVikingMemoryClient。
 *
 * @example
 * ```typescript
 * import type { OpenVikingConfig } from "@teamsland/types";
 *
 * const cfg: OpenVikingConfig = {
 *   baseUrl: "http://127.0.0.1:1933",
 *   agentId: "teamsland",
 *   timeoutMs: 30000,
 *   heartbeatIntervalMs: 30000,
 *   heartbeatFailThreshold: 3,
 * };
 * ```
 */
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

// ─── 聚合根类型 ───

/**
 * 应用完整配置，聚合所有 YAML 配置文件
 *
 * @example
 * ```typescript
 * import type { AppConfig } from "@teamsland/types";
 *
 * declare const config: AppConfig;
 * console.log(config.meego.spaces[0].name);
 * ```
 */
export interface AppConfig {
  /** Meego 配置 */
  meego: MeegoConfig;
  /** 飞书配置 */
  lark: LarkConfig;
  /** Session 配置 */
  session: SessionConfig;
  /** Sidecar 配置 */
  sidecar: SidecarConfig;
  /** 记忆配置 */
  memory: MemoryConfig;
  /** 存储配置 */
  storage: StorageConfig;
  /** 确认流程配置 */
  confirmation: ConfirmationConfig;
  /** Dashboard 配置 */
  dashboard: DashboardConfig;
  /** 仓库映射 */
  repoMapping: RepoMappingConfig;
  /** Skill 路由 */
  skillRouting: SkillRoutingConfig;
  /** LLM 配置（未配置时使用 stub，功能降级） */
  llm?: LlmConfig;
  /** 持久化消息队列配置（可选，未配置时使用内置默认值） */
  queue?: QueueConfig;
  /** Coordinator 配置（可选，未配置时不启用） */
  coordinator?: CoordinatorConfig;
  /** Hook 引擎配置（可选，未配置时不加载 hook） */
  hooks?: HooksConfig;
  /** OpenViking 记忆服务配置（可选，未配置时使用 NullClient） */
  openViking?: OpenVikingConfig;
}
