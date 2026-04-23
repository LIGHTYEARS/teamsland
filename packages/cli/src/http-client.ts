// ─── API Request / Response Types ───

/**
 * Worker 创建请求参数
 *
 * @example
 * ```typescript
 * import type { CreateWorkerRequest } from "@teamsland/cli";
 *
 * const req: CreateWorkerRequest = {
 *   task: "修复登录页面样式问题",
 *   repo: "https://github.com/example/repo",
 * };
 * ```
 */
export interface CreateWorkerRequest {
  /** 要执行的任务描述 */
  task: string;
  /** 代码仓库地址 */
  repo?: string;
  /** Worktree 路径 */
  worktree?: string;
  /** 任务简述（用于列表展示） */
  taskBrief?: string;
  /** 来源信息 */
  origin?: {
    chatId?: string;
    messageId?: string;
    senderId?: string;
    assigneeId?: string;
    source?: "meego" | "lark_mention" | "coordinator";
  };
  /** 父 Agent ID */
  parentAgentId?: string;
}

/**
 * Worker 创建成功响应
 *
 * @example
 * ```typescript
 * import type { CreateWorkerResponse } from "@teamsland/cli";
 *
 * const resp: CreateWorkerResponse = {
 *   workerId: "worker-a1b2c3",
 *   pid: 12345,
 *   sessionId: "sess-xyz",
 *   worktreePath: "/tmp/worktrees/worker-a1b2c3",
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface CreateWorkerResponse {
  /** Worker 唯一标识 */
  workerId: string;
  /** 进程 PID */
  pid: number;
  /** 会话 ID */
  sessionId: string;
  /** Worktree 目录路径 */
  worktreePath: string;
  /** 创建时间戳 (ms) */
  createdAt: number;
}

/**
 * Worker 列表响应
 *
 * @example
 * ```typescript
 * import type { ListWorkersResponse } from "@teamsland/cli";
 *
 * const resp: ListWorkersResponse = { workers: [], total: 0 };
 * ```
 */
export interface ListWorkersResponse {
  /** Worker 摘要列表 */
  workers: WorkerSummary[];
  /** 总数 */
  total: number;
}

/**
 * Worker 摘要信息
 *
 * @example
 * ```typescript
 * import type { WorkerSummary } from "@teamsland/cli";
 *
 * const summary: WorkerSummary = {
 *   workerId: "worker-a1b2c3",
 *   pid: 12345,
 *   sessionId: "sess-xyz",
 *   status: "running",
 *   worktreePath: "/tmp/worktrees/worker-a1b2c3",
 *   createdAt: Date.now(),
 * };
 * ```
 */
export interface WorkerSummary {
  /** Worker 唯一标识 */
  workerId: string;
  /** 进程 PID */
  pid: number;
  /** 会话 ID */
  sessionId: string;
  /** 运行状态 */
  status: "running" | "completed" | "failed";
  /** Worktree 目录路径 */
  worktreePath: string;
  /** 任务简述 */
  taskBrief?: string;
  /** 创建时间戳 (ms) */
  createdAt: number;
  /** 完成时间戳 (ms) */
  completedAt?: number;
}

/**
 * Worker 详情响应
 *
 * @example
 * ```typescript
 * import type { WorkerDetailResponse } from "@teamsland/cli";
 *
 * const detail: WorkerDetailResponse = {
 *   workerId: "worker-a1b2c3",
 *   pid: 12345,
 *   sessionId: "sess-xyz",
 *   status: "completed",
 *   worktreePath: "/tmp/worktrees/worker-a1b2c3",
 *   createdAt: Date.now(),
 *   alive: false,
 *   result: "任务已完成",
 * };
 * ```
 */
export interface WorkerDetailResponse extends WorkerSummary {
  /** 任务执行结果 */
  result?: string;
  /** 进程是否仍存活 */
  alive: boolean;
}

/**
 * Worker 取消响应
 *
 * @example
 * ```typescript
 * import type { CancelWorkerResponse } from "@teamsland/cli";
 *
 * const resp: CancelWorkerResponse = {
 *   workerId: "worker-a1b2c3",
 *   signal: "SIGINT",
 *   previousStatus: "running",
 * };
 * ```
 */
export interface CancelWorkerResponse {
  /** Worker 唯一标识 */
  workerId: string;
  /** 发送的终止信号 */
  signal: "SIGINT" | "SIGKILL";
  /** 取消前的状态 */
  previousStatus: string;
}

