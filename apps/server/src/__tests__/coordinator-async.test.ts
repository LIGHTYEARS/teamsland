import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

import type {
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorSessionManagerConfig,
} from "@teamsland/types";
import type { CoordinatorPromptBuilderLike, SpawnedProcess, SpawnFn } from "../coordinator.js";
import { CoordinatorSessionManager } from "../coordinator.js";

const DEFAULT_CONFIG: CoordinatorSessionManagerConfig = {
  workspacePath: "/tmp/test-coordinator-async",
  sessionIdleTimeoutMs: 300_000,
  sessionMaxLifetimeMs: 1_800_000,
  sessionReuseWindowMs: 300_000,
  maxRecoveryRetries: 3,
  inferenceTimeoutMs: 60_000,
};

function makeEvent(id = "evt-async-1"): CoordinatorEvent {
  return {
    type: "lark_mention",
    id,
    timestamp: Date.now(),
    priority: 1,
    payload: { chatId: "oc_test" },
  };
}

function makeContextLoader(): CoordinatorContextLoader {
  return {
    async load(): Promise<CoordinatorContext> {
      return { taskStateSummary: "", recentMessages: "", relevantMemories: "" };
    },
  };
}

function makePromptBuilder(): CoordinatorPromptBuilderLike {
  return {
    build(): string {
      return "test prompt";
    },
  };
}

describe("Coordinator processEvent non-blocking", () => {
  let manager: CoordinatorSessionManager;

  afterEach(() => {
    manager.reset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("processEvent resolves before Claude CLI stream completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Create a slow stdout that takes 5s to emit the session ID
    const slowSpawnFn: SpawnFn = vi.fn().mockImplementation((): SpawnedProcess => {
      const initLine = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "real-session-id",
      });
      return {
        pid: 99999,
        stdin: { write: vi.fn().mockReturnValue(0), flush: vi.fn(), end: vi.fn() },
        stdout: new ReadableStream({
          start(controller) {
            // Delay the session ID by 5 seconds
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(`${initLine}\n`));
              controller.close();
            }, 5000);
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    });

    manager = new CoordinatorSessionManager({
      config: DEFAULT_CONFIG,
      contextLoader: makeContextLoader(),
      promptBuilder: makePromptBuilder(),
      spawnFn: slowSpawnFn,
    });

    const start = Date.now();
    await manager.processEvent(makeEvent());
    const elapsed = Date.now() - start;

    // The key assertion: processEvent should resolve quickly (< 1s)
    // NOT after 5s when the session ID arrives
    expect(elapsed).toBeLessThan(1000);

    // Session should exist with a placeholder ID
    expect(manager.getState()).toBe("running");
  });
});
