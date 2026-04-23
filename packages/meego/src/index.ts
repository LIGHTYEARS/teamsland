// @teamsland/meego — Meego 事件摄入与人工确认工作流
// 提供：MeegoEventBus（去重调度）、MeegoConnector（三模式接入）、ConfirmationWatcher（确认提醒）

export { ConfirmationWatcher } from "./confirmation.js";
export type { MeegoConnectorOpts } from "./connector.js";
export { MeegoConnector } from "./connector.js";
export { MeegoEventBus } from "./event-bus.js";
