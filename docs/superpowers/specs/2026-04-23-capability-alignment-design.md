# Capability Alignment: OpenViking + Workspace Hardening + Observer Chain + Self-Evolution

> Date: 2026-04-23
> Status: Design Approved
> Approach: Incremental Gap-Fill (Approach A)

## Problem Statement

Four designed capabilities are not yet aligned with the implementation:

1. **OpenViking integration** -- currently using sqlite-vec + node-llama-cpp as placeholders
2. **Coordinator workspace** -- mostly implemented but missing session persistence, self-evolve skill injection, and workspace integrity checks
3. **Interrupt -> Observe -> Resume chain** -- controllers exist in `@teamsland/sidecar` but are not wired into the server; `ObserverController` and `diagnosis_ready` handler are missing
4. **Self-evolution** -- HookEngine supports hot-reload but the self-evolve skill is not injected; no evolution log, no human approval gate

## Architecture Overview

```
Module 1: OpenViking                Module 2: Workspace Hardening
  OpenVikingLauncher                  Session persistence
  VikingMemoryClient                  Self-evolve skill injection
  Storage init replacement            Workspace integrity check
  Context loader adaptation           Hooks dir timing fix
  Worker writeback
                    \                /
                     \              /
                      v            v
               apps/server/src/main.ts
                      ^            ^
                     /              \
                    /                \
Module 3: Observer Chain            Module 4: Self-Evolution
  AnomalyDetector wiring             self-evolve/SKILL.md
  ObserverController                  evolution-log.jsonl
  diagnosis_ready handler             Human approval gate
  API endpoints (interrupt/           Pending hooks workflow
    resume/observe)                   Dashboard integration
  Bug fixes (InterruptController,
    ResumeController, prompt builder)
```

---

## Module 1: OpenViking Full Replacement

### 1.1 Overview

Replace the entire `TeamMemoryStore` / `LocalEmbedder` / sqlite-vec stack with OpenViking's REST API. Implementation follows the existing Phase 3 design doc (`docs/plans/phase-3-openviking-integration.md`) precisely.

### 1.2 New Files

#### `apps/server/src/openviking-launcher.ts`

Manages the OpenViking Python server as a child process:

```typescript
export class OpenVikingLauncher {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenVikingConfig);

  /** Start openviking-server subprocess and wait for /ready */
  async start(signal: AbortSignal): Promise<void>;

  /** Poll GET /ready with exponential backoff, throw on timeout */
  private async waitReady(timeoutMs: number, signal: AbortSignal): Promise<void>;

  /** Graceful shutdown: SIGTERM -> 5s -> SIGKILL */
  async stop(): Promise<void>;
}
```

Startup flow:
- If `config.openViking.managed === true`: spawn subprocess with `OPENVIKING_CONFIG_FILE` env var, pipe stdout/stderr to logger, poll `/ready` with 500ms initial interval and exponential backoff to 2s, total timeout `readyTimeoutMs`.
- If `managed === false`: only check `/ready` to confirm external server is running.

Shutdown flow:
- `proc.kill("SIGTERM")` -> `setTimeout(5000)` -> `proc.kill("SIGKILL")` -> wait for exit.

#### `packages/memory/src/viking-memory-client.ts`

TypeScript wrapper for OpenViking's REST API. Full method table per Phase 3 design (Section 3B):

