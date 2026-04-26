import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import { enrichTicket, TicketStore } from "@teamsland/ticket";

describe("ticket lifecycle integration", () => {
  let db: Database;
  let store: TicketStore;

  beforeEach(() => {
    db = new Database(":memory:");
    store = new TicketStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("full happy path: received → enriching → triaging → ready → executing → completed", () => {
    store.create("ISSUE-1", "evt-001");
    const initial = store.get("ISSUE-1");
    expect(initial).not.toBeNull();
    expect(initial?.state).toBe("received");

    expect(store.transition("ISSUE-1", "enriching").ok).toBe(true);
    expect(store.transition("ISSUE-1", "triaging").ok).toBe(true);
    expect(store.transition("ISSUE-1", "ready").ok).toBe(true);
    expect(store.transition("ISSUE-1", "executing").ok).toBe(true);
    expect(store.transition("ISSUE-1", "completed").ok).toBe(true);
    const final = store.get("ISSUE-1");
    expect(final?.state).toBe("completed");
  });

  it("clarification path: triaging → awaiting → triaging → ready", () => {
    store.create("ISSUE-2", "evt-002");
    store.transition("ISSUE-2", "enriching");
    store.transition("ISSUE-2", "triaging");
    store.transition("ISSUE-2", "awaiting_clarification");
    const awaiting = store.get("ISSUE-2");
    expect(awaiting?.state).toBe("awaiting_clarification");

    // Reply arrives, re-triage
    store.transition("ISSUE-2", "triaging");
    store.transition("ISSUE-2", "ready");
    const ready = store.get("ISSUE-2");
    expect(ready?.state).toBe("ready");
  });

  it("timeout path: awaiting → suspended", () => {
    store.create("ISSUE-3", "evt-003");
    store.transition("ISSUE-3", "enriching");
    store.transition("ISSUE-3", "triaging");
    store.transition("ISSUE-3", "awaiting_clarification");
    store.transition("ISSUE-3", "suspended");
    const suspended = store.get("ISSUE-3");
    expect(suspended?.state).toBe("suspended");
  });

  it("skip path: triaging → skipped", () => {
    store.create("ISSUE-4", "evt-004");
    store.transition("ISSUE-4", "enriching");
    store.transition("ISSUE-4", "triaging");
    store.transition("ISSUE-4", "skipped");
    const skipped = store.get("ISSUE-4");
    expect(skipped?.state).toBe("skipped");
  });

  it("failure path: executing → failed", () => {
    store.create("ISSUE-5", "evt-005");
    store.transition("ISSUE-5", "enriching");
    store.transition("ISSUE-5", "triaging");
    store.transition("ISSUE-5", "ready");
    store.transition("ISSUE-5", "executing");
    store.transition("ISSUE-5", "failed");
    const failed = store.get("ISSUE-5");
    expect(failed?.state).toBe("failed");
  });

  it("enrichment with mocked deps returns structured data", async () => {
    const result = await enrichTicket({
      issueId: "ISSUE-1",
      projectKey: "TEST",
      workItemType: "story",
      meegoGet: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          id: 1,
          name: "Test",
          type: "story",
          status: "open",
          fields: {
            priority: "P1",
            prd: "https://bytedance.feishu.cn/docx/abc",
            description: "A test ticket",
          },
          createdBy: "alice",
        },
      }),
      docRead: vi.fn().mockResolvedValue("# PRD Content\nDetails here"),
    });

    expect(result.basic.title).toBe("Test");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].ok).toBe(true);
    expect(result.customFields.find((f) => f.fieldKey === "priority")?.value).toBe("P1");
  });
});
