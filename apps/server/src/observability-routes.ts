import type { PersistentQueue, QueueMessageType } from "@teamsland/queue";
import type { CoordinatorProcess } from "./coordinator-process.js";

/** Observability API 路由依赖 */
export interface ObservabilityRouteDeps {
  coordinatorManager: CoordinatorProcess | null;
  queue: PersistentQueue;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function handleQueueRoutes(url: URL, deps: ObservabilityRouteDeps): Response | null {
  if (url.pathname === "/api/queue/stats") {
    return jsonResponse(deps.queue.stats());
  }

  if (url.pathname === "/api/queue/dead-letters") {
    const limit = Number(url.searchParams.get("limit") ?? "50");
    return jsonResponse(deps.queue.deadLetters(limit));
  }

  if (url.pathname === "/api/queue/recent") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const typeParam = url.searchParams.get("type");
    const types = typeParam ? (typeParam.split(",") as QueueMessageType[]) : undefined;
    return jsonResponse(deps.queue.recentProcessed(limit, types));
  }

  return null;
}

/**
 * 处理可观测性相关 API 路由
 *
 * - GET /api/coordinator/status — Coordinator 状态
 * - GET /api/queue/stats — 队列统计
 * - GET /api/queue/dead-letters — 死信队列
 * - GET /api/queue/recent — 最近处理的消息
 */
export function handleObservabilityRoutes(
  req: Request,
  url: URL,
  deps: ObservabilityRouteDeps,
): Response | Promise<Response> | null {
  if (!url.pathname.startsWith("/api/coordinator") && !url.pathname.startsWith("/api/queue")) return null;

  if (req.method !== "GET") return null;

  if (url.pathname === "/api/coordinator/status") {
    if (!deps.coordinatorManager) {
      return jsonResponse({ enabled: false });
    }
    return jsonResponse({
      enabled: true,
      state: deps.coordinatorManager.getState(),
      activeSession: deps.coordinatorManager.getSessionId(),
    });
  }

  return handleQueueRoutes(url, deps);
}
