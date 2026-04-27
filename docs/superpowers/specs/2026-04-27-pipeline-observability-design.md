# Coordinator Pipeline Observability Design

## Problem

The coordinator message processing pipeline — from external event intake through queue consumption, context loading, prompt building, LLM inference, to result handling — lacks structured observability. Key gaps:

1. **No end-to-end latency tracking**: The time from message enqueue to processing completion is never logged as a single metric.
2. **No per-phase timing breakdown**: Context loading runs 4 parallel Viking calls, but individual source timings are not recorded. If Viking is slow, logs don't reveal which source is the bottleneck.
3. **No queue dwell time**: How long a message waited between enqueue and dequeue is not logged.
4. **No coordinator decision audit trail**: The prompt sent to the coordinator and the result received are not logged (even at debug level). When something goes wrong, there's no way to trace what the coordinator "saw" and what it "decided."
5. **Discarded inference metadata**: `ResultEvent` from Claude CLI carries `duration_ms`, `num_turns`, and `total_cost_usd`, but these fields are never logged or exposed.
6. **Session rotation cost invisible**: Session rotation kills the CLI process and spawns fresh. The cold-start latency is not measured or logged separately.

## Approach: PipelineTracker

Introduce a lightweight `PipelineTracker` class that accompanies each message through the processing chain. Each stage calls `tracker.phase()` / `tracker.endPhase()` to record timing. At the end, `tracker.summarize()` emits a single structured log line with the full pipeline breakdown.

### Why Not OTel Spans

The codebase already has a minimal OTel integration (`withSpan` in coordinator-context.ts), but the primary log consumption method is Pino NDJSON (grep/jq). Adding full OTel spans for every phase would add overhead without immediate value. The tracker approach gives the same per-phase breakdown via structured logs, with zero external dependencies.

## Architecture

### PipelineTracker Module

New file: `apps/server/src/pipeline-tracker.ts`

```typescript
class PipelineTracker {
  constructor(msgId: string, eventType: string, enqueuedAt: number)

  phase(name: string): void
  endPhase(): void
  subPhase(parent: string, name: string, durationMs: number): void
  setInferenceResult(result: { durationMs?: number; numTurns?: number; costUsd?: number }): void
  setSessionInfo(sessionId: string, eventIndex: number): void
  setOutcome(outcome: "success" | "failed" | "timeout"): void
  summarize(): PipelineSummary
}

interface PipelineSummary {
  msgId: string
  eventType: string
  dwellMs: number
  phases: Record<string, number>
  subPhases: Record<string, Record<string, number>>
  inference: { durationMs: number; numTurns: number; costUsd: number } | null
  sessionId: string | null
  sessionEventIndex: number | null
  totalMs: number
  outcome: string
}
```

### Integration Points (6 Instrumentation Sites)

#### Site 1 — Queue Consumer Entry (`main.ts:136`)

Create tracker at consumption start. Dwell time computed automatically from `msg.createdAt`.

```typescript
queue.consume(async (msg) => {
  const tracker = new PipelineTracker(msg.id, msg.type, msg.createdAt);
  tracker.phase("eventMapping");
  const event = toCoordinatorEvent(msg);
  tracker.endPhase();

  try {
    await coordinator.coordinator?.processEvent(event, tracker);
    tracker.setOutcome("success");
  } catch (err) {
    tracker.setOutcome("failed");
    throw err;
  } finally {
    const summary = tracker.summarize();
    logger.info(summary, "消息处理链路完成");
  }
});
```

#### Site 2 — Context Loading (`coordinator-process.ts:58`)

