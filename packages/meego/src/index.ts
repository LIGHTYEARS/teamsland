// @teamsland/meego — Meego 事件摄入、人工确认、API 客户端
// 提供：MeegoEventBus（去重调度）、MeegoConnector（三模式接入）、
//       ConfirmationWatcher（确认提醒）、MeegoClient（OpenAPI 全量操作）

export type { MeegoClientOpts } from "./client.js";
// ── API Client ──
export { MeegoClient } from "./client.js";
// ── Event Ingestion ──
export { ConfirmationWatcher } from "./confirmation.js";
export type { MeegoConnectorOpts } from "./connector.js";
export { MeegoConnector } from "./connector.js";
export { MeegoEventBus } from "./event-bus.js";

// ── API Types ──
export type {
  AddAttachmentOpts,
  CreateWorkItemOpts,
  MeegoApiResult,
  MeegoFieldDef,
  MeegoFieldOption,
  MeegoFieldValuePair,
  MeegoFilter,
  MeegoSearchResult,
  MeegoStateConnection,
  MeegoTransitionFieldItem,
  MeegoUser,
  MeegoWorkflowDetail,
  MeegoWorkflowNode,
  MeegoWorkItem,
  MeegoWorkItemBrief,
  MeegoWorkItemListEntry,
  NodeOperateOpts,
  SearchWorkItemsOpts,
  TransitStateOpts,
} from "./types.js";
