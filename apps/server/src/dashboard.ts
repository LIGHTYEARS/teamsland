import type { WorktreeManager } from "@teamsland/git";
import type { HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type {
  ClaudeMdInjector,
  ProcessController,
  SidecarDataPlane,
  SkillInjector,
  SubagentRegistry,
} from "@teamsland/sidecar";
import type { AgentRecord, DashboardConfig } from "@teamsland/types";
import { handleExtendedApiRoutes } from "./api-routes.js";
import { handleFileRoutes, validatePath } from "./file-routes.js";
import { handleGitRoutes } from "./git-routes.js";
import { extractToken, type LarkAuthManager } from "./lark-auth.js";
import { TerminalService } from "./terminal-service.js";
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
 *   claudeMdInjector,
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

type WsMessage = WsAgentsUpdate | WsConnected;

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
function routeRequest(
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
  },
): Response | Promise<Response> | null {
  if (req.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ status: "ok", uptime: process.uptime() });
  }

  if (ctx.authEnabled && ctx.authManager) {
    const authResult = handleAuthRoutes(req, url, ctx.authManager, ctx.config);
    if (authResult) return authResult;
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

  return handleApiRoutes(req, url, ctx.registry, ctx.sessionDb, ctx.hookEngine, ctx.hookMetricsCollector);
}

/** 处理 Hook 相关 API 路由 */
function handleHookRoutes(
  req: Request,
  url: URL,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
): Response | null {
  if (req.method === "GET" && url.pathname === "/api/hooks/status") {
    if (!hookEngine) {
      return jsonResponse({ enabled: false, message: "Hook 引擎未启用" });
    }
    return jsonResponse({ enabled: true, ...hookEngine.getStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/hooks/metrics") {
    if (!hookMetricsCollector) {
      return jsonResponse({ enabled: false, message: "Hook 指标收集器未启用" });
    }
    return jsonResponse({ enabled: true, ...hookMetricsCollector.getSnapshot() });
  }

  return null;
}

function handleApiRoutes(
  req: Request,
  url: URL,
  registry: SubagentRegistry,
  sessionDb: SessionDB,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
): Response | null {
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

  const hookResult = handleHookRoutes(req, url, hookEngine, hookMetricsCollector);
  if (hookResult) return hookResult;

  return null;
}

/** WebSocket 客户端消息类型定义 */
interface WsClientMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * 处理 WebSocket 客户端消息
 *
 * 根据消息类型分派到对应的处理逻辑：
 * - `terminal-start`: 创建终端会话
 * - `terminal-input`: 向终端写入数据
 * - `terminal-stop`: 关闭终端会话
 * - 其他类型记录调试日志
 *
 * @param ws - WebSocket 连接实例
 * @param message - 原始消息数据
 * @param terminalService - 终端服务实例
 *
 * @example
 * ```typescript
 * handleWsMessage(ws, rawMessage, terminalService);
 * ```
 */
function handleWsMessage(ws: unknown, message: string | Buffer, terminalService: TerminalService): void {
  let parsed: WsClientMessage;
  try {
    parsed = JSON.parse(String(message)) as WsClientMessage;
  } catch {
    logger.debug({ message: String(message).slice(0, 100) }, "WebSocket 消息解析失败");
    return;
  }

  const sender = ws as { send(data: string): void };

  if (parsed.type === "terminal-start") {
    handleTerminalStart(parsed, sender, terminalService).catch((err: unknown) => {
      logger.error({ err }, "终端启动处理失败");
    });
    return;
  }

  if (parsed.type === "terminal-input") {
    const id = typeof parsed.id === "string" ? parsed.id : "";
    const data = typeof parsed.data === "string" ? parsed.data : "";
    if (id && data) {
      terminalService.write(id, data);
    }
    return;
  }

  if (parsed.type === "terminal-stop") {
    const id = typeof parsed.id === "string" ? parsed.id : "";
    if (id) {
      terminalService.destroy(id);
      sender.send(JSON.stringify({ type: "terminal-stopped", id }));
    }
    return;
  }

  logger.debug({ type: parsed.type }, "WebSocket 收到未识别的消息类型");
}

/**
 * 处理终端启动请求
 *
 * 创建终端会话并异步将 stdout 数据转发到 WebSocket 客户端。
 *
 * @param parsed - 解析后的消息
 * @param sender - WebSocket 发送器
 * @param terminalService - 终端服务实例
 *
 * @example
 * ```typescript
 * await handleTerminalStart({ type: "terminal-start", id: "t1", cwd: "/tmp" }, sender, terminalService);
 * ```
 */
async function handleTerminalStart(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  terminalService: TerminalService,
): Promise<void> {
  const id = typeof parsed.id === "string" ? parsed.id : `term-${Date.now()}`;
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd : process.cwd();

  const validatedCwd = await validatePath(cwd);
  if (!validatedCwd) {
    sender.send(JSON.stringify({ type: "terminal-error", id, error: "工作目录路径无效" }));
    return;
  }

  const stdout = terminalService.create(id, validatedCwd);
  if (!stdout) {
    sender.send(JSON.stringify({ type: "terminal-error", id, error: "终端会话已存在" }));
    return;
  }

  sender.send(JSON.stringify({ type: "terminal-started", id }));

  // 异步读取 stdout 并转发到 WebSocket
  const reader = stdout.getReader();
  const decoder = new TextDecoder();

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        try {
          sender.send(JSON.stringify({ type: "terminal-output", id, data: text }));
        } catch {
          // WebSocket 可能已断开
          break;
        }
      }
    } catch {
      // 进程可能已退出
    } finally {
      reader.releaseLock();
    }
  };

  pump().catch(() => {});
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
 * - `GET /api/ws` — WebSocket 升级（支持 terminal-start/input/stop）
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
  } = deps;
  const clients = new Set<unknown>();
  const authEnabled = config.auth.provider === "lark_oauth" && authManager;
  const terminalService = new TerminalService();

  const unsubscribe = registry.subscribe((agents) => {
    broadcast(clients, { type: "agents_update", agents });
  });

  const server = Bun.serve({
    port: config.port,

    fetch(req, server) {
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
      };
      return routeRequest(req, url, ctx) ?? jsonResponse({ error: "Not Found" }, 404);
    },

    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "connected", agents: registry.allRunning() } satisfies WsConnected));
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已连接");
      },
      message(ws, message) {
        handleWsMessage(ws, message, terminalService);
      },
      close(ws) {
        clients.delete(ws);
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已断开");
      },
    },
  });

  logger.info({ port: config.port, authEnabled: Boolean(authEnabled) }, "Dashboard 服务已启动");

  if (signal) {
    signal.addEventListener("abort", () => {
      logger.info("收到 AbortSignal，正在关闭 Dashboard 服务");
      unsubscribe();
      terminalService.destroyAll();
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
