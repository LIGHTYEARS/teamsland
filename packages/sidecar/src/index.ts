// @teamsland/sidecar — ProcessController, SubagentRegistry, SidecarDataPlane,
//                       Alerter, ClaudeMdInjector, SkillInjector, TranscriptReader
// Claude Code 子进程管理：进程控制 + Agent 注册 + NDJSON 流解析 + 告警 + CLAUDE.md 注入 + Skill 注入 + Transcript 读取

export type { AlertNotifier } from "./alerter.js";
export { Alerter } from "./alerter.js";
export type { ClaudeMdContext } from "./claude-md-injector.js";
export { ClaudeMdInjector } from "./claude-md-injector.js";
export type { AssistantEvent, CliProcessOpts, ResultEvent, StreamEvent } from "./cli-process.js";
export { CliProcess } from "./cli-process.js";
export type { InterceptedTool, RawEventListener, SidecarEventType } from "./data-plane.js";
export { SidecarDataPlane } from "./data-plane.js";
export type { InterruptRequest, InterruptResult } from "./interrupt-controller.js";
export { InterruptController } from "./interrupt-controller.js";
export type { ObserveRequest, ObserveResult } from "./observer-controller.js";
export { buildObserverPrompt, ObserverController } from "./observer-controller.js";
export type { ResumeSpawnParams, SpawnParams, SpawnResult } from "./process-controller.js";
export { ProcessController } from "./process-controller.js";
export type { SubagentRegistryOpts } from "./registry.js";
export { CapacityError, SubagentRegistry } from "./registry.js";
export type { ResumeRequest, ResumeResult } from "./resume-controller.js";
export { buildResumePrompt, ResumeController } from "./resume-controller.js";
export type {
  InjectRequest,
  InjectResult,
  SkillInjectorOpts,
  SkillManifest,
  SkillRouting,
} from "./skill-injector.js";
export { SkillInjector } from "./skill-injector.js";
export type {
  NormalizedEntry,
  ReadResult,
  TranscriptSummary,
} from "./transcript-reader.js";
export { TranscriptReader } from "./transcript-reader.js";
export type { SpawnWorkerParams, WorkerEvent, WorkerManagerOpts } from "./worker-manager.js";
export { WorkerManager } from "./worker-manager.js";
