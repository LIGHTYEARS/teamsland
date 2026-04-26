import { createLogger } from "@teamsland/observability";
import type { EnqueueOptions, PersistentQueue } from "@teamsland/queue";
import type { TicketStore } from "@teamsland/ticket";

const logger = createLogger("server:ask-routes");

export interface AskRouteDeps {
  ticketStore: TicketStore;
  larkSendDm: (userId: string, text: string) => Promise<void>;
  queue: PersistentQueue;
}

type RouteResult = Response | Promise<Response> | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const CLARIFICATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// In-memory timeout registry (cleared on server restart)
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

export function handleAskRoutes(req: Request, url: URL, deps: AskRouteDeps): RouteResult {
  // POST /api/ask
  if (req.method !== "POST" || url.pathname !== "/api/ask") return null;

  return (async () => {
    const body = (await req.json()) as { to: string; ticketId: string; text: string };
    const { to, ticketId, text } = body;

    if (!to || !ticketId || !text) {
      return json({ error: "Missing required fields: to, ticketId, text" }, 400);
    }

    // Step 1: Send Lark DM
    try {
      await deps.larkSendDm(to, text);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: `Failed to send DM: ${message}` }, 500);
    }

    // Step 2: Transition to awaiting_clarification
    const result = deps.ticketStore.transition(ticketId, "awaiting_clarification");
    if (!result.ok) {
      logger.warn({ ticketId, error: result.error }, "ask: transition failed, DM was already sent");
    }

    // Step 3: Register timeout
    const existing = pendingTimeouts.get(ticketId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pendingTimeouts.delete(ticketId);
      const ticket = deps.ticketStore.get(ticketId);
      if (ticket?.state === "awaiting_clarification") {
        try {
          // Use worker_anomaly as the closest existing type for system-generated events.
          // The payload carries clarification_timeout semantics via the details field.
          const enqueueOpts: EnqueueOptions = {
            type: "worker_anomaly",
            payload: {
              workerId: ticketId,
              anomalyType: "timeout",
              details: `clarification_timeout:${ticketId}`,
            },
            priority: "high",
          };
          deps.queue.enqueue(enqueueOpts);
          logger.info({ ticketId }, "Clarification timeout fired");
        } catch (err) {
          logger.error({ ticketId, err }, "Failed to enqueue clarification_timeout");
        }
      }
    }, CLARIFICATION_TIMEOUT_MS);

    pendingTimeouts.set(ticketId, timer);

    return json({ ok: true, ticketId, state: "awaiting_clarification" });
  })();
}
