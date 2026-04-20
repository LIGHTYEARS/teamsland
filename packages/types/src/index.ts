// @teamsland/types — 共享类型定义包
// 所有类型按领域分文件，通过此 barrel 统一导出

// 配置类型（对应 config/*.yaml）
export type {
  AppConfig,
  ConfirmationConfig,
  DashboardAuthConfig,
  DashboardConfig,
  EmbeddingConfig,
  EntityMergeConfig,
  Fts5Config,
  LarkBotConfig,
  LarkConfig,
  LarkNotificationConfig,
  MeegoConfig,
  MeegoEventMode,
  MeegoLongConnectionConfig,
  MeegoPollConfig,
  MeegoSpaceConfig,
  MeegoWebhookConfig,
  MemoryConfig,
  RepoEntry,
  RepoMappingConfig,
  RepoMappingEntry,
  SessionConfig,
  SidecarConfig,
  SkillRoutingConfig,
  SqliteVecConfig,
  StorageConfig,
} from "./config.js";

// 请求上下文与意图
export type { IntentResult, IntentType, RequestContext } from "./context.js";

// Meego 事件
export type { EventHandler, MeegoEvent, MeegoEventType } from "./meego.js";

// 记忆系统
export type { AbstractMemoryStore, MemoryEntry, MemoryType } from "./memory.js";

// 团队通讯
export type { TeamMessage, TeamMessageType } from "./message.js";

// Session 持久化行类型
export type { CompactResult, MessageRow, SessionRow, SessionStatus, TaskRow, TaskStatus } from "./session-row.js";

// Sidecar 注册表
export type { AgentRecord, AgentStatus, RegistryState } from "./sidecar.js";

// 任务与 Swarm
export type { ComplexTask, SwarmResult, TaskConfig } from "./task.js";