| Method | HTTP | Purpose |
|--------|------|---------|
| `healthCheck()` | `GET /health` | Connectivity check |
| `find(query, opts)` | `POST /api/v1/search/find` | Semantic search |
| `search(query, opts)` | `POST /api/v1/search/search` | Session-aware search |
| `read(uri)` | `GET /api/v1/content/read` | Read L2 full content |
| `abstract(uri)` | `GET /api/v1/content/abstract` | Read L0 abstract |
| `overview(uri)` | `GET /api/v1/content/overview` | Read L1 overview |
| `write(uri, content, opts)` | `POST /api/v1/content/write` | Write/update content |
| `ls(uri)` | `GET /api/v1/fs/ls` | List directory |
| `mkdir(uri, desc?)` | `POST /api/v1/fs/mkdir` | Create directory |
| `rm(uri, recursive?)` | `DELETE /api/v1/fs` | Delete |
| `addResource(path, opts)` | `POST /api/v1/resources` | Import resource |
| `waitProcessed()` | `POST /api/v1/system/wait` | Wait for semantic processing |
| `createSession(id?)` | `POST /api/v1/sessions` | Create session |
| `getSession(id)` | `GET /api/v1/sessions/{id}` | Get session info |
| `getSessionContext(id, budget?)` | `GET /api/v1/sessions/{id}/context` | Get assembled context |
| `addMessage(sessionId, role, content)` | `POST /api/v1/sessions/{id}/messages` | Add message |
| `markUsed(sessionId, contexts)` | `POST /api/v1/sessions/{id}/used` | Record used contexts |
| `commitSession(sessionId)` | `POST /api/v1/sessions/{id}/commit` | Commit session (trigger memory extraction) |
| `extractMemories(sessionId)` | `POST /api/v1/sessions/{id}/extract` | Immediate memory extraction |
| `deleteSession(sessionId)` | `DELETE /api/v1/sessions/{id}` | Delete session |
| `getTask(taskId)` | `GET /api/v1/tasks/{taskId}` | Query background task status |

All methods use a shared `request<T>()` base with:
- `X-OpenViking-Agent` header
- Configurable timeout via `AbortController`
- Structured error extraction from response payload

`NullVikingMemoryClient` provides the degraded fallback: all reads return empty, all writes silently succeed.

#### `config/openviking.conf`

```json
{
  "storage": { "workspace": "./data/openviking" },
  "log": { "level": "INFO", "output": "file" },
  "embedding": {
    "dense": {
      "provider": "ollama",
      "model": "nomic-embed-text",
      "api_base": "http://localhost:11434",
      "dimension": 768
    },
    "max_concurrent": 5
  },
  "vlm": {
    "provider": "ollama",
    "model": "qwen2.5-coder:14b",
    "api_base": "http://localhost:11434",
    "max_concurrent": 10
  },
  "server": { "host": "127.0.0.1", "port": 1933 }
}
```

#### `scripts/viking-init.ts`

Knowledge import script:
1. Ensure directory structure (`viking://resources/tasks/active/`, `viking://resources/tasks/completed/`, `viking://resources/lark-docs/`)
2. Import code repos from `config.repoMapping`
3. Async processing (does not block startup)

### 1.3 Modified Files

#### `packages/types/src/config.ts`

Add `OpenVikingConfig` interface:

```typescript
export interface OpenVikingConfig {
  confPath: string;
  serverBin?: string;
  port: number;
  readyTimeoutMs: number;
  managed: boolean;
  agentId: string;
}
```

Add to `AppConfig`:

```typescript
export interface AppConfig {
  // ...existing...
  openViking?: OpenVikingConfig;
}
```

#### `apps/server/src/main.ts`

Insert between step 5 and 6:

```
5.5. OpenViking Server
  if config.openViking?.managed:
    vikingLauncher = new OpenVikingLauncher(config.openViking)
    await vikingLauncher.start(controller.signal)
```

Replace storage init (step 6):

```
6. Storage
  if config.openViking:
    vikingClient = new VikingMemoryClient(config.openViking)
    await vikingClient.waitReady(config.openViking.readyTimeoutMs)
  else:
    vikingClient = new NullVikingMemoryClient()
```

Add to `shutdown()`:
```
if (vikingLauncher) await vikingLauncher.stop()
```

#### `apps/server/src/coordinator-context.ts`

`LiveContextLoader` switches from `TeamMemoryStore` + `PersistentQueue` to `VikingMemoryClient`:

```
Old: relevantMemories from TeamMemoryStore.vectorSearch + ftsSearch
New: relevantMemories from vikingClient.find(query, { targetUri: "viking://agent/teamsland/memories/" })
     + vikingClient.find(query, { targetUri: `viking://user/${requesterId}/memories/` })

