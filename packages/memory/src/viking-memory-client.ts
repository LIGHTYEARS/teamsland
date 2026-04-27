import { createLogger } from "@teamsland/observability";
import type { OpenVikingConfig } from "@teamsland/types";

const logger = createLogger("memory:viking-client");

// ─── 类型定义 ───

/**
 * 搜索结果中的单条记录
 *
 * 代表一条记忆、资源或技能命中项，包含评分和匹配原因。
 *
 * @example
 * ```typescript
 * import type { FindResultItem } from "@teamsland/memory";
 *
 * const item: FindResultItem = {
 *   uri: "mem://memories/deployment-guide",
 *   context_type: "memory",
 *   is_leaf: true,
 *   abstract: "部署流程指南",
 *   category: "operations",
 *   score: 0.92,
 *   match_reason: "keyword match on '部署'",
 * };
 * ```
 */
export interface FindResultItem {
  uri: string;
  context_type: "resource" | "memory" | "skill";
  is_leaf: boolean;
  abstract: string;
  category: string;
  score: number;
  match_reason: string;
}

/**
 * 搜索结果集合
 *
 * 将命中项按类型（记忆 / 资源 / 技能）分组并附带总数。
 *
 * @example
 * ```typescript
 * import type { FindResult } from "@teamsland/memory";
 *
 * const result: FindResult = {
 *   memories: [],
 *   resources: [],
 *   skills: [],
 *   total: 0,
 * };
 * ```
 */
export interface FindResult {
  memories: FindResultItem[];
  resources: FindResultItem[];
  skills: FindResultItem[];
  total: number;
}

/**
 * 搜索选项
 *
 * 用于过滤和约束 find 请求的可选参数。
 *
 * @example
 * ```typescript
 * import type { FindOptions } from "@teamsland/memory";
 *
 * const opts: FindOptions = {
 *   targetUri: "mem://project",
 *   limit: 20,
 *   scoreThreshold: 0.5,
 * };
 * ```
 */
export interface FindOptions {
  targetUri?: string;
  limit?: number;
  scoreThreshold?: number;
  since?: string;
  until?: string;
}

/**
 * 写入选项
 *
 * 控制内容写入行为的可选参数。
 *
 * @example
 * ```typescript
 * import type { WriteOptions } from "@teamsland/memory";
 *
 * const opts: WriteOptions = {
 *   mode: "replace",
 *   wait: true,
 *   timeout: 10000,
 * };
 * ```
 */
export interface WriteOptions {
  mode?: "replace" | "create" | "append";
  wait?: boolean;
  timeout?: number;
}

/**
 * 添加资源选项
 *
 * 控制资源导入行为的参数。
 *
 * @example
 * ```typescript
 * import type { AddResourceOptions } from "@teamsland/memory";
 *
 * const opts: AddResourceOptions = {
 *   to: "mem://resources/project",
 *   reason: "项目代码导入",
 *   ignore_dirs: "node_modules,.git",
 * };
 * ```
 */
export interface AddResourceOptions {
  to: string;
  reason?: string;
  wait?: boolean;
  ignore_dirs?: string;
  include?: string;
  exclude?: string;
}

/**
 * 资源操作结果
 *
 * 包含资源 URI 以及可选的异步任务 ID。
 *
 * @example
 * ```typescript
 * import type { ResourceResult } from "@teamsland/memory";
 *
 * const result: ResourceResult = {
 *   uri: "mem://resources/project/src",
 *   task_id: "task-abc123",
 * };
 * ```
 */
export interface ResourceResult {
  uri: string;
  task_id?: string;
}

/**
 * 文件系统条目
 *
 * 表示 OpenViking 虚拟文件系统中的文件或目录。
 *
 * @example
 * ```typescript
 * import type { FsEntry } from "@teamsland/memory";
 *
 * const entry: FsEntry = {
 *   name: "notes.md",
 *   uri: "mem://memories/notes.md",
 *   is_dir: false,
 *   size: 1024,
 * };
 * ```
 */
export interface FsEntry {
  name: string;
  uri: string;
  is_dir: boolean;
  size?: number;
}

/**
 * 会话上下文
 *
 * 包含最新归档概述、归档摘要列表、消息历史和 token 估算。
 *
 * @example
 * ```typescript
 * import type { SessionContext } from "@teamsland/memory";
 *
 * const ctx: SessionContext = {
 *   latest_archive_overview: "本次会话讨论了部署流程",
 *   pre_archive_abstracts: [],
 *   messages: [],
 *   estimatedTokens: 500,
 * };
 * ```
 */
