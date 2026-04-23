// @teamsland/server — Worker API 路由
// 提供 /api/workers 端点，用于创建、查询、取消 Worker 子进程

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { WorktreeManager } from "@teamsland/git";
import { createLogger } from "@teamsland/observability";
import type { ClaudeMdInjector, ProcessController, SidecarDataPlane, SkillInjector } from "@teamsland/sidecar";
import { CapacityError, type SubagentRegistry } from "@teamsland/sidecar";
import type { AgentOrigin } from "@teamsland/types";

const logger = createLogger("server:worker-routes");

/**
 * Worker 路由依赖
 *
 * @example
 * ```typescript
 * import type { WorkerRouteDeps } from "./worker-routes.js";
 *
 * const deps: WorkerRouteDeps = {
 *   registry: subagentRegistry,
 *   processController,
 *   worktreeManager,
 *   dataPlane,
 *   skillInjector,
 *   claudeMdInjector,
 *   meegoApiBase: "https://meego.example.com",
 *   meegoPluginToken: "token_xxx",
 * };
 * ```
 */
export interface WorkerRouteDeps {
  /** Agent 注册表 */
  registry: SubagentRegistry;
  /** 进程控制器 */
  processController: ProcessController;
  /** Git worktree 管理器 */
  worktreeManager: WorktreeManager;
  /** Sidecar 数据平面 */
  dataPlane: SidecarDataPlane;
  /** Skill 注入器（可选，未配置时跳过 Skill 注入） */
  skillInjector?: SkillInjector;
  /** CLAUDE.md 任务上下文注入器（可选，未配置时跳过注入） */
  claudeMdInjector?: ClaudeMdInjector;
  /** Meego API 基础地址（用于 CLAUDE.md 注入） */
  meegoApiBase?: string;
  /** Meego 插件认证 Token（用于 CLAUDE.md 注入） */
  meegoPluginToken?: string;
}

/**
 * 创建 Worker 请求体
 *
 * @example
 * ```typescript
 * const body: CreateWorkerRequest = {
 *   task: "实现用户登录功能",
 *   repo: "/repos/frontend",
 *   taskType: "coding",
 * };
 * ```
 */
interface CreateWorkerRequest {
  /** 任务提示词（必填） */
  task: string;
  /** 仓库路径（与 worktree 二选一） */
  repo?: string;
  /** 已有 worktree 路径（与 repo 二选一） */
  worktree?: string;
  /** 任务简述 */
  taskBrief?: string;
  /** Agent 来源信息 */
  origin?: AgentOrigin;
  /** 父级 Agent ID */
  parentAgentId?: string;
  /** 任务类型（用于 Skill 路由，默认 "coding"） */
  taskType?: string;
}

/** JSON 响应工具函数 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 解析请求体，失败时返回 Response 错误 */
async function parseCreateBody(req: Request): Promise<CreateWorkerRequest | Response> {
  let body: CreateWorkerRequest;
  try {
    body = (await req.json()) as CreateWorkerRequest;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  if (!body.task || typeof body.task !== "string") {
    return jsonResponse({ error: "missing_field", message: "task 字段为必填" }, 400);
  }

  const hasRepo = typeof body.repo === "string" && body.repo.length > 0;
  const hasWorktree = typeof body.worktree === "string" && body.worktree.length > 0;

  if ((!hasRepo && !hasWorktree) || (hasRepo && hasWorktree)) {
    return jsonResponse({ error: "invalid_params", message: "必须且只能提供 repo 或 worktree 之一" }, 400);
  }

  return body;
}

/** Worktree 解析结果 */
interface WorktreeResolution {
  worktreePath: string;
  issueId: string;
}

/** 根据请求体解析 worktree 路径和 issueId */
async function resolveWorktree(
  body: CreateWorkerRequest,
  worktreeManager: WorktreeManager,
): Promise<WorktreeResolution | Response> {
  if (typeof body.repo === "string" && body.repo.length > 0) {
    const issueId = `cli-${randomUUID().slice(0, 8)}`;
    try {
      const worktreePath = await worktreeManager.create(body.repo, issueId);
      return { worktreePath, issueId };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, repo: body.repo, issueId }, "worktree 创建失败");
      return jsonResponse({ error: "worktree_create_failed", message }, 500);
    }
  }

  const worktreePath = body.worktree as string;
  if (!existsSync(worktreePath)) {
    return jsonResponse({ error: "worktree_not_found", message: `路径不存在: ${worktreePath}` }, 400);
  }
  return { worktreePath, issueId: basename(worktreePath) };
}

