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

    it("forwards eventType to store", async () => {
      const req = makeRequest("POST", "/api/ticket/ISSUE-2/create", {
        eventId: "evt-002",
        eventType: "meego_issue_created",
      });
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      expect(res).not.toBeNull();
      const json = await res?.json();
      expect(json.eventType).toBe("meego_issue_created");
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

  describe("GET /api/tickets", () => {
    it("returns all tickets", async () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      store.create("ISSUE-2", "evt-002", "lark_mention");
      store.transition("ISSUE-1", "enriching");
      const req = makeRequest("GET", "/api/tickets");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      expect(res).not.toBeNull();
      const json = await res?.json();
      expect(json).toHaveLength(2);
      expect(json[0].issueId).toBeDefined();
      expect(json[0].eventType).toBeDefined();
    });

    it("filters by state", async () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      store.create("ISSUE-2", "evt-002", "lark_mention");
      store.transition("ISSUE-1", "enriching");
      const req = makeRequest("GET", "/api/tickets?state=enriching");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      const json = await res?.json();
      expect(json).toHaveLength(1);
      expect(json[0].state).toBe("enriching");
    });

    it("filters by multiple states", async () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      store.create("ISSUE-2", "evt-002", "lark_mention");
      store.transition("ISSUE-1", "enriching");
      const req = makeRequest("GET", "/api/tickets?state=received,enriching");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      const json = await res?.json();
      expect(json).toHaveLength(2);
    });

    it("supports limit and offset", async () => {
      for (let i = 0; i < 5; i++) store.create(`ISSUE-${i}`, `evt-${i}`);
      const req = makeRequest("GET", "/api/tickets?limit=2&offset=1");
      const res = await handleTicketRoutes(req, new URL(req.url), deps);
      const json = await res?.json();
      expect(json).toHaveLength(2);
    });
  });

  describe("ticket_update callback", () => {
    it("calls onTransition after successful transition", async () => {
      const onTransition = vi.fn();
      const depsWithCallback = { ...deps, onTransition };
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      const req = makeRequest("POST", "/api/ticket/ISSUE-1/transition", { to: "enriching" });
      await handleTicketRoutes(req, new URL(req.url), depsWithCallback);
      expect(onTransition).toHaveBeenCalledWith({
        ticketId: "ISSUE-1",
        state: "enriching",
        previousState: "received",
        updatedAt: expect.any(Number),
      });
    });

    it("does not call onTransition on failed transition", async () => {
      const onTransition = vi.fn();
      const depsWithCallback = { ...deps, onTransition };
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      const req = makeRequest("POST", "/api/ticket/ISSUE-1/transition", { to: "executing" });
      await handleTicketRoutes(req, new URL(req.url), depsWithCallback);
      expect(onTransition).not.toHaveBeenCalled();
    });
  });

  describe("extended TicketRecord fields", () => {
    it("create stores eventType from parameter", () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      const record = store.get("ISSUE-1");
      expect(record?.eventType).toBe("meego_issue_created");
    });

    it("create defaults eventType to 'unknown' when not provided", () => {
      store.create("ISSUE-2", "evt-002");
      const record = store.get("ISSUE-2");
      expect(record?.eventType).toBe("unknown");
    });

    it("history starts empty on create", () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      const record = store.get("ISSUE-1");
      expect(record?.history).toEqual([]);
    });

    it("transition appends to history", () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      store.transition("ISSUE-1", "enriching");
      const record = store.get("ISSUE-1");
      expect(record?.history).toHaveLength(1);
      expect(record?.history[0].from).toBe("received");
      expect(record?.history[0].to).toBe("enriching");
      expect(record?.history[0].timestamp).toBeGreaterThan(0);
    });

    it("multiple transitions build full history", () => {
      store.create("ISSUE-1", "evt-001", "meego_issue_created");
      store.transition("ISSUE-1", "enriching");
      store.transition("ISSUE-1", "triaging");
      store.transition("ISSUE-1", "ready");
      const record = store.get("ISSUE-1");
      expect(record?.history).toHaveLength(3);
      expect(record?.history.map((h: { to: string }) => h.to)).toEqual(["enriching", "triaging", "ready"]);
    });
  });
});
