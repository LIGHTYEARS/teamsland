import { createLogger } from "@teamsland/observability";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { AgentRecord, DashboardConfig } from "@teamsland/types";

const logger = createLogger("server:dashboard");

/**
 * Dashboard 服务依赖
 *
 * @example
 * ```typescript
 * const deps: DashboardDeps = {
 *   registry: subagentRegistry,
 *   config: { port: 3000, auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] } },
 * };
 * ```
 */
export interface DashboardDeps {
  /** Agent 注册表，用于查询运行中的 agent 列表 */
  registry: SubagentRegistry;
  /** Dashboard 配置（端口、鉴权等） */
  config: DashboardConfig;
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

/**
 * 启动 Dashboard HTTP/WebSocket 服务
 *
 * 基于 Bun.serve 启动一个轻量 HTTP 服务，提供以下路由：
 * - `GET /health` — 健康检查，返回 `{ status: "ok", uptime }` (200)
 * - `GET /api/agents` — 返回所有运行中的 agent 列表 (200)
 * - `GET /ws` — WebSocket 升级端点，推送实时 agent 列表变更
 * - 其他路由 — 返回 `{ error: "Not Found" }` (404)
 *
 * WebSocket 连接建立后立即推送当前 agent 列表。
 * 之后每次注册表变更（register/unregister）自动广播更新。
 *
 * @param deps - Dashboard 依赖（注册表 + 配置）
 * @param signal - 可选的 AbortSignal，用于优雅关闭
 * @returns Bun.serve 返回的 Server 实例
 *
 * @example
 * ```typescript
 * import { startDashboard } from "./dashboard.js";
 *
 * const ac = new AbortController();
 * const server = startDashboard(
 *   { registry: subagentRegistry, config: dashboardConfig },
 *   ac.signal,
 * );
 * ac.abort(); // 优雅关闭
 * ```
 */
export function startDashboard(deps: DashboardDeps, signal?: AbortSignal): ReturnType<typeof Bun.serve> {
  const { registry, config } = deps;
  const clients = new Set<unknown>();

  // 订阅注册表变更，广播给所有 WebSocket 客户端
  const unsubscribe = registry.subscribe((agents) => {
    broadcast(clients, { type: "agents_update", agents });
  });

  const server = Bun.serve({
    port: config.port,

    fetch(req, server) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req);
        if (upgraded) {
          return undefined as unknown as Response;
        }
        return new Response(JSON.stringify({ error: "WebSocket upgrade failed" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", uptime: process.uptime() }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (req.method === "GET" && url.pathname === "/api/agents") {
        return new Response(JSON.stringify(registry.allRunning()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    },

    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "connected", agents: registry.allRunning() } satisfies WsConnected));
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已连接");
      },
      message(_ws, message) {
        // 客户端消息暂不处理（预留 ping/pong 或命令扩展）
        logger.debug({ message: String(message).slice(0, 100) }, "WebSocket 收到客户端消息");
      },
      close(ws) {
        clients.delete(ws);
        logger.debug({ clientCount: clients.size }, "WebSocket 客户端已断开");
      },
    },
  });

  logger.info({ port: config.port }, "Dashboard 服务已启动");

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