Pass tracker into `processEvent`, forward to `contextLoader.load()`:

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

  tracker?.phase("inference");
  const result = await cli.sendMessage(prompt);
  tracker?.endPhase();

  tracker?.setInferenceResult({
    durationMs: result.duration_ms,
    numTurns: result.num_turns,
    costUsd: result.total_cost_usd,
  });
  tracker?.setSessionInfo(this.sessionId!, this.eventCount);
  // ...
}
```

#### Site 3 — Context Loader Internals (`coordinator-context.ts`)

Record per-source timings as sub-phases:

```typescript
async load(event: CoordinatorEvent, tracker?: PipelineTracker): Promise<CoordinatorContext> {
  return withSpan("coordinator-context", "load", async () => {
    const fetches = this.buildTimedFetches(query, requesterId, coordSessionId, tracker);
    // Each fetch wrapper records its own duration via tracker.subPhase()
    const [taskResult, vikingTasksResult, userMemResult, sessionResult] = await Promise.allSettled(fetches);
    // ...
  });
}
```

Each of the 4 parallel fetches is wrapped to measure its individual duration:

```typescript
private timedFetch<T>(tracker: PipelineTracker | undefined, parent: string, name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  return fn().finally(() => {
    tracker?.subPhase(parent, name, Math.round(performance.now() - t0));
  });
}
```

Sub-phase names: `registry`, `vikingTasks`, `userMem`, `session`.

#### Site 4 — Coordinator Decision Audit (`coordinator-process.ts`)

After receiving ResultEvent, log at `debug` level:

```typescript
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
```

This is `debug` level to avoid flooding info logs with large prompt/result text. Set `LOG_LEVEL=debug` when troubleshooting.

#### Site 5 — Session Rotation Enhancement (`coordinator-process.ts`)

Enhance existing rotation log:

```typescript
logger.info({
  sessionId: this.sessionId,
  eventCount: this.eventCount,
  sessionAgeMs: Date.now() - this.startedAt,
  reason: this.eventCount >= this.config.maxEventsPerSession ? "maxEvents" : "maxLifetime",
}, "Session 轮转");
```

#### Site 6 — Queue Layer Enhancements (`persistent-queue.ts`)

**Dequeue** — add dwell time:

```typescript
const dwellMs = Date.now() - row.created_at;
logger.info({ id: row.id, type: row.type, dwellMs }, "消息已出队");
```

**Ack** — add processing duration:

```typescript
const processingMs = Date.now() - row.processing_at;
logger.info({ id, processingMs }, "消息已确认");
```

**Dead letter** — add lifetime and retry info:

```typescript
logger.warn({
  id, retryCount: newRetryCount, maxRetries,
  totalLifetimeMs: Date.now() - row.created_at,
  lastError,
}, "消息进入死信队列");
```

### Connector Layer Enhancements

#### Lark Connector (`packages/lark/src/connector.ts`)

Record enrichment duration (sender info fetch + chat history fetch) before enqueue:

```typescript
const enrichStart = performance.now();
// ... enrichSenderInfo(), imHistory() ...
const enrichMs = Math.round(performance.now() - enrichStart);
logger.info({ eventId, type, enrichMs }, "Lark 消息已入队");
```

#### Meego Connector (`packages/meego/src/connector.ts`)

Record webhook verification + parsing + enqueue duration:

```typescript
const handleStart = performance.now();
// ... verifySignature(), parse, dispatchEvent() ...
const handleMs = Math.round(performance.now() - handleStart);
logger.info({ eventId, type, handleMs }, "Meego 事件已处理");
```

### Interface Changes

`CoordinatorContextLoader` in `packages/types/src/coordinator.ts`:

```typescript
// Before
load(event: CoordinatorEvent): Promise<CoordinatorContext>;

// After (tracker is optional, backward compatible)
load(event: CoordinatorEvent, tracker?: PipelineTracker): Promise<CoordinatorContext>;
```

Note: `PipelineTracker` type is imported via a minimal interface to avoid coupling `@teamsland/types` to the server package. A `PipelineTrackerLike` interface with just `subPhase(parent: string, name: string, durationMs: number): void` is sufficient for the context loader.

```typescript
// packages/types/src/coordinator.ts
export interface PipelineTrackerLike {
  subPhase(parent: string, name: string, durationMs: number): void;
}