/** 执行 Skill 和 CLAUDE.md 注入（创建 Worker 前的准备步骤） */
async function runPreSpawnInjections(
  deps: WorkerRouteDeps,
  worktreePath: string,
  taskType: string,
  agentId: string,
  body: CreateWorkerRequest,
  issueId: string,
): Promise<void> {
  if (deps.skillInjector) {
    const injectResult = await deps.skillInjector.inject({ worktreePath, taskType });
    logger.info({ agentId, injected: injectResult.injected, skipped: injectResult.skipped }, "Skills 已注入");
  }

  if (deps.claudeMdInjector) {
    await deps.claudeMdInjector.inject(worktreePath, {
      workerId: agentId,
      taskType,
      requester: body.origin?.senderId ?? "unknown",
      issueId,
      chatId: body.origin?.chatId ?? "",
      messageId: body.origin?.messageId ?? "",
      taskPrompt: body.task,
      meegoApiBase: deps.meegoApiBase ?? "",
      meegoPluginToken: deps.meegoPluginToken ?? "",
    });
    logger.info({ agentId }, "CLAUDE.md 任务上下文已注入");
  }
}

/**
 * 处理 POST /api/workers — 创建 Worker 子进程
 *
 * @param req - HTTP 请求
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = await handleCreateWorker(req, deps);
 * // 201: { workerId, pid, sessionId, worktreePath, createdAt }
 * ```
 */
async function handleCreateWorker(req: Request, deps: WorkerRouteDeps): Promise<Response> {
  const bodyResult = await parseCreateBody(req);
  if (bodyResult instanceof Response) return bodyResult;

  const resolved = await resolveWorktree(bodyResult, deps.worktreeManager);
  if (resolved instanceof Response) return resolved;

  const { worktreePath, issueId } = resolved;
  const agentId = `worker-${randomUUID().slice(0, 8)}`;
  const createdAt = Date.now();
  const taskType = bodyResult.taskType ?? "coding";

  try {
    await runPreSpawnInjections(deps, worktreePath, taskType, agentId, bodyResult, issueId);

    const spawnResult = await deps.processController.spawn({
      issueId,
      worktreePath,
      initialPrompt: bodyResult.task,
      env: {
        WORKER_ID: agentId,
        MEEGO_API_BASE: deps.meegoApiBase ?? "",
        MEEGO_PLUGIN_TOKEN: deps.meegoPluginToken ?? "",
      },
    });

    deps.registry.register({
      agentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      issueId,
      worktreePath,
      status: "running",
      retryCount: 0,
      createdAt,
      origin: bodyResult.origin,
      taskBrief: bodyResult.taskBrief,
      parentAgentId: bodyResult.parentAgentId,
      taskPrompt: bodyResult.task,
    });

    // Fire-and-forget: 后台处理 stdout 流
    void deps.dataPlane.processStream(agentId, spawnResult.stdout).catch((err: unknown) => {
      logger.error({ err, agentId }, "Worker stdout 流处理异常");
    });

    logger.info({ agentId, pid: spawnResult.pid, issueId, worktreePath }, "Worker 已创建");

    return jsonResponse(
      {
        workerId: agentId,
        pid: spawnResult.pid,
        sessionId: spawnResult.sessionId,
        worktreePath,
        createdAt,
      },
      201,
    );
  } catch (err: unknown) {
    if (err instanceof CapacityError) {
      return jsonResponse({ error: "capacity_full", current: err.current, max: err.max }, 409);
    }
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, agentId }, "Worker 创建失败");
    return jsonResponse({ error: "spawn_failed", message }, 500);
  }
}

/**
 * 处理 GET /api/workers — 列出运行中的 Worker
 *
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = handleListWorkers(deps);
 * // 200: { workers: [...], total: N }
 * ```
 */
function handleListWorkers(deps: WorkerRouteDeps): Response {
  const workers = deps.registry.allRunning().map((r) => ({
    workerId: r.agentId,
    pid: r.pid,
    sessionId: r.sessionId,
    issueId: r.issueId,
    worktreePath: r.worktreePath,
    status: r.status,
    taskBrief: r.taskBrief,
    createdAt: r.createdAt,
  }));
  return jsonResponse({ workers, total: workers.length });
}

/**
 * 处理 GET /api/workers/:id — 获取单个 Worker 详情
 *
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = handleGetWorker("worker-abc123", deps);
 * // 200: { ...record, alive: true }
 * ```
 */
