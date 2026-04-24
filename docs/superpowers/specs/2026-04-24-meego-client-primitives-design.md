# MeegoClient API Primitives 设计文档

> 日期：2026-04-24
> 状态：Draft
> 范围：`@teamsland/meego` 包新增 MeegoClient class，封装飞书项目 (Meego) OpenAPI 全部 CRUD / 工作流 / 用户 / 字段 / 文件操作

## 1. 背景与动机

### 1.1 现状

`@teamsland/meego` 包当前只有**事件接入**能力：

| 模块 | 职责 | 状态 |
|---|---|---|
| `MeegoConnector` | 通过 webhook / poll / SSE 接收 Meego 事件 | 生产使用 |
| `MeegoEventBus` | 事件去重 + 处理器调度 | `@deprecated`，双写过渡期 |
| `ConfirmationWatcher` | 轮询工作项状态等待人工确认 | 生产使用 |

项目根目录有一个完整的 Python CLI 脚本 `meego_api_examples.py`（1600 行），涵盖 Meego OpenAPI 的 16 种操作。这些能力在 TypeScript 端完全缺失。

### 1.2 问题

1. `coordinator-init.ts` 为 Agent 生成了 `meego-query` SKILL，其中引用的 `/api/meego/issues` 等路由**实际未实现**——Agent 无法查询 Meego 数据
2. Dashboard 需要展示最近 2 周的 Meego 需求列表，但 server 端没有 Meego 查询 API
3. `connector.ts` 和 `confirmation.ts` 各自有独立的 `fetch` + header 构建逻辑，HTTP 层碎片化

### 1.3 目标

- 在 `@teamsland/meego` 包内新增 `MeegoClient` class，封装 Meego OpenAPI 的全部 15 个操作（auth 除外）
- 提供统一的 HTTP 层和错误处理，消除包内 HTTP 逻辑碎片化
- 为后续 server 端 `/api/meego/*` 路由和 Dashboard 需求列表提供数据层基础

## 2. 设计决策

| 决策 | 选项 | 结论 | 理由 |
|---|---|---|---|
| 模块位置 | 新包 / 子目录 / 平铺 | **平铺在 meego 包内** | 与 connector / event-bus 并列，避免过度拆分 |
| 认证方式 | 自动换 token / 缓存刷新 / 手动配 | **手动配 pluginAccessToken** | 与现有 config.json 一致，不引入 plugin_id/secret |
| 封装风格 | Class / 纯函数 | **Class 实例** | 构造时注入公共参数（baseUrl/token/userKey），方法调用不重复传 |
| 前移范围 | 全量 / 核心 CRUD / 仅查询 | **全量 15 个操作** | 一次性覆盖，避免反复追加 |
| 不前移的 | auth / 图片缓存 / multipart 自实现 | — | auth 不需要；图片缓存是 CLI 本地行为；multipart 用 Bun FormData 原生替代 |

## 3. 架构设计

### 3.1 文件结构

```
packages/meego/src/
├── client.ts          ← 新增：MeegoClient class（统一 HTTP 层 + 15 个 API 方法）
├── types.ts           ← 新增：Meego API 请求/响应类型定义
├── connector.ts       ← 现有：事件接入（webhook/poll/SSE）
├── event-bus.ts       ← 现有：事件去重（@deprecated）
├── confirmation.ts    ← 现有：确认提醒
└── index.ts           ← 追加导出 MeegoClient + API 类型
```

### 3.2 MeegoClient 构造

```typescript
interface MeegoClientOpts {
  /** Meego OpenAPI 基础地址，如 https://meego.larkoffice.com */
  baseUrl: string;
  /** plugin_access_token */
  token: string;
  /** 调用者 user_key（在飞书项目中双击头像获取） */
  userKey: string;
  /** 默认项目 key（可选，方法级别可覆盖） */
  defaultProjectKey?: string;
  /** 可注入的 fetch 函数，用于单元测试 mock（默认 globalThis.fetch） */
  fetchFn?: typeof globalThis.fetch;
}

class MeegoClient {
  constructor(opts: MeegoClientOpts);
}
```

**关键设计点：`fetchFn` 注入**

构造函数接受可选的 `fetchFn` 参数，默认使用 `globalThis.fetch`。这使得单元测试可以注入 mock fetch 而不依赖真实 Meego API。

