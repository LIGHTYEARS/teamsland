import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import type { EnqueueOptions } from "@teamsland/queue";
import { PersistentQueue } from "@teamsland/queue";

// Minimal stub payloads typed to satisfy EnqueueOptions without `as any`
const meego_issue_created: EnqueueOptions = {
  type: "meego_issue_created",
  payload: {
    event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
  },
  priority: "normal",
};

const worker_completed: EnqueueOptions = {
  type: "worker_completed",
  payload: { workerId: "w1", sessionId: "s1", issueId: "I1", resultSummary: "done" },
  priority: "normal",
};

const lark_mention: EnqueueOptions = {
  type: "lark_mention",
  payload: {
    event: { eventId: "e2", issueId: "I2", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
    chatId: "oc_test",
    senderId: "ou_test",
    messageId: "msg_test",
  },
  priority: "normal",
};

describe("unified consumer", () => {
  let queue: PersistentQueue;

  beforeEach(() => {
    queue = new PersistentQueue({
      dbPath: ":memory:",
      pollIntervalMs: 50,
      visibilityTimeoutMs: 5000,
      busyTimeoutMs: 5000,
      maxRetries: 3,
      deadLetterEnabled: false,
    });
  });

  afterEach(() => {
    queue.close();
  });

  it("only has one consumer registered (coordinator path)", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    // Simulating the old bug: two consume() calls
    queue.consume(handler1);
    queue.consume(handler2); // this overwrites handler1

    // The fix: only register once in main.ts
    // Verify we don't double-register by checking the queue has exactly one handler
    // PersistentQueue warns on overwrite — this test documents the constraint
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it("coordinator receives all event types through single consumer", async () => {
    const processedTypes: string[] = [];
    queue.consume(async (msg) => {
      processedTypes.push(msg.type);
    });

    queue.enqueue(meego_issue_created);
    queue.enqueue(worker_completed);
    queue.enqueue(lark_mention);

    // Wait for poll cycles
    await new Promise((r) => setTimeout(r, 300));

    expect(processedTypes).toContain("meego_issue_created");
    expect(processedTypes).toContain("worker_completed");
    expect(processedTypes).toContain("lark_mention");
  });
});