function handleGetWorker(id: string, deps: WorkerRouteDeps): Response {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  let alive = false;
  try {
    process.kill(record.pid, 0);
    alive = true;
  } catch {
    alive = false;
  }

  return jsonResponse({ ...record, workerId: record.agentId, alive });
}

/**
 * 处理 POST /api/workers/:id/cancel — 取消 Worker
 *
 * @param req - HTTP 请求
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = await handleCancelWorker(req, "worker-abc123", deps);
 * // 200: { workerId, signal, previousStatus }
 * ```
 */
async function handleCancelWorker(req: Request, id: string, deps: WorkerRouteDeps): Promise<Response> {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  if (record.status === "completed" || record.status === "failed") {
    return jsonResponse({ error: "already_terminated", message: `Worker ${id} 已处于 ${record.status} 状态` }, 409);
  }

  let force = false;
  try {
    const body = (await req.json()) as { force?: boolean };
    force = body.force === true;
  } catch {
    // body 为空或非 JSON，默认 force=false
  }

  const signal = force ? "SIGKILL" : "SIGINT";
  try {
    process.kill(record.pid, signal);
  } catch (err: unknown) {
    logger.warn({ err, pid: record.pid, agentId: id }, "发送取消信号失败");
  }

  logger.info({ agentId: id, pid: record.pid, signal, force }, "Worker 取消信号已发送");

  return jsonResponse({ workerId: id, signal, previousStatus: record.status });
}

/**
 * 处理 GET /api/workers/:id/transcript — 获取 Worker 会话记录路径
 *
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = handleGetTranscript("worker-abc123", deps);
 * // 200: { workerId, sessionId, transcriptPath, exists }
 * ```
 */
function handleGetTranscript(id: string, deps: WorkerRouteDeps): Response {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  const projectSlug = record.worktreePath.replaceAll("/", "-").slice(1, 65);
  const transcriptPath = join(homedir(), ".claude", "projects", projectSlug, `${record.sessionId}.jsonl`);
  const exists = existsSync(transcriptPath);

  return jsonResponse({ workerId: id, sessionId: record.sessionId, transcriptPath, exists });
}

/**
 * 进度报告请求体
 *
 * @example
 * ```typescript
 * const body: ProgressReport = {
 *   phase: "code_review",
 *   summary: "正在审查 AuthService 的代码",
 *   details: "已完成 3/5 个文件的审查",
 * };
 * ```
 */
interface ProgressReport {
  /** 当前阶段标识 */
  phase: string;
  /** 进度摘要 */
  summary: string;
  /** 详细信息（可选） */
  details?: string;
}

/**
 * Worker 结果请求体
 *
 * @example
 * ```typescript
 * const body: WorkerResult = {
 *   status: "success",
 *   summary: "用户登录功能已完成",
 *   artifacts: { prUrl: "https://github.com/..." },
 * };
 * ```
 */
interface WorkerResult {
  /** 结果状态 */
  status: "success" | "failed" | "blocked";
  /** 结果摘要 */
  summary: string;
  /** 产出物（可选） */
  artifacts?: Record<string, unknown>;
}

// TODO: progressReports 字段将由另一个 agent 添加到 AgentRecord 类型中。
// 在此之前，使用本地扩展接口来安全访问该字段。
/** AgentRecord 扩展，包含 progressReports 字段 */
interface AgentRecordWithProgress {
  progressReports?: Array<ProgressReport & { reportedAt: number }>;
}

/**
 * 处理 POST /api/workers/:id/progress — Worker 上报进度
 *
 * @param req - HTTP 请求
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = await handleReportProgress(req, "worker-abc123", deps);
 * // 200: { workerId, phase, reportedAt }
 * ```
 */
