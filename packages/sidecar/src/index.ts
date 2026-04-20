// @teamsland/sidecar — ProcessController, SubagentRegistry, SidecarDataPlane,
//                       ObservableMessageBus, Alerter
// Claude Code 子进程管理：进程控制 + Agent 注册 + NDJSON 流解析 + 消息总线 + 告警

export type { AlertNotifier } from "./alerter.js";
export { Alerter } from "./alerter.js";
export type { InterceptedTool, SidecarEventType } from "./data-plane.js";
export { SidecarDataPlane } from "./data-plane.js";
export { ObservableMessageBus } from "./message-bus.js";
export type { SpawnParams, SpawnResult } from "./process-controller.js";
export { ProcessController } from "./process-controller.js";
export type { SubagentRegistryOpts } from "./registry.js";
export { CapacityError, SubagentRegistry } from "./registry.js";
