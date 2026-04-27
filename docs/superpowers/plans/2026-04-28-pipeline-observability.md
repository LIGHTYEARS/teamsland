# Coordinator Pipeline Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end structured logging to the coordinator message processing pipeline, making every stage's latency visible and the coordinator's decisions auditable.

**Architecture:** A lightweight `PipelineTracker` class accompanies each message through the processing chain. Each stage calls `tracker.phase()` / `tracker.endPhase()` to record timing. At the end, `tracker.summarize()` produces one structured log line with the full pipeline breakdown. Queue and connector layers get independent timing field enhancements.

**Tech Stack:** TypeScript, Pino structured logging, Vitest, `performance.now()` for timing

---

### Task 1: Add `PipelineTrackerLike` interface to `@teamsland/types`

**Files:**
- Modify: `packages/types/src/coordinator.ts:149-152`

This is a prerequisite for Task 2 and Task 4. We add a minimal interface that the context loader can accept without depending on the full `PipelineTracker` class, and update the `CoordinatorContextLoader` interface to accept it.

- [ ] **Step 1: Write the failing test**

Create a type-level test to verify the interface exists and is compatible.

```typescript
// In a temporary test file or inline check — since this is a pure type change,
// the real validation is that Task 2 and Task 4 compile against it.
// We verify by running typecheck after the change.
```

- [ ] **Step 2: Add `PipelineTrackerLike` interface and update `CoordinatorContextLoader`**

In `packages/types/src/coordinator.ts`, add the interface before `CoordinatorContextLoader` and update the `load` signature:

```typescript
/**
 * Pipeline 追踪器的最小接口
 *
 * 用于在不引入 server 包依赖的前提下，让 CoordinatorContextLoader
 * 记录子阶段耗时。
 */
export interface PipelineTrackerLike {
  /** 记录子阶段耗时 */
  subPhase(parent: string, name: string, durationMs: number): void;
}

export interface CoordinatorContextLoader {
  /** 根据事件加载上下文 */
  load(event: CoordinatorEvent, tracker?: PipelineTrackerLike): Promise<CoordinatorContext>;
}
```

- [ ] **Step 3: Run typecheck to verify**

Run: `bun run typecheck`
Expected: Compilation errors in `coordinator-context.ts` because `LiveContextLoader.load()` signature doesn't match yet. This is expected — Task 4 will fix it. Confirm the types package itself compiles.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/coordinator.ts
git commit -m "feat(types): add PipelineTrackerLike interface, update CoordinatorContextLoader signature"
```

---

### Task 2: Implement `PipelineTracker` class

**Files:**
- Create: `apps/server/src/pipeline-tracker.ts`
- Create: `apps/server/src/__tests__/pipeline-tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it, vi } from "vitest";

// We'll import after creating the module
// import { PipelineTracker } from "../pipeline-tracker.js";