async function handleReportProgress(req: Request, id: string, deps: WorkerRouteDeps): Promise<Response> {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  let body: ProgressReport;
  try {
    body = (await req.json()) as ProgressReport;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  if (!body.phase || typeof body.phase !== "string") {
    return jsonResponse({ error: "missing_field", message: "phase 字段为必填" }, 400);
  }

  if (!body.summary || typeof body.summary !== "string") {
    return jsonResponse({ error: "missing_field", message: "summary 字段为必填" }, 400);
  }

  // 安全地访问 progressReports 字段（可能尚未在类型中定义）
  const extended = record as typeof record & AgentRecordWithProgress;
  extended.progressReports = extended.progressReports ?? [];
  const reportedAt = Date.now();
  extended.progressReports.push({ phase: body.phase, summary: body.summary, details: body.details, reportedAt });

  logger.info({ agentId: id, phase: body.phase }, "Worker 进度已上报");

  return jsonResponse({ workerId: id, phase: body.phase, reportedAt });
}

/**
 * 处理 POST /api/workers/:id/result — Worker 上报最终结果
 *
 * @param req - HTTP 请求
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = await handleReportResult(req, "worker-abc123", deps);
 * // 200: { workerId, status, completedAt }
 * ```
 */
async function handleReportResult(req: Request, id: string, deps: WorkerRouteDeps): Promise<Response> {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  let body: WorkerResult;
  try {
    body = (await req.json()) as WorkerResult;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  if (!body.status || !["success", "failed", "blocked"].includes(body.status)) {
    return jsonResponse({ error: "invalid_field", message: "status 必须为 success、failed 或 blocked" }, 400);
  }

  if (!body.summary || typeof body.summary !== "string") {
    return jsonResponse({ error: "missing_field", message: "summary 字段为必填" }, 400);
  }

  record.result = JSON.stringify(body);
  record.completedAt = Date.now();
  record.status = body.status === "success" ? "completed" : "failed";

  logger.info({ agentId: id, resultStatus: body.status }, "Worker 结果已上报");

  return jsonResponse({ workerId: id, status: body.status, completedAt: record.completedAt });
}

/**
 * 处理 GET /api/workers/:id/progress — 获取 Worker 进度报告列表
 *
 * @param id - Worker ID
 * @param deps - 路由依赖
 * @returns HTTP 响应
 *
 * @example
 * ```typescript
 * const response = handleGetProgress("worker-abc123", deps);
 * // 200: { workerId, progressReports: [...] }
 * ```
 */
function handleGetProgress(id: string, deps: WorkerRouteDeps): Response {
  const record = deps.registry.get(id);
  if (!record) {
    return jsonResponse({ error: "not_found", message: `Worker ${id} 不存在` }, 404);
  }

  const extended = record as typeof record & AgentRecordWithProgress;
  const progressReports = extended.progressReports ?? [];

  return jsonResponse({ workerId: id, progressReports });
}

/** 子路由处理结果类型 */
type RouteResult = Response | Promise<Response> | null;

/** 分发 /api/workers/:id 下的子路由 */
function dispatchSubRoute(req: Request, id: string, sub: string | undefined, deps: WorkerRouteDeps): RouteResult {
  if (req.method === "GET" && !sub) {
    return handleGetWorker(id, deps);
  }
  if (req.method === "GET" && sub === "transcript") {
    return handleGetTranscript(id, deps);
  }
  if (req.method === "GET" && sub === "progress") {
    return handleGetProgress(id, deps);
  }
  if (req.method === "POST" && sub === "cancel") {
    return handleCancelWorker(req, id, deps);
  }
  if (req.method === "POST" && sub === "progress") {
    return handleReportProgress(req, id, deps);
  }
  if (req.method === "POST" && sub === "result") {
    return handleReportResult(req, id, deps);
  }
  return null;
}

/**
 * Worker API 路由分发器
 *
 * 处理所有 /api/workers 相关路由。匹配到路由时返回 Response，
 * 不匹配时返回 null 以便上层继续路由。
 *
 * @param req - HTTP 请求
 * @param url - 解析后的 URL
 * @param deps - 路由依赖
 * @returns Response（匹配时）或 null（不匹配时）
 *
 * @example
 * ```typescript
 * import { handleWorkerRoutes } from "./worker-routes.js";
 *
 * const result = handleWorkerRoutes(req, url, deps);
 * if (result) return result;
 * ```
 */
export function handleWorkerRoutes(req: Request, url: URL, deps: WorkerRouteDeps): RouteResult {
  if (!url.pathname.startsWith("/api/workers")) {
    return null;
  }

  // POST /api/workers — 创建 Worker
  if (req.method === "POST" && url.pathname === "/api/workers") {
    return handleCreateWorker(req, deps);
  }

  // GET /api/workers — 列出所有 Worker
  if (req.method === "GET" && url.pathname === "/api/workers") {
    return handleListWorkers(deps);
  }

  // /api/workers/:id/...
  const idMatch = url.pathname.match(/^\/api\/workers\/([^/]+)(?:\/(.+))?$/);
  if (!idMatch) {
    return null;
  }

  return dispatchSubRoute(req, idMatch[1] ?? "", idMatch[2], deps);
}