export interface SessionContext {
  latest_archive_overview: string;
  pre_archive_abstracts: Array<{ archive_id: string; abstract: string }>;
  messages: Array<{
    id: string;
    role: string;
    parts: unknown[];
    created_at: string;
  }>;
  estimatedTokens: number;
}

/**
 * 会话提交结果
 *
 * 会话归档后返回的状态和任务信息。
 *
 * @example
 * ```typescript
 * import type { CommitResult } from "@teamsland/memory";
 *
 * const result: CommitResult = {
 *   session_id: "sess-abc",
 *   status: "accepted",
 *   task_id: "task-1",
 *   archive_uri: "mem://archives/sess-abc",
 * };
 * ```
 */
export interface CommitResult {
  session_id: string;
  status: "accepted";
  task_id: string;
  archive_uri: string;
}

/**
 * 异步任务状态
 *
 * 查询 OpenViking 后台任务的执行进度。
 *
 * @example
 * ```typescript
 * import type { TaskStatus } from "@teamsland/memory";
 *
 * const task: TaskStatus = {
 *   task_id: "task-1",
 *   task_type: "archive",
 *   status: "running",
 * };
 * ```
 */
export interface TaskStatus {
  task_id: string;
  task_type: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: Record<string, unknown>;
}

export interface GrepMatch {
  uri: string;
  line: number;
  content: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  count: number;
}

export interface GlobResult {
  matches: string[];
  count: number;
}

// ─── 接口 ───

/**
 * OpenViking 记忆服务客户端接口
 *
 * 定义与 OpenViking server 交互的所有操作，
 * 包含搜索、内容读写、文件系统、会话管理和任务查询。
 *
 * @example
 * ```typescript
 * import type { IVikingMemoryClient } from "@teamsland/memory";
 *
 * async function useMemory(client: IVikingMemoryClient) {
 *   const healthy = await client.healthCheck();
 *   if (healthy) {
 *     const result = await client.find("部署流程");
 *     console.log(result.total);
 *   }
 * }
 * ```
 */
export interface IVikingMemoryClient {
  healthCheck(): Promise<boolean>;
  find(query: string, opts?: FindOptions): Promise<FindResult>;
  read(uri: string): Promise<string>;
  abstract(uri: string): Promise<string>;
  overview(uri: string): Promise<string>;
  write(uri: string, content: string, opts?: WriteOptions): Promise<void>;
  ls(uri: string): Promise<FsEntry[]>;
  mkdir(uri: string, description?: string): Promise<void>;
  rm(uri: string, recursive?: boolean): Promise<void>;
  mv(fromUri: string, toUri: string): Promise<void>;
  grep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<GrepResult>;
  glob(pattern: string, uri?: string): Promise<GlobResult>;
  addResource(path: string, opts: AddResourceOptions): Promise<ResourceResult>;
  createSession(id?: string): Promise<string>;
  getSessionContext(id: string, tokenBudget?: number): Promise<SessionContext>;
  addMessage(sessionId: string, role: string, content: string): Promise<void>;
  commitSession(sessionId: string): Promise<CommitResult>;
  deleteSession(sessionId: string): Promise<void>;
  getTask(taskId: string): Promise<TaskStatus>;
}

// ─── 实现 ───

/**
 * OpenViking 记忆服务 HTTP 客户端
 *
 * 通过 HTTP 调用独立部署的 OpenViking server，实现记忆检索、内容管理、
 * 会话管理等完整功能。所有请求自动附带 agent 标识和 API Key。
 *
 * @example
 * ```typescript
 * import { VikingMemoryClient } from "@teamsland/memory";
 *
 * const client = new VikingMemoryClient({
 *   baseUrl: "http://127.0.0.1:1933",
 *   agentId: "teamsland",
 *   timeoutMs: 30000,
 *   heartbeatIntervalMs: 30000,
 *   heartbeatFailThreshold: 3,
 * });
 *
 * const ok = await client.healthCheck();
 * if (ok) {
 *   const result = await client.find("部署流程");
 *   console.log(`找到 ${result.total} 条结果`);
 * }
 * ```
 */