### 3.3 统一 HTTP 层

MeegoClient 内部实现一个私有 `request()` 方法，作为所有 API 调用的唯一出口：

```typescript
private async request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<MeegoApiResult<T>>
```

**职责：**
1. 拼接完整 URL：`${this.baseUrl}/open_api${path}`
2. 构建统一 headers：`X-PLUGIN-TOKEN` + `X-USER-KEY` + `Content-Type: application/json`
3. 调用 `this.fetchFn(url, { method, headers, body })`
4. 检查 HTTP 状态码（非 2xx 尝试解析响应体）
5. **双格式错误归一化**（见 3.4）
6. 返回 `MeegoApiResult<T>` discriminated union

### 3.4 错误处理：双格式归一化

Meego OpenAPI 存在两种不同的错误响应格式：

**格式 A（多数接口）：**
```json
{ "err_code": 30005, "err_msg": "work item not found", "data": null }
```

**格式 B（部分新接口）：**
```json
{ "error": { "code": 30005, "msg": "work item not found" }, "data": null }
```

Python 脚本的 `is_success()` 兼容了两者。MeegoClient 必须忠实移植此逻辑：

```typescript
/** Meego API 统一结果类型 */
type MeegoApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; errCode: number; message: string };

/** 判断原始响应是否成功（兼容双格式） */
function isMeegoSuccess(raw: Record<string, unknown>): boolean {
  if (raw.err_code === 0) return true;
  if (typeof raw.error === "object" && raw.error !== null
      && (raw.error as Record<string, unknown>).code === 0) return true;
  return false;
}

/** 从原始响应提取错误信息（兼容双格式） */
function extractMeegoError(raw: Record<string, unknown>): { errCode: number; message: string } {
  if (typeof raw.err_code === "number") {
    return { errCode: raw.err_code, message: String(raw.err_msg ?? "") };
  }
  if (typeof raw.error === "object" && raw.error !== null) {
    const err = raw.error as Record<string, unknown>;
    return { errCode: Number(err.code ?? -1), message: String(err.msg ?? "") };
  }
  return { errCode: -1, message: JSON.stringify(raw) };
}
```

**常见错误码速查表**（从 Python 脚本提取）：

| err_code | 含义 | 出现场景 |
|---|---|---|
| 10001 | 无权限 | update / finish-node / delete |
| 20003 | work_item_type_key 错误 | get / delete |
| 20006 | 字段格式错误 | update / create |
| 20038 | 必填字段未设置 | create / transit-state / finish-node |
| 30005 | 工作项不存在 | get / update / delete / workflow |
| 30014 | 工作项类型 key 不存在 | create |
| 50006 | user_key 无效 | create（assignee） |

### 3.5 API 方法清单

#### 3.5.1 工作项 CRUD（6 个方法）

| 方法 | Meego API | HTTP | 说明 |
|---|---|---|---|
| `getWorkItem(projectKey, type, id, opts?)` | `/{project}/work_item/{type}/query` | POST | 查询单个工作项详情 |
| `getWorkItemBrief(projectKey, type, id, opts?)` | 同上 + `expand.need_multi_text` | POST | 格式化摘要（含富文本/图片 URL） |
| `searchWorkItems(projectKey, type, opts?)` | `/{project}/work_item/filter` | POST | 搜索/过滤工作项列表 |
| `createWorkItem(projectKey, type, name, opts?)` | `/{project}/work_item/create` | POST | 创建工作项 |
| `updateWorkItem(projectKey, type, id, fields)` | `/{project}/work_item/{type}/{id}` | PUT | 更新工作项字段 |
| `deleteWorkItem(projectKey, type, id)` | `/{project}/work_item/{type}/{id}` | DELETE | 删除工作项 |

**searchWorkItems 参数设计：**

```typescript
interface SearchWorkItemsOpts {
  /** 过滤条件数组 */
  filters?: MeegoFilter[];
  /** 返回数量上限，默认 20 */
  limit?: number;
  /** 页码，默认 1 */
  pageNum?: number;
}

interface MeegoFilter {
  fieldKey: string;
  fieldAlias?: string;
  fieldValue: unknown;
  operator: "EQUAL" | "LIKE" | "IN" | "NOT_EQUAL" | "GREATER" | "LESS";
}
```