Old: recentMessages from PersistentQueue.recentCompleted()
New: recentMessages from vikingClient.getSessionContext(coordSessionId, tokenBudget)

Old: taskStateSummary from SubagentRegistry.allRunning()
New: taskStateSummary from vikingClient.find(query, { targetUri: "viking://resources/tasks/active/" })
     + SubagentRegistry.allRunning() (running workers are still from registry)
```

#### `apps/server/src/event-handlers.ts`

Worker completion writeback:
```
handleWorkerCompleted:
  ...existing logic...
  + Write task result to viking://resources/tasks/completed/task-{id}.md
  + Create session, add messages, commit -> trigger memory extraction
```

### 1.4 Deleted Files and Dependencies

| Removed | Reason |
|---------|--------|
| `packages/memory/src/team-memory-store.ts` | Replaced by VikingMemoryClient |
| `packages/memory/src/embedder.ts` | Replaced by OpenViking's built-in embedding |
| `packages/memory/src/retriever.ts` | Replaced by VikingMemoryClient.find/search |
| dep: `sqlite-vec` | No longer needed |
| dep: `sqlite-vec-darwin-arm64` | No longer needed |
| dep: `node-llama-cpp` | No longer needed |

`NullMemoryStore` is retained as a thin wrapper around `NullVikingMemoryClient`.

### 1.5 URI Naming Convention

Per Phase 3 Section 3C. Key mappings:

| Content | URI |
|---------|-----|
| Code repos | `viking://resources/{repo-name}/` |
| Lark docs | `viking://resources/lark-docs/{title}/` |
| Active tasks | `viking://resources/tasks/active/task-{uuid}.md` |
| Completed tasks | `viking://resources/tasks/completed/task-{uuid}.md` |
| User memories | `viking://user/{user_id}/memories/{category}/` |
| Agent memories | `viking://agent/teamsland/memories/{category}/` |
| Coordinator session | `viking://session/coord-{msg_id}/` |
| Worker session | `viking://session/worker-{task_id}/` |

---

## Module 2: Coordinator Workspace Hardening

### 2.1 Session Persistence

**Problem**: `CoordinatorSessionManager.activeSession` is in-memory only. Server restart loses the active session, meaning the coordinator cannot `--continue` a prior session.

**Fix**: Add `persistSession()` / `loadSession()` to `coordinator-session.ts`:

```typescript
const SESSION_FILE = ".session.json";

interface PersistedSession {
  sessionId: string;
  chatId: string;
  startedAt: number;
  processedEvents: string[];
}

// On state change (session created, event processed, session ended):
async persistSession(session: ActiveSession | null): Promise<void> {
  const filePath = join(this.config.workspacePath, SESSION_FILE);
  if (!session) {
    await unlink(filePath).catch(() => {});
    return;
  }
  await Bun.write(filePath, JSON.stringify({
    sessionId: session.sessionId,
    chatId: session.chatId,
    startedAt: session.startedAt,
    processedEvents: session.processedEvents,
  }));
}

// On startup:
async loadSession(): Promise<PersistedSession | null> {
  const filePath = join(this.config.workspacePath, SESSION_FILE);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return JSON.parse(await file.text()) as PersistedSession;
}
```

On startup, if a persisted session exists AND the process is no longer alive, clear the stale session. If the process IS alive (e.g., server restarted but claude process survived), reconnect by reusing the sessionId for `--continue`.

### 2.2 Self-Evolve Skill Injection

Add to `coordinator-init.ts` in the `WORKSPACE_DIRS` array:
```typescript
".claude/skills/self-evolve/"
```

Add to `writeWorkspaceFiles`:
```typescript
{
  path: ".claude/skills/self-evolve/SKILL.md",
  content: SELF_EVOLVE_SKILL_CONTENT, // Phase 6 Section 5 content verbatim
}
```

### 2.3 Workspace Integrity Check

New function `verifyWorkspaceIntegrity()` in `coordinator-init.ts`:

