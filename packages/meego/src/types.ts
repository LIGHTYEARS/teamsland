/**
 * Meego OpenAPI 请求/响应类型
 *
 * 这些类型代表 Meego OpenAPI 返回的数据结构（camelCase 命名），
 * 与 `@teamsland/types/meego.ts` 中的事件管线类型（MeegoEvent）是独立的类型家族。
 *
 * @example
 * ```typescript
 * import type { MeegoWorkItem, MeegoApiResult } from "@teamsland/meego";
 * ```
 */

// ── 通用 ──

/** Meego API 统一结果类型（discriminated union） */
export type MeegoApiResult<T> = { ok: true; data: T } | { ok: false; errCode: number; message: string };

/** Meego 字段键值对（用于 update/create 的 field_value_pairs） */
export interface MeegoFieldValuePair {
  fieldKey: string;
  fieldAlias?: string;
  fieldValue: unknown;
}

/** Meego 搜索过滤条件 */
export interface MeegoFilter {
  fieldKey: string;
  fieldAlias?: string;
  fieldValue: unknown;
  operator: "EQUAL" | "LIKE" | "IN" | "NOT_EQUAL" | "GREATER" | "LESS";
}

// ── 工作项 ──

/** Meego 工作项（query 接口返回的完整结构） */
export interface MeegoWorkItem {
  id: number;
  name: string;
  workItemTypeKey: string;
  pattern?: "Node" | "State";
  templateId?: number;
  templateType?: string;
  workItemStatus?: { stateKey: string };
  currentNodes?: MeegoWorkflowNode[];
  fields?: Array<{ fieldKey: string; fieldValue: unknown }>;
  fieldValuePairs?: Array<{ fieldKey: string; fieldValue: unknown }>;
  multiTexts?: Array<{
    fieldKey: string;
    fieldValue: { doc?: string; docHtml?: string };
  }>;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * searchWorkItems 返回的列表项（filter 接口格式）
 *
 * filter 接口与 query 接口的字段结构略有不同：
 * - ID 字段为 `workItemId`（而非 `id`）
 * - 字段在 `fieldValuePairs` 中（而非 `fields`）
 */
export interface MeegoWorkItemListEntry {
  workItemId?: number;
  id?: number;
  name: string;
  fieldValuePairs?: Array<{ fieldKey: string; fieldValue: unknown }>;
}

/** 搜索结果 */
export interface MeegoSearchResult {
  workItemList: MeegoWorkItemListEntry[];
  totalCount?: number;
}

/** searchWorkItems 参数 */
export interface SearchWorkItemsOpts {
  /** 过滤条件数组 */
  filters?: MeegoFilter[];
  /** 返回数量上限，默认 20 */
  limit?: number;
  /** 页码，默认 1 */
  pageNum?: number;
}

/** getWorkItemBrief 返回的格式化摘要 */
export interface MeegoWorkItemBrief {
  id: number;
  name: string;
  type: string;
  mode: "节点流" | "状态流";
  status?: string;
  template?: { id?: number; name: string };
  currentNodes?: Array<{ id: string; name: string }>;
  fields?: Record<string, unknown>;
  url?: string;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
}

/** createWorkItem 参数 */
export interface CreateWorkItemOpts {
  /** 字段键值对 */
  fields?: MeegoFieldValuePair[];
  /** 流程模板 ID */
  templateId?: number;
}

// ── 工作流 ──

/** 工作流节点 */
export interface MeegoWorkflowNode {
  id: string;
  name: string;
  status?: number;
}

/** 状态流转连接 */
export interface MeegoStateConnection {
  transitionId: number;
  sourceStateKey: string;
  targetStateKey: string;
}

/** 工作流详情 */
export interface MeegoWorkflowDetail {
  workflowNodes?: MeegoWorkflowNode[];
  stateFlowNodes?: MeegoWorkflowNode[];
  connections?: MeegoStateConnection[];
}

/** finishNode / updateNode 参数 */
export interface NodeOperateOpts {
  /** 节点负责人 user_key 列表 */
  owners?: string[];
  /** 节点排期 */
  schedule?: { estimateStartDate?: number; estimateEndDate?: number };
  /** 节点自定义字段 */
  fields?: MeegoFieldValuePair[];
}

/** transitState 参数 */
export interface TransitStateOpts {
  /** 目标状态 key（如 RESOLVED、CLOSED）。与 transitionId 二选一 */
  toState?: string;
  /** 直接指定流转 ID（覆盖 toState 自动查找） */
  transitionId?: number;
  /** 流转表单字段 */
  fields?: MeegoFieldValuePair[];
  /** 角色负责人 */
  roleOwners?: Array<{ role: string; owners: string[] }>;
}

/** 流转必填字段项 */
export interface MeegoTransitionFieldItem {
  key: string;
  class: "field" | "control";
  fieldTypeKey?: string;
  finished: boolean;
  subField?: Array<{
    fieldKey: string;
    fieldTypeKey?: string;
    finished: boolean;
  }>;
}

// ── 用户 ──

/** 用户搜索结果条目 */
export interface MeegoUser {
  userKey: string;
  nameCn?: string;
  nameEn?: string;
  email?: string;
}

// ── 字段定义 ──

/** 字段选项 */
export interface MeegoFieldOption {
  value: string;
  label: string;
}

/** 字段定义 */
export interface MeegoFieldDef {
  fieldKey: string;
  fieldName?: string;
  name?: string;
  fieldTypeKey: string;
  isRequired: boolean;
  options?: MeegoFieldOption[];
}

// ── 文件操作 ──

/** addAttachment 参数 */
export interface AddAttachmentOpts {
  /** 附件字段 field_key */
  fieldKey?: string;
  /** 附件字段 field_alias */
  fieldAlias?: string;
  /** 复合字段下标 */
  index?: string;
}
