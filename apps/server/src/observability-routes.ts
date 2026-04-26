import type { PersistentQueue } from "@teamsland/queue";
import type { CoordinatorSessionManager } from "./coordinator.js";

/** Observability API 路由依赖 */
export interface ObservabilityRouteDeps {
  coordinatorManager: CoordinatorSessionManager | null;
  queue: PersistentQueue;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * 处理可观测性相关 API 路由
 *
 * - GET /api/coordinator/status — Coordinator 状态
 * - GET /api/queue/stats — 队列统计
 * - GET /api/queue/dead-letters — 死信队列
 */
export function handleObservabilityRoutes(
  req: Request,
  url: URL,
  deps: ObservabilityRouteDeps,
): Response | Promise<Response> | null {
  if (!url.pathname.startsWith("/api/coordinator") && !url.pathname.startsWith("/api/queue")) return null;

  if (req.method === "GET" && url.pathname === "/api/coordinator/status") {
    if (!deps.coordinatorManager) {
      return jsonResponse({ enabled: false });
    }
    return jsonResponse({
      enabled: true,
      state: deps.coordinatorManager.getState(),
      activeSession: deps.coordinatorManager.getActiveSession(),
      recoveryCount: deps.coordinatorManager.getRecoveryCount(),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/queue/stats") {
    return jsonResponse(deps.queue.stats());
  }

  if (req.method === "GET" && url.pathname === "/api/queue/dead-letters") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return jsonResponse(deps.queue.deadLetters(limit));
  }

  return null;
}
