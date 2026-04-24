import { homedir } from "node:os";
import { join } from "node:path";
import type { WorktreeManager } from "@teamsland/git";
import type { HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type {
  ClaudeMdInjector,
  InterruptController,
  ProcessController,
  SidecarDataPlane,
  SkillInjector,
  SubagentRegistry,
} from "@teamsland/sidecar";
import type { AgentRecord, AppConfig, DashboardConfig } from "@teamsland/types";
import { handleExtendedApiRoutes } from "./api-routes.js";
import { handleWsMessage, type WsHandlerContext } from "./dashboard-ws.js";
import { handleFileRoutes } from "./file-routes.js";
import { handleGitRoutes } from "./git-routes.js";
import { extractToken, type LarkAuthManager } from "./lark-auth.js";
import { TerminalService } from "./terminal-service.js";
import { normalizeJsonlEntry } from "./utils/normalized-message.js";
import { handleVikingRoutes } from "./viking-routes.js";
import { handleWorkerRoutes } from "./worker-routes.js";

const logger = createLogger("server:dashboard");

/**
 * Dashboard 服务依赖
 *
 * @example
 * ```typescript
 * const deps: DashboardDeps = {
 *   registry: subagentRegistry,
 *   sessionDb,
 *   config: { port: 3000, auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] } },
 *   processController,
 *   worktreeManager,
 *   dataPlane,
 *   skillInjector,
 *   claudeMdInjector, vikingClient,
 * };
 * ```
 */
export interface DashboardDeps {
  /** Agent 注册表，用于查询运行中的 agent 列表 */
  registry: SubagentRegistry;
  /** 会话数据库，用于查询会话消息历史 */
  sessionDb: SessionDB;
  /** Dashboard 配置（端口、鉴权等） */
  config: DashboardConfig;
  /** Lark OAuth 管理器（provider 为 lark_oauth 时必须提供） */
  authManager?: LarkAuthManager;
  /** 进程控制器，用于 Worker API 创建子进程 */
  processController: ProcessController;
  /** Git worktree 管理器，用于 Worker API 创建工作目录 */
  worktreeManager: WorktreeManager;
  /** Sidecar 数据平面，用于 Worker API 消费 stdout 流 */
  dataPlane: SidecarDataPlane;
  /** Skill 注入器（可选，用于 Worker spawn 时注入 Skill 文件） */
  skillInjector?: SkillInjector;
  /** CLAUDE.md 任务上下文注入器（可选，用于 Worker spawn 时注入任务上下文） */
  claudeMdInjector?: ClaudeMdInjector;
  /** Meego API 基础地址（用于 CLAUDE.md 注入） */
  meegoApiBase?: string;
  /** Meego 插件认证 Token（用于 CLAUDE.md 注入） */
  meegoPluginToken?: string;
  /** Hook 引擎（可选，用于 Hook 状态 API） */
  hookEngine?: HookEngine | null;
  /** Hook 指标收集器（可选，用于 Hook 指标 API） */
  hookMetricsCollector?: HookMetricsCollector | null;
  /** 应用完整配置（可选，用于 Hook 审批 / 进化日志 API） */
  appConfig?: AppConfig | null;
  /** OpenViking 记忆服务客户端（可选，用于 Viking 代理路由） */
  vikingClient?: IVikingMemoryClient | null;
  /** 中断控制器，用于 Dashboard 用户中止正在运行的会话 */
  interruptController?: InterruptController;
}

/** WebSocket 推送消息类型 */
interface WsAgentsUpdate {
  type: "agents_update";
  agents: AgentRecord[];
}

interface WsConnected {
  type: "connected";
  agents: AgentRecord[];
}

/** 归一化消息推送（展平 NormalizedMessage 字段到顶层） */
interface WsNormalizedMessage {
  type: "normalized_message";
  [key: string]: unknown;
}

/** claude-command 处理错误响应 */
interface WsCommandError {
  type: "claude-command-error";
  sessionId: string;
  error: string;
  message: string;
}

/** claude-command 处理确认响应 */
interface WsCommandAck {
  type: "claude-command-ack";
  sessionId: string;
  agentId: string;
}

type WsMessage = WsAgentsUpdate | WsConnected | WsNormalizedMessage | WsCommandError | WsCommandAck;

/** JSON 响应工具函数 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** 序列化并广播到所有连接的客户端 */
function broadcast(clients: Set<unknown>, message: WsMessage): void {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    try {
      (ws as { send(data: string): void }).send(payload);
    } catch {
      // 忽略已断开的连接，close 事件会清理
    }
  }
}

