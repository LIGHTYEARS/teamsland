import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSession, type PersistedSession, persistSession } from "../coordinator.js";

describe("Session Persistence", () => {
  const testDir = join(tmpdir(), `coord-test-${randomUUID().slice(0, 8)}`);

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("should persist and load a session", async () => {
    mkdirSync(testDir, { recursive: true });

    const session: PersistedSession = {
      sessionId: "sess-001",
      chatId: "oc_xxx",
      startedAt: Date.now() - 10_000,
      processedEvents: ["evt-1", "evt-2"],
    };

    await persistSession(testDir, session);
    const loaded = await loadSession(testDir);

    expect(loaded).toEqual(session);
  });

  it("should return null when no session file exists", async () => {
    mkdirSync(testDir, { recursive: true });
    const loaded = await loadSession(testDir);
    expect(loaded).toBeNull();
  });

  it("should clear session file when persisting null", async () => {
    mkdirSync(testDir, { recursive: true });

    await persistSession(testDir, {
      sessionId: "sess-001",
      chatId: "oc_xxx",
      startedAt: Date.now(),
      processedEvents: [],
    });

    await persistSession(testDir, null);
    const loaded = await loadSession(testDir);
    expect(loaded).toBeNull();
  });
});
