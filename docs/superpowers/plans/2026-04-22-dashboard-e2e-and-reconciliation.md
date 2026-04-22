# Dashboard E2E Verification & ISSUES.md Reconciliation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the dashboard builds and runs correctly, add the missing `/auth/*` proxy route to rspack dev server config, and reconcile ISSUES.md to reflect the true codebase state (many items are already resolved).

**Architecture:** The dashboard frontend is fully implemented: `App.tsx` with header + status indicator, `AgentList` table with real-time WebSocket updates via `useAgents` hook, `EventViewer` NDJSON message viewer via `useSessionMessages` hook, `AuthGate` with Lark OAuth login flow via `useAuth` hook. The server provides all backend routes: `/api/agents`, `/api/sessions/:id/messages` (NDJSON), `/ws` (WebSocket with `connected` + `agents_update` push), `/auth/lark` + `/auth/lark/callback` + `/auth/me` + `/auth/logout`, `/health`. The rspack dev server proxies `/api`, `/ws`, `/health` to `localhost:3000` but is missing `/auth` proxy.

**Tech Stack:** rspack, React 19, TailwindCSS v4, PostCSS

---

### Task 1: Add `/auth` proxy route to rspack dev server

**Files:**
- Modify: `apps/dashboard/rspack.config.ts:38`

The `AuthGate` component calls `/auth/me` on mount and links to `/auth/lark`. The rspack dev server proxy config at line 38 only proxies `["/api", "/ws", "/health"]` — `/auth` is missing, so the auth flow will 404 in development mode.

- [ ] **Step 1: Add `/auth` to the proxy context array**

In `apps/dashboard/rspack.config.ts`, change line 38 from:

```typescript
    proxy: [{ context: ["/api", "/ws", "/health"], target: "http://localhost:3000", ws: true }],
```

to:

```typescript
    proxy: [{ context: ["/api", "/ws", "/health", "/auth"], target: "http://localhost:3000", ws: true }],
```

- [ ] **Step 2: Verify the config is valid TypeScript**

Run: `cd /Users/bytedance/workspace/teamsland/apps/dashboard && bunx tsc --noEmit rspack.config.ts 2>&1 || echo "Note: tsc may not handle rspack types, verify manually"`