/** 处理 OAuth 认证相关路由 */
function handleAuthRoutes(
  req: Request,
  url: URL,
  authManager: LarkAuthManager,
  config: DashboardConfig,
): Response | Promise<Response> | null {
  if (req.method === "GET" && url.pathname === "/auth/lark") {
    const redirectPath = url.searchParams.get("redirect") ?? "/";
    return Response.redirect(authManager.getAuthUrl(redirectPath), 302);
  }

  if (req.method === "GET" && url.pathname === "/auth/lark/callback") {
    return handleOAuthCallback(url, authManager, config);
  }

  if (req.method === "GET" && url.pathname === "/auth/me") {
    const session = authManager.validate(extractToken(req.headers.get("cookie")));
    if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
    return jsonResponse({ userId: session.userId, name: session.name, department: session.department });
  }

  if (req.method === "POST" && url.pathname === "/auth/logout") {
    const token = extractToken(req.headers.get("cookie"));
    if (token) authManager.logout(token);
    return new Response(null, {
      status: 302,
      headers: { Location: "/", "Set-Cookie": "teamsland_session=; Path=/; HttpOnly; Max-Age=0" },
    });
  }

  return null;
}

/** 处理 OAuth 回调 code 交换 */
function handleOAuthCallback(
  url: URL,
  authManager: LarkAuthManager,
  config: DashboardConfig,
): Response | Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "/";
  if (!code) return jsonResponse({ error: "Missing code" }, 400);

  return authManager
    .handleCallback(code, state)
    .then(({ token, redirectPath }) => {
      const maxAge = config.auth.sessionTtlHours * 3600;
      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectPath,
          "Set-Cookie": `teamsland_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
        },
      });
    })
    .catch((err: unknown) => {
      logger.error({ err }, "OAuth 回调处理失败");
      return jsonResponse({ error: "Authentication failed" }, 403);
    });
}

/** 检查 API 路由的认证状态 */
function checkApiAuth(
  req: Request,
  url: URL,
  authManager: LarkAuthManager | undefined,
  authEnabled: boolean,
): Response | null {
  if (!authEnabled || !url.pathname.startsWith("/api/")) return null;
  // Worker API 来自本地 CLI，无需 OAuth 认证
  if (url.pathname.startsWith("/api/workers")) return null;
  if (!authManager) return null;
  const session = authManager.validate(extractToken(req.headers.get("cookie")));
  if (!session) return jsonResponse({ error: "Unauthorized" }, 401);
  return null;
}

/** 路由主请求（从 Bun.serve fetch 中调出以降低 cognitive complexity） */
async function routeRequest(
  req: Request,
  url: URL,
  ctx: {
    registry: SubagentRegistry;
    sessionDb: SessionDB;
    config: DashboardConfig;
    authManager: LarkAuthManager | undefined;
    authEnabled: boolean;
    processController: ProcessController;
    worktreeManager: WorktreeManager;
    dataPlane: SidecarDataPlane;
    skillInjector: SkillInjector | undefined;
    claudeMdInjector: ClaudeMdInjector | undefined;
    meegoApiBase: string | undefined;
    meegoPluginToken: string | undefined;
    hookEngine: HookEngine | null | undefined;
    hookMetricsCollector: HookMetricsCollector | null | undefined;
    appConfig: AppConfig | null | undefined;
    vikingClient: IVikingMemoryClient | null | undefined;
  },
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ status: "ok", uptime: process.uptime() });
  }

  if (ctx.authEnabled && ctx.authManager) {
    const authResult = handleAuthRoutes(req, url, ctx.authManager, ctx.config);
    if (authResult) return authResult;
  }

  if (!ctx.authEnabled && url.pathname.startsWith("/auth")) {
    return jsonResponse({ authEnabled: false }, 200);
  }

  const authBlock = checkApiAuth(req, url, ctx.authManager, ctx.authEnabled);
  if (authBlock) return authBlock;

  const workerResult = handleWorkerRoutes(req, url, {
    registry: ctx.registry,
    processController: ctx.processController,
    worktreeManager: ctx.worktreeManager,
    dataPlane: ctx.dataPlane,
    skillInjector: ctx.skillInjector,
    claudeMdInjector: ctx.claudeMdInjector,
    meegoApiBase: ctx.meegoApiBase,
    meegoPluginToken: ctx.meegoPluginToken,
  });
  if (workerResult) return workerResult;

  // 扩展 API 路由（/api/projects, /api/topology, /api/sessions/:id/normalized-messages）
  const extendedResult = handleExtendedApiRoutes(req, url, { registry: ctx.registry });
  if (extendedResult) return extendedResult;

  // 文件系统路由（/api/files/*）
  const fileResult = handleFileRoutes(req, url);
  if (fileResult) return fileResult;

  // Git 操作路由（/api/git/*）
  const gitResult = handleGitRoutes(req, url);
  if (gitResult) return gitResult;

  // Viking 代理路由（/api/viking/*）
  const vikingResult = ctx.vikingClient ? await handleVikingRoutes(req, url, ctx.vikingClient) : null;
  if (vikingResult) return vikingResult;

  return handleApiRoutes(
    req,
    url,
    ctx.registry,
    ctx.sessionDb,
    ctx.hookEngine,
    ctx.hookMetricsCollector,
    ctx.appConfig,
  );
}

/** 解析以 ~ 开头的路径 */
function resolveTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** GET /api/hooks/pending — 待审批 hook 列表 */
async function handleHooksPending(pendingDir: string): Promise<Response> {
  const resolvedDir = resolveTilde(pendingDir);
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(resolvedDir).catch(() => [] as string[]);
  const pending = files.filter((f) => f.endsWith(".ts")).map((f) => ({ filename: f, path: join(resolvedDir, f) }));
  return jsonResponse({ pending });
}

/** POST /api/hooks/:filename/approve — 审批通过 */
async function handleHookApprove(
  filename: string,
  pendingDir: string,
  hooksDir: string,
  workspacePath: string,
): Promise<Response> {
  const resolvedPending = resolveTilde(pendingDir);
  const resolvedHooks = resolveTilde(hooksDir);
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { rename } = await import("node:fs/promises");
  try {
    await rename(join(resolvedPending, filename), join(resolvedHooks, filename));
    const { appendEvolutionLog } = await import("./evolution-log.js");
    await appendEvolutionLog(resolvedWorkspace, {
      timestamp: new Date().toISOString(),
      action: "approve_hook",
      path: `hooks/${filename}`,
      reason: "Dashboard 审批通过",
    });
    return jsonResponse({ approved: filename });
  } catch (err: unknown) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

/** POST /api/hooks/:filename/reject — 拒绝 */
async function handleHookReject(
  req: Request,
  filename: string,
  pendingDir: string,
  workspacePath: string,
): Promise<Response> {
  const resolvedPending = resolveTilde(pendingDir);
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { unlink } = await import("node:fs/promises");
  let reason = "未指定原因";
  try {
    const body = (await req.json()) as { reason?: string };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    /* 使用默认原因 */
  }
  try {
    await unlink(join(resolvedPending, filename));
    const { appendEvolutionLog } = await import("./evolution-log.js");
    await appendEvolutionLog(resolvedWorkspace, {
      timestamp: new Date().toISOString(),
      action: "reject_hook",
      path: `hooks-pending/${filename}`,
      reason,
      rejectedReason: reason,
    });
    return jsonResponse({ rejected: filename });
  } catch (err: unknown) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

/** GET /api/hooks/evolution-log — 进化日志 */
async function handleHooksEvolutionLog(url: URL, workspacePath: string): Promise<Response> {
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { readEvolutionLog } = await import("./evolution-log.js");
  const limit = Number(url.searchParams.get("limit")) || 100;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const entries = await readEvolutionLog(resolvedWorkspace, limit, offset);
  return jsonResponse({ entries, total: entries.length });
}

/** Hook 进化管理所需配置项 */
interface HookEvolutionConfig {
  pendingDir: string | undefined;
  hooksDir: string | undefined;
  workspacePath: string;
}

/** 从 AppConfig 中提取 Hook 进化管理配置 */
function extractHookEvolutionConfig(config: AppConfig | null | undefined): HookEvolutionConfig {
  return {
    pendingDir: config?.hooks?.pendingDir,
    hooksDir: config?.hooks?.hooksDir,
    workspacePath: config?.coordinator?.workspacePath ?? "~/.teamsland/coordinator",
  };
}

/** 处理 POST /api/hooks/:filename/approve 或 /reject */
function handleHookMutation(req: Request, url: URL, cfg: HookEvolutionConfig): Response | Promise<Response> | null {
  const approveMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const filename = approveMatch[1];
    if (!cfg.pendingDir || !cfg.hooksDir) return jsonResponse({ error: "hooks 目录未配置" }, 400);
    return handleHookApprove(filename, cfg.pendingDir, cfg.hooksDir, cfg.workspacePath);
  }

  const rejectMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const filename = rejectMatch[1];
    if (!cfg.pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);
    return handleHookReject(req, filename, cfg.pendingDir, cfg.workspacePath);
  }

  return null;
}

/** 处理 Hook 进化管理路由（pending/approve/reject/evolution-log） */
function handleHookEvolutionRoutes(
  req: Request,
  url: URL,
  config?: AppConfig | null,
): Response | Promise<Response> | null {
  const cfg = extractHookEvolutionConfig(config);

  if (req.method === "GET" && url.pathname === "/api/hooks/pending") {
    if (!cfg.pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);
    return handleHooksPending(cfg.pendingDir);
  }

  if (req.method === "GET" && url.pathname === "/api/hooks/evolution-log") {
    return handleHooksEvolutionLog(url, cfg.workspacePath);
  }

  return handleHookMutation(req, url, cfg);
}

/** 处理 Hook 相关 API 路由 */
function handleHookRoutes(
  req: Request,
  url: URL,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
  config?: AppConfig | null,
): Response | Promise<Response> | null {
  if (req.method === "GET" && url.pathname === "/api/hooks/status") {
    if (!hookEngine) return jsonResponse({ enabled: false, message: "Hook 引擎未启用" });
    return jsonResponse({ enabled: true, ...hookEngine.getStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/hooks/metrics") {
    if (!hookMetricsCollector) return jsonResponse({ enabled: false, message: "Hook 指标收集器未启用" });
    return jsonResponse({ enabled: true, ...hookMetricsCollector.getSnapshot() });
  }

  return handleHookEvolutionRoutes(req, url, config);
}

function handleApiRoutes(
  req: Request,
  url: URL,
  registry: SubagentRegistry,
  sessionDb: SessionDB,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
  appConfig?: AppConfig | null,
): Response | Promise<Response> | null {
  if (req.method === "GET" && url.pathname === "/api/agents") {
    return jsonResponse(registry.allRunning());
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (req.method === "GET" && sessionMatch) {
    const sessionId = sessionMatch[1] ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "1000");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const messages = sessionDb.getMessages(sessionId, { limit, offset });
    const ndjson = messages.map((m) => JSON.stringify(m)).join("\n");
    return new Response(ndjson ? `${ndjson}\n` : "", {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  const hookResult = handleHookRoutes(req, url, hookEngine, hookMetricsCollector, appConfig);
  if (hookResult) return hookResult;

  return null;
}

/**
 * 启动 Dashboard HTTP/WebSocket 服务
 *
 * 基于 Bun.serve 启动一个轻量 HTTP 服务，提供以下路由：
 * - `GET /health` — 健康检查 (200)
 * - `GET /auth/lark` — 飞书 OAuth 授权跳转
 * - `GET /auth/lark/callback` — OAuth 回调
 * - `GET /auth/me` — 当前登录用户信息
 * - `POST /auth/logout` — 登出
 * - `GET /api/agents` — agent 列表 (需认证)
 * - `GET /api/sessions/:id/messages` — 会话消息 NDJSON (需认证)
 * - `GET /api/sessions/:id/normalized-messages` — 会话归一化消息 (需认证)
 * - `GET /api/projects` — 项目列表 (需认证)
 * - `GET /api/topology` — Agent 拓扑图 (需认证)
 * - `GET /api/files/tree` — 文件目录树 (需认证)
 * - `GET /api/files/read` — 读取文件 (需认证)
 * - `PUT /api/files/write` — 写入文件 (需认证)
 * - `GET /api/git/status` — Git 状态 (需认证)
 * - `GET /api/git/diff` — Git diff (需认证)
 * - `GET /api/git/branches` — 分支列表 (需认证)
 * - `POST /api/git/stage` — 暂存文件 (需认证)
 * - `POST /api/git/commit` — 提交变更 (需认证)
 * - `GET /api/hooks/status` — Hook 引擎状态 (需认证)
 * - `GET /api/hooks/metrics` — Hook 指标快照 (需认证)
 * - `GET /api/hooks/pending` — 待审批 Hook 列表 (需认证)
 * - `POST /api/hooks/:filename/approve` — 审批通过 Hook (需认证)
 * - `POST /api/hooks/:filename/reject` — 拒绝 Hook (需认证)
 * - `GET /api/hooks/evolution-log` — 进化日志 (需认证)
 * - `/api/viking/*` — OpenViking 代理路由 (需认证，详见 viking-routes.ts)
 * - `GET /api/ws` — WebSocket 升级（支持 terminal-start/input/resize/stop）
 *
 * @param deps - Dashboard 依赖
 * @param signal - 可选的 AbortSignal，用于优雅关闭
 * @returns Bun.serve 返回的 Server 实例
 *
 * @example
 * ```typescript
 * const server = startDashboard(
 *   { registry, sessionDb, config: dashboardConfig, authManager },
 *   controller.signal,
 * );
 * ```
 */
export function startDashboard(deps: DashboardDeps, signal?: AbortSignal): ReturnType<typeof Bun.serve> {
  const {
    registry,
    sessionDb,
    config,
    authManager,
    processController,
    worktreeManager,
    dataPlane,
    skillInjector,
    claudeMdInjector,
    meegoApiBase,
    meegoPluginToken,
    hookEngine,
    hookMetricsCollector,
    appConfig,
    vikingClient,
  } = deps;
  const clients = new Set<unknown>();
  /** 追踪每个 WebSocket 连接关联的终端会话 ID，用于连接断开时自动清理 */
  const wsTerminals = new Map<unknown, Set<string>>();
  const authEnabled = config.auth.provider === "lark_oauth" && authManager;
  const terminalService = new TerminalService();

  // 设置 DataPlane 原始事件监听器：将 NDJSON 事件 normalize 后广播到所有 WebSocket 客户端
  dataPlane.setRawEventListener((agentId, line) => {
    const record = registry.get(agentId);
    const sid = record?.sessionId ?? agentId;
    const messages = normalizeJsonlEntry(line, sid);
    for (const msg of messages) {
      broadcast(clients, { type: "normalized_message", ...msg } as WsNormalizedMessage);
    }
  });

  /** WebSocket 消息处理上下文 */
  const wsContext: WsHandlerContext = {
    terminalService,
    wsTerminals,
    registry,
    processController,
    dataPlane,
    clients,
    interruptController: deps.interruptController,
  };

  const unsubscribe = registry.subscribe((agents) => {
    broadcast(clients, { type: "agents_update", agents });
  });

  const server = Bun.serve({
    port: config.port,

    async fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/api/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as unknown as Response;
        return jsonResponse({ error: "WebSocket upgrade failed" }, 400);
      }

      const ctx = {
        registry,
        sessionDb,
        config,
        authManager,
        authEnabled: Boolean(authEnabled),
        processController,
        worktreeManager,
        dataPlane,
        skillInjector,
        claudeMdInjector,
        meegoApiBase,
        meegoPluginToken,
        hookEngine,
        hookMetricsCollector,
        appConfig,
        vikingClient,
      };
      return (await routeRequest(req, url, ctx)) ?? jsonResponse({ error: "Not Found" }, 404);
    },

    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "connected", agents: registry.allRunning() } satisfies WsConnected));
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已连接");
      },
      message(ws, message) {
        handleWsMessage(ws, message, wsContext);
      },
      close(ws) {
        clients.delete(ws);
        // 清理该连接关联的所有终端会话
        const termIds = wsTerminals.get(ws);
        if (termIds) {
          for (const id of termIds) {
            terminalService.destroy(id);
          }
          wsTerminals.delete(ws);
        }
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已断开");
      },
    },
  });

  logger.info({ port: config.port, authEnabled: Boolean(authEnabled) }, "Dashboard 服务已启动");

  if (signal) {
    signal.addEventListener("abort", () => {
      logger.info("收到 AbortSignal，正在关闭 Dashboard 服务");
      unsubscribe();
      dataPlane.setRawEventListener(null);
      terminalService.destroyAll();
      wsTerminals.clear();
      for (const ws of clients) {
        try {
          (ws as { close(): void }).close();
        } catch {
          // 忽略
        }
      }
      clients.clear();
      server.stop();
    });
  }

  return server;
}