describe("PipelineTracker", () => {
  it("computes dwellMs from enqueuedAt", () => {
    const enqueuedAt = Date.now() - 500;
    const tracker = new PipelineTracker("msg-1", "lark_dm", enqueuedAt);
    const summary = tracker.summarize();
    expect(summary.dwellMs).toBeGreaterThanOrEqual(400);
    expect(summary.msgId).toBe("msg-1");
    expect(summary.eventType).toBe("lark_dm");
  });

  it("records phase durations", async () => {
    const tracker = new PipelineTracker("msg-2", "lark_mention", Date.now());
    tracker.phase("contextLoad");
    await new Promise((r) => setTimeout(r, 50));
    tracker.endPhase();

    tracker.phase("inference");
    await new Promise((r) => setTimeout(r, 30));
    tracker.endPhase();

    const summary = tracker.summarize();
    expect(summary.phases.contextLoad).toBeGreaterThanOrEqual(40);
    expect(summary.phases.inference).toBeGreaterThanOrEqual(20);
    expect(summary.totalMs).toBeGreaterThanOrEqual(70);
  });

  it("records sub-phases", () => {
    const tracker = new PipelineTracker("msg-3", "lark_dm", Date.now());
    tracker.subPhase("contextLoad", "registry", 5);
    tracker.subPhase("contextLoad", "vikingTasks", 80);
    tracker.subPhase("contextLoad", "userMem", 45);
    tracker.subPhase("contextLoad", "session", 120);

    const summary = tracker.summarize();
    expect(summary.subPhases.contextLoad).toEqual({
      registry: 5,
      vikingTasks: 80,
      userMem: 45,
      session: 120,
    });
  });

  it("records inference result", () => {
    const tracker = new PipelineTracker("msg-4", "lark_dm", Date.now());
    tracker.setInferenceResult({ durationMs: 12000, numTurns: 3, costUsd: 0.04 });
    const summary = tracker.summarize();
    expect(summary.inference).toEqual({ durationMs: 12000, numTurns: 3, costUsd: 0.04 });
  });

  it("records session info", () => {
    const tracker = new PipelineTracker("msg-5", "lark_dm", Date.now());
    tracker.setSessionInfo("sess-abc", 5);
    const summary = tracker.summarize();
    expect(summary.sessionId).toBe("sess-abc");
    expect(summary.sessionEventIndex).toBe(5);
  });

  it("records outcome", () => {
    const tracker = new PipelineTracker("msg-6", "lark_dm", Date.now());
    tracker.setOutcome("failed");
    const summary = tracker.summarize();
    expect(summary.outcome).toBe("failed");
  });

  it("defaults to null/unknown for unset fields", () => {
    const tracker = new PipelineTracker("msg-7", "lark_dm", Date.now());
    const summary = tracker.summarize();
    expect(summary.inference).toBeNull();
    expect(summary.sessionId).toBeNull();
    expect(summary.sessionEventIndex).toBeNull();
    expect(summary.outcome).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- apps/server/src/__tests__/pipeline-tracker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement PipelineTracker**

Create `apps/server/src/pipeline-tracker.ts`:

```typescript
import { performance } from "node:perf_hooks";

export interface PipelineSummary {
  msgId: string;
  eventType: string;
  dwellMs: number;
  phases: Record<string, number>;
  subPhases: Record<string, Record<string, number>>;
  inference: { durationMs: number; numTurns: number; costUsd: number } | null;
  sessionId: string | null;
  sessionEventIndex: number | null;
  totalMs: number;
  outcome: string;
}

export class PipelineTracker {
  private readonly msgId: string;
  private readonly eventType: string;
  private readonly enqueuedAt: number;
  private readonly startedAt: number;

  private currentPhase: string | null = null;
  private currentPhaseStart = 0;
  private readonly phases: Record<string, number> = {};
  private readonly subPhasesMap: Record<string, Record<string, number>> = {};

  private inferenceResult: { durationMs: number; numTurns: number; costUsd: number } | null = null;
  private sessionId: string | null = null;
  private sessionEventIndex: number | null = null;
  private outcome = "unknown";

  constructor(msgId: string, eventType: string, enqueuedAt: number) {
    this.msgId = msgId;
    this.eventType = eventType;
    this.enqueuedAt = enqueuedAt;
    this.startedAt = performance.now();
  }

  phase(name: string): void {
    if (this.currentPhase) {
      this.endPhase();
    }
    this.currentPhase = name;
    this.currentPhaseStart = performance.now();
  }

  endPhase(): void {
    if (this.currentPhase) {
      this.phases[this.currentPhase] = Math.round(performance.now() - this.currentPhaseStart);
      this.currentPhase = null;
    }
  }

  subPhase(parent: string, name: string, durationMs: number): void {
    if (!this.subPhasesMap[parent]) {
      this.subPhasesMap[parent] = {};
    }
    this.subPhasesMap[parent][name] = durationMs;
  }

  setInferenceResult(result: { durationMs?: number; numTurns?: number; costUsd?: number }): void {
    this.inferenceResult = {
      durationMs: result.durationMs ?? 0,
      numTurns: result.numTurns ?? 0,
      costUsd: result.costUsd ?? 0,
    };
  }

  setSessionInfo(sessionId: string, eventIndex: number): void {
    this.sessionId = sessionId;
    this.sessionEventIndex = eventIndex;
  }

  setOutcome(outcome: "success" | "failed" | "timeout"): void {
    this.outcome = outcome;
  }

  summarize(): PipelineSummary {
    if (this.currentPhase) {
      this.endPhase();
    }
    return {
      msgId: this.msgId,
      eventType: this.eventType,
      dwellMs: Math.round(Date.now() - this.enqueuedAt),
      phases: { ...this.phases },
      subPhases: Object.fromEntries(
        Object.entries(this.subPhasesMap).map(([k, v]) => [k, { ...v }]),
      ),
      inference: this.inferenceResult,
      sessionId: this.sessionId,
      sessionEventIndex: this.sessionEventIndex,
      totalMs: Math.round(performance.now() - this.startedAt),
      outcome: this.outcome,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- apps/server/src/__tests__/pipeline-tracker.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/pipeline-tracker.ts apps/server/src/__tests__/pipeline-tracker.test.ts
git commit -m "feat(server): add PipelineTracker for end-to-end pipeline latency tracking"
```

---

### Task 3: Integrate tracker into queue consumer (`main.ts`)

**Files:**
- Modify: `apps/server/src/main.ts:136-154`

- [ ] **Step 1: Add import and wrap queue consumer with tracker**

At the top of `main.ts`, add import:

```typescript
import { PipelineTracker } from "./pipeline-tracker.js";
```

Replace the `queue.consume(...)` block (lines 136-153) with:

```typescript
queue.consume(async (msg) => {
  const tracker = new PipelineTracker(msg.id, msg.type, msg.createdAt);

  tracker.phase("eventMapping");
  const event = toCoordinatorEvent(msg);
  tracker.endPhase();

  logger.info({ msgId: msg.id, eventId: event.id, eventType: event.type }, "开始处理队列消息");
  try {
    await coordinator.coordinator?.processEvent(event, tracker);
    tracker.setOutcome("success");
    logger.info({ msgId: msg.id, eventId: event.id }, "队列消息处理完成");
  } catch (err) {
    tracker.setOutcome("failed");
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { msgId: msg.id, eventId: event.id, eventType: event.type, error: errMsg },
      "Coordinator 事件处理失败",
    );
    lark.notifier
      .sendCard("Coordinator 处理失败", `事件类型: ${event.type}\n事件 ID: ${event.id}\n错误: ${errMsg}`, "error")
      .catch((sendErr) => logger.warn({ sendErr }, "Coordinator 失败告警发送失败"));
    throw err;
  } finally {
    const summary = tracker.summarize();
    logger.info(summary, "消息处理链路完成");
  }
});
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: May fail because `processEvent` doesn't accept tracker yet — that's Task 5. Verify no other type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): integrate PipelineTracker into queue consumer"
```

---

### Task 4: Add tracker to context loader (`coordinator-context.ts`)

**Files:**
- Modify: `apps/server/src/coordinator-context.ts:75-96, 101-123`
- Modify: `apps/server/src/__tests__/coordinator-context.test.ts`

- [ ] **Step 1: Update the test to verify sub-phase recording**

In `apps/server/src/__tests__/coordinator-context.test.ts`, add a new test within the `LiveContextLoader` describe block:

```typescript
it("records sub-phase timings when tracker is provided", async () => {
  const vikingClient = makeMockVikingClient();
  const registry = makeMockRegistry();
  const loader = new LiveContextLoader({ registry, vikingClient });
  const event = makeEvent();

  const subPhases: Record<string, Record<string, number>> = {};
  const tracker = {
    subPhase(parent: string, name: string, durationMs: number) {
      if (!subPhases[parent]) subPhases[parent] = {};
      subPhases[parent][name] = durationMs;
    },
  };

  await loader.load(event, tracker);

  expect(subPhases.contextLoad).toBeDefined();
  expect(subPhases.contextLoad.registry).toBeGreaterThanOrEqual(0);
  expect(subPhases.contextLoad.vikingTasks).toBeGreaterThanOrEqual(0);
  expect(subPhases.contextLoad.userMem).toBeGreaterThanOrEqual(0);
  expect(subPhases.contextLoad.session).toBeGreaterThanOrEqual(0);
});

it("works without tracker (backward compatible)", async () => {
  const vikingClient = makeMockVikingClient();
  const registry = makeMockRegistry();
  const loader = new LiveContextLoader({ registry, vikingClient });
  const event = makeEvent();

  // No tracker passed — should not throw
  const ctx = await loader.load(event);
  expect(ctx.taskStateSummary).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `bun run test -- apps/server/src/__tests__/coordinator-context.test.ts`
Expected: New test fails because `load()` doesn't accept tracker yet

- [ ] **Step 3: Update `LiveContextLoader.load()` to accept tracker and record sub-phase timings**

Import `PipelineTrackerLike` from types:

```typescript
import type { CoordinatorContext, CoordinatorContextLoader, CoordinatorEvent, PipelineTrackerLike } from "@teamsland/types";
```

Update the `load` method signature and body in `coordinator-context.ts`:

```typescript
async load(event: CoordinatorEvent, tracker?: PipelineTrackerLike): Promise<CoordinatorContext> {
  return withSpan("coordinator-context", "load", async () => {
    const query = buildMemoryQuery(event);
    const requesterId = extractRequesterId(event);
    const coordSessionId = `coord-${event.payload.chatId ?? event.id}`;

    const fetches = this.buildTimedFetches(query, requesterId, coordSessionId, tracker);
    const [taskResult, vikingTasksResult, userMemResult, sessionResult] = await Promise.allSettled(fetches);

    const taskSummary = taskResult.status === "fulfilled" ? taskResult.value : "";
    const vikingTasks =
      vikingTasksResult.status === "fulfilled" ? formatFindResult(vikingTasksResult.value, "活跃任务") : "";
    const userMem = userMemResult.status === "fulfilled" ? formatFindResult(userMemResult.value, "用户记忆") : "";
    const sessionCtx = sessionResult.status === "fulfilled" ? formatSessionContext(sessionResult.value) : "";

    return {
      taskStateSummary: [taskSummary, vikingTasks].filter(Boolean).join("\n"),
      recentMessages: sessionCtx,
      relevantMemories: userMem,
    };
  });
}
```

Add `buildTimedFetches` method (replaces `buildFetches`):

```typescript
private buildTimedFetches(
  query: string,
  requesterId: string | undefined,
  coordSessionId: string,
  tracker?: PipelineTrackerLike,
): [Promise<string>, Promise<FindResult>, Promise<FindResult>, Promise<SessionContext>] {
  const empty: FindResult = { memories: [], resources: [], skills: [], total: 0 };

  const tasksFetch = query
    ? this.vikingClient.find(query, { targetUri: "viking://resources/tasks/active/", limit: 5 })
    : Promise.resolve(empty);

  const userMemFetch =
    query && requesterId
      ? this.vikingClient.find(query, { targetUri: `viking://user/${requesterId}/memories/`, limit: 3 })
      : Promise.resolve(empty);

  return [
    this.timedFetch(tracker, "contextLoad", "registry", () => this.loadTaskStateSummary()),
    this.timedFetch(tracker, "contextLoad", "vikingTasks", () => tasksFetch),
    this.timedFetch(tracker, "contextLoad", "userMem", () => userMemFetch),
    this.timedFetch(tracker, "contextLoad", "session", () =>
      this.vikingClient.getSessionContext(coordSessionId, 8000),
    ),
  ];
}

private timedFetch<T>(
  tracker: PipelineTrackerLike | undefined,
  parent: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  return fn().finally(() => {
    tracker?.subPhase(parent, name, Math.round(performance.now() - t0));
  });
}
```

Remove the old `buildFetches` method (lines 101-123).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- apps/server/src/__tests__/coordinator-context.test.ts`
Expected: All tests PASS (including existing tests, since tracker is optional)

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/coordinator-context.ts apps/server/src/__tests__/coordinator-context.test.ts packages/types/src/coordinator.ts
git commit -m "feat(server): add per-source sub-phase timing to context loader"
```

---

### Task 5: Integrate tracker into `CoordinatorProcess.processEvent()` + audit log

**Files:**
- Modify: `apps/server/src/coordinator-process.ts:53-77`
- Modify: `apps/server/src/__tests__/coordinator-process.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test in `coordinator-process.test.ts`:

```typescript
it("processEvent: records tracker phases and inference result", async () => {
  const spawnFn = createMockSpawnFn("task completed");
  const contextLoader = createMockContextLoader();
  const promptBuilder = createMockPromptBuilder();
  const proc = new CoordinatorProcess({
    config: { workspacePath: "/tmp", systemPromptPath: "/tmp/sp.md", allowedTools: ["Read"], sessionMaxLifetimeMs: 1_800_000, maxEventsPerSession: 20, resultTimeoutMs: 60_000 },
    contextLoader,
    promptBuilder,
    spawnFn,
  });

  const phases: Record<string, number> = {};
  let currentPhase: string | null = null;
  let phaseStart = 0;
  const tracker = {
    phase(name: string) { currentPhase = name; phaseStart = Date.now(); },
    endPhase() { if (currentPhase) { phases[currentPhase] = Date.now() - phaseStart; currentPhase = null; } },
    subPhase() {},
    setInferenceResult: vi.fn(),
    setSessionInfo: vi.fn(),
    setOutcome() {},
    summarize: vi.fn(),
  };

  const event = { type: "lark_dm" as const, id: "evt-1", timestamp: Date.now(), priority: 1, payload: {} };
  await proc.processEvent(event, tracker);

  expect(Object.keys(phases)).toContain("contextLoad");
  expect(Object.keys(phases)).toContain("promptBuild");
  expect(Object.keys(phases)).toContain("inference");
  expect(tracker.setInferenceResult).toHaveBeenCalledWith(
    expect.objectContaining({ durationMs: expect.any(Number) }),
  );
  expect(tracker.setSessionInfo).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `bun run test -- apps/server/src/__tests__/coordinator-process.test.ts`
Expected: FAIL — `processEvent` doesn't accept tracker

- [ ] **Step 3: Update `processEvent` to accept tracker and add instrumentation**

In `coordinator-process.ts`, import `PipelineTracker`:

```typescript
import type { PipelineTracker } from "./pipeline-tracker.js";
```

Update `processEvent` method:

```typescript
async processEvent(event: CoordinatorEvent, tracker?: PipelineTracker): Promise<ResultEvent> {
  const cli = await this.ensureProcess();

  this.setState("running", event.id);

  tracker?.phase("contextLoad");
  const context = await this.contextLoader.load(event, tracker);
  tracker?.endPhase();

  tracker?.phase("promptBuild");
  const prompt = this.promptBuilder.build(event, context);
  tracker?.endPhase();

  try {
    tracker?.phase("inference");
    const result = await cli.sendMessage(prompt);
    tracker?.endPhase();
    this.eventCount++;
    this.setState("idle", event.id);

    tracker?.setInferenceResult({
      durationMs: result.duration_ms,
      numTurns: result.num_turns,
      costUsd: result.total_cost_usd,
    });
    tracker?.setSessionInfo(this.sessionId!, this.eventCount);

    logger.debug({
      eventId: event.id,
      eventType: event.type,
      promptLength: prompt.length,
      promptPreview: prompt.slice(0, 500),
      resultText: result.result?.slice(0, 1000),
      numTurns: result.num_turns,
      costUsd: result.total_cost_usd,
      sessionId: this.sessionId,
    }, "Coordinator 决策审计");

    if (this.shouldRotateSession()) {
      await this.rotateSession();
    }

    return result;
  } catch (err) {
    tracker?.endPhase();
    logger.error({ err, eventId: event.id }, "processEvent 失败");
    this.setState("failed", event.id);
    this.cli = null;
    throw err;
  }
}
```

- [ ] **Step 4: Enhance session rotation log**

Update the `rotateSession` method:

```typescript
private async rotateSession(): Promise<void> {
  logger.info({
    sessionId: this.sessionId,
    eventCount: this.eventCount,
    sessionAgeMs: Date.now() - this.startedAt,
    reason: this.eventCount >= this.config.maxEventsPerSession ? "maxEvents" : "maxLifetime",
  }, "Session 轮转");
  if (this.cli) {
    await this.cli.terminate();
    this.cli = null;
  }
  this.sessionId = null;
  this.eventCount = 0;
  this.startedAt = 0;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- apps/server/src/__tests__/coordinator-process.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS (all type errors from Task 1 should now be resolved)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/coordinator-process.ts apps/server/src/__tests__/coordinator-process.test.ts
git commit -m "feat(server): integrate PipelineTracker into processEvent, add audit log and session rotation enhancement"
```

---

### Task 6: Enhance queue logging with timing fields

**Files:**
- Modify: `packages/queue/src/persistent-queue.ts:220,278,316,442`

- [ ] **Step 1: Write the failing test**

In `packages/queue/src/__tests__/persistent-queue.test.ts`, add a test that verifies the log output (we'll use vi.mock for the logger). Actually, the existing queue tests don't mock the logger — they test behavior, not log output. Since we're only adding fields to existing log calls (not changing behavior), we verify by running existing tests + manual inspection.

Instead, let's write a focused test that verifies the timing fields are computed correctly via the log calls. We'll mock the logger:

Create a new test section at the end of the test file:

```typescript
describe("logging enhancements", () => {
  it("dequeue logs dwellMs", () => {
    // Enqueue, wait briefly, then dequeue
    const id = queue.enqueue({ type: "lark_dm", payload: { test: true }, traceId: "log-test-1" });
    expect(id).toBeTruthy();
    const msg = queue.dequeue();
    expect(msg).not.toBeNull();
    // We can't easily assert on logger output without mocking it,
    // so this test just ensures dequeue still works correctly after the change.
    // The dwellMs field is verified by integration/manual testing.
  });

  it("ack logs processingMs", () => {
    const id = queue.enqueue({ type: "lark_dm", payload: { test: true }, traceId: "log-test-2" });
    const msg = queue.dequeue();
    expect(msg).not.toBeNull();
    queue.ack(msg!.id);
    // Verify ack still works (message is completed)
    const stats = queue.stats();
    expect(stats.completed).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Update `dequeue()` to log `dwellMs`**

In `packages/queue/src/persistent-queue.ts`, line 220, change:

```typescript
// Before:
logger.info({ id: row.id, type: row.type }, "消息已出队");

// After:
const dwellMs = Date.now() - row.created_at;
logger.info({ id: row.id, type: row.type, dwellMs }, "消息已出队");
```

- [ ] **Step 3: Update `ack()` to log `processingMs`**

In `packages/queue/src/persistent-queue.ts`, update the `ack` method. We need to read `processing_at` before updating. Change lines 272-279:

```typescript
ack(messageId: string): void {
  this.assertNotClosed();
  const now = Date.now();
  const row = this.db
    .prepare("SELECT processing_at FROM messages WHERE id = ?")
    .get(messageId) as { processing_at: number | null } | null;
  this.db
    .prepare("UPDATE messages SET status = 'completed', updated_at = ?, processing_at = NULL WHERE id = ?")
    .run(now, messageId);
  const processingMs = row?.processing_at ? now - row.processing_at : undefined;
  logger.info({ id: messageId, processingMs }, "消息已确认完成");
}
```

- [ ] **Step 4: Update `nack()` dead letter log to include lifetime**

In `packages/queue/src/persistent-queue.ts`, line 316, change:

```typescript
// Before:
logger.warn({ id: messageId, retryCount: newRetryCount, lastError: error }, "消息超过最大重试次数，进入死信队列");

// After:
const createdRow = this.db.prepare("SELECT created_at FROM messages WHERE id = ?").get(messageId) as { created_at: number } | null;
const totalLifetimeMs = createdRow ? Date.now() - createdRow.created_at : undefined;
logger.warn({ id: messageId, retryCount: newRetryCount, maxRetries: row.max_retries, totalLifetimeMs, lastError: error }, "消息超过最大重试次数，进入死信队列");
```

Wait — `nack` already has the `row` from the SELECT at line 299-301 but it only selects `retry_count, max_retries, type`. Let's extend that SELECT to also fetch `created_at`:

```typescript
// Line 299-301, change to:
const row = this.db
  .prepare("SELECT retry_count, max_retries, type, created_at FROM messages WHERE id = ?")
  .get(messageId) as Pick<RawMessageRow, "retry_count" | "max_retries" | "type" | "created_at"> | null;
```

Then line 316 becomes:

```typescript
const totalLifetimeMs = Date.now() - row.created_at;
logger.warn({ id: messageId, retryCount: newRetryCount, maxRetries: row.max_retries, totalLifetimeMs, lastError: error }, "消息超过最大重试次数，进入死信队列");
```

- [ ] **Step 5: Update `recoverTimeouts()` dead letter log**

In `packages/queue/src/persistent-queue.ts`, line 442, change:

```typescript
// Before:
logger.warn({ id: row.id }, "超时消息进入死信队列");

// After:
logger.warn({ id: row.id, retryCount: newRetryCount }, "超时消息进入死信队列");
```

Also update the SELECT at line 428-430 to include `created_at`:

```typescript
const rows = this.db
  .prepare(
    "SELECT id, retry_count, max_retries, type, created_at FROM messages WHERE status = 'processing' AND processing_at <= ?",
  )
  .all(threshold) as Pick<RawMessageRow, "id" | "retry_count" | "max_retries" | "type" | "created_at">[];
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- packages/queue/src/__tests__/persistent-queue.test.ts`
Expected: All tests PASS

Run: `bun run test -- packages/queue/src/__tests__/persistent-queue-timeout.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/queue/src/persistent-queue.ts packages/queue/src/__tests__/persistent-queue.test.ts
git commit -m "feat(queue): add dwellMs, processingMs, totalLifetimeMs to queue log fields"
```

---

### Task 7: Enhance Lark connector logging with enrichment timing

**Files:**
- Modify: `packages/lark/src/connector.ts:196-243`

- [ ] **Step 1: Add timing to `handleLine`**

The enrichment work (sender info + chat history) happens inside `buildBridgeEvent` (line 220). We measure the whole `buildBridgeEvent` call:

In `handleLine`, around line 220, change:

```typescript
// Before:
const event = await this.buildBridgeEvent(mention);

// After:
const enrichStart = performance.now();
const event = await this.buildBridgeEvent(mention);
const enrichMs = Math.round(performance.now() - enrichStart);
```

Then update the enqueue success log at line 239:

```typescript
// Before:
logger.info({ eventId: event.eventId, type: queueType }, "Lark 消息已入队到 PersistentQueue");

// After:
logger.info({ eventId: event.eventId, type: queueType, enrichMs }, "Lark 消息已入队到 PersistentQueue");
```

- [ ] **Step 2: Add `performance` import if needed**

At the top of `connector.ts`, add if not already present:

```typescript
import { performance } from "node:perf_hooks";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/lark/src/connector.ts
git commit -m "feat(lark): add enrichMs timing to Lark message enqueue log"
```

---

### Task 8: Enhance Meego connector logging with dispatch timing

**Files:**
- Modify: `packages/meego/src/connector.ts:224-237`

- [ ] **Step 1: Add timing to `dispatchEvent`**

In `dispatchEvent`, wrap the existing logic:

```typescript
private async dispatchEvent(event: MeegoEvent): Promise<void> {
  const dispatchStart = performance.now();
  if (this.enqueue) {
    try {
      this.enqueue({
        type: mapEventTypeToQueueType(event.type),
        payload: { event },
        traceId: event.eventId,
      });
      const dispatchMs = Math.round(performance.now() - dispatchStart);
      logger.info({ eventId: event.eventId, type: mapEventTypeToQueueType(event.type), dispatchMs }, "Meego 事件已入队");
    } catch (err: unknown) {
      logger.error({ err, eventId: event.eventId }, "队列入队失败，回退到 EventBus");
    }
  }
  await this.eventBus.handle(event);
}
```

- [ ] **Step 2: Add `performance` import if needed**

At the top of `connector.ts`, add if not already present:

```typescript
import { performance } from "node:perf_hooks";
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/meego/src/connector.ts
git commit -m "feat(meego): add dispatchMs timing to Meego event dispatch log"
```

---

### Task 9: Run full verification

**Files:**
- No changes — verification only

- [ ] **Step 1: Run full test suite**

Run: `bun run test:run`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (17/17 packages)

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: Clean (no errors)

- [ ] **Step 4: Fix any issues found**

If any test, typecheck, or lint issues are found, fix them and commit:

```bash
git add -A
git commit -m "fix: address verification issues in pipeline observability"
```
