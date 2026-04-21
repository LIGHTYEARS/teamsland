# ISSUES

Prioritized backlog for the teamsland auto-evolution loop.
Each issue is scoped to ~1-2 hours of AI-agent work.
The evolution loop picks unchecked items and marks them `[x]` on completion.

---

## 1. Critical Gaps (blocking a working v0.1 demo)

- [x] **[server] Wire SidecarDataPlane into issue.created pipeline** — `ProcessController.spawn()` returns a stdout ReadableStream but no code calls `SidecarDataPlane.processStream()` on it. Agent events are never persisted to SessionDB and Agent status never transitions. Add a `SidecarDataPlane` instance to `EventHandlerDeps` and invoke `dataPlane.processStream(agentId, spawnResult.stdout)` after `registry.register()` in `event-handlers.ts`.

- [ ] **[server] Wire real LLM client instead of stub** — `main.ts` creates a `stubLlmClient` that always throws. Implement a real `LlmClient` backed by the Anthropic SDK, reading API key/model from `config.json`, and inject it into `IntentClassifier` and `TaskPlanner`.

- [x] **[context] Create agent role templates under config/templates/** — `DynamicContextAssembler.buildSectionE()` calls `loadTemplate(agentRole)` which reads `config/templates/{agentRole}.md`. No templates directory exists. Create `config/templates/` with `frontend_dev.md`, `tech_spec.md`, `design.md`, `query.md`, `status_sync.md`, and `confirm.md`.

- [ ] **[meego] Implement real Meego REST poll** — `MeegoConnector.startPoll()` is a pure stub. Implement the actual Meego API call using `config.meego.spaces`, the `plugin_access_token` header, and `lookbackMinutes` to fetch recent issue events and push them to `eventBus.handle()`.

- [ ] **[meego] Implement webhook signature verification** — `MeegoConnector.startWebhook()` accepts any POST without validating signature. Add HMAC-SHA256 verification using `config.meego.webhookSecret`.

- [ ] **[server] Implement Meego confirmation via real API** — `ConfirmationWatcher.fetchConfirmationStatus()` always returns `"pending"`. Wire it to the actual Meego OpenAPI issue-status query so human-confirmation loops can resolve.

- [x] **[config] Add config validation on startup** — `loadConfig()` reads raw JSON and casts without schema validation. Add Zod validation that fails fast with human-readable error listing all missing/invalid fields.

---

## 2. Missing Integrations (wiring between packages)

- [ ] **[server] Integrate DocumentParser + ingestDocument into issue.created handler** — When a new issue arrives, its title/description should be ingested into team memory via `ingestDocument()`. Currently the handler only spawns an agent but never writes the PRD to memory.

- [ ] **[server] Integrate Alerter into scheduled health-check** — `Alerter` class exists but is never instantiated. Add a periodic health-check that calls `alerter.check("concurrent_agents", registry.runningCount(), threshold)` and sends Lark alerts when exceeded.

- [ ] **[server] Wire ObservableMessageBus** — `ObservableMessageBus` is defined but never wired. Instantiate it, subscribe `SidecarDataPlane`, and pass it to Swarm workers so all inter-agent messages carry a `traceId`.

- [ ] **[swarm] Wire runSwarm into event-handlers for complex tasks** — `runSwarm()` and `TaskPlanner` exist but are never called from the server. Add logic to detect complex tasks and dispatch to `runSwarm()` instead of single-agent spawn.

- [ ] **[meego] Wire ConfirmationWatcher into issue.status_changed handler** — The handler is a placeholder logger. When status transitions require human confirmation, call `ConfirmationWatcher.watch()` and only allow the transition after `"approved"`.

- [ ] **[ingestion] Wire DocumentParser output into IntentClassifier** — `DocumentParser.parseMarkdown()` extracts entities but they are never passed to `IntentClassifier`. Pass `entities` as context for richer LLM classification results.

- [ ] **[lark] Wire contact/group resolution in issue.created handler** — `LarkCli.contactSearch()` and `groupSearch()` are implemented but never called. After intent classification, resolve `entities.owners` to Lark user IDs and send group notification.

---

## 3. Feature Completions (package capabilities)

- [ ] **[meego] Implement long-connection EventSource** — `MeegoConnector.startLongConnection()` is a stub that sleeps in a loop. Replace with actual SSE/EventSource connection using `plugin_access_token` and exponential-backoff retry.

- [ ] **[session] Implement SessionDB.compact()** — Schema and types exist but no compaction method. Implement `compact(sessionId)` that summarises old messages via LLM when token count exceeds threshold and trims history.

- [ ] **[memory] Implement access_count increment on retrieval** — `vectorSearch()` and `ftsSearch()` never increment `access_count`, so `hotnessScore` ranking is recency-only. Add `UPDATE SET access_count = access_count + 1` on retrieval.

- [ ] **[sidecar] Implement orphan-recovery on restoreOnStartup** — `restoreOnStartup()` loads alive PIDs but doesn't re-attach stream processing. Surviving orphans are unmonitored. Add re-attach or re-spawn logic.

- [ ] **[config] Add skillRouting to config schema and config.json** — `DynamicContextAssembler.buildSectionC()` reads `config.skillRouting[task.triggerType]` but no `skillRouting` field exists. Add to both TypeScript type and config.json.

- [ ] **[context] Add templateBasePath to AppConfig** — `DynamicContextAssembler` defaults to `"config/templates"` but has no config override. Add `context.templateBasePath` to AppConfig and config.json.

- [ ] **[memory] Make LocalEmbedder.embedBatch parallel** — Currently a serial for-loop. Use `Promise.all` with concurrency limit to speed up multi-document embedding.

- [ ] **[observability] Add OpenTelemetry span instrumentation** — No OTel spans are created or exported to Jaeger. Add `@opentelemetry/sdk-node` and instrument `ProcessController.spawn`, `TeamMemoryStore.vectorSearch`, and `DynamicContextAssembler.buildInitialPrompt`.

---

## 4. Quality Improvements (tests, error handling)

- [ ] **[test] Integration test: Meego event -> Agent spawn pipeline** — No test exercises the full `issue.created` -> classify -> worktree -> prompt -> spawn path. Write an integration test using in-memory SQLite, FakeEmbedder, FakeLlmClient, and mock ProcessController.

- [ ] **[test] Memory retrieval precision regression test** — Create `test/fixtures/corpus/` with representative docs and `test/fixtures/queries/` with labelled queries. Assert P@10 >= 0.8 on 20 queries against 50 documents.

- [ ] **[test] Sidecar crash-recovery integration test** — Spawn a fake process, register it, kill it, call `restoreOnStartup()`, assert dead-PID record is cleaned up while alive-PID is restored.

- [ ] **[test] Concurrent SQLite WAL write test** — Fire 10 concurrent `SessionDB.appendMessage()` calls, assert all succeed without SQLITE_BUSY errors within `busyTimeoutMs` window.

- [ ] **[server] Structured error handling for missing repoMapping** — `resolveRepoPath()` returns `undefined` and the handler silently returns. Send a Lark DM to the assignee or team channel when no repo mapping is found.

- [ ] **[session] Expose FTS5 searchMessages method** — FTS5 index is scaffolded but no `searchMessages()` method is exported. Implement and export for agents and dashboard to query past sessions by keyword.

- [ ] **[observability] Startup health-check for sqlite-vec extension** — If `vec0` native extension is not installed, crash is unhandled. Add explicit pre-flight check with clear installation message and graceful exit.

---

## 5. Dashboard UI

- [ ] **[dashboard] WebSocket real-time agent list** — Replace placeholder `<h1>` with a React component that connects to `ws://localhost:3000/ws` and displays a live table of running agents.

- [ ] **[dashboard] Implement real WebSocket push in server** — `dashboard.ts` sends `"connected"` then closes. Implement proper server-side push with registry change event subscriptions.

- [ ] **[dashboard] Stream-JSON event viewer** — Panel that shows raw NDJSON stream events for a selected agent's session via `GET /api/sessions/:sessionId/messages`.

- [ ] **[dashboard] Lark OAuth authentication** — `DashboardConfig` has `auth.provider: "lark_oauth"` but no middleware. Implement Lark OAuth flow and gate `/api/*` routes.

- [ ] **[dashboard] Configure rspack + Tailwind build** — Add proper `rspack.config.ts`, configure TailwindCSS/shadcn/ui, add `dev` script with API proxy, verify hot-reload.