```typescript
export async function verifyWorkspaceIntegrity(
  workspacePath: string,
): Promise<{ ok: boolean; missing: string[] }> {
  const required = [
    "CLAUDE.md",
    ".claude/settings.json",
    ".claude/skills/teamsland-spawn/SKILL.md",
    ".claude/skills/lark-message/SKILL.md",
    ".claude/skills/lark-docs/SKILL.md",
    ".claude/skills/meego-query/SKILL.md",
    ".claude/skills/self-evolve/SKILL.md",
  ];
  const missing: string[] = [];
  for (const rel of required) {
    const file = Bun.file(join(workspacePath, rel));
    if (!(await file.exists())) missing.push(rel);
  }
  return { ok: missing.length === 0, missing };
}
```

Called at startup after `initCoordinatorWorkspace`. If any files are missing, re-run init for just those files (the `writeFileIfNotExists` pattern handles this naturally by calling `initCoordinatorWorkspace` again).

### 2.4 Hooks Directory Timing

Ensure `initCoordinatorWorkspace()` is called before `HookEngine.start()` in `main.ts`. The hooks directory `~/.teamsland/coordinator/hooks/` must exist before the file watcher is created. Currently both are in `main.ts` but the ordering is implicit. Make it explicit:

```typescript
// Step N: Coordinator workspace (must precede HookEngine)
await initCoordinatorWorkspace(config);
const { ok, missing } = await verifyWorkspaceIntegrity(config.coordinator.workspacePath);
if (!ok) logger.warn({ missing }, "Workspace integrity check failed, re-initializing...");

// Step N+1: Hook Engine
const hookEngine = new HookEngine(hooksDir, hookContext);
await hookEngine.start();
```

---

## Module 3: Interrupt -> Observe -> Resume Chain

### 3.1 Type Additions

In `packages/types/src/queue.ts` (or wherever `QueueMessageType` is defined):

```typescript
export type QueueMessageType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_updated"
  | "meego_issue_deleted"
  | "meego_sprint_event"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_interrupted"   // NEW
  | "worker_resumed"       // NEW
  | "diagnosis_ready";     // NEW (was placeholder)
```

In `packages/types/src/sidecar.ts`:

```typescript
export type AgentStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "observing";    // NEW
```

### 3.2 ObserverController

New file: `packages/sidecar/src/observer-controller.ts`

```typescript
export interface ObserveRequest {
  /** Target worker agent ID */
  targetAgentId: string;
  /** Anomaly type that triggered the observation */
  anomalyType: string;
  /** Mode: "progress" | "quality" | "diagnosis" */
  mode: "progress" | "quality" | "diagnosis";
}

export interface ObserveResult {
  /** Observer worker agent ID */
  observerAgentId: string;
  /** PID of the observer process */
  pid: number;
  /** Session ID */
  sessionId: string;
}

export class ObserverController {
  constructor(
    private registry: SubagentRegistry,
    private processCtrl: ProcessController,
    private transcriptReader: TranscriptReader,
    private logger: Logger,
  ) {}

  async observe(req: ObserveRequest): Promise<ObserveResult> {
    // 1. Look up target worker record
    const target = this.registry.get(req.targetAgentId);
    if (!target) throw new Error(`Target worker ${req.targetAgentId} not found`);

    // 2. Read target's transcript
    const transcriptPath = await this.transcriptReader.resolveTranscriptPath(
      target.worktreePath, target.sessionId
    );
    const summary = await this.transcriptReader.summarizeStructured(transcriptPath);

    // 3. Build diagnosis prompt
    const prompt = buildObserverPrompt(req.mode, target, summary, req.anomalyType);

    // 4. Spawn observer in temp directory (no worktree needed)
    const tmpDir = join(tmpdir(), `observer-${randomUUID().slice(0, 8)}`);
    await mkdir(tmpDir, { recursive: true });
    const spawnResult = await this.processCtrl.spawn({
      worktreePath: tmpDir,
      initialPrompt: prompt,
      env: {
        OBSERVER_TARGET_ID: req.targetAgentId,
        OBSERVER_MODE: req.mode,
      },
    });

    // 5. Register observer
    this.registry.register({
      agentId: `observer-${spawnResult.sessionId}`,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      status: "observing",
      workerType: "observer",
      observeTargetId: req.targetAgentId,
      startedAt: Date.now(),
    });

    return {
      observerAgentId: `observer-${spawnResult.sessionId}`,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
    };
  }
}
```