/**
 * Worker 日志转录响应
 *
 * @example
 * ```typescript
 * import type { TranscriptResponse } from "@teamsland/cli";
 *
 * const resp: TranscriptResponse = {
 *   workerId: "worker-a1b2c3",
 *   sessionId: "sess-xyz",
 *   transcriptPath: "/tmp/transcripts/worker-a1b2c3.jsonl",
 *   exists: true,
 * };
 * ```
 */
export interface TranscriptResponse {
  /** Worker 唯一标识 */
  workerId: string;
  /** 会话 ID */
  sessionId: string;
  /** 转录文件路径 */
  transcriptPath: string;
  /** 文件是否存在 */
  exists: boolean;
}

// ─── Error ───

/**
 * Teamsland API 请求错误
 *
 * 当 API 请求返回非 2xx 状态码或连接失败时抛出
 *
 * @example
 * ```typescript
 * import { TeamslandApiError } from "@teamsland/cli";
 *
 * try {
 *   await client.listWorkers();
 * } catch (err) {
 *   if (err instanceof TeamslandApiError) {
 *     console.error(`API 错误: ${err.status} - ${err.message}`);
 *   }
 * }
 * ```
 */
export class TeamslandApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "TeamslandApiError";
  }
}

// ─── Client ───

/**
 * Teamsland Server API 客户端
 *
 * 封装所有 Worker 管理 HTTP 接口，提供类型安全的调用方式
 *
 * @example
 * ```typescript
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * const workers = await client.listWorkers();
 * console.log(`共 ${workers.total} 个 Worker`);
 * ```
 */
export class TeamslandClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * 创建并启动一个新的 Worker
   *
   * @example
   * ```typescript
   * const client = new TeamslandClient("http://localhost:3000");
   * const resp = await client.spawnWorker({ task: "修复样式问题", repo: "https://github.com/org/repo" });
   * console.log(`Worker ${resp.workerId} 已创建，PID: ${resp.pid}`);
   * ```
   */
  async spawnWorker(params: CreateWorkerRequest): Promise<CreateWorkerResponse> {
    return this.request<CreateWorkerResponse>("POST", "/api/workers", params);
  }

  /**
   * 获取所有 Worker 列表
   *
   * @example
   * ```typescript
   * const client = new TeamslandClient("http://localhost:3000");
   * const { workers, total } = await client.listWorkers();
   * console.log(`共 ${total} 个 Worker`);
   * ```
   */
  async listWorkers(): Promise<ListWorkersResponse> {
    return this.request<ListWorkersResponse>("GET", "/api/workers");
  }

  /**
   * 获取单个 Worker 的详细信息
   *
   * @example
   * ```typescript
   * const client = new TeamslandClient("http://localhost:3000");
   * const detail = await client.getWorker("worker-a1b2c3");
   * console.log(`状态: ${detail.status}, 存活: ${detail.alive}`);
   * ```
   */
  async getWorker(id: string): Promise<WorkerDetailResponse> {
    return this.request<WorkerDetailResponse>("GET", `/api/workers/${id}`);
  }

  /**
   * 取消一个正在运行的 Worker
   *
   * @example
   * ```typescript
   * const client = new TeamslandClient("http://localhost:3000");
   * const resp = await client.cancelWorker("worker-a1b2c3", true);
   * console.log(`已发送 ${resp.signal} 信号`);
   * ```
   */
  async cancelWorker(id: string, force?: boolean): Promise<CancelWorkerResponse> {
    const body = force ? { force: true } : undefined;
    return this.request<CancelWorkerResponse>("POST", `/api/workers/${id}/cancel`, body);
  }

  /**
   * 获取 Worker 的转录文件信息
   *
   * @example
   * ```typescript
   * const client = new TeamslandClient("http://localhost:3000");
   * const resp = await client.getTranscript("worker-a1b2c3");
   * if (resp.exists) console.log(`转录文件: ${resp.transcriptPath}`);
   * ```
   */
  async getTranscript(id: string): Promise<TranscriptResponse> {
    return this.request<TranscriptResponse>("GET", `/api/workers/${id}/transcript`);
  }

  /**
   * 通用 HTTP 请求方法
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        let parsed: unknown = responseBody;
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          // 保留原始文本
        }
        throw new TeamslandApiError(
          `API request failed: ${method} ${path} → ${response.status}`,
          response.status,
          parsed,
        );
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      if (err instanceof TeamslandApiError) {
        throw err;
      }
      if (err instanceof TypeError) {
        throw new TeamslandApiError(`Cannot connect to teamsland server at ${this.baseUrl} — is it running?`, 0, null);
      }
      throw err;
    }
  }
}
