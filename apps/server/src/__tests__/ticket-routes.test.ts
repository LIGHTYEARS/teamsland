import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { TicketStore } from "@teamsland/ticket";
import { handleTicketRoutes, type TicketRouteDeps } from "../ticket-routes.js";

function makeRequest(method: string, path: string, body?: unknown): Request {
  const url = `http://localhost:3001${path}`;
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("ticket routes", () => {
  let db: Database;
  let store: TicketStore;
  let deps: TicketRouteDeps;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new TicketStore(db);
    deps = {
      ticketStore: store,
      meegoGet: vi.fn(),
      docRead: vi.fn(),
    };
  });

  afterEach(() => {
    db.close();
  });

  it("returns null for non-ticket paths", () => {
    const req = makeRequest("GET", "/api/workers");
    const result = handleTicketRoutes(req, new URL(req.url), deps);
    expect(result).toBeNull();
  });

  describe("POST /api/ticket/:id/create", () => {
    it("creates a ticket", async () => {
      const req = makeRequest("POST", "/api/ticket/ISSUE-1/create", { eventId: "evt-001" });
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      expect(res).not.toBeNull();
      const json = await res?.json();
      expect(json.issueId).toBe("ISSUE-1");
      expect(json.state).toBe("received");
    });
  });

  describe("GET /api/ticket/:id", () => {
    it("returns ticket state", async () => {
      store.create("ISSUE-1", "evt-001");
      const req = makeRequest("GET", "/api/ticket/ISSUE-1");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      const json = await res?.json();
      expect(json.state).toBe("received");
    });

    it("returns 404 for missing ticket", async () => {
      const req = makeRequest("GET", "/api/ticket/MISSING");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      expect(res?.status).toBe(404);
    });
  });

  describe("POST /api/ticket/:id/transition", () => {
    it("transitions state", async () => {
      store.create("ISSUE-1", "evt-001");
      const req = makeRequest("POST", "/api/ticket/ISSUE-1/transition", { to: "enriching" });
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      const json = await res?.json();
      expect(json.ok).toBe(true);
      expect(store.get("ISSUE-1")?.state).toBe("enriching");
    });

    it("rejects invalid transition", async () => {
      store.create("ISSUE-1", "evt-001");
      const req = makeRequest("POST", "/api/ticket/ISSUE-1/transition", { to: "executing" });
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      expect(res?.status).toBe(400);
    });
  });
});