#### 3.5.2 工作流操作（5 个方法）

| 方法 | Meego API | 说明 |
|---|---|---|
| `getWorkflow(projectKey, type, id, flowType?)` | `/{project}/work_item/{type}/{id}/workflow/query` | 获取工作流详情 |
| `finishNode(projectKey, type, id, nodeId, opts?)` | `/{project}/workflow/{type}/{id}/node/{nodeId}/operate` | 完成节点（Node 模式） |
| `updateNode(projectKey, type, id, nodeId, opts?)` | `/{project}/workflow/{type}/{id}/node/{nodeId}` | 更新节点（Node 模式） |
| `transitState(projectKey, type, id, opts)` | `/{project}/workflow/{type}/{id}/node/state_change` | 流转状态（State 模式） |
| `getTransitionFields(projectKey, type, id, toState, opts?)` | `/work_item/transition_required_info/get` | 探测流转必填字段 |

**finishNode 参数设计：**

```typescript
interface FinishNodeOpts {
  /** 设置节点负责人 user_key 列表 */
  owners?: string[];
  /** 节点排期 */
  schedule?: { estimateStartDate?: number; estimateEndDate?: number };
  /** 节点自定义字段 */
  fields?: MeegoFieldValuePair[];
}
```

**transitState 参数设计：**

```typescript
interface TransitStateOpts {
  /** 目标状态 key（如 RESOLVED、CLOSED）。与 transitionId 二选一 */
  toState?: string;
  /** 直接指定流转 ID（覆盖 toState 自动查找） */
  transitionId?: number;
  /** 流转表单字段 */
  fields?: MeegoFieldValuePair[];
  /** 角色负责人 */
  roleOwners?: Array<{ role: string; owners: string[] }>;
}
```

> **注意**：当仅传 `toState` 时，`transitState` 内部需先调 `getWorkflow` 查出当前状态和可用流转，再匹配 `transitionId`。这与 Python `cmd_transit_state` 的行为一致。

#### 3.5.3 用户查询（1 个方法）

| 方法 | Meego API | 说明 |
|---|---|---|
| `searchUsers(query, projectKey?)` | `/user/search` | 按姓名/邮箱搜索用户，返回 user_key |

#### 3.5.4 字段查询（1 个方法）

| 方法 | Meego API | 说明 |
|---|---|---|
| `listFields(projectKey, type?)` | `/{project}/field/all` | 列出工作项类型的字段定义 |

#### 3.5.5 文件操作（2 个方法）

| 方法 | Meego API | 说明 |
|---|---|---|
| `uploadFile(projectKey, file)` | `/{project}/file/upload` | 上传文件到 Meego 空间 |
| `addAttachment(projectKey, type, id, file, opts?)` | `/{project}/work_item/{type}/{id}/file/upload` | 向工作项附件字段添加附件 |

**文件上传使用 Bun 原生 FormData：**

```typescript
async uploadFile(projectKey: string, file: File | Blob): Promise<MeegoApiResult<string>> {
  const url = `${this.baseUrl}/open_api/${projectKey}/file/upload`;
  const form = new FormData();
  form.append("file", file);
  const resp = await this.fetchFn(url, {
    method: "POST",
    headers: { "X-PLUGIN-TOKEN": this.token, "X-USER-KEY": this.userKey },
    body: form,
  });
  // ... 解析响应
}
```

> 不移植 Python 脚本中的手工 multipart boundary 构建逻辑，直接用 `FormData`。

## 4. 类型设计

### 4.1 新增文件 `types.ts`

所有 Meego API 相关的请求/响应类型定义集中在 `packages/meego/src/types.ts`。

**命名约定**：所有类型以 `Meego` 前缀开头，与 `@teamsland/types/meego.ts` 中的事件管线类型（`MeegoEvent`/`MeegoEventType`）清晰区分。

