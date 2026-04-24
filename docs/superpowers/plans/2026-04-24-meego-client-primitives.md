# MeegoClient API Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `MeegoClient` class to `@teamsland/meego` that wraps all 15 Meego OpenAPI operations (CRUD, workflow, users, fields, files) with unified HTTP layer and error handling.

**Architecture:** Single `MeegoClient` class with injectable `fetchFn` for testability. A private `request()` method normalizes Meego's two error response formats into a discriminated union `MeegoApiResult<T>`. All API response types live in a separate `types.ts` file using camelCase naming (converted from Meego's snake_case).

**Tech Stack:** TypeScript, Bun runtime (`fetch`, `FormData`), Vitest for testing

**Spec:** `docs/superpowers/specs/2026-04-24-meego-client-primitives-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `packages/meego/src/types.ts` | All Meego API request/response type definitions |
| Create | `packages/meego/src/client.ts` | `MeegoClient` class with 15 API methods |
| Create | `packages/meego/src/__tests__/client.test.ts` | Unit tests for MeegoClient |
| Modify | `packages/meego/src/index.ts` | Re-export MeegoClient + types |
| Modify | `packages/types/src/config.ts:105-120` | Add `userKey` to `MeegoConfig` |
| Modify | `packages/config/src/schema.ts:53-61` | Add `userKey` to `MeegoConfigSchema` |
| Modify | `config/config.json:2-15` | Add `userKey` field |
| Modify | `.env.example` | Add `MEEGO_USER_KEY` |
| Modify | `packages/meego/src/__tests__/connector.test.ts:8-14` | Fix `makeConfig` missing fields |

---

### Task 1: Config — Add `userKey` to MeegoConfig

**Files:**
- Modify: `packages/types/src/config.ts:105-120`
- Modify: `packages/config/src/schema.ts:53-61`
- Modify: `config/config.json:2-15`
- Modify: `.env.example`
- Modify: `packages/meego/src/__tests__/connector.test.ts:8-14`

- [ ] **Step 1: Add `userKey` to MeegoConfig interface**

In `packages/types/src/config.ts`, add after the `pluginAccessToken` field:

```typescript
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
```

- [ ] **Step 2: Add `userKey` to Zod schema**

In `packages/config/src/schema.ts`, add to `MeegoConfigSchema`:

```typescript
const MeegoConfigSchema = z.object({
  spaces: z.array(MeegoSpaceSchema),
  eventMode: z.enum(["webhook", "poll", "both"]),
  webhook: MeegoWebhookSchema,
  poll: MeegoPollSchema,
  longConnection: MeegoLongConnectionSchema,
  apiBaseUrl: z.string().url().default("https://project.feishu.cn/open_api"),
  pluginAccessToken: z.string().default(""),
  userKey: z.string().default(""),
});
```

- [ ] **Step 3: Update config.json**

In `config/config.json`, add `userKey` inside the `meego` block:

```json
{
  "meego": {
    "spaces": [{ "spaceId": "xxx", "name": "开放平台前端" }, { "spaceId": "yyy", "name": "开放平台基础" }],
    "eventMode": "webhook",
    "webhook": {
      "host": "127.0.0.1",
      "port": 8090,
      "path": "/meego/webhook",
      "secret": "${MEEGO_WEBHOOK_SECRET}"
    },
    "poll": {
      "intervalSeconds": 60,
      "lookbackMinutes": 5
    },
    "longConnection": {
      "enabled": false,
      "reconnectIntervalSeconds": 10
    },
    "apiBaseUrl": "https://project.feishu.cn/open_api",
    "pluginAccessToken": "${MEEGO_PLUGIN_ACCESS_TOKEN}",
    "userKey": "${MEEGO_USER_KEY}"
  },
```

- [ ] **Step 4: Update .env.example**

Add `MEEGO_USER_KEY` after existing Meego entries:

```
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
MEEGO_PLUGIN_TOKEN=xxx
MEEGO_USER_KEY=xxx
```

- [ ] **Step 5: Fix connector test `makeConfig`**

In `packages/meego/src/__tests__/connector.test.ts`, update the `makeConfig` helper to include the previously missing `apiBaseUrl` and `pluginAccessToken`, plus the new `userKey`:

```typescript
const makeConfig = (port: number, secret?: string): MeegoConfig => ({
  spaces: [],
  eventMode: "webhook",
  webhook: { host: "127.0.0.1", port, path: "/meego/webhook", secret },
  poll: { intervalSeconds: 60, lookbackMinutes: 5 },
  longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
  apiBaseUrl: "https://project.feishu.cn/open_api",
  pluginAccessToken: "",
  userKey: "",
});
```

- [ ] **Step 6: Run typecheck and existing tests**

Run: `cd packages/meego && bun run typecheck && cd ../config && bun run typecheck`
Run: `cd packages/meego && bun vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/config.ts packages/config/src/schema.ts config/config.json .env.example packages/meego/src/__tests__/connector.test.ts
git commit -m "feat(meego): add userKey to MeegoConfig for API CRUD operations"
```

---

### Task 2: Types — Create `types.ts` with all Meego API types

**Files:**
- Create: `packages/meego/src/types.ts`

- [ ] **Step 1: Create `types.ts` with result type and common types**

Create `packages/meego/src/types.ts`:

```typescript
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
```

- [ ] **Step 2: Verify types compile**

Run: `cd packages/meego && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/meego/src/types.ts
git commit -m "feat(meego): add Meego API request/response type definitions"
```

---

### Task 3: Client Core — Create `MeegoClient` with unified HTTP layer

**Files:**
- Create: `packages/meego/src/client.ts`
- Create: `packages/meego/src/__tests__/client.test.ts`

- [ ] **Step 1: Write tests for the unified HTTP layer**

Create `packages/meego/src/__tests__/client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { MeegoClient } from "../client.js";

/** 创建返回固定响应的 mock fetch */
function mockFetch(response: unknown, status = 200): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

/** 创建记录请求参数的 mock fetch */
function spyFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn: typeof globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn, calls };
}

