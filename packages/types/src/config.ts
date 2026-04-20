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
}
