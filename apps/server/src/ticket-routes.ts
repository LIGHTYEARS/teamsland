import { createLogger } from "@teamsland/observability";
import type { TicketState, TicketStore } from "@teamsland/ticket";
import { enrichTicket } from "@teamsland/ticket";

const logger = createLogger("server:ticket-routes");

export interface TicketRouteDeps {
  ticketStore: TicketStore;
  meegoGet: (
    projectKey: string,
    workItemType: string,
    workItemId: number,
  ) => Promise<{
    ok: boolean;
    data?: {
      id: number;
      name: string;
      type: string;
      status?: string;
      fields: Record<string, unknown>;
      createdBy?: string;
      updatedBy?: string;
    };
    message?: string;
  }>;
  docRead: (url: string) => Promise<string>;
}

type RouteResult = Response | Promise<Response> | null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function handleTicketRoutes(req: Request, url: URL, deps: TicketRouteDeps): RouteResult {
  if (!url.pathname.startsWith("/api/ticket/")) return null;

  const parts = url.pathname.split("/").filter(Boolean); // ["api", "ticket", "<id>", ...]
  if (parts.length < 3) return null;
  const issueId = parts[2];
  const action = parts[3]; // "create" | "transition" | "enrich" | "context" | undefined (GET state)

  // GET /api/ticket/:id — get state
  if (req.method === "GET" && !action) {
    const record = deps.ticketStore.get(issueId);
    if (!record) return json({ error: `Ticket ${issueId} not found` }, 404);
    return json(record);
  }

  // POST /api/ticket/:id/create
  if (req.method === "POST" && action === "create") {
    return (async () => {
      const body = (await req.json()) as { eventId: string };
      deps.ticketStore.create(issueId, body.eventId);
      const record = deps.ticketStore.get(issueId);
      return json(record, 201);
    })();
  }

  // POST /api/ticket/:id/transition
  if (req.method === "POST" && action === "transition") {
    return (async () => {
      const body = (await req.json()) as { to: string };
      const result = deps.ticketStore.transition(issueId, body.to as TicketState);
      if (!result.ok) return json({ ok: false, error: result.error }, 400);
      return json({ ok: true, state: body.to });
    })();
  }

  // POST /api/ticket/:id/enrich
  if (req.method === "POST" && action === "enrich") {
    return (async () => {
      const body = (await req.json()) as { projectKey: string; workItemType: string };
      try {
        const result = await enrichTicket({
          issueId,
          projectKey: body.projectKey,
          workItemType: body.workItemType,
          meegoGet: deps.meegoGet,
          docRead: deps.docRead,
        });
        // Store enriched context
        deps.ticketStore.updateContext(issueId, JSON.stringify(result));
        return json(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ issueId, err }, "Enrich failed");
        return json({ error: message }, 500);
      }
    })();
  }

  // POST /api/ticket/:id/context — update context
  if (req.method === "POST" && action === "context") {
    return (async () => {
      const body = (await req.json()) as { context: string };
      deps.ticketStore.updateContext(issueId, body.context);
      return json({ ok: true });
    })();
  }

  return null;
}