Observer prompt template (diagnosis mode):

```
You are an Observer agent. Your job is to diagnose why a worker agent is having trouble.

## Target Worker
- Agent ID: ${target.agentId}
- Task: ${target.taskPrompt}
- Status: ${target.status}
- Anomaly: ${anomalyType}
- Running since: ${target.startedAt}

## Transcript Summary
- Tool calls: ${summary.toolCalls.join(", ")}
- Errors: ${summary.errors.join("\n")}
- Last assistant message: ${summary.lastAssistantMessage}
- Duration: ${summary.durationMs}ms

## Your Task
Analyze the transcript and produce a diagnosis. Output ONLY a JSON object:

{
  "verdict": "retry_loop" | "persistent_error" | "stuck" | "waiting_input" | "unknown",
  "recommendation": "interrupt" | "let_continue" | "inject_hint",
  "analysis": "Brief explanation of what went wrong",
  "correctionInstructions": "If recommending interrupt+resume, what should the resumed worker do differently"
}
```

### 3.3 AnomalyDetector Wiring

In `apps/server/src/main.ts`:

```typescript
import { AnomalyDetector } from "@teamsland/sidecar";

// After registry + queue are initialized:
const anomalyDetector = new AnomalyDetector({
  registry,
  workerTimeoutMs: config.sidecar.workerTimeoutMs,
  logger: createLogger("server:anomaly"),
});

anomalyDetector.onAnomaly(async (anomaly) => {
  await queue.enqueue({
    type: "worker_anomaly",
    payload: {
      workerId: anomaly.agentId,
      anomalyType: anomaly.type,
      details: anomaly.details,
    },
    priority: "high",
    traceId: `anomaly-${anomaly.agentId}-${anomaly.type}`,
  });
});

anomalyDetector.start();
```

**Deduplication with WorkerLifecycleMonitor**: Since both `AnomalyDetector` and `WorkerLifecycleMonitor` can detect timeouts and crashes, and the queue has `traceId`-based dedup, we use deterministic trace IDs (`anomaly-{agentId}-{type}`) to prevent double-processing. Additionally, `WorkerLifecycleMonitor` already handles `crash` and `timeout` well; `AnomalyDetector` adds `unexpected_exit` (process dead but registry says running) which `WorkerLifecycleMonitor` catches as `crash`. The two systems overlap but the dedup makes this safe. Long-term, `AnomalyDetector` should subsume `WorkerLifecycleMonitor`'s role, but that refactor is out of scope for this design.

### 3.4 `diagnosis_ready` Handler

Replace the stub in `event-handlers.ts`:

```typescript
case "diagnosis_ready": {
  const { targetWorkerId, observerWorkerId, report } = msg.payload;
  // parseDiagnosisReport: JSON.parse the observer's output + validate required fields
  // Returns { verdict, recommendation, analysis, correctionInstructions }
  const diagnosis = parseDiagnosisReport(report);
  logger.info(
    { targetWorkerId, verdict: diagnosis.verdict, recommendation: diagnosis.recommendation },
    "Diagnosis received"
  );

  if (diagnosis.recommendation === "interrupt") {
    // Interrupt the target worker
    const interruptResult = await interruptController.interrupt({
      agentId: targetWorkerId,
      reason: diagnosis.analysis,
    });
    logger.info({ targetWorkerId, ...interruptResult }, "Worker interrupted based on diagnosis");

    // Enqueue worker_interrupted
    await queue.enqueue({
      type: "worker_interrupted",
      payload: { workerId: targetWorkerId, reason: diagnosis.analysis },
      priority: "normal",
      traceId: `interrupted-${targetWorkerId}`,
    });

    // Resume with correction instructions
    const resumeResult = await resumeController.resume({
      predecessorId: targetWorkerId,
      correctionInstructions: diagnosis.correctionInstructions,
    });
    logger.info({ resumedAgentId: resumeResult.agentId }, "Worker resumed with corrections");

    // Enqueue worker_resumed
    await queue.enqueue({
      type: "worker_resumed",
      payload: {
        workerId: resumeResult.agentId,
        predecessorId: targetWorkerId,
      },
      priority: "normal",
      traceId: `resumed-${resumeResult.agentId}`,
    });

  } else if (diagnosis.recommendation === "let_continue") {
    logger.info({ targetWorkerId }, "Diagnosis: let worker continue");
    // No action needed

  } else if (diagnosis.recommendation === "inject_hint") {
    // Write hint to worker's stdin via DataPlane
    const target = registry.get(targetWorkerId);
    if (target && processCtrl.isAlive(target.pid)) {
      await processCtrl.writeStdin(target.pid, diagnosis.correctionInstructions);
      logger.info({ targetWorkerId }, "Hint injected to worker via stdin");
    }
  }
  break;
}
```

