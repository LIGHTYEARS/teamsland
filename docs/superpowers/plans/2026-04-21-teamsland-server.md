# apps/server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `apps/server/src/main.ts` — the process entry point that wires all 12 packages together into a running system. Startup sequence: config → SQLite → memory → embedder → registry → event bus → connector → dashboard → scheduled tasks. Graceful shutdown via AbortController + SIGTERM handler.

**Architecture:** Four source files: `main.ts` (orchestration entry), `event-handlers.ts` (MeegoEventBus handler registrations — intent pipeline + raw corpus ingestion), `scheduled-tasks.ts` (4 interval-based maintenance jobs), `dashboard.ts` (Bun.serve HTTP + WebSocket placeholder). One test file for the scheduled tasks module (pure functions, testable without real infra).

**Tech Stack:** TypeScript (strict), Bun, Vitest, Biome

---

## Context

All 12 packages are implemented and tested (225 tests passing). The server stub exists at `apps/server/src/main.ts` with only a `console.log`. The architecture docs (`docs/09-risks-roadmap-decisions.md`) contain the canonical startup sequence. This plan wires the packages together following that sequence.

**Why this matters:** Without the server, no package is reachable at runtime. This is the glue that turns 12 independent libraries into a running system.

**Key constraint:** The MeegoConnector and several other components use placeholder implementations (poll mode, long-connection, confirmation status query). The server should wire what exists and log warnings for placeholders — not block on incomplete upstream code.

## Critical Files

- **Modify:** `apps/server/src/main.ts` (replace stub with full startup)
- **Create:** `apps/server/src/event-handlers.ts` (MeegoEventBus handler registrations)
- **Create:** `apps/server/src/scheduled-tasks.ts` (4 interval-based maintenance jobs)
- **Create:** `apps/server/src/dashboard.ts` (Bun.serve HTTP + WebSocket placeholder)
- **Create:** `apps/server/src/__tests__/scheduled-tasks.test.ts`

## Conventions

- JSDoc: Chinese, every exported function must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- Logger: `createLogger("server:main")`, `createLogger("server:events")`, `createLogger("server:scheduler")`, `createLogger("server:dashboard")`
- Run tests with: `bunx --bun vitest run apps/server/`
- Run typecheck with: `bunx tsc --noEmit --project apps/server/tsconfig.json`
- Run lint with: `bunx biome check apps/server/src/`

## Dependency Wiring Reference (exact constructor signatures)

```
loadConfig(configPath?: string): Promise<AppConfig>                     @teamsland/config
RepoMapping.fromConfig(config: RepoMappingConfig): RepoMapping          @teamsland/config
createLogger(name: string): Logger                                       @teamsland/observability

SessionDB(dbPath: string, config: SessionConfig)                         @teamsland/session
TeamMemoryStore(teamId: string, config: StorageConfig, embedder: Embedder) @teamsland/memory
LocalEmbedder(config: EmbeddingConfig) → .init(): Promise<void>          @teamsland/memory
MemoryReaper(store: TeamMemoryStore, config: MemoryConfig)               @teamsland/memory

BunCommandRunner()                                                       @teamsland/lark
LarkCli(config: LarkConfig, runner: CommandRunner)                       @teamsland/lark
LarkNotifier(cli: LarkCli, notificationConfig: LarkNotificationConfig)   @teamsland/lark

ProcessController({ logger: Logger })                                    @teamsland/sidecar
SubagentRegistry({ config: SidecarConfig, notifier: LarkNotifier, registryPath?: string, logger?: Logger }) @teamsland/sidecar
ObservableMessageBus({ logger: Logger })                                 @teamsland/sidecar
Alerter({ notifier: AlertNotifier, channelId: string, cooldownMs?: number }) @teamsland/sidecar

MeegoEventBus(db: Database)                          bun:sqlite Database   @teamsland/meego
MeegoConnector({ config: MeegoConfig, eventBus: MeegoEventBus }) → .start(signal?: AbortSignal) @teamsland/meego
ConfirmationWatcher({ notifier: LarkNotifier, config: ConfirmationConfig }) @teamsland/meego

IntentClassifier({ llm: LlmClient })                                    @teamsland/ingestion
DynamicContextAssembler({ config, repoMapping, memoryStore, embedder, templateBasePath? }) @teamsland/context
WorktreeManager(runner?: CommandRunner) → .reap(agents, maxAgeDays?)     @teamsland/git
TaskPlanner({ llm: LlmClient })                                         @teamsland/swarm
```

---

### Task 1: Create scheduled-tasks.ts — 4 interval maintenance jobs

**Files:**
- Create: `apps/server/src/scheduled-tasks.ts`
- Create: `apps/server/src/__tests__/scheduled-tasks.test.ts`