export interface CoordinatorContextLoader {
  load(event: CoordinatorEvent, tracker?: PipelineTrackerLike): Promise<CoordinatorContext>;
}
```

### Example Output

A typical pipeline summary log line (pretty-printed for readability):

```json
{
  "level": 30,
  "msg": "消息处理链路完成",
  "msgId": "msg-a1b2c3",
  "eventType": "lark_dm",
  "dwellMs": 320,
  "phases": {
    "eventMapping": 1,
    "contextLoad": 145,
    "promptBuild": 2,
    "inference": 12400
  },
  "subPhases": {
    "contextLoad": {
      "registry": 3,
      "vikingTasks": 89,
      "userMem": 52,
      "session": 140
    }
  },
  "inference": {
    "durationMs": 12400,
    "numTurns": 3,
    "costUsd": 0.042
  },
  "sessionId": "abc-def-123",
  "sessionEventIndex": 5,
  "totalMs": 12870,
  "outcome": "success"
}
```

Useful queries:

```bash
# Find slow messages (total > 30s)
cat server.log | jq 'select(.msg == "消息处理链路完成" and .totalMs > 30000)'

# Find high dwell time (queue backlog)
cat server.log | jq 'select(.msg == "消息处理链路完成" and .dwellMs > 5000)'

# Find slow context loading
cat server.log | jq 'select(.msg == "消息处理链路完成" and .phases.contextLoad > 500)'

# Find cold starts (first event in new session)
cat server.log | jq 'select(.msg == "消息处理链路完成" and .sessionEventIndex == 0)'