### 3.5 `handleWorkerAnomaly` Enhancement

Current flow is correct (routes to Coordinator if available, Lark DM fallback). Enhancement: if Coordinator is not enabled, automatically spawn an Observer instead of just sending a DM:

```typescript
async function handleWorkerAnomaly(msg, deps): Promise<void> {
  const { workerId, anomalyType, details } = msg.payload;

  if (deps.coordinatorManager) {
    // Existing path: delegate to Coordinator for reasoning
    await deps.coordinatorManager.processEvent(toCoordinatorEvent(msg));
  } else if (deps.observerController) {
    // NEW: Auto-spawn observer if Coordinator is not available
    await deps.observerController.observe({
      targetAgentId: workerId,
      anomalyType,
      mode: "diagnosis",
    });
  } else {
    // Fallback: Lark DM notification
    await notifyWorkerAnomaly(workerId, anomalyType, details, deps);
  }
}
```

### 3.6 API Endpoints

Add to `apps/server/src/file-routes.ts` (or `worker-routes.ts`):

```
POST /api/workers/:id/interrupt
  Body: { reason?: string }
  -> InterruptController.interrupt({ agentId: id, reason })
  -> Return InterruptResult

POST /api/workers/:id/resume
  Body: { correctionInstructions?: string }
  -> ResumeController.resume({ predecessorId: id, correctionInstructions })
  -> Return ResumeResult { agentId, pid, sessionId }

POST /api/workers/:id/observe
  Body: { mode?: "progress" | "quality" | "diagnosis" }
  -> ObserverController.observe({ targetAgentId: id, mode: mode ?? "diagnosis" })
  -> Return ObserveResult
```

### 3.7 Bug Fixes

**Fix 1: InterruptController persist + enqueue**

After setting `record.status = "interrupted"`, add:
```typescript
// Persist registry state
await this.registry.persist();
```
Note: enqueuing `worker_interrupted` is done by the caller (diagnosis_ready handler), not InterruptController itself. This keeps the controller focused on the interrupt operation.

**Fix 2: ResumeController taskType fallback**

Change:
```typescript
const taskType = predecessor.taskType ?? "default";
```
To:
```typescript
const taskType = predecessor.taskType ?? predecessor.origin?.taskType ?? "default";
```

**Fix 3: coordinator-prompt.ts field name mismatch**

In `buildDiagnosisReady`, change:
```typescript
// Before (wrong field names):
const diagnosisId = payload.diagnosisId;
const summary = payload.summary;

// After (correct field names matching event mapper):
const targetWorkerId = payload.targetWorkerId;
const observerWorkerId = payload.observerWorkerId;
const report = payload.report;
```

---

## Module 4: Self-Evolution with Human Approval

### 4.1 Self-Evolve Skill Content

The `SKILL.md` content follows Phase 6 Section 5 verbatim, with one addition for the human approval gate:

```markdown
## Approval Mode

Check `~/.teamsland/coordinator/evolution-config.json`:
- If `requireApproval: true`: Write to `hooks-pending/` instead of `hooks/`.
  Then notify the admin via Lark DM with the hook details.
- If `requireApproval: false` or file missing: Write directly to `hooks/`.
```