This is the most testable part (pure scheduler wrappers), so we start here.

- [ ] **Step 1: Create scheduled-tasks.ts**

Four exported functions, each wrapping `setInterval` + error handling + logging:

```typescript
import { createLogger } from "@teamsland/observability";
import type { TeamMemoryStore, MemoryReaper } from "@teamsland/memory";
import type { MeegoEventBus } from "@teamsland/meego";
import type { WorktreeManager } from "@teamsland/git";
import type { SubagentRegistry } from "@teamsland/sidecar";

const logger = createLogger("server:scheduler");

export function startWorktreeReaper(worktreeManager: WorktreeManager, registry: SubagentRegistry, intervalMs: number): ReturnType<typeof setInterval>
export function startMemoryReaper(reaper: MemoryReaper, intervalMs: number): ReturnType<typeof setInterval>
export function startSeenEventsSweep(eventBus: MeegoEventBus, intervalMs: number): ReturnType<typeof setInterval>
export function startFts5Optimize(memoryStore: TeamMemoryStore, intervalMs: number): ReturnType<typeof setInterval>
```

Each function:
1. Logs startup info with interval
2. Calls `setInterval` with a try/catch error handler that logs but never throws
3. Returns the interval ID for cleanup on shutdown

`startWorktreeReaper`: calls `worktreeManager.reap(registry.allRunning(), 7)` — passes all running agents as reapable candidates.

`startMemoryReaper`: calls `reaper.reap()` and logs `{ archived, skipped }`.

`startSeenEventsSweep`: calls `eventBus.sweepSeenEvents()` (synchronous, default 1h maxAge).

`startFts5Optimize`: calls `memoryStore.optimizeFts5()`.

- [ ] **Step 2: Create tests**

Test that each function:
1. Returns a valid interval ID (typeof number)
2. Calls the injected dependency at least once (use `vi.fn()` mocks + `vi.advanceTimersByTime()`)
3. Does not throw when the dependency throws (error swallowing)

- [ ] **Step 3: Run tests, typecheck, lint**
- [ ] **Step 4: Commit**

```
feat(server): add scheduled-tasks.ts — worktree reaper, memory reaper, event sweep, FTS5 optimize
```

---

### Task 2: Create event-handlers.ts — MeegoEventBus handler registrations

**Files:**
- Create: `apps/server/src/event-handlers.ts`

- [ ] **Step 1: Create event-handlers.ts**

A single `registerEventHandlers(bus, deps)` function that registers handlers on the MeegoEventBus.

```typescript
export interface EventHandlerDeps {
  intentClassifier: IntentClassifier;
  processController: ProcessController;
  assembler: DynamicContextAssembler;
  registry: SubagentRegistry;
  worktreeManager: WorktreeManager;
  notifier: LarkNotifier;
  config: AppConfig;
  teamId: string;
}

export function registerEventHandlers(bus: MeegoEventBus, deps: EventHandlerDeps): void
```

Registers these handlers:

- `issue.created` → `handleIssueCreated`: classify intent via `IntentClassifier.classify(event)`, then if confidence >= 0.5: create worktree via `WorktreeManager.create()`, build prompt via `DynamicContextAssembler.buildInitialPrompt()`, spawn Claude Code via `ProcessController.spawn()`, register in `SubagentRegistry`. On `CapacityError`: send DM via `LarkNotifier`.
- `issue.status_changed` → `handleStatusChanged`: log the status change. (Placeholder — full implementation depends on Meego API integration)
- `issue.assigned` → `handleAssigned`: send DM notification to assignee via `LarkNotifier.sendDm()`.
- `sprint.started` → `handleSprintStarted`: log sprint context. (Placeholder)

Each handler is an `EventHandler` (has `process(event: MeegoEvent): Promise<void>`).

- [ ] **Step 2: Run typecheck, lint**
- [ ] **Step 3: Commit**

```
feat(server): add event-handlers.ts — intent classification + agent spawn pipeline
```

---

### Task 3: Create dashboard.ts — HTTP + WebSocket placeholder

**Files:**
- Create: `apps/server/src/dashboard.ts`

- [ ] **Step 1: Create dashboard.ts**

Minimal `Bun.serve` wrapper that serves:
- `GET /health` → `{ status: "ok", uptime: process.uptime() }`
- `GET /api/agents` → `registry.allRunning()` as JSON
- WebSocket upgrade at `/ws` → placeholder that sends `{ type: "connected" }` then closes (real implementation later)
- All other routes → 404

```typescript
export interface DashboardDeps {
  registry: SubagentRegistry;
  config: DashboardConfig;
}

export function startDashboard(deps: DashboardDeps, signal?: AbortSignal): ReturnType<typeof Bun.serve>
```