describe("MeegoClient — 构造与 request()", () => {
  it("应发送正确的 headers（X-PLUGIN-TOKEN + X-USER-KEY）", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: [] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "tok-123",
      userKey: "user-abc",
      fetchFn: fn,
    });

    await client.searchUsers("test");

    expect(calls).toHaveLength(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-PLUGIN-TOKEN"]).toBe("tok-123");
    expect(headers["X-USER-KEY"]).toBe("user-abc");
  });

  it("应拼接正确的 URL（baseUrl + /open_api + path）", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: [] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.listFields("proj_a");

    expect(calls[0].url).toBe("https://meego.test/open_api/proj_a/field/all");
  });

  it("格式 A 成功响应（err_code: 0）应返回 ok: true", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 0, data: [{ user_key: "u1" }] }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("格式 A 错误响应（err_code: 30005）应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 30005, err_msg: "not found" }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(30005);
      expect(result.message).toBe("not found");
    }
  });

  it("格式 B 成功响应（error.code: 0）应返回 ok: true", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ error: { code: 0, msg: "" }, data: [] }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(true);
  });

  it("格式 B 错误响应（error.code: 10001）应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ error: { code: 10001, msg: "no permission" } }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(10001);
      expect(result.message).toBe("no permission");
    }
  });

  it("HTTP 非 200 应尝试解析响应体并返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 30005, err_msg: "not found" }, 404),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(30005);
    }
  });

  it("网络错误应返回 ok: false, errCode: -1", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: async () => {
        throw new Error("network error");
      },
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(-1);
      expect(result.message).toContain("network error");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: FAIL — `MeegoClient` not found

- [ ] **Step 3: Implement MeegoClient core (constructor + request + snake_case conversion)**

Create `packages/meego/src/client.ts`:

```typescript
import { createLogger } from "@teamsland/observability";
import type { MeegoApiResult } from "./types.js";

const logger = createLogger("meego:client");

/**
 * MeegoClient 构造参数
 *
 * @example
 * ```typescript
 * import { MeegoClient } from "@teamsland/meego";
 *
 * const client = new MeegoClient({
 *   baseUrl: "https://meego.larkoffice.com",
 *   token: "plugin_access_token",
 *   userKey: "your_user_key",
 * });
 * ```
 */
export interface MeegoClientOpts {
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

/**
 * 判断 Meego API 原始响应是否成功（兼容双格式）
 *
 * 格式 A: `{ err_code: 0, data: ... }`
 * 格式 B: `{ error: { code: 0, msg: "" }, data: ... }`
 *
 * @example
 * ```typescript
 * isMeegoSuccess({ err_code: 0, data: [] }); // true
 * isMeegoSuccess({ error: { code: 0, msg: "" } }); // true
 * isMeegoSuccess({ err_code: 30005 }); // false
 * ```
 */
function isMeegoSuccess(raw: Record<string, unknown>): boolean {
  if (raw.err_code === 0) return true;
  if (
    typeof raw.error === "object" &&
    raw.error !== null &&
    (raw.error as Record<string, unknown>).code === 0
  ) {
    return true;
  }
  return false;
}

/**
 * 从 Meego API 原始响应提取错误信息（兼容双格式）
 *
 * @example
 * ```typescript
 * extractMeegoError({ err_code: 30005, err_msg: "not found" });
 * // => { errCode: 30005, message: "not found" }
 * ```
 */
function extractMeegoError(raw: Record<string, unknown>): {
  errCode: number;
  message: string;
} {
  if (typeof raw.err_code === "number") {
    return { errCode: raw.err_code, message: String(raw.err_msg ?? "") };
  }
  if (typeof raw.error === "object" && raw.error !== null) {
    const err = raw.error as Record<string, unknown>;
    return {
      errCode: Number(err.code ?? -1),
      message: String(err.msg ?? ""),
    };
  }
  return { errCode: -1, message: JSON.stringify(raw) };
}

/**
 * snake_case 字符串转 camelCase
 *
 * @example
 * ```typescript
 * snakeToCamelStr("work_item_type_key"); // => "workItemTypeKey"
 * ```
 */
function snakeToCamelStr(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/**
 * 递归将对象的 snake_case 属性名转为 camelCase
 *
 * @example
 * ```typescript
 * snakeToCamel({ work_item_id: 1 }); // => { workItemId: 1 }
 * ```
 */
function snakeToCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[snakeToCamelStr(key)] = snakeToCamel(value);
    }
    return result;
  }
  return obj;
}

/**
 * camelCase 字符串转 snake_case
 *
 * @example
 * ```typescript
 * camelToSnakeStr("fieldKey"); // => "field_key"
 * ```
 */
function camelToSnakeStr(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/**
 * 递归将对象的 camelCase 属性名转为 snake_case（用于请求体）
 *
 * @example
 * ```typescript
 * camelToSnake({ fieldKey: "name" }); // => { field_key: "name" }
 * ```
 */
function camelToSnake(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelToSnake);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[camelToSnakeStr(key)] = camelToSnake(value);
    }
    return result;
  }
  return obj;
}

/**
 * Meego OpenAPI 客户端
 *
 * 封装飞书项目 (Meego) OpenAPI 的全部 CRUD / 工作流 / 用户 / 字段 / 文件操作。
 * 内部使用统一的 `request()` 方法处理 HTTP 调用和双格式错误归一化。
 *
 * @example
 * ```typescript
 * import { MeegoClient } from "@teamsland/meego";
 *
 * const client = new MeegoClient({
 *   baseUrl: "https://meego.larkoffice.com",
 *   token: "plugin_access_token",
 *   userKey: "your_user_key",
 * });
 *
 * const result = await client.searchWorkItems("proj_key", "story", {
 *   filters: [{ fieldKey: "name", fieldValue: "登录", operator: "LIKE" }],
 *   limit: 10,
 * });
 * if (result.ok) {
 *   console.log(result.data.workItemList);
 * }
 * ```
 */
export class MeegoClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userKey: string;
  private readonly defaultProjectKey: string | undefined;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(opts: MeegoClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.userKey = opts.userKey;
    this.defaultProjectKey = opts.defaultProjectKey;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  /**
   * 统一 HTTP 请求方法
   *
   * 所有 API 方法必须通过此方法调用。职责：
   * 1. 拼接 URL
   * 2. 构建 headers
   * 3. 双格式错误归一化
   * 4. snake_case → camelCase 转换
   */
  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<MeegoApiResult<T>> {
    const url = `${this.baseUrl}/open_api${path}`;
    const headers: Record<string, string> = {
      "X-PLUGIN-TOKEN": this.token,
      "X-USER-KEY": this.userKey,
      "Content-Type": "application/json",
    };

    try {
      const resp = await this.fetchFn(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(camelToSnake(body)) : undefined,
      });

      let raw: Record<string, unknown>;
      try {
        raw = (await resp.json()) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          errCode: resp.status,
          message: `HTTP ${resp.status}: 响应体非 JSON`,
        };
      }

      if (isMeegoSuccess(raw)) {
        return { ok: true, data: snakeToCamel(raw.data) as T };
      }

      const error = extractMeegoError(raw);
      logger.warn({ url, method, ...error }, "Meego API 请求失败");
      return { ok: false, ...error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ url, method, err }, "Meego API 网络错误");
      return { ok: false, errCode: -1, message };
    }
  }

  /** 解析项目 key，优先使用参数值，其次使用默认值 */
  private resolveProjectKey(projectKey?: string): string {
    const key = projectKey ?? this.defaultProjectKey;
    if (!key) throw new Error("projectKey is required (no default configured)");
    return key;
  }

  // ── 占位方法，后续 Task 逐步实现 ──
  // （Task 4-8 将替换这些占位）

  /** 搜索用户 */
  async searchUsers(
    query: string,
    projectKey?: string,
  ): Promise<MeegoApiResult<import("./types.js").MeegoUser[]>> {
    const body: Record<string, unknown> = { query };
    if (projectKey) body.projectKey = projectKey;
    return this.request("POST", "/user/search", body);
  }

  /** 列出字段定义 */
  async listFields(
    projectKey: string,
    workItemType?: string,
  ): Promise<MeegoApiResult<import("./types.js").MeegoFieldDef[]>> {
    const pk = this.resolveProjectKey(projectKey);
    const body: Record<string, unknown> = {};
    if (workItemType) body.workItemTypeKey = workItemType;
    return this.request("POST", `/${pk}/field/all`, body);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/__tests__/client.test.ts
git commit -m "feat(meego): add MeegoClient core with unified HTTP layer and error handling"
```

---

### Task 4: Work Item CRUD — getWorkItem, getWorkItemBrief, searchWorkItems

**Files:**
- Modify: `packages/meego/src/client.ts`
- Modify: `packages/meego/src/__tests__/client.test.ts`

- [ ] **Step 1: Write tests for work item query methods**

Append to `packages/meego/src/__tests__/client.test.ts`:

```typescript
describe("MeegoClient — 工作项查询", () => {
  it("getWorkItem 应 POST /{project}/work_item/{type}/query", async () => {
    const rawItem = {
      id: 123,
      name: "登录页面",
      work_item_type_key: "story",
      fields: [{ field_key: "priority", field_value: { value: "1" } }],
    };
    const { fn, calls } = spyFetch({ err_code: 0, data: [rawItem] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getWorkItem("proj_a", "story", 123);

    expect(calls[0].url).toBe(
      "https://meego.test/open_api/proj_a/work_item/story/query",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(123);
      expect(result.data.workItemTypeKey).toBe("story");
    }
  });

  it("getWorkItemBrief 应返回格式化摘要", async () => {
    const rawItem = {
      id: 456,
      name: "修复登录崩溃",
      work_item_type_key: "issue",
      pattern: "State",
      work_item_status: { state_key: "OPEN" },
      fields: [{ field_key: "priority", field_value: { value: "0" } }],
      created_at: 1700000000,
      updated_at: 1700001000,
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 0, data: [rawItem] }),
    });

    const result = await client.getWorkItemBrief("proj_a", "issue", 456);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mode).toBe("状态流");
      expect(result.data.status).toBe("OPEN");
    }
  });

  it("searchWorkItems 应传递 filters 和分页参数", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { work_item_list: [], total_count: 0 },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.searchWorkItems("proj_a", "story", {
      filters: [
        { fieldKey: "name", fieldValue: "登录", operator: "LIKE" },
      ],
      limit: 5,
      pageNum: 2,
    });

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.work_item_type_keys).toEqual(["story"]);
    expect(body.limit).toBe(5);
    expect(body.page_num).toBe(2);
    expect(body.filters).toHaveLength(1);
    expect(body.filters[0].field_key).toBe("name");
  });

  it("searchWorkItems 无 filters 时不传 filters 字段", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { work_item_list: [] },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.searchWorkItems("proj_a", "issue");

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.filters).toBeUndefined();
    expect(body.limit).toBe(20);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: FAIL — methods not defined

- [ ] **Step 3: Implement getWorkItem, getWorkItemBrief, searchWorkItems**

Add to `MeegoClient` class in `packages/meego/src/client.ts`:

```typescript
  // ── 工作项查询 ──

  /**
   * 查询单个工作项详情
   *
   * @param projectKey - 项目 key
   * @param workItemType - 工作项类型 key（story / issue / task）
   * @param workItemId - 工作项 ID
   *
   * @example
   * ```typescript
   * const result = await client.getWorkItem("proj_a", "issue", 6887053145);
   * ```
   */
  async getWorkItem(
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkItem>> {
    const pk = this.resolveProjectKey(projectKey);
    const result = await this.request<unknown[]>(
      "POST",
      `/${pk}/work_item/${workItemType}/query`,
      { workItemIds: [workItemId] },
    );
    if (!result.ok) return result;
    const item = Array.isArray(result.data) && result.data.length > 0
      ? result.data[0]
      : null;
    if (!item) {
      return { ok: false, errCode: 30005, message: "工作项不存在" };
    }
    return { ok: true, data: item as import("./types.js").MeegoWorkItem };
  }

  /**
   * 查询工作项格式化摘要
   *
   * 在 getWorkItem 基础上启用 expand.need_multi_text，返回精简的 brief 结构。
   *
   * @example
   * ```typescript
   * const result = await client.getWorkItemBrief("proj_a", "issue", 123);
   * ```
   */
  async getWorkItemBrief(
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkItemBrief>> {
    const pk = this.resolveProjectKey(projectKey);
    const result = await this.request<unknown[]>(
      "POST",
      `/${pk}/work_item/${workItemType}/query`,
      { workItemIds: [workItemId], expand: { needMultiText: true } },
    );
    if (!result.ok) return result;
    const raw = Array.isArray(result.data) && result.data.length > 0
      ? (result.data[0] as Record<string, unknown>)
      : null;
    if (!raw) {
      return { ok: false, errCode: 30005, message: "工作项不存在" };
    }

    const fields: Record<string, unknown> = {};
    for (const pair of (raw.fields ?? raw.fieldValuePairs ?? []) as Array<{
      fieldKey: string;
      fieldValue: unknown;
    }>) {
      fields[pair.fieldKey] = pair.fieldValue;
    }

    const brief: import("./types.js").MeegoWorkItemBrief = {
      id: raw.id as number,
      name: raw.name as string,
      type: (raw.workItemTypeKey ?? workItemType) as string,
      mode: raw.pattern === "Node" ? "节点流" : "状态流",
      status: (raw.workItemStatus as Record<string, string> | undefined)?.stateKey,
      template: {
        id: raw.templateId as number | undefined,
        name: (raw.templateType ?? "") as string,
      },
      currentNodes: raw.pattern === "Node"
        ? ((raw.currentNodes ?? []) as Array<{ id: string; name: string }>)
        : undefined,
      fields,
      createdAt: raw.createdAt as number | undefined,
      updatedAt: raw.updatedAt as number | undefined,
      createdBy: raw.createdBy as string | undefined,
      updatedBy: raw.updatedBy as string | undefined,
    };

    return { ok: true, data: brief };
  }

  /**
   * 搜索/过滤工作项列表
   *
   * @example
   * ```typescript
   * const result = await client.searchWorkItems("proj_a", "story", {
   *   filters: [{ fieldKey: "name", fieldValue: "登录", operator: "LIKE" }],
   *   limit: 10,
   * });
   * ```
   */
  async searchWorkItems(
    projectKey: string,
    workItemType: string,
    opts?: import("./types.js").SearchWorkItemsOpts,
  ): Promise<MeegoApiResult<import("./types.js").MeegoSearchResult>> {
    const pk = this.resolveProjectKey(projectKey);
    const body: Record<string, unknown> = {
      workItemTypeKeys: [workItemType],
      limit: opts?.limit ?? 20,
      pageNum: opts?.pageNum ?? 1,
    };
    if (opts?.filters && opts.filters.length > 0) {
      body.filters = opts.filters;
    }
    return this.request("POST", `/${pk}/work_item/filter`, body);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/__tests__/client.test.ts
git commit -m "feat(meego): add getWorkItem, getWorkItemBrief, searchWorkItems"
```

---

### Task 5: Work Item Mutations — createWorkItem, updateWorkItem, deleteWorkItem

**Files:**
- Modify: `packages/meego/src/client.ts`
- Modify: `packages/meego/src/__tests__/client.test.ts`

- [ ] **Step 1: Write tests for mutation methods**

Append to `packages/meego/src/__tests__/client.test.ts`:

```typescript
describe("MeegoClient — 工作项写操作", () => {
  it("createWorkItem 应 POST /{project}/work_item/create", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: 999 });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.createWorkItem("proj_a", "issue", "登录崩溃", {
      fields: [{ fieldKey: "priority", fieldValue: { value: "1" } }],
    });

    expect(calls[0].url).toContain("/work_item/create");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.work_item_type_key).toBe("issue");
    expect(body.name).toBe("登录崩溃");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(999);
  });

  it("updateWorkItem 应 PUT /{project}/work_item/{type}/{id}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.updateWorkItem("proj_a", "issue", 123, [
      { fieldKey: "priority", fieldValue: { value: "0" } },
    ]);

    expect(calls[0].url).toContain("/work_item/issue/123");
    expect(calls[0].init?.method).toBe("PUT");
  });

  it("deleteWorkItem 应 DELETE /{project}/work_item/{type}/{id}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.deleteWorkItem("proj_a", "issue", 123);

    expect(calls[0].url).toContain("/work_item/issue/123");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement createWorkItem, updateWorkItem, deleteWorkItem**

Add to `MeegoClient` class in `packages/meego/src/client.ts`:

```typescript
  // ── 工作项写操作 ──

  /**
   * 创建工作项
   *
   * @returns 成功时 data 为新工作项 ID（number）
   *
   * @example
   * ```typescript
   * const result = await client.createWorkItem("proj_a", "issue", "登录崩溃");
   * ```
   */
  async createWorkItem(
    projectKey: string,
    workItemType: string,
    name: string,
    opts?: import("./types.js").CreateWorkItemOpts,
  ): Promise<MeegoApiResult<number>> {
    const pk = this.resolveProjectKey(projectKey);
    const body: Record<string, unknown> = {
      workItemTypeKey: workItemType,
      name,
    };
    if (opts?.fields) body.fieldValuePairs = opts.fields;
    if (opts?.templateId) body.templateId = opts.templateId;
    return this.request("POST", `/${pk}/work_item/create`, body);
  }

  /**
   * 更新工作项字段
   *
   * @example
   * ```typescript
   * await client.updateWorkItem("proj_a", "issue", 123, [
   *   { fieldKey: "priority", fieldValue: { value: "0" } },
   * ]);
   * ```
   */
  async updateWorkItem(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    fields: import("./types.js").MeegoFieldValuePair[],
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request(
      "PUT",
      `/${pk}/work_item/${workItemType}/${workItemId}`,
      { updateFields: fields },
    );
  }

  /**
   * 删除工作项
   *
   * @example
   * ```typescript
   * await client.deleteWorkItem("proj_a", "issue", 123);
   * ```
   */
  async deleteWorkItem(
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request(
      "DELETE",
      `/${pk}/work_item/${workItemType}/${workItemId}`,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/__tests__/client.test.ts
git commit -m "feat(meego): add createWorkItem, updateWorkItem, deleteWorkItem"
```

---

### Task 6: Workflow — getWorkflow, finishNode, updateNode, transitState, getTransitionFields

**Files:**
- Modify: `packages/meego/src/client.ts`
- Modify: `packages/meego/src/__tests__/client.test.ts`

- [ ] **Step 1: Write tests for workflow methods**

Append to `packages/meego/src/__tests__/client.test.ts`:

```typescript
describe("MeegoClient — 工作流操作", () => {
  it("getWorkflow 应 POST workflow/query with flowType", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: {
        workflow_nodes: [{ id: "n1", name: "开始" }],
        connections: [],
      },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getWorkflow("proj_a", "story", 123, 0);

    expect(calls[0].url).toContain("/workflow/query");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.flow_type).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("finishNode 应 POST node/{nodeId}/operate with action=confirm", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.finishNode("proj_a", "story", 123, "node-1", {
      owners: ["user_a"],
    });

    expect(calls[0].url).toContain("/node/node-1/operate");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.action).toBe("confirm");
    expect(body.node_owners).toEqual(["user_a"]);
  });

  it("updateNode 应 PUT node/{nodeId}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.updateNode("proj_a", "story", 123, "node-2", {
      owners: ["user_b"],
      schedule: { estimateStartDate: 1700000000000 },
    });

    expect(calls[0].url).toContain("/node/node-2");
    expect(calls[0].init?.method).toBe("PUT");
  });

  it("transitState 应 POST state_change with transitionId", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.transitState("proj_a", "issue", 123, {
      transitionId: 42,
    });

    expect(calls[0].url).toContain("/state_change");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.transition_id).toBe(42);
  });

  it("transitState 仅传 toState 时应先查 workflow 再匹配 transitionId", async () => {
    let callIndex = 0;
    const responses = [
      // 第一次调用：getWorkflow
      {
        err_code: 0,
        data: {
          state_flow_nodes: [
            { id: "OPEN", status: 2 },
            { id: "RESOLVED", status: 1 },
          ],
          connections: [
            { transition_id: 99, source_state_key: "OPEN", target_state_key: "RESOLVED" },
          ],
        },
      },
      // 第二次调用：state_change
      { err_code: 0, data: null },
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      const resp = responses[callIndex++];
      return new Response(JSON.stringify(resp), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.transitState("proj_a", "issue", 123, {
      toState: "RESOLVED",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/workflow/query");
    expect(calls[1].url).toContain("/state_change");
    const body = JSON.parse(calls[1].init?.body as string);
    expect(body.transition_id).toBe(99);
    expect(result.ok).toBe(true);
  });

  it("transitState 仅传 toState 但找不到匹配流转时应返回错误", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({
        err_code: 0,
        data: {
          state_flow_nodes: [{ id: "OPEN", status: 2 }],
          connections: [],
        },
      }),
    });

    const result = await client.transitState("proj_a", "issue", 123, {
      toState: "RESOLVED",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("RESOLVED");
    }
  });

  it("getTransitionFields 应 POST transition_required_info/get", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { form_items: [{ key: "priority", class: "field", finished: false }] },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getTransitionFields("proj_a", "issue", 123, "RESOLVED");

    expect(calls[0].url).toContain("/transition_required_info/get");
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement all 5 workflow methods**

Add to `MeegoClient` class in `packages/meego/src/client.ts`:

```typescript
  // ── 工作流操作 ──

  /**
   * 获取工作项工作流详情
   *
   * @param flowType - 0 = 节点流（story/epic）, 1 = 状态流（issue）
   *
   * @example
   * ```typescript
   * const result = await client.getWorkflow("proj_a", "issue", 123, 1);
   * ```
   */
  async getWorkflow(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    flowType: 0 | 1 = 1,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkflowDetail>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request(
      "POST",
      `/${pk}/work_item/${workItemType}/${workItemId}/workflow/query`,
      { flowType },
    );
  }

  /**
   * 完成工作流节点（Node 模式工作项，如 story/epic）
   *
   * @example
   * ```typescript
   * await client.finishNode("proj_a", "story", 123, "node-1", { owners: ["user_a"] });
   * ```
   */
  async finishNode(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    nodeId: string,
    opts?: import("./types.js").NodeOperateOpts,
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    const body: Record<string, unknown> = { action: "confirm" };
    if (opts?.owners) body.nodeOwners = opts.owners;
    if (opts?.schedule) body.nodeSchedule = opts.schedule;
    if (opts?.fields) body.fields = opts.fields;
    return this.request(
      "POST",
      `/${pk}/workflow/${workItemType}/${workItemId}/node/${nodeId}/operate`,
      body,
    );
  }

  /**
   * 更新工作流节点（Node 模式，不流转节点）
   *
   * @example
   * ```typescript
   * await client.updateNode("proj_a", "story", 123, "node-2", { owners: ["user_b"] });
   * ```
   */
  async updateNode(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    nodeId: string,
    opts?: import("./types.js").NodeOperateOpts,
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    const body: Record<string, unknown> = {};
    if (opts?.owners) body.nodeOwners = opts.owners;
    if (opts?.schedule) body.nodeSchedule = opts.schedule;
    if (opts?.fields) body.fields = opts.fields;
    return this.request(
      "PUT",
      `/${pk}/workflow/${workItemType}/${workItemId}/node/${nodeId}`,
      body,
    );
  }

  /**
   * 流转工作项状态（State 模式，如 issue/缺陷）
   *
   * 当仅传 toState 时，内部先调 getWorkflow 查出当前状态和可用流转，
   * 匹配目标状态的 transitionId 后再执行流转。
   *
   * @example
   * ```typescript
   * await client.transitState("proj_a", "issue", 123, { toState: "RESOLVED" });
   * await client.transitState("proj_a", "issue", 123, { transitionId: 42 });
   * ```
   */
  async transitState(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    opts: import("./types.js").TransitStateOpts,
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    let transitionId = opts.transitionId;

    if (transitionId === undefined) {
      if (!opts.toState) {
        return {
          ok: false,
          errCode: -1,
          message: "toState 或 transitionId 必须提供其一",
        };
      }

      const wfResult = await this.getWorkflow(pk, workItemType, workItemId, 1);
      if (!wfResult.ok) return wfResult;

      const nodes = wfResult.data.stateFlowNodes ?? [];
      let currentState: string | undefined;
      for (const node of nodes) {
        if (node.status === 2) {
          currentState = node.id;
          break;
        }
      }
      if (!currentState) {
        return {
          ok: false,
          errCode: -1,
          message: "无法确定当前状态（无 status=2 节点）",
        };
      }

      const target = opts.toState.toUpperCase();
      for (const conn of wfResult.data.connections ?? []) {
        if (
          conn.sourceStateKey === currentState &&
          conn.targetStateKey.toUpperCase() === target
        ) {
          transitionId = conn.transitionId;
          break;
        }
      }

      if (transitionId === undefined) {
        return {
          ok: false,
          errCode: -1,
          message: `无法从状态 ${currentState} 流转到 ${opts.toState}`,
        };
      }
    }

    const body: Record<string, unknown> = { transitionId };
    if (opts.fields) body.fields = opts.fields;
    if (opts.roleOwners) body.roleOwners = opts.roleOwners;
    return this.request(
      "POST",
      `/${pk}/workflow/${workItemType}/${workItemId}/node/state_change`,
      body,
    );
  }

  /**
   * 探测状态流转的必填字段（不实际执行流转）
   *
   * @example
   * ```typescript
   * const result = await client.getTransitionFields("proj_a", "issue", 123, "RESOLVED");
   * ```
   */
  async getTransitionFields(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    toState: string,
  ): Promise<MeegoApiResult<import("./types.js").MeegoTransitionFieldItem[]>> {
    const result = await this.request<{
      formItems: import("./types.js").MeegoTransitionFieldItem[];
    }>("POST", "/work_item/transition_required_info/get", {
      projectKey: this.resolveProjectKey(projectKey),
      workItemTypeKey: workItemType,
      workItemId,
      stateKey: toState,
      mode: "unfinished",
    });
    if (!result.ok) return result;
    return { ok: true, data: result.data.formItems ?? [] };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/__tests__/client.test.ts
git commit -m "feat(meego): add workflow operations (getWorkflow, finishNode, updateNode, transitState, getTransitionFields)"
```

---

### Task 7: File Operations — uploadFile, addAttachment

**Files:**
- Modify: `packages/meego/src/client.ts`
- Modify: `packages/meego/src/__tests__/client.test.ts`

- [ ] **Step 1: Write tests for file upload methods**

Append to `packages/meego/src/__tests__/client.test.ts`:

```typescript
describe("MeegoClient — 文件操作", () => {
  it("uploadFile 应使用 FormData 并 POST /{project}/file/upload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ err_code: 0, data: "file-token-abc" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const file = new Blob(["hello"], { type: "text/plain" });
    const result = await client.uploadFile("proj_a", file, "test.txt");

    expect(calls[0].url).toContain("/file/upload");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("file-token-abc");
  });

  it("addAttachment 应使用 FormData 并 POST /{project}/work_item/{type}/{id}/file/upload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: typeof globalThis.fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({ err_code: 0, data: "attach-token-xyz" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const file = new Blob(["pdf content"], { type: "application/pdf" });
    const result = await client.addAttachment("proj_a", "issue", 123, file, "report.pdf", {
      fieldKey: "attachment_field",
    });

    expect(calls[0].url).toContain("/work_item/issue/123/file/upload");
    expect(calls[0].init?.method).toBe("POST");
    const formData = calls[0].init?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("field_key")).toBe("attachment_field");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("attach-token-xyz");
  });

  it("uploadFile 在 API 返回错误时应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: async () =>
        new Response(
          JSON.stringify({ err_code: 10001, err_msg: "no permission" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
    });

    const file = new Blob(["data"]);
    const result = await client.uploadFile("proj_a", file, "test.txt");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errCode).toBe(10001);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: FAIL — `uploadFile` / `addAttachment` not defined

- [ ] **Step 3: Implement uploadFile and addAttachment**

Add to `MeegoClient` class in `packages/meego/src/client.ts`:

```typescript
  // ── 文件操作 ──

  /**
   * 上传文件到 Meego 空间
   *
   * 使用 FormData 上传文件（不走 JSON request()，因为需要 multipart/form-data）。
   * 响应解析与错误处理复用 isMeegoSuccess / extractMeegoError。
   *
   * @param projectKey - 项目 key
   * @param file - 文件内容（File / Blob）
   * @param filename - 文件名
   * @returns 成功时 data 为文件 token（string）
   *
   * @example
   * ```typescript
   * const result = await client.uploadFile("proj_a", blob, "screenshot.png");
   * ```
   */
  async uploadFile(
    projectKey: string,
    file: File | Blob,
    filename: string,
  ): Promise<MeegoApiResult<string>> {
    const pk = this.resolveProjectKey(projectKey);
    const url = `${this.baseUrl}/open_api/${pk}/file/upload`;
    const form = new FormData();
    form.append("file", file, filename);

    return this.requestFormData<string>(url, form);
  }

  /**
   * 向工作项附件字段添加附件
   *
   * @param projectKey - 项目 key
   * @param workItemType - 工作项类型 key
   * @param workItemId - 工作项 ID
   * @param file - 文件内容（File / Blob）
   * @param filename - 文件名
   * @param opts - 附件字段定位参数
   * @returns 成功时 data 为附件 token（string）
   *
   * @example
   * ```typescript
   * const result = await client.addAttachment("proj_a", "issue", 123, blob, "log.txt", {
   *   fieldKey: "attachment",
   * });
   * ```
   */
  async addAttachment(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    file: File | Blob,
    filename: string,
    opts?: import("./types.js").AddAttachmentOpts,
  ): Promise<MeegoApiResult<string>> {
    const pk = this.resolveProjectKey(projectKey);
    const url = `${this.baseUrl}/open_api/${pk}/work_item/${workItemType}/${workItemId}/file/upload`;
    const form = new FormData();
    form.append("file", file, filename);
    if (opts?.fieldKey) form.append("field_key", opts.fieldKey);
    if (opts?.fieldAlias) form.append("field_alias", opts.fieldAlias);
    if (opts?.index) form.append("index", opts.index);

    return this.requestFormData<string>(url, form);
  }

  /**
   * FormData 请求的通用处理（文件上传专用）
   *
   * 与 request() 类似，但 body 是 FormData 而非 JSON。
   * 不设置 Content-Type header（让浏览器/Bun 自动设置 multipart boundary）。
   */
  private async requestFormData<T>(
    url: string,
    form: FormData,
  ): Promise<MeegoApiResult<T>> {
    try {
      const resp = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "X-PLUGIN-TOKEN": this.token,
          "X-USER-KEY": this.userKey,
        },
        body: form,
      });

      let raw: Record<string, unknown>;
      try {
        raw = (await resp.json()) as Record<string, unknown>;
      } catch {
        return {
          ok: false,
          errCode: resp.status,
          message: `HTTP ${resp.status}: 响应体非 JSON`,
        };
      }

      if (isMeegoSuccess(raw)) {
        return { ok: true, data: raw.data as T };
      }

      const error = extractMeegoError(raw);
      logger.warn({ url, ...error }, "Meego 文件上传失败");
      return { ok: false, ...error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ url, err }, "Meego 文件上传网络错误");
      return { ok: false, errCode: -1, message };
    }
  }
```

> **注意**：`requestFormData` 不做 snake_case → camelCase 转换，因为文件上传接口返回的 data 是简单的 string token，不需要转换。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/meego && bun vitest run src/__tests__/client.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/__tests__/client.test.ts
git commit -m "feat(meego): add uploadFile and addAttachment with FormData"
```

---

### Task 8: Cleanup & Exports — Remove placeholder comment, update index.ts

**Files:**
- Modify: `packages/meego/src/client.ts`
- Modify: `packages/meego/src/index.ts`

- [ ] **Step 1: Remove stale placeholder comment from client.ts**

In `packages/meego/src/client.ts`, delete the two placeholder comment lines that were added in Task 3:

```typescript
  // ── 占位方法，后续 Task 逐步实现 ──
  // （Task 4-8 将替换这些占位）
```

These are no longer accurate since all methods are now implemented.

- [ ] **Step 2: Update index.ts to export MeegoClient and API types**

Replace the entire `packages/meego/src/index.ts` with:

```typescript
// @teamsland/meego — Meego 事件摄入、人工确认、API 客户端
// 提供：MeegoEventBus（去重调度）、MeegoConnector（三模式接入）、
//       ConfirmationWatcher（确认提醒）、MeegoClient（OpenAPI 全量操作）

// ── Event Ingestion ──
export { ConfirmationWatcher } from "./confirmation.js";
export type { MeegoConnectorOpts } from "./connector.js";
export { MeegoConnector } from "./connector.js";
export { MeegoEventBus } from "./event-bus.js";

// ── API Client ──
export { MeegoClient } from "./client.js";
export type { MeegoClientOpts } from "./client.js";

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
  MeegoWorkItem,
  MeegoWorkItemBrief,
  MeegoWorkItemListEntry,
  MeegoWorkflowDetail,
  MeegoWorkflowNode,
  NodeOperateOpts,
  SearchWorkItemsOpts,
  TransitStateOpts,
} from "./types.js";
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/meego && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run all tests in the package**

Run: `cd packages/meego && bun vitest run`
Expected: All pass (both client.test.ts and connector.test.ts)

- [ ] **Step 5: Commit**

```bash
git add packages/meego/src/client.ts packages/meego/src/index.ts
git commit -m "feat(meego): clean up placeholders and export MeegoClient + API types"
```