```typescript
// ── 通用 ──

/** Meego API 统一结果类型 */
export type MeegoApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; errCode: number; message: string };

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

/** Meego 工作项（API 返回的原始结构） */
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
  multiTexts?: Array<{ fieldKey: string; fieldValue: { doc?: string; docHtml?: string } }>;
  createdAt?: number;
  updatedAt?: number;
  createdBy?: string;
  updatedBy?: string;
}

/** searchWorkItems 返回的列表项（filter 接口格式，字段结构略有不同） */
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

/** 流转必填字段项 */
export interface MeegoTransitionFieldItem {
  key: string;
  class: "field" | "control";
  fieldTypeKey?: string;
  finished: boolean;
  subField?: Array<{ fieldKey: string; fieldTypeKey?: string; finished: boolean }>;
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
```

### 4.2 snake_case → camelCase 转换策略

Meego API 返回 snake_case 字段名（`work_item_type_key`、`field_value_pairs`），TypeScript 类型使用 camelCase（`workItemTypeKey`、`fieldValuePairs`）。

**转换时机**：在 `MeegoClient.request()` 解析响应后立即转换，所有公开方法返回的类型都是 camelCase。内部保留一个 `snakeToCamel` 工具函数做递归属性名转换。

### 4.3 与现有 `@teamsland/types/meego.ts` 的关系

| 类型位置 | 用途 | 命名 |
|---|---|---|
| `@teamsland/types/meego.ts` | 事件管线类型（webhook/poll 接入） | `MeegoEvent`, `MeegoEventType`, `EventHandler` |
| `packages/meego/src/types.ts` | API 客户端请求/响应类型 | `MeegoWorkItem`, `MeegoApiResult`, etc. |

两者是独立的类型家族：
- **MeegoEvent** = 归一化后的事件（eventId + type + payload），面向事件处理器消费
- **MeegoWorkItem** = Meego API 返回的原始工作项结构，面向 CRUD 操作

不存在继承或组合关系。未来如果 `MeegoConnector.startPoll()` 迁移到使用 `MeegoClient.searchWorkItems()`，则在 connector 内部做 `MeegoWorkItem → MeegoEvent` 的映射。

## 5. 配置变更

### 5.1 MeegoConfig 新增 userKey

在 `@teamsland/types/config.ts` 的 `MeegoConfig` 接口中新增：

```typescript
export interface MeegoConfig {
  // ... 现有字段 ...
  /** 调用者 user_key（在飞书项目中双击头像获取，API CRUD 操作必需） */
  userKey?: string;
}
```

在 `@teamsland/config/schema.ts` 的 `MeegoConfigSchema` 中新增：

```typescript
const MeegoConfigSchema = z.object({
  // ... 现有字段 ...
  userKey: z.string().default(""),
});
```

### 5.2 config.json 更新

```json
{
  "meego": {
    "spaces": [...],
    "userKey": "${MEEGO_USER_KEY}",
    ...
  }
}
```

### 5.3 .env.example 更新

新增 `MEEGO_USER_KEY` 条目。

### 5.4 connector 测试修复

`packages/meego/src/__tests__/connector.test.ts` 中的 `makeConfig()` 缺少 `apiBaseUrl` 和 `pluginAccessToken` 字段，新增 `userKey` 后需同步修复。

## 6. 技术债务管理

### 6.1 本次必须解决的

| # | 问题 | 措施 |
|---|---|---|
| 1 | HTTP 层碎片化 | MeegoClient 的 `request()` 方法是**唯一的**新增 HTTP 出口；所有 15 个方法必须通过它调用 |
| 2 | 双格式错误处理 | `isMeegoSuccess()` + `extractMeegoError()` 忠实移植 Python 的 `is_success()` 逻辑 |
| 3 | 测试策略 | 构造函数接受 `fetchFn` 注入，单测用 mock fetch 覆盖成功 + 两种错误格式 |
| 4 | 文件大小 | 拆为 `client.ts`（≤600 行）+ `types.ts`（≤300 行），各自控制在 800 行内 |
| 5 | Config 同步 | `MeegoConfig` 类型 + Zod schema + connector 测试三处同步更新 |

### 6.2 紧跟的后续任务（下一个 PR）

| # | 任务 | 描述 |
|---|---|---|
| 6 | 标记废弃 + 迁移 | 给 `connector.ts` 的 `fetchMeegoEvents()` 和 `confirmation.ts` 的 `fetchStatusFromMeego()` 添加 `@deprecated` 标记，注明使用 `MeegoClient.searchWorkItems()` / `MeegoClient.getWorkItem()` 替代 |
| 7 | ConfirmationWatcher 迁移 | `ConfirmationWatcher` 构造时注入 `MeegoClient` 实例，内部 `fetchStatusFromMeego()` 改为调用 `MeegoClient.getWorkItem()` |