### 4.2 Evolution Log

New utility function in `apps/server/src/evolution-log.ts`:

```typescript
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

export interface EvolutionLogEntry {
  timestamp: string;
  action: "create_hook" | "create_skill" | "create_subagent" | "approve_hook" | "reject_hook";
  path: string;
  reason: string;
  patternCount?: number;
  approvedBy?: string;
  rejectedReason?: string;
}

export async function appendEvolutionLog(
  workspacePath: string,
  entry: EvolutionLogEntry,
): Promise<void> {
  const logPath = join(workspacePath, "evolution-log.jsonl");
  const line = JSON.stringify(entry) + "\n";
  await appendFile(logPath, line);
}
```

The Coordinator writes to this log via the self-evolve skill (it calls `Write` tool on the file). The server also writes to it when processing approvals/rejections.

### 4.3 Human Approval Gate

**Config**: Add to `config/config.json`:
```json
{
  "hooks": {
    "hooksDir": "~/.teamsland/coordinator/hooks",
    "pendingDir": "~/.teamsland/coordinator/hooks-pending",
    "requireApproval": true
  }
}
```

**Flow**:

1. Coordinator's self-evolve skill writes hook to `hooks-pending/` (not `hooks/`)
2. Coordinator sends Lark DM to admin: "Detected pattern X, suggesting hook Y. Approve at dashboard."
3. Dashboard shows pending hooks list (reads from `hooks-pending/` directory)
4. Admin clicks "Approve":
   - Server moves file from `hooks-pending/` to `hooks/`
   - HookEngine hot-reloads the new hook
   - `appendEvolutionLog({ action: "approve_hook", ... })`
5. Admin clicks "Reject":
   - Server deletes file from `hooks-pending/`
   - `appendEvolutionLog({ action: "reject_hook", rejectedReason: ... })`

**API endpoints**:

```
GET  /api/hooks/pending
  -> List all .ts files in hooks-pending/ with metadata

POST /api/hooks/:filename/approve
  -> mv hooks-pending/:filename hooks/:filename
  -> appendEvolutionLog

POST /api/hooks/:filename/reject
  Body: { reason: string }
  -> rm hooks-pending/:filename
  -> appendEvolutionLog
```

### 4.4 Evolution Config

File: `~/.teamsland/coordinator/evolution-config.json`

Created by `coordinator-init.ts` with sensible defaults:

```json
{
  "requireApproval": true,
  "minPatternCount": 3,
  "notifyUserId": null,
  "notifyChannelId": null
}
```

The Coordinator reads this file before writing hooks to determine the target directory.

### 4.5 Dashboard Integration

Add an "Evolution" tab to the dashboard:

- **Pending Hooks**: List of hooks awaiting approval, with "Approve" / "Reject" buttons and code preview
- **Evolution Log**: Timeline view of `evolution-log.jsonl` entries
- **Hook Analytics**: Hit/miss/error counts from HookMetricsCollector (already implemented in Phase 6)

API endpoints (in addition to the approval endpoints above):

```
GET /api/hooks/evolution-log
  Query: { limit?: number, offset?: number }
  -> Read and parse evolution-log.jsonl, return entries
```

---

## Cross-Cutting Concerns

### Error Handling

Each module degrades gracefully:
- **OpenViking unavailable**: `NullVikingMemoryClient` returns empty results; system runs without memory
- **Observer spawn fails**: Log error, fall back to Lark DM notification
- **Approval endpoint fails**: Hook stays in pending; no data loss
- **Evolution log write fails**: Log error; non-blocking

### Testing Strategy

| Module | Unit Tests | Integration Tests |
|--------|-----------|------------------|
| 1: OpenViking | VikingMemoryClient mock tests, NullVikingMemoryClient tests | End-to-end with running OpenViking server |
| 2: Workspace | verifyWorkspaceIntegrity tests, session persist/load tests | Startup sequence with fresh workspace |
| 3: Observer Chain | ObserverController with mock registry/process, diagnosis_ready handler with mock queue | Full anomaly -> observe -> diagnose -> interrupt -> resume flow |
| 4: Self-Evolution | Evolution log append/read, approval endpoint tests | Coordinator writes hook -> pending -> approve -> hot-reload |

