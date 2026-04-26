import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TicketStore } from "../store.js";

describe("TicketStore", () => {
  let db: Database;
  let store: TicketStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new TicketStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a ticket in received state", () => {
    store.create("ISSUE-1", "evt-001");
    const record = store.get("ISSUE-1");
    expect(record).not.toBeNull();
    expect(record?.state).toBe("received");
    expect(record?.eventId).toBe("evt-001");
  });

  it("transitions through valid states", () => {
    store.create("ISSUE-1", "evt-001");
    const result = store.transition("ISSUE-1", "enriching");
    expect(result.ok).toBe(true);
    expect(store.get("ISSUE-1")?.state).toBe("enriching");
  });

  it("rejects invalid transitions", () => {
    store.create("ISSUE-1", "evt-001");
    const result = store.transition("ISSUE-1", "executing");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("received");
    expect(result.error).toContain("executing");
    expect(store.get("ISSUE-1")?.state).toBe("received");
  });

  it("rejects transition for non-existent ticket", () => {
    const result = store.transition("NONEXISTENT", "enriching");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("updates context", () => {
    store.create("ISSUE-1", "evt-001");
    store.updateContext("ISSUE-1", JSON.stringify({ enriched: true }));
    const record = store.get("ISSUE-1");
    expect(JSON.parse(record?.context ?? "null")).toEqual({ enriched: true });
  });

  it("lists tickets by state", () => {
    store.create("ISSUE-1", "evt-001");
    store.create("ISSUE-2", "evt-002");
    store.transition("ISSUE-1", "enriching");
    expect(store.listByState("received")).toHaveLength(1);
    expect(store.listByState("enriching")).toHaveLength(1);
    expect(store.listByState("received")[0].issueId).toBe("ISSUE-2");
  });

  it("handles duplicate create (upsert)", () => {
    store.create("ISSUE-1", "evt-001");
    store.create("ISSUE-1", "evt-002");
    const record = store.get("ISSUE-1");
    expect(record?.eventId).toBe("evt-001"); // first create wins
  });
});