Alternative: just run `bun run build` in the next step — if rspack loads the config, it's valid.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/rspack.config.ts
git commit -m "fix(dashboard): add /auth to rspack dev server proxy"
```

---

### Task 2: Verify dashboard builds successfully

**Files:**
- None (read-only verification)

- [ ] **Step 1: Run the dashboard production build**

Run: `cd /Users/bytedance/workspace/teamsland && bun run --filter @teamsland/dashboard build`

Expected: Build completes with no errors. Output goes to `apps/dashboard/dist/`.

- [ ] **Step 2: Verify the output directory contains expected assets**

Run: `ls -la apps/dashboard/dist/`

Expected: `index.html`, `main.js` (or similar bundled JS), CSS file.

- [ ] **Step 3: Verify TypeScript types pass**

Run: `cd /Users/bytedance/workspace/teamsland/apps/dashboard && bunx tsc --noEmit`

Expected: No type errors.

---

### Task 3: Reconcile ISSUES.md with actual codebase state

**Files:**
- Modify: `ISSUES.md`

Many ISSUES.md items are already resolved in the codebase but still shown as unchecked. This creates confusion for the auto-evolution loop and human readers. Mark resolved items as `[x]` with a note about when/how they were resolved.

- [ ] **Step 1: Mark all resolved issues as complete**

The following items are **already implemented** and should be checked off:

**Section 1 (Critical Gaps):**
- `[server] Wire SidecarDataPlane into issue.created pipeline` — Already wired at `event-handlers.ts:253`, `main.ts:149`
- `[server] Wire real LLM client instead of stub` — `AnthropicLlmClient` exists at `apps/server/src/llm-client.ts:79`, activated when `config.llm` is present. Config block added in Phase 1 plan.
- `[context] Create agent role templates under config/templates/` — All 6 templates exist: `frontend_dev.md`, `tech_spec.md`, `design.md`, `query.md`, `status_sync.md`, `confirm.md`
- `[meego] Implement real Meego REST poll` — Implemented at `connector.ts:264-298`, calls real API with `fetchMeegoEvents()`
- `[meego] Implement webhook signature verification` — Implemented at `connector.ts:104-109`, HMAC-SHA256 with `timingSafeEqual`
- `[server] Implement Meego confirmation via real API` — `ConfirmationWatcher` wired at `main.ts:185-189` and used in `event-handlers.ts:456`. Real API call gated on `pluginAccessToken` being non-empty.
- `[config] Add config validation on startup` — `AppConfigSchema.parse()` called in `loadConfig()` with full Zod validation at `schema.ts:170-191`

**Section 2 (Missing Integrations):**
- `[server] Integrate DocumentParser + ingestDocument into issue.created handler` — Wired at `event-handlers.ts:334` (parseMarkdown) and `event-handlers.ts:166-184` (scheduleMemoryIngestion)
- `[server] Integrate Alerter into scheduled health-check` — Wired at `main.ts:230-231` with `createAlerter` + `startHealthCheck`
- `[server] Wire ObservableMessageBus` — Instantiated at `main.ts:145`, passed to `SidecarDataPlane` at `main.ts:149`
- `[swarm] Wire runSwarm into event-handlers for complex tasks` — Wired at `event-handlers.ts:281-394`, gated on `taskPlanner !== null && entities.length >= 3`
- `[meego] Wire ConfirmationWatcher into issue.status_changed handler` — Wired at `event-handlers.ts:455-465`
- `[ingestion] Wire DocumentParser output into IntentClassifier` — Entities from `documentParser.parseMarkdown()` passed via `scheduleMemoryIngestion`
- `[lark] Wire contact/group resolution in issue.created handler` — `contactSearch` called in `resolveAndNotifyOwners()` at `event-handlers.ts:202-221`

**Section 3 (Feature Completions):**
- `[meego] Implement long-connection EventSource` — Real SSE implementation at `connector.ts:316-472`
- `[session] Implement SessionDB.compact()` — Fully implemented at `session-db.ts:454-492`
- `[memory] Implement access_count increment on retrieval` — Called at `retriever.ts:85-86`
- `[config] Add skillRouting to config schema and config.json` — Exists in schema at `schema.ts:180` and in `config.json:98-102`
- `[context] Add templateBasePath to AppConfig` — In `config.ts`, `config.json:103`, and `assembler.ts:73`
- `[memory] Make LocalEmbedder.embedBatch parallel` — Concurrency=4 worker loop at `embedder.ts:116-133`
- `[observability] Add OpenTelemetry span instrumentation` — `tracer.ts` has `initTracing`, `withSpan`, `getTracer`. Phase 2 plan adds spans to key operations.

**Section 4 (Quality Improvements):**
- `[test] Sidecar crash-recovery integration test` — Full test suite at `sidecar/__tests__/crash-recovery.test.ts`
- `[session] Expose FTS5 searchMessages method` — Implemented at `session-db.ts:281-311`
- `[observability] Startup health-check for sqlite-vec extension` — `checkVec0Available()` called at `main.ts:103`, with clear log message and graceful fallback
- `[test] Concurrent SQLite WAL write test` — Test exists at `session/__tests__/concurrent-wal.test.ts`

**Section 5 (Dashboard UI):**
- `[dashboard] WebSocket real-time agent list` — `useAgents` hook with WebSocket at `hooks/useAgents.ts`, `AgentList` component at `components/AgentList.tsx`
- `[dashboard] Implement real WebSocket push in server` — `dashboard.ts:210-240` with registry subscription and broadcast
- `[dashboard] Stream-JSON event viewer` — `EventViewer` component at `components/EventViewer.tsx`, `useSessionMessages` hook at `hooks/useSessionMessages.ts`
- `[dashboard] Lark OAuth authentication` — Full `LarkAuthManager` at `apps/server/src/lark-auth.ts`, `AuthGate` component at `components/AuthGate.tsx`
- `[dashboard] Configure rspack + Tailwind build` — Full config at `rspack.config.ts`, `postcss.config.js`, `tailwind.config.ts`, TailwindCSS v4 `@import "tailwindcss"` in `index.css`

Update `ISSUES.md` to check off all of the above items. For items not yet resolved, keep them as-is. The remaining unchecked items should be:

**Still open:**
- `[test] Integration test: Meego event -> Agent spawn pipeline` — The existing `event-pipeline.test.ts` mocks DataPlane. Phase 2 plan adds a real DataPlane integration test.
- `[test] Memory retrieval precision regression test` — No labeled corpus/queries fixture exists yet.
- `[sidecar] Implement orphan-recovery on restoreOnStartup` — Orphans are tracked and monitored for death, but stdout streams cannot be re-attached (architectural limitation — pipe FD is lost on server restart).
- `[server] Structured error handling for missing repoMapping` — Handler silently returns; should send Lark DM.

- [ ] **Step 2: Verify the updated ISSUES.md renders correctly**

Read through the file to confirm all `[x]` items are marked consistently and remaining open items are accurate.

- [ ] **Step 3: Commit**

```bash
git add ISSUES.md
git commit -m "docs: reconcile ISSUES.md — mark 30+ resolved items, 4 remain open"
```
