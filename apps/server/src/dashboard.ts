import { createLogger } from "@teamsland/observability";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { DashboardConfig } from "@teamsland/types";

const logger = createLogger("server:dashboard");

/**
 * Dashboard 服务依赖
 *
 * @example
 * ```typescript
 * import type { DashboardDeps } from "@teamsland/server";
 *
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

/**
 * 启动 Dashboard HTTP/WebSocket 服务
 *
 * 基于 Bun.serve 启动一个轻量 HTTP 服务，提供以下路由：
 * - `GET /health` — 健康检查，返回 `{ status: "ok", uptime }` (200)
 * - `GET /api/agents` — 返回所有运行中的 agent 列表 (200)
 * - `GET /ws` — WebSocket 升级端点（占位实现，连接后 1 秒自动关闭）
 * - 其他路由 — 返回 `{ error: "Not Found" }` (404)
 *
 * 当传入 `signal` 时，AbortSignal 触发后会自动停止服务。
 *
 * @param deps - Dashboard 依赖（注册表 + 配置）
 * @param signal - 可选的 AbortSignal，用于优雅关闭
 * @returns Bun.serve 返回的 Server 实例
 *
 * @example
 * ```typescript
 * import { startDashboard } from "@teamsland/server";
 *
 * const ac = new AbortController();
 * const server = startDashboard(
 *   {
 *     registry: subagentRegistry,
 *     config: { port: 3000, auth: { provider: "lark_oauth", sessionTtlHours: 8, allowedDepartments: [] } },
 *   },
 *   ac.signal,
 * );
 *
 * // 优雅关闭
 * ac.abort();
 * ```
 */
export function startDashboard(deps: DashboardDeps, signal?: AbortSignal): ReturnType<typeof Bun.serve> {
  const { registry, config } = deps;

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
        ws.send(JSON.stringify({ type: "connected" }));
        setTimeout(() => {
          ws.close();
        }, 1000);
      },
      message() {
        // placeholder — 暂不处理客户端消息
      },
    },
  });

  logger.info({ port: config.port }, "Dashboard 服务已启动");

  if (signal) {
    signal.addEventListener("abort", () => {
      logger.info("收到 AbortSignal，正在关闭 Dashboard 服务");
      server.stop();
    });
  }

  return server;
}