Returns the `Server` instance for shutdown.

- [ ] **Step 2: Run typecheck, lint**
- [ ] **Step 3: Commit**

```
feat(server): add dashboard.ts — health check + agent list API + WebSocket placeholder
```

---

### Task 4: Implement main.ts — Full startup orchestration

**Files:**
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Replace stub with full startup sequence**

The startup follows this exact order (dependencies flow top-down):

```
1. loadConfig()                          → config: AppConfig
2. createLogger("server:main")           → logger
3. SessionDB(dbPath, config.session)     → sessionDb
4. Database(":memory:")                  → eventDb (for MeegoEventBus dedup)
5. LocalEmbedder(config.storage.embedding) → embedder → await embedder.init()
6. TeamMemoryStore(TEAM_ID, config.storage, embedder) → memoryStore
7. MemoryReaper(memoryStore, config.memory) → memoryReaper
8. BunCommandRunner()                    → cmdRunner
9. LarkCli(config.lark, cmdRunner)       → larkCli
10. LarkNotifier(larkCli, config.lark.notification) → notifier
11. ProcessController({ logger })         → processController
12. SubagentRegistry({ config: config.sidecar, notifier, logger }) → registry
     await registry.restoreOnStartup()
13. RepoMapping.fromConfig(config.repoMapping) → repoMapping
14. DynamicContextAssembler({ config, repoMapping, memoryStore, embedder }) → assembler
15. IntentClassifier({ llm: ??? })       → intentClassifier
16. WorktreeManager(cmdRunner)            → worktreeManager
17. MeegoEventBus(eventDb)               → eventBus
18. registerEventHandlers(eventBus, { ...deps })
19. MeegoConnector({ config: config.meego, eventBus }) → connector
     await connector.start(controller.signal)
20. startDashboard({ registry, config: config.dashboard }, controller.signal) → dashboardServer
21. Start 4 scheduled tasks
22. Log "[main] system started"
```

**LLM client note:** `IntentClassifier` and `TaskPlanner` need an `LlmClient`. For now, create a stub `LlmClient` that throws "LLM not configured" — the real implementation requires an API key and model endpoint which are not yet in the config. Log a warning at startup.

**SIGTERM handler:**
```
process.on("SIGTERM", async () => {
  logger.info("收到 SIGTERM，开始优雅关闭");
  controller.abort();
  clearInterval(all 4 interval IDs);
  dashboardServer.stop();
  await registry.persist();
  sessionDb.close();
  logger.info("优雅关闭完成");
  process.exit(0);
});
```

**TEAM_ID constant:** `const TEAM_ID = "default"` — single-team deployment.

- [ ] **Step 2: Run typecheck**

```bash
bunx tsc --noEmit --project apps/server/tsconfig.json
```

- [ ] **Step 3: Run lint**

```bash
bunx biome check apps/server/src/
```

- [ ] **Step 4: Smoke test — start and immediately stop**

```bash
timeout 5 bun run apps/server/src/main.ts || true
```

The server should print startup logs and not crash. It will fail to connect to Meego (expected) but should reach "system started" or fail gracefully with a logged error.

- [ ] **Step 5: Commit**

```
feat(server): wire main.ts — full startup, event pipeline, scheduled tasks, graceful shutdown
```

---

### Task 5: Full Verification

- [ ] **Step 1: Run server tests**

```bash
bunx --bun vitest run apps/server/
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```
All 14 packages must pass.

- [ ] **Step 3: Run lint**

```bash
bun run lint
```

- [ ] **Step 4: Run full test suite**

```bash
bun run test:run
```
All 225+ tests must still pass.

- [ ] **Step 5: Verify no `any` or `!`**

```bash
grep -rn '\bany\b' apps/server/src/ --include='*.ts' | grep -v '__tests__'
grep -rn '!\.' apps/server/src/ --include='*.ts' | grep -v '__tests__'
```

- [ ] **Step 6: Verify file count**

4 source files: `main.ts`, `event-handlers.ts`, `scheduled-tasks.ts`, `dashboard.ts`
1 test file: `__tests__/scheduled-tasks.test.ts`

## Verification

After all tasks:

1. `bun run typecheck` — all packages exit 0
2. `bun run lint` — no errors
3. `bun run test:run` — all tests pass (225+ existing + new scheduler tests)
4. `bun run apps/server/src/main.ts` — starts, prints structured logs, does not crash
5. `curl http://localhost:3000/health` → `{ "status": "ok", "uptime": ... }`
6. `curl http://localhost:3000/api/agents` → `[]` (no agents running)
7. Every exported function has Chinese JSDoc with `@example`
8. No `any`, no `!` non-null assertions
9. All logging via `createLogger()` — no bare `console.log`
