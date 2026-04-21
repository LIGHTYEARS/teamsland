import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { AgentRecord, DashboardConfig } from "@teamsland/types";
import { extractToken, type LarkAuthManager } from "./lark-auth.js";

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

  return handleApiRoutes(req, url, ctx.registry, ctx.sessionDb);
}
function handleApiRoutes(req: Request, url: URL, registry: SubagentRegistry, sessionDb: SessionDB): Response | null {
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
 * - `GET /ws` — WebSocket 升级
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
  const { registry, sessionDb, config, authManager } = deps;
  const clients = new Set<unknown>();
  const authEnabled = config.auth.provider === "lark_oauth" && authManager;

  const unsubscribe = registry.subscribe((agents) => {
    broadcast(clients, { type: "agents_update", agents });
  });

  const server = Bun.serve({
    port: config.port,

    fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) return undefined as unknown as Response;
        return jsonResponse({ error: "WebSocket upgrade failed" }, 400);
      }

      const ctx = { registry, sessionDb, config, authManager, authEnabled: Boolean(authEnabled) };
      return routeRequest(req, url, ctx) ?? jsonResponse({ error: "Not Found" }, 404);
    },

    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "connected", agents: registry.allRunning() } satisfies WsConnected));
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已连接");
      },
      message(_ws, message) {
        logger.debug({ message: String(message).slice(0, 100) }, "WebSocket 收到客户端消息");
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
