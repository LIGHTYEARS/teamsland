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

  /**
   * FormData 请求的通用处理，文件上传专用。
   *
   * @returns Meego API 统一结果。
   *
   * @example
   * ```typescript
   * const form = new FormData();
   * form.append("file", blob, "demo.txt");
   * // 由 uploadFile/addAttachment 间接调用。
   * ```
   */
  private async requestFormData<T>(url: string, form: FormData): Promise<MeegoApiResult<T>> {
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

  /** 解析项目 key，优先使用参数值，其次使用默认值 */
  private resolveProjectKey(projectKey?: string): string {
    const key = projectKey ?? this.defaultProjectKey;
    if (!key) throw new Error("projectKey is required (no default configured)");
    return key;
  }

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

  // ── 工作项写操作 ──

  /**
   * 创建工作项
   *
   * @returns 成功时 data 为新工作项 ID（number）
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
   */
  async updateWorkItem(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    fields: import("./types.js").MeegoFieldValuePair[],
  ): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request("PUT", `/${pk}/work_item/${workItemType}/${workItemId}`, { updateFields: fields });
  }

  /**
   * 删除工作项
   */
  async deleteWorkItem(projectKey: string, workItemType: string, workItemId: number): Promise<MeegoApiResult<null>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request("DELETE", `/${pk}/work_item/${workItemType}/${workItemId}`);
  }

  // ── 工作流操作 ──

  /**
   * 获取工作项工作流详情。
   *
   * @param flowType - 0 表示节点流，1 表示状态流。
   * @returns 工作流节点、状态流节点和连接关系。
   *
   * @example
   * ```typescript
   * const result = await client.getWorkflow("proj_a", "issue", 123, 1);
   * if (result.ok) {
   *   console.log(result.data.connections);
   * }
   * ```
   */
  async getWorkflow(
    projectKey: string,
    workItemType: string,
    workItemId: number,
    flowType: 0 | 1 = 1,
  ): Promise<MeegoApiResult<import("./types.js").MeegoWorkflowDetail>> {
    const pk = this.resolveProjectKey(projectKey);
    return this.request("POST", `/${pk}/work_item/${workItemType}/${workItemId}/workflow/query`, { flowType });
  }

  /**
   * 完成节点流工作项中的指定节点。
   *
   * @returns Meego API 统一结果，成功时 data 为 null。
   *
   * @example
   * ```typescript
   * await client.finishNode("proj_a", "story", 123, "node-1", {
   *   owners: ["user_a"],
   * });
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
    return this.request("POST", `/${pk}/workflow/${workItemType}/${workItemId}/node/${nodeId}/operate`, body);
  }

  /**
   * 更新节点流工作项中的指定节点信息。
   *
   * @returns Meego API 统一结果，成功时 data 为 null。
   *
   * @example
   * ```typescript
   * await client.updateNode("proj_a", "story", 123, "node-2", {
   *   owners: ["user_b"],
   * });
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
    return this.request("PUT", `/${pk}/workflow/${workItemType}/${workItemId}/node/${nodeId}`, body);
  }

  /**
   * 流转状态流工作项。
   *
   * 如果只传入 `toState`，会先读取工作流并匹配当前状态到目标状态的 transitionId。
   *
   * @returns Meego API 统一结果，成功时 data 为 null。
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

      const currentState = wfResult.data.stateFlowNodes?.find((node) => node.status === 2)?.id;
      if (!currentState) {
        return {
          ok: false,
          errCode: -1,
          message: "无法确定当前状态（无 status=2 节点）",
        };
      }

      const target = opts.toState.toUpperCase();
      transitionId = wfResult.data.connections?.find(
        (conn) => conn.sourceStateKey === currentState && conn.targetStateKey.toUpperCase() === target,
      )?.transitionId;

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
    return this.request("POST", `/${pk}/workflow/${workItemType}/${workItemId}/node/state_change`, body);
  }

  /**
   * 查询状态流转所需字段，不实际执行流转。
   *
   * @returns 目标状态流转前需要填写的字段列表。
   *
   * @example
   * ```typescript
   * const result = await client.getTransitionFields("proj_a", "issue", 123, "RESOLVED");
   * if (result.ok) {
   *   console.log(result.data.map((item) => item.key));
   * }
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

  // ── 文件操作 ──

  /**
   * 上传文件到 Meego 空间。
   *
   * @param projectKey - 项目 key。
   * @param file - 文件内容。
   * @param filename - 文件名。
   * @returns 成功时 data 为文件 token。
   *
   * @example
   * ```typescript
   * const blob = new Blob(["hello"], { type: "text/plain" });
   * const result = await client.uploadFile("proj_a", blob, "hello.txt");
   * ```
   */
  async uploadFile(projectKey: string, file: File | Blob, filename: string): Promise<MeegoApiResult<string>> {
    const pk = this.resolveProjectKey(projectKey);
    const url = `${this.baseUrl}/open_api/${pk}/file/upload`;
    const form = new FormData();
    form.append("file", file, filename);
    return this.requestFormData<string>(url, form);
  }

  /**
   * 向工作项附件字段添加附件。
   *
   * @param projectKey - 项目 key。
   * @param workItemType - 工作项类型 key。
   * @param workItemId - 工作项 ID。
   * @param file - 文件内容。
   * @param filename - 文件名。
   * @param opts - 附件字段定位参数。
   * @returns 成功时 data 为附件 token。
   *
   * @example
   * ```typescript
   * const blob = new Blob(["log"]);
   * await client.addAttachment("proj_a", "issue", 123, blob, "log.txt", {
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
}