# Coordinator decision audit (requires LOG_LEVEL=debug)
cat server.log | jq 'select(.msg == "Coordinator 决策审计")'
```

## Files Changed

| File | Change Type | Description |
|------|------------|-------------|
| `apps/server/src/pipeline-tracker.ts` | **New** | PipelineTracker class and PipelineSummary type |
| `apps/server/src/main.ts` | **Modify** | Queue consumer integrates tracker, summary log |
| `apps/server/src/coordinator-process.ts` | **Modify** | processEvent accepts tracker, phases instrumented, audit log, session rotation enhancement |
| `apps/server/src/coordinator-context.ts` | **Modify** | load() accepts tracker, per-source sub-phase timing |
| `packages/types/src/coordinator.ts` | **Modify** | Add PipelineTrackerLike interface, update CoordinatorContextLoader |
| `packages/queue/src/persistent-queue.ts` | **Modify** | dequeue/ack/dead-letter add timing fields |
| `packages/lark/src/connector.ts` | **Modify** | Enqueue log adds enrichMs |
| `packages/meego/src/connector.ts` | **Modify** | Dispatch log adds handleMs |
| `apps/server/src/__tests__/pipeline-tracker.test.ts` | **New** | Unit tests for PipelineTracker |
| `apps/server/src/__tests__/coordinator-process.test.ts` | **Modify** | Update for tracker parameter |
| `apps/server/src/__tests__/coordinator-context.test.ts` | **Modify** | Update for tracker parameter |

## Out of Scope

- **Worker-side observability**: Worker processes (`worker-manager.ts`, `data-plane.ts`) have their own lifecycle and are not part of the coordinator pipeline.
- **Dashboard visualization**: No new dashboard components. The summary log is consumed via grep/jq.
- **OTel span expansion**: The existing `withSpan` in coordinator-context.ts remains as-is. No new spans added.
- **Hook engine metrics**: Already covered by `HookMetricsCollector` — not duplicated.
- **Queue concurrency changes**: Single-consumer sequential model remains. Throughput optimization is a separate initiative.

## Acceptance Scenarios

### Scenario 1: Lark DM processed end-to-end, summary log emitted

Given the coordinator is idle and the queue is empty
When a user sends a Lark DM to the bot
And LarkConnector receives the message and logs `eventId`, `type`, `enrichMs` on enqueue
And PersistentQueue.dequeue() logs `dwellMs` alongside `id` and `type`
And the queue consumer creates a PipelineTracker and starts the `eventMapping` phase
And `toCoordinatorEvent()` completes and the `eventMapping` phase ends
And `contextLoader.load()` runs 4 parallel fetches, each recording sub-phase timing (`registry`, `vikingTasks`, `userMem`, `session`)
And `promptBuilder.build()` completes within the `promptBuild` phase
And `cli.sendMessage()` completes within the `inference` phase, returning `ResultEvent` with `duration_ms`, `num_turns`, `total_cost_usd`
And PersistentQueue.ack() logs `processingMs`
Then a single `info`-level log with `msg: "消息处理链路完成"` is emitted containing:
  - `msgId`, `eventType: "lark_dm"`
  - `dwellMs` (>= 0)
  - `phases` with keys: `eventMapping`, `contextLoad`, `promptBuild`, `inference`
  - `subPhases.contextLoad` with keys: `registry`, `vikingTasks`, `userMem`, `session`
  - `inference` with `durationMs`, `numTurns`, `costUsd`
  - `sessionId`, `sessionEventIndex`
  - `totalMs` (sum of all phases approximately)
  - `outcome: "success"`

### Scenario 2: Coordinator inference fails, failure summary logged

Given the coordinator is running
When a message is dequeued and processing begins
And context loading and prompt building succeed
And `cli.sendMessage()` throws a timeout error
Then the pipeline tracker records `outcome: "failed"`
And the summary log is emitted with `outcome: "failed"` and all phase timings up to the point of failure
And the existing error log `"Coordinator 事件处理失败"` is still emitted (unchanged)
And the queue nacks the message (existing behavior, unchanged)

### Scenario 3: Context loading partially fails, sub-phase timing still recorded

Given Viking's user memory endpoint is temporarily unavailable
When context loading runs 4 parallel fetches
And the `userMem` fetch fails after 2000ms
And the other 3 fetches succeed
Then the summary log shows `subPhases.contextLoad.userMem: 2000` (the time spent before failure)
And the `contextLoad` phase total reflects the slowest source (2000ms)
And the context is degraded (empty user memories) but processing continues

### Scenario 4: Debug-level audit log captures prompt and result

Given `LOG_LEVEL=debug` is set
When a message is processed successfully by the coordinator
Then a `debug`-level log with `msg: "Coordinator 决策审计"` is emitted containing:
  - `eventId`, `eventType`
  - `promptLength` (integer)
  - `promptPreview` (first 500 chars of prompt)
  - `resultText` (first 1000 chars of result)
  - `numTurns`, `costUsd`, `sessionId`
And when `LOG_LEVEL=info` (default), this log is NOT emitted

### Scenario 5: Session rotation logs enhanced fields

Given the coordinator has processed 20 events in the current session (maxEventsPerSession = 20)
When the next event completes successfully
And `shouldRotateSession()` returns true
Then the session rotation log includes:
  - `sessionId`, `eventCount: 20`
  - `sessionAgeMs` (time since session start)
  - `reason: "maxEvents"`
And the CLI process is terminated and a fresh session is prepared for the next event

### Scenario 6: Cold start identified via sessionEventIndex

Given the coordinator session was just rotated (or this is the first event after startup)
When the first event in the new session is processed
Then the summary log shows `sessionEventIndex: 0`
And the `inference` phase timing includes the cold-start overhead of spawning a new CLI process

### Scenario 7: Queue dead letter includes lifetime metrics

Given a message has failed 3 times (maxRetries = 3)
When the message fails for the 4th time and enters dead letter
Then the dead letter log includes:
  - `retryCount: 4`, `maxRetries: 3`
  - `totalLifetimeMs` (time from first enqueue to dead letter)
  - `lastError`
And the existing Lark error card notification fires (unchanged)

### Scenario 8: Tracker is optional, non-coordinator paths unaffected

Given the coordinator is disabled (`config.coordinator.enabled = false`)
When the legacy `registerQueueConsumer()` path handles a message
Then no PipelineTracker is created
And `contextLoader.load(event)` works without a tracker parameter (backward compatible)
And no summary log is emitted (tracker-specific logs only appear in the coordinator path)