### Migration Path

1. Deploy Module 2 (workspace hardening) first -- zero risk, purely additive
2. Deploy Module 3 (observer chain) -- wires existing components, new queue types
3. Deploy Module 4 (self-evolution) -- depends on Module 2 for skill injection
4. Deploy Module 1 (OpenViking) -- largest change, requires OpenViking server setup

Modules 2, 3, 4 can be deployed together as they don't conflict. Module 1 is independent but should follow the others to reduce blast radius.

---

## File Inventory

### New Files

| File | Module | Purpose |
|------|--------|---------|
| `apps/server/src/openviking-launcher.ts` | 1 | OpenViking subprocess management |
| `packages/memory/src/viking-memory-client.ts` | 1 | OpenViking REST API wrapper |
| `config/openviking.conf` | 1 | OpenViking server configuration |
| `scripts/viking-init.ts` | 1 | Knowledge import script |
| `packages/sidecar/src/observer-controller.ts` | 3 | Observer worker spawning |
| `apps/server/src/evolution-log.ts` | 4 | Evolution log utility |

### Modified Files

| File | Module | Change |
|------|--------|--------|
| `packages/types/src/config.ts` | 1 | Add OpenVikingConfig |
| `packages/types/src/queue.ts` | 3 | Add worker_interrupted, worker_resumed, diagnosis_ready types |
| `packages/types/src/sidecar.ts` | 3 | Add "observing" status |
| `apps/server/src/main.ts` | 1,2,3 | OpenViking init, workspace verify, AnomalyDetector wiring |
| `apps/server/src/coordinator-context.ts` | 1 | Switch to VikingMemoryClient |
| `apps/server/src/coordinator-init.ts` | 2 | Add self-evolve skill, integrity check |
| `apps/server/src/coordinator-session.ts` | 2 | Add session persistence |
| `apps/server/src/event-handlers.ts` | 1,3 | Worker writeback, diagnosis_ready handler |
| `apps/server/src/file-routes.ts` | 3,4 | Add interrupt/resume/observe/approval endpoints |
| `apps/server/src/dashboard.ts` | 4 | Add evolution/pending hooks endpoints |
| `packages/sidecar/src/interrupt-controller.ts` | 3 | Add registry persist |
| `packages/sidecar/src/resume-controller.ts` | 3 | Fix taskType fallback |
| `apps/server/src/coordinator-prompt.ts` | 3 | Fix field name mismatch |
| `packages/memory/package.json` | 1 | Remove sqlite-vec, node-llama-cpp deps |

### Deleted Files

| File | Module | Reason |
|------|--------|--------|
| `packages/memory/src/team-memory-store.ts` | 1 | Replaced by VikingMemoryClient |
| `packages/memory/src/embedder.ts` | 1 | Replaced by OpenViking embedding |
| `packages/memory/src/retriever.ts` | 1 | Replaced by VikingMemoryClient.find |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| OpenViking server startup slow (Python + model loading) | Server startup delayed | `readyTimeoutMs` default 120s; async model loading; `managed: false` for pre-started servers |
| Observer worker produces bad diagnosis | Wrong interrupt/resume decisions | Three-verdict system (interrupt/let_continue/inject_hint) with conservative defaults; Coordinator as fallback decision-maker |
| Self-evolve creates buggy hooks | Runtime errors in HookEngine | requireApproval gate; module validation on load; timeout + error isolation in HookEngine |
| Dual anomaly detection (WorkerLifecycleMonitor + AnomalyDetector) | Duplicate events | traceId-based dedup in PersistentQueue; long-term consolidation planned |
| Session persistence race condition | Corrupted .session.json | Atomic write (write to .tmp, rename); single-writer guarantee (only CoordinatorSessionManager writes) |
