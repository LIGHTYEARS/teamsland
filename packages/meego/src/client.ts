import { createLogger } from "@teamsland/observability";
import type { MeegoApiResult } from "./types.js";

const logger = createLogger("meego:client");

/**
 * MeegoClient 构造参数
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
  fetchFn?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

/**
 * 判断 Meego API 原始响应是否成功（兼容双格式）
 *
 * 格式 A: `{ err_code: 0, data: ... }`
 * 格式 B: `{ error: { code: 0, msg: "" }, data: ... }`
 */
function isMeegoSuccess(raw: Record<string, unknown>): boolean {
  if (raw.err_code === 0) return true;
  if (typeof raw.error === "object" && raw.error !== null && (raw.error as Record<string, unknown>).code === 0) {
    return true;
  }
  return false;
}

/**
 * 从 Meego API 原始响应提取错误信息（兼容双格式）
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

/** snake_case 字符串转 camelCase */
function snakeToCamelStr(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** 递归将对象的 snake_case 属性名转为 camelCase */
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

/** camelCase 字符串转 snake_case */
function camelToSnakeStr(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** 递归将对象的 camelCase 属性名转为 snake_case（用于请求体） */
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
 */
export class MeegoClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly userKey: string;
  private readonly defaultProjectKey: string | undefined;
  private readonly fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

  constructor(opts: MeegoClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.userKey = opts.userKey;
    this.defaultProjectKey = opts.defaultProjectKey;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  /**
   * 统一 HTTP 请求方法
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
  async searchUsers(query: string, projectKey?: string): Promise<MeegoApiResult<import("./types.js").MeegoUser[]>> {
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

  // ── 工作项查询 ──

  /**
   * 查询单个工作项详情
   */
  async getWorkItem(
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkItem>> {
    const pk = this.resolveProjectKey(projectKey);
    const result = await this.request<unknown[]>("POST", `/${pk}/work_item/${workItemType}/query`, {
      workItemIds: [workItemId],
    });
    if (!result.ok) return result;
    const item = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : null;
    if (!item) {
      return { ok: false, errCode: 30005, message: "工作项不存在" };
    }
    return { ok: true, data: item as import("./types.js").MeegoWorkItem };
  }

  /**
   * 查询工作项格式化摘要
   */
  async getWorkItemBrief(
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkItemBrief>> {
    const pk = this.resolveProjectKey(projectKey);
    const result = await this.request<unknown[]>("POST", `/${pk}/work_item/${workItemType}/query`, {
      workItemIds: [workItemId],
      expand: { needMultiText: true },
    });
    if (!result.ok) return result;
    const raw =
      Array.isArray(result.data) && result.data.length > 0 ? (result.data[0] as Record<string, unknown>) : null;
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
      currentNodes:
        raw.pattern === "Node" ? ((raw.currentNodes ?? []) as Array<{ id: string; name: string }>) : undefined,
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
}