export class VikingMemoryClient implements IVikingMemoryClient {
  private readonly baseUrl: string;
  private readonly agentId: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(config: OpenVikingConfig) {
    this.baseUrl = config.baseUrl;
    this.agentId = config.agentId;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    logger.info({ baseUrl: this.baseUrl, agentId: this.agentId }, "VikingMemoryClient 初始化");
  }

  /**
   * 通用 HTTP 请求方法
   *
   * 自动附带 agent 标识、API Key 和超时控制。
   * 解析 OpenViking 标准响应格式并提取 result 字段。
   */
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers(init.headers ?? {});
      headers.set("X-OpenViking-Agent", this.agentId);
      if (this.apiKey) headers.set("X-API-Key", this.apiKey);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        result?: T;
        error?: { code?: string; message?: string };
      };
      if (!response.ok || payload.status === "error") {
        const code = payload.error?.code ? ` [${payload.error.code}]` : "";
        const msg = payload.error?.message ?? `HTTP ${response.status}`;
        throw new Error(`OpenViking request failed${code}: ${msg}`);
      }
      return (payload.result ?? payload) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<unknown>("/health");
      logger.debug("healthCheck 成功");
      return true;
    } catch (err: unknown) {
      logger.warn({ error: err instanceof Error ? err.message : String(err) }, "healthCheck 失败");
      return false;
    }
  }

  async find(query: string, opts?: FindOptions): Promise<FindResult> {
    logger.debug({ query, opts }, "find 请求");
    return this.request<FindResult>("/api/v1/search/find", {
      method: "POST",
      body: JSON.stringify({ query, ...opts }),
    });
  }

  async read(uri: string): Promise<string> {
    logger.debug({ uri }, "read 请求");
    return this.request<string>(`/api/v1/content/read?uri=${encodeURIComponent(uri)}`);
  }

  async abstract(uri: string): Promise<string> {
    logger.debug({ uri }, "abstract 请求");
    return this.request<string>(`/api/v1/content/abstract?uri=${encodeURIComponent(uri)}`);
  }

  async overview(uri: string): Promise<string> {
    logger.debug({ uri }, "overview 请求");
    return this.request<string>(`/api/v1/content/overview?uri=${encodeURIComponent(uri)}`);
  }

  async write(uri: string, content: string, opts?: WriteOptions): Promise<void> {
    logger.debug({ uri, opts }, "write 请求");
    await this.request<unknown>("/api/v1/content/write", {
      method: "POST",
      body: JSON.stringify({ uri, content, ...opts }),
    });
  }

  async ls(uri: string): Promise<FsEntry[]> {
    logger.debug({ uri }, "ls 请求");
    return this.request<FsEntry[]>(`/api/v1/fs/ls?uri=${encodeURIComponent(uri)}`);
  }

  async mkdir(uri: string, description?: string): Promise<void> {
    logger.debug({ uri, description }, "mkdir 请求");
    await this.request<unknown>("/api/v1/fs/mkdir", {
      method: "POST",
      body: JSON.stringify({ uri, description }),
    });
  }

  async rm(uri: string, recursive?: boolean): Promise<void> {
    logger.debug({ uri, recursive }, "rm 请求");
    const params = new URLSearchParams({ uri });
    if (recursive !== undefined) {
      params.set("recursive", String(recursive));
    }
    await this.request<unknown>(`/api/v1/fs/rm?${params.toString()}`, {
      method: "DELETE",
    });
  }

  async mv(fromUri: string, toUri: string): Promise<void> {
    logger.debug({ fromUri, toUri }, "mv 请求");
    await this.request<unknown>("/api/v1/fs/mv", {
      method: "POST",
      body: JSON.stringify({ from_uri: fromUri, to_uri: toUri }),
    });
  }

  async grep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<GrepResult> {
    logger.debug({ uri, pattern, opts }, "grep 请求");
    return this.request<GrepResult>("/api/v1/search/grep", {
      method: "POST",
      body: JSON.stringify({ uri, pattern, case_insensitive: opts?.caseInsensitive }),
    });
  }

  async glob(pattern: string, uri?: string): Promise<GlobResult> {
    logger.debug({ pattern, uri }, "glob 请求");
    return this.request<GlobResult>("/api/v1/search/glob", {
      method: "POST",
      body: JSON.stringify({ pattern, uri }),
    });
  }

  async addResource(path: string, opts: AddResourceOptions): Promise<ResourceResult> {
    logger.debug({ path, opts }, "addResource 请求");
    return this.request<ResourceResult>("/api/v1/resources", {
      method: "POST",
      body: JSON.stringify({ path, ...opts }),
    });
  }

  async createSession(id?: string): Promise<string> {
    logger.debug({ id }, "createSession 请求");
    const result = await this.request<{ session_id: string }>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify(id !== undefined ? { session_id: id } : {}),
    });
    return result.session_id;
  }

  async getSessionContext(id: string, tokenBudget?: number): Promise<SessionContext> {
    logger.debug({ id, tokenBudget }, "getSessionContext 请求");
    const params = new URLSearchParams();
    if (tokenBudget !== undefined) {
      params.set("token_budget", String(tokenBudget));
    }
    const query = params.toString();
    const suffix = query ? `?${query}` : "";
    return this.request<SessionContext>(`/api/v1/sessions/${encodeURIComponent(id)}/context${suffix}`);
  }

  async addMessage(sessionId: string, role: string, content: string): Promise<void> {
    logger.debug({ sessionId, role }, "addMessage 请求");
    await this.request<unknown>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content }),
    });
  }

  async commitSession(sessionId: string): Promise<CommitResult> {
    logger.debug({ sessionId }, "commitSession 请求");
    return this.request<CommitResult>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/commit`, { method: "POST" });
  }

  async deleteSession(sessionId: string): Promise<void> {
    logger.debug({ sessionId }, "deleteSession 请求");
    await this.request<unknown>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  }

  async getTask(taskId: string): Promise<TaskStatus> {
    logger.debug({ taskId }, "getTask 请求");
    return this.request<TaskStatus>(`/api/v1/tasks/${encodeURIComponent(taskId)}`);
  }
}

// ─── 空操作实现 ───

/**
 * 空操作 OpenViking 客户端
 *
 * 当 OpenViking 服务不可用时的降级替代。
 * 所有读操作返回空结果，所有写操作为静默空操作。
 *
 * @example
 * ```typescript
 * import { NullVikingMemoryClient } from "@teamsland/memory";
 *
 * const client = new NullVikingMemoryClient();
 * const healthy = await client.healthCheck(); // false
 * const result = await client.find("任意查询"); // { memories: [], resources: [], skills: [], total: 0 }
 * ```
 */
export class NullVikingMemoryClient implements IVikingMemoryClient {
  async healthCheck(): Promise<boolean> {
    return false;
  }

  async find(_query: string, _opts?: FindOptions): Promise<FindResult> {
    return { memories: [], resources: [], skills: [], total: 0 };
  }

  async read(_uri: string): Promise<string> {
    return "";
  }

  async abstract(_uri: string): Promise<string> {
    return "";
  }

  async overview(_uri: string): Promise<string> {
    return "";
  }

  async write(_uri: string, _content: string, _opts?: WriteOptions): Promise<void> {
    // 空操作
  }

  async ls(_uri: string): Promise<FsEntry[]> {
    return [];
  }

  async mkdir(_uri: string, _description?: string): Promise<void> {
    // 空操作
  }

  async rm(_uri: string, _recursive?: boolean): Promise<void> {
    // 空操作
  }

  async mv(_fromUri: string, _toUri: string): Promise<void> {
    // 空操作
  }

  async grep(_uri: string, _pattern: string, _opts?: { caseInsensitive?: boolean }): Promise<GrepResult> {
    return { matches: [], count: 0 };
  }

  async glob(_pattern: string, _uri?: string): Promise<GlobResult> {
    return { matches: [], count: 0 };
  }

  async addResource(_path: string, _opts: AddResourceOptions): Promise<ResourceResult> {
    return { uri: "" };
  }

  async createSession(_id?: string): Promise<string> {
    return "null-session";
  }

  async getSessionContext(_id: string, _tokenBudget?: number): Promise<SessionContext> {
    return {
      latest_archive_overview: "",
      pre_archive_abstracts: [],
      messages: [],
      estimatedTokens: 0,
    };
  }

  async addMessage(_sessionId: string, _role: string, _content: string): Promise<void> {
    // 空操作
  }

  async commitSession(_sessionId: string): Promise<CommitResult> {
    return {
      session_id: "",
      status: "accepted",
      task_id: "",
      archive_uri: "",
    };
  }

  async deleteSession(_sessionId: string): Promise<void> {
    // 空操作
  }

  async getTask(_taskId: string): Promise<TaskStatus> {
    return {
      task_id: "",
      task_type: "",
      status: "completed",
    };
  }
}
