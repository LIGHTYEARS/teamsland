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

async function handleCreate(req: Request, issueId: string, deps: TicketRouteDeps): Promise<Response> {
  const body = (await req.json()) as { eventId: string; eventType?: string };
  deps.ticketStore.create(issueId, body.eventId, body.eventType);
  return json(deps.ticketStore.get(issueId), 201);
}

async function handleTransition(req: Request, issueId: string, deps: TicketRouteDeps): Promise<Response> {
  const body = (await req.json()) as { to: string };
  const result = deps.ticketStore.transition(issueId, body.to as TicketState);
  if (!result.ok) return json({ ok: false, error: result.error }, 400);
  return json({ ok: true, state: body.to });
}

async function handleEnrich(req: Request, issueId: string, deps: TicketRouteDeps): Promise<Response> {
  const body = (await req.json()) as { projectKey: string; workItemType: string };
  try {
    const result = await enrichTicket({
      issueId,
      projectKey: body.projectKey,
      workItemType: body.workItemType,
      meegoGet: deps.meegoGet,
      docRead: deps.docRead,
    });
    deps.ticketStore.updateContext(issueId, JSON.stringify(result));
    return json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ issueId, err }, "Enrich failed");
    return json({ error: message }, 500);
  }
}

async function handleUpdateContext(req: Request, issueId: string, deps: TicketRouteDeps): Promise<Response> {
  const body = (await req.json()) as { context: string };
  deps.ticketStore.updateContext(issueId, body.context);
  return json({ ok: true });
}

function handleListTickets(url: URL, deps: TicketRouteDeps): Response {
  const stateParam = url.searchParams.get("state");
  const states = stateParam ? (stateParam.split(",") as TicketState[]) : undefined;
  const limit = Number(url.searchParams.get("limit") ?? "200") || 200;
  const offset = Number(url.searchParams.get("offset") ?? "0") || 0;
  return json(deps.ticketStore.listAll({ states, limit, offset }));
}

function handleSingleTicket(req: Request, url: URL, deps: TicketRouteDeps): RouteResult {
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

  if (req.method === "POST" && action === "create") return handleCreate(req, issueId, deps);
  if (req.method === "POST" && action === "transition") return handleTransition(req, issueId, deps);
  if (req.method === "POST" && action === "enrich") return handleEnrich(req, issueId, deps);
  if (req.method === "POST" && action === "context") return handleUpdateContext(req, issueId, deps);

  return null;
}

export function handleTicketRoutes(req: Request, url: URL, deps: TicketRouteDeps): RouteResult {
  if (!url.pathname.startsWith("/api/ticket/") && url.pathname !== "/api/tickets") return null;

  // GET /api/tickets — list all tickets
  if (req.method === "GET" && url.pathname === "/api/tickets") return handleListTickets(url, deps);

  return handleSingleTicket(req, url, deps);
}