### 6.3 不做的事

- **不重构 MeegoConnector**：connector 的事件接入逻辑（webhook server / poll loop / SSE）保持不变，仅标记内部 HTTP 调用为 deprecated
- **不移除 MeegoEventBus**：仍处于双写过渡期，与本次变更无关
- **不实现 NullMeegoClient**：当前没有需要优雅降级的消费者，待需要时再加

## 7. 测试策略

### 7.1 单元测试

在 `packages/meego/src/__tests__/client.test.ts` 中实现：

```typescript
import { describe, expect, it } from "vitest";
import { MeegoClient } from "../client.js";

function mockFetch(response: unknown, status = 200) {
  return async () => new Response(JSON.stringify(response), { status });
}

describe("MeegoClient", () => {
  // 构造
  it("should accept custom fetchFn", () => { ... });

  // 错误格式 A：{ err_code, err_msg }
  it("should handle Format A error response", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "test-token",
      userKey: "test-user",
      fetchFn: mockFetch({ err_code: 30005, err_msg: "not found" }),
    });
    const result = await client.getWorkItem("proj", "issue", 123);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(30005);
    }
  });

  // 错误格式 B：{ error: { code, msg } }
  it("should handle Format B error response", async () => { ... });

  // 成功响应
  it("should return work item on success", async () => { ... });

  // HTTP 非 200
  it("should handle HTTP error status", async () => { ... });

  // 每个 API 方法至少一个正向 case
  describe("searchWorkItems", () => { ... });
  describe("createWorkItem", () => { ... });
  describe("transitState", () => { ... });
  // ... 其余方法
});
```

### 7.2 覆盖要求

- 每个公开方法至少 1 个成功 case + 1 个失败 case
- `request()` 的双格式错误处理：2 个专项 case
- HTTP 非 2xx 响应：1 个 case
- `transitState` 的自动查找 transitionId 逻辑：2 个 case（找到 / 未找到）
- 文件上传方法的 FormData 构建：1 个 case

### 7.3 不做集成测试

API primitives 层不做真实 Meego API 的集成测试。集成验证在 server 路由层（`/api/meego/*`）实现时再做。

## 8. 导出变更

`packages/meego/src/index.ts` 追加：

```typescript
// API Client
export { MeegoClient } from "./client.js";
export type { MeegoClientOpts } from "./client.js";

// API Types
export type {
  MeegoApiResult,
  MeegoFieldDef,
  MeegoFieldOption,
  MeegoFieldValuePair,
  MeegoFilter,
  MeegoSearchResult,
  MeegoStateConnection,
  MeegoTransitionFieldItem,
  MeegoUser,
  MeegoWorkItem,
  MeegoWorkItemListEntry,
  MeegoWorkflowDetail,
  MeegoWorkflowNode,
} from "./types.js";
```

按关注点分组注释：现有的 "Event ingestion" 和新增的 "API Client"。

## 9. 依赖关系

### 9.1 包依赖（不变）

`@teamsland/meego` 已有的依赖完全够用：

- `@teamsland/types` — `MeegoConfig` 类型
- `@teamsland/observability` — `createLogger`

MeegoClient 不引入新的外部依赖。`fetch` 和 `FormData` 是 Bun runtime 内置。

### 9.2 消费者

初期消费者：

1. **`apps/server`** — 新增的 `/api/meego/*` 路由 handler（后续 PR）
2. **`coordinator-init.ts`** — 已生成的 `meego-query` SKILL 将指向真实可用的 API
3. **Agent worker** — 通过 server API 间接使用

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| Meego API 响应格式变更 | 类型解析失败 | `request()` 统一层是唯一变更点，影响可控 |
| pluginAccessToken 过期 | 所有 API 调用 401 | 手动更新 config 或后续实现 auto-refresh（本次不做） |
| snake_case 转换遗漏某些嵌套字段 | 类型不匹配 | 递归转换 + 对实际 API 响应做 snapshot 测试 |
| 文件上传 FormData 在 Bun 中行为差异 | 上传失败 | 上传方法单独用 mock 覆盖 FormData 构建逻辑 |
