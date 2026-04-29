// @teamsland/types — 共享类型定义包
// 所有类型按领域分文件，通过此 barrel 统一导出

// 配置类型（对应 config/*.yaml）
export type {
  AppConfig,
  ConfirmationConfig,
  CoordinatorConfig,
  DashboardAuthConfig,
  DashboardConfig,
  HooksConfig,
  LarkBotConfig,
  LarkConfig,
  LarkConnectorConfig,
  LarkNotificationConfig,
  LlmConfig,
  MeegoConfig,
  MeegoEventMode,
  MeegoLongConnectionConfig,
  MeegoPollConfig,
  MeegoSpaceConfig,
  MeegoWebhookConfig,
  OpenVikingConfig,
  QueueConfig,
  RepoEntry,
  RepoMappingConfig,
  RepoMappingEntry,
  SessionConfig,
  SidecarConfig,
  SkillRoutingConfig,
} from "./config.js";

// 请求上下文与意图
export type { IntentResult, IntentType, RequestContext } from "./context.js";
// Coordinator 类型
export type {
  ActiveSession,
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorEventType,
  CoordinatorSessionManagerConfig,
  CoordinatorState,
  PipelineTrackerLike,
} from "./coordinator.js";
// Meego 事件
export type { EventHandler, MeegoEvent, MeegoEventType } from "./meego.js";
// 记忆系统
export type { MemoryType } from "./memory.js";
// 团队通讯
export type { TeamMessage, TeamMessageType } from "./message.js";
// 归一化消息（Dashboard Phase 7）
export type {
  FetchHistoryOptions,
  FetchHistoryResult,
  MessageKind,
  NormalizedMessage,
} from "./normalized-message.js";
// 队列入队回调
export type { EnqueueFn } from "./queue.js";
// Session 发现
export type { DiscoveredProject, DiscoveredSession } from "./session-discovery.js";
// Session 持久化行类型
export type {
  CompactResult,
  MessageRow,
  OriginData,
  SessionRow,
  SessionStatus,
  TaskRow,
  TaskStatus,
} from "./session-row.js";
// Sidecar 注册表
export type { AgentOrigin, AgentRecord, AgentStatus, RegistryState } from "./sidecar.js";
// Swarm 子任务与执行结果
export type { SubTask, SwarmResult, WorkerResult } from "./swarm.js";
// 任务
export type { ComplexTask, TaskConfig } from "./task.js";
// 拓扑图
export type { TopologyEdge, TopologyGraph, TopologyNode } from "./topology.js";
