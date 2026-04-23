# Phase 6: Hooks Layer + Self-Evolution Technical Design

## Overview

Phase 6 establishes the bottom layer of the three-tier event processing architecture (Hooks) and the Coordinator self-evolution mechanism. This document covers the Event Hook engine, HookContext design, hot-reload mechanism, the complete three-tier event routing flow, the self-evolution Skill, preset hooks, metrics, validation, and risk analysis.

**Key distinction:** This document addresses two different "hooks" concepts:
1. **Claude Code native hooks** (`settings.json` lifecycle hooks) -- official Claude Code feature for running shell commands around tool calls. Reference: `docs/hooks-guide.md`.
2. **teamsland event hooks** (this design) -- teamsland's own server-side event processing layer that matches event patterns and executes actions with zero LLM overhead.

Phase 6 focuses on **type 2** but leverages Claude Code native hooks where appropriate.

---

## 1. Event Hook Engine Design

### 1.1 Architecture Overview

```
~/.teamsland/coordinator/hooks/
  |- meego/
  |    |- issue-assigned.ts
  |    |- issue-created.ts
  |    +- sprint-started.ts
  |- lark/
  |    +- keyword-reply.ts
  +- ci/
       +- build-failed.ts
```

The Hook Engine lives in a new `packages/hooks/` package (`@teamsland/hooks`), imported by `apps/server`. It watches the hooks directory, dynamically loads TypeScript hook files, and intercepts events before they reach the message queue / Coordinator.

### 1.2 Hook File Format Specification

Every hook file must export two named exports:

```typescript
// ~/.teamsland/coordinator/hooks/meego/issue-assigned.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

/** Event matcher -- return true to claim the event */
export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.assigned";

/** Handler -- execute the action, no LLM involved */
export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const assigneeId = event.payload.assigneeId;
  if (typeof assigneeId !== "string" || !assigneeId) return;
  await ctx.lark.sendDm(
    assigneeId,
    `Task ${event.issueId} (project ${event.projectKey}) has been assigned to you.`
  );
  ctx.log.info({ issueId: event.issueId, assigneeId }, "Assignment notification sent via hook");
};
```

**Type contract:**

```typescript
/** Hook module shape -- what a hook .ts file must export */
export interface HookModule {
  /** Return true if this hook should handle the event */
  match: (event: MeegoEvent) => boolean;
  /** Execute the hook action */
  handle: (event: MeegoEvent, ctx: HookContext) => Promise<void>;
  /** Optional: hook priority (lower = higher priority, default 100) */
  priority?: number;
  /** Optional: human-readable description for dashboard display */
  description?: string;
}
```

**Rules:**
- `match` must be a pure, synchronous function (no I/O, no async)
- `match` must complete in < 1ms -- it runs on every event
- `handle` has a configurable timeout (default 30s)
- A hook file that fails to load (syntax error, missing exports) is skipped with an error log; other hooks remain unaffected
- File naming convention: `<event-category>/<descriptive-name>.ts`

### 1.3 Matching Logic

When an event arrives, the engine runs through all loaded hooks in priority order:

```typescript
async function processEvent(event: MeegoEvent, hooks: LoadedHook[], ctx: HookContext): Promise<boolean> {
  for (const hook of hooks) {
    try {
      if (hook.module.match(event)) {
        ctx.log.info({ hookId: hook.id, eventId: event.eventId }, "Hook matched");
        await Promise.race([
          hook.module.handle(event, ctx),
          timeout(hook.timeoutMs),
        ]);
        ctx.metrics.recordHookHit(hook.id, event.type);
        return true; // Event consumed by hook
      }
    } catch (err: unknown) {
      ctx.log.error({ hookId: hook.id, eventId: event.eventId, err }, "Hook execution failed");
      ctx.metrics.recordHookError(hook.id, event.type);
      // Continue to next hook -- one hook failure doesn't block others
    }
  }
  return false; // No hook matched, pass to next tier
}
```

**Design decisions:**
- **First-match-wins by default.** The first hook (by priority) whose `match` returns true consumes the event. This keeps the model simple and predictable.
- **Configurable multi-match mode.** A global config flag `hooks.multiMatch: true` allows all matching hooks to run (fan-out). Default is `false`.
- **Short-circuit on error.** A failing hook does NOT prevent subsequent hooks from trying. But once a hook's `handle` starts executing, the event is considered "claimed" -- even if `handle` throws, the event doesn't fall through to the next tier. The rationale: if `match` succeeded, the hook was the right handler; an execution failure should be retried or logged, not silently routed elsewhere.

---

## 2. HookContext Interface

```typescript
import type { LarkCli, LarkNotifier } from "@teamsland/lark";
import type { ProcessController, SubagentRegistry } from "@teamsland/sidecar";
import type { ObservableMessageBus } from "@teamsland/sidecar";
import type { Logger } from "@teamsland/observability";

/**
 * Context injected into every hook handler.
 * Provides all the tools a hook needs to execute actions without LLM involvement.
 */
export interface HookContext {
  // -- Communication --

  /** LarkCli instance for sending messages, reading docs, searching contacts */
  lark: LarkCli;

  /** LarkNotifier for structured notifications (DM, group, card messages) */
  notifier: LarkNotifier;

  // -- Orchestration --

  /**
   * Spawn a worker agent directly, bypassing the message queue.
   * Use when the hook has already made the decision and wants immediate execution.
   *
   * @returns Worker agent ID and process info
   *
   * @example
   * const worker = await ctx.spawn({
   *   repo: "/path/to/repo",
   *   task: "Fix the CI failure in module X",
   *   requester: "user-123",
   *   chatId: "oc_xxx",
   * });
   */
  spawn: (opts: HookSpawnOptions) => Promise<HookSpawnResult>;

  /**
   * Enqueue an event into the Coordinator's message queue.
   * Use when the hook wants to delegate to a higher processing tier.
   *
   * @example
   * await ctx.queue.enqueue({
   *   ...event,
   *   payload: { ...event.payload, hookEnriched: true, analysis: "..." },
   * });
   */
  queue: {
    enqueue: (event: MeegoEvent) => Promise<void>;
  };

  // -- Data Access --

  /** SubagentRegistry for querying worker status */
  registry: SubagentRegistry;

  /** Application configuration (read-only) */
  config: Readonly<AppConfig>;

  // -- Observability --

  /** Structured logger scoped to the hook */
  log: Logger;

  /** Metrics recorder for hook performance tracking */
  metrics: HookMetrics;
}

/** Options for spawning a worker from a hook */
export interface HookSpawnOptions {
  /** Target repository path */
  repo: string;
  /** Task description for the worker */
  task: string;
  /** Requester's Lark user ID */
  requester: string;
  /** Chat ID for result delivery (optional) */
  chatId?: string;
  /** Reuse existing worktree path instead of creating new one */
  worktreePath?: string;
}

/** Result of spawning a worker from a hook */
export interface HookSpawnResult {
  agentId: string;
  pid: number;
  sessionId: string;
  worktreePath: string;
}

/** Hook metrics recording interface */
export interface HookMetrics {
  /** Record a successful hook match and execution */
  recordHookHit(hookId: string, eventType: string): void;
  /** Record a hook execution error */
  recordHookError(hookId: string, eventType: string): void;
  /** Record hook match evaluation time */
  recordMatchDuration(hookId: string, durationMs: number): void;
  /** Record hook handle execution time */
  recordHandleDuration(hookId: string, durationMs: number): void;
}
```

### 2.1 HookContext Construction

HookContext is constructed once at server startup and shared across all hook executions. Per-hook `log` instances are scoped via child loggers:

```typescript
function buildHookContext(deps: EventHandlerDeps, metrics: HookMetrics): HookContext {
  return {
    lark: deps.larkCli,
    notifier: deps.notifier,
    spawn: async (opts) => {
      const worktreePath = opts.worktreePath ?? await deps.worktreeManager.create(opts.repo, `hook-${randomUUID().slice(0, 8)}`);
      const prompt = `## Task\n${opts.task}\n\n## Requester\n${opts.requester}`;
      const result = await deps.processController.spawn({
        issueId: `hook-${randomUUID().slice(0, 8)}`,
        worktreePath,
        initialPrompt: prompt,
      });
      // Register in SubagentRegistry...
      return { agentId: `hook-agent-${result.sessionId}`, ...result, worktreePath };
    },
    queue: {
      enqueue: async (event) => { /* forward to PersistentQueue */ },
    },
    registry: deps.registry,
    config: deps.config,
    log: createLogger("hooks:engine"),
    metrics,
  };
}
```

---

## 3. Hot-Reload Implementation

### 3.1 File Watching

Use `Bun.watch()` (Bun's native file watcher, based on FSEvents on macOS) to watch the hooks directory:

```typescript
import { watch } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export class HookEngine {
  private hooks: Map<string, LoadedHook> = new Map();
  private readonly hooksDir: string;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(hooksDir: string, private ctx: HookContext) {
    this.hooksDir = hooksDir;
  }

  /** Initial load of all hooks + start watching */
  async start(): Promise<void> {
    await this.loadAll();
    this.watcher = watch(this.hooksDir, { recursive: true }, (eventType, filename) => {
      if (!filename?.endsWith(".ts")) return;
      this.handleFileChange(filename).catch((err: unknown) => {
        this.ctx.log.error({ err, filename }, "Hook file change handling failed");
      });
    });
    this.ctx.log.info({ dir: this.hooksDir, count: this.hooks.size }, "Hook engine started");
  }

  /** Stop watching and unload all hooks */
  stop(): void {
    this.watcher?.close();
    this.hooks.clear();
  }

  /** Load a single hook file */
  private async loadHook(filePath: string): Promise<void> {
    const hookId = relative(this.hooksDir, filePath).replace(/\.ts$/, "");
    try {
      // Bust the module cache by appending a timestamp query param
      const moduleUrl = `${filePath}?t=${Date.now()}`;
      const mod = await import(moduleUrl) as unknown;

      // Validate module shape
      if (!isValidHookModule(mod)) {
        this.ctx.log.warn({ hookId, filePath }, "Invalid hook module: missing match/handle exports");
        return;
      }

      this.hooks.set(hookId, {
        id: hookId,
        filePath,
        module: mod,
        timeoutMs: 30_000,
        loadedAt: Date.now(),
      });
      this.ctx.log.info({ hookId }, "Hook loaded");
    } catch (err: unknown) {
      this.ctx.log.error({ err, hookId, filePath }, "Hook load failed");
      // Do NOT rethrow -- one bad hook must not break others
    }
  }

  /** Unload a hook */
  private unloadHook(hookId: string): void {
    if (this.hooks.delete(hookId)) {
      this.ctx.log.info({ hookId }, "Hook unloaded");
    }
  }

  /** Handle file change event */
  private async handleFileChange(filename: string): Promise<void> {
    const filePath = join(this.hooksDir, filename);
    const hookId = filename.replace(/\.ts$/, "");

    try {
      await stat(filePath);
      // File exists -- load or reload
      await this.loadHook(filePath);
    } catch {
      // File deleted -- unload
      this.unloadHook(hookId);
    }
  }

  /** Load all .ts files from the hooks directory recursively */
  private async loadAll(): Promise<void> {
    const files = await this.findTsFiles(this.hooksDir);
    await Promise.allSettled(files.map((f) => this.loadHook(f)));
  }

  /** Recursively find all .ts files */
  private async findTsFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await this.findTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        results.push(fullPath);
      }
    }
    return results;
  }

  /** Process an event through the hook chain */
  async processEvent(event: MeegoEvent): Promise<boolean> {
    const sorted = [...this.hooks.values()].sort(
      (a, b) => (a.module.priority ?? 100) - (b.module.priority ?? 100)
    );
    return processEvent(event, sorted, this.ctx);
  }

  /** Get hook status for health check / dashboard */
  getStatus(): HookStatus[] {
    return [...this.hooks.values()].map((h) => ({
      id: h.id,
      filePath: h.filePath,
      loadedAt: h.loadedAt,
      description: h.module.description,
      priority: h.module.priority ?? 100,
    }));
  }
}
```

### 3.2 Module Cache Busting

Bun caches `import()` results by URL. To reload a changed file, append a timestamp query parameter: `import(\`${filePath}?t=${Date.now()}\`)`. This forces Bun to re-evaluate the module.

### 3.3 Error Isolation

- **Load failure:** Logged as error, hook not added to registry. Other hooks unaffected.
- **Match failure:** Caught per-hook, logged, move to next hook.
- **Handle failure:** Caught per-hook, logged, event still considered "claimed" (no silent fallthrough).
- **Timeout:** `handle` wrapped in `Promise.race` with configurable timeout. Timeout triggers error log and metric.

### 3.4 Health Check Endpoint

Add to `apps/server/src/dashboard.ts`:

```
GET /api/hooks/status
```

Response:
```json
{
  "hooksDir": "~/.teamsland/coordinator/hooks/",
  "loadedHooks": [
    {
      "id": "meego/issue-assigned",
      "filePath": "/Users/.../.teamsland/coordinator/hooks/meego/issue-assigned.ts",
      "loadedAt": 1713859200000,
      "description": "Send DM notification when issue is assigned",
      "priority": 100
    }
  ],
  "totalLoaded": 5,
  "lastReloadAt": 1713859200000
}
```

---

## 4. Three-Tier Event Processing Flow

### 4.1 Complete Flow Diagram

```
Event arrives (Meego webhook / Lark @mention / CI notification / ...)
  |
  v
[Tier 1: Hook Engine] -- server-side, zero LLM, millisecond latency
  |
  |-- match() returns true --> handle() executes --> DONE (不入队)
  |
  +-- no match
        |
        v
[PersistentQueue.enqueue()] -- Phase 0 持久化队列
        |
        v
[Tier 2: PersistentQueue --> Coordinator Skills/Subagents] -- lightweight LLM, seconds
  |
  |-- Coordinator recognizes pattern, invokes Skill or Subagent --> DONE
  |
  +-- no recognized pattern
        |
        v
[Tier 3: Coordinator Deep Reasoning] -- full LLM inference, seconds to tens of seconds
  |
  +-- Coordinator analyzes from scratch, decides action, executes
```

### 4.2 Integration with Current Event Pipeline

Phase 0 已将 `MeegoEventBus` 标记为 deprecated，并用 `PersistentQueue` 替代作为事件主通道。Hook Engine 作为 `PersistentQueue` 入队前的拦截层，在事件到达时先经过 Hook 匹配，未匹配的事件才进入队列供 Coordinator 消费。

**事件处理流程：**

```
事件到达（Connector 收到 Meego webhook / Lark @mention / ...）
  → HookEngine.processEvent(event)
    ├→ matched → hook.handle() 直接执行 → DONE（不入队）
    └→ no match → PersistentQueue.enqueue(event) → Coordinator 消费
```

**集成代码：**

```typescript
// In apps/server/src/main.ts, modified startup sequence:

// ── 19.5. Hook Engine ──
const hookEngine = new HookEngine(
  resolve(homedir(), ".teamsland/coordinator/hooks"),
  buildHookContext(/* deps */),
);
await hookEngine.start();

// ── 20. Connector 事件入口（Hook 拦截 + PersistentQueue 入队）──
// Connector 收到事件后，先经过 Hook Engine 拦截
async function onEventArrived(event: MeegoEvent): Promise<void> {
  const consumed = await hookEngine.processEvent(event);
  if (consumed) {
    logger.info({ eventId: event.eventId, type: event.type }, "Event consumed by hook layer");
    return;
  }
  // Hook 未匹配，入队到 PersistentQueue 供 Coordinator 消费
  await persistentQueue.enqueue(toQueueMessage(event));
}

// 注册为 Connector 的事件回调
larkConnector.onEvent(onEventArrived);
meegoConnector.onEvent(onEventArrived);
```

### 4.3 How Tier 2 and Tier 3 Work (Coordinator Side)

Tier 2 and 3 happen inside the Coordinator's Claude Code session. The Coordinator is a Claude Code agent running in `~/.teamsland/coordinator/` with Skills and Subagents:

**Tier 2 -- Skill/Subagent matching:** The Coordinator has Skills (`.claude/skills/`) and Subagents (`.claude/agents/`) that Claude auto-matches based on descriptions. For a known event pattern, Claude recognizes it and invokes the appropriate Skill/Subagent without deep reasoning.

**Tier 3 -- Deep reasoning:** For truly novel events, the Coordinator performs full analysis: understanding context, consulting memory, deciding whether to respond, spawn a worker, or do nothing.

### 4.4 Relationship to Claude Code Native Hooks

| Aspect | Claude Code native hooks | teamsland event hooks |
|--------|-------------------------|----------------------|
| Where defined | `settings.json` | `~/.teamsland/coordinator/hooks/*.ts` |
| When triggered | Tool lifecycle (PreToolUse, PostToolUse, etc.) | External events (Meego, Lark, CI) |
| Execution model | Shell command / HTTP POST / prompt | TypeScript function with injected context |
| Purpose | Enforce rules on Claude's own behavior | Process team events without LLM |
| Who manages | Developer or admin | Coordinator (self-evolution) or developer |

**Claude Code native hooks are complementary, not competing.** They serve a different purpose:
- Use native hooks in `~/.teamsland/coordinator/.claude/settings.json` to enforce Coordinator behavior (e.g., PostToolUse hook to log all Coordinator tool calls)
- Use teamsland event hooks for pre-LLM event processing

---

## 5. Self-Evolution Skill (SKILL.md)

This Skill teaches the Coordinator how to evolve itself by creating hooks, skills, and subagents.

**File path:** `~/.teamsland/coordinator/.claude/skills/self-evolve/SKILL.md`

```yaml
---
name: self-evolve
description: >
  Analyze recurring event patterns and create automation artifacts (hooks, skills, or subagents)
  to reduce LLM overhead. Use when you notice you have processed the same type of event
  3 or more times with the same decision pattern.
when_to_use: >
  When processing an event and recognizing you have handled similar events before with
  the same action. Also invoke when explicitly asked to optimize event handling.
disable-model-invocation: false
allowed-tools: Write Edit Read Bash(ls *) Bash(cat *) Bash(mkdir *)
---

# Self-Evolution Guide

You are the Coordinator (Brain) of teamsland. Your job is to process team events and make decisions.
Over time, you should recognize patterns and automate them, reducing your own LLM overhead.

## The Three Tiers

1. **Hook** (zero LLM) -- TypeScript file in `~/.teamsland/coordinator/hooks/`, executed by the server directly
2. **Skill** (lightweight LLM) -- SKILL.md in `~/.teamsland/coordinator/.claude/skills/`, gives you a playbook
3. **Subagent** (isolated LLM) -- .md in `~/.teamsland/coordinator/.claude/agents/`, delegates to a sub-session

## When to Create What

### Create a Hook when:
- The event type and action are 100% deterministic (no judgment needed)
- The action is simple: send notification, spawn worker with fixed params, call API
- You have handled this exact pattern 3+ times identically
- Example: "issue.assigned always sends DM to assignee" -> Hook

### Create a Skill when:
- The pattern is mostly fixed but needs slight LLM judgment (e.g., formatting a message based on context)
- You need a playbook but the details vary per event
- Example: "sprint.started -> summarize sprint items and post to group chat" -> Skill

### Create a Subagent when:
- The task requires multi-step reasoning but is a recognized category
- It should run in isolation to avoid polluting your context
- Example: "CI failure triage -> read logs, identify root cause, suggest fix" -> Subagent

## How to Create a Hook

1. Determine the file path based on event source: `~/.teamsland/coordinator/hooks/<source>/<name>.ts`
2. Write the file using the exact format below
3. The server watches this directory and hot-reloads automatically

### Hook File Template

```typescript
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

/** [DESCRIBE WHAT THIS HOOK DOES] */
export const description = "[human-readable description]";

/** Priority: lower = higher priority. Default 100. */
export const priority = 100;

/** Return true if this hook should handle the event */
export const match = (event: MeegoEvent): boolean => {
  // IMPORTANT: match must be synchronous, pure, and fast (<1ms)
  // Only check event.type and event.payload fields
  return event.type === "[EVENT_TYPE]" && [ADDITIONAL_CONDITIONS];
};

/** Execute the hook action */
export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  // Available on ctx:
  // ctx.lark      -- send messages, search contacts, read docs
  // ctx.notifier  -- send structured notifications
  // ctx.spawn()   -- spawn worker agent (bypasses queue)
  // ctx.queue     -- enqueue event for Coordinator processing
  // ctx.registry  -- query worker status
  // ctx.config    -- read application config
  // ctx.log       -- structured logger
  // ctx.metrics   -- record metrics

  [IMPLEMENT ACTION HERE]
};
```

## How to Create a Skill

1. Create directory: `~/.teamsland/coordinator/.claude/skills/<name>/`
2. Write `SKILL.md` with YAML frontmatter

### Skill Template

```yaml
---
name: [skill-name]
description: [when Claude should use this skill]
---

[Instructions for handling this type of event]
```

## How to Create a Subagent

1. Write file: `~/.teamsland/coordinator/.claude/agents/<name>.md`

### Subagent Template

```yaml
---
name: [agent-name]
description: [what this agent specializes in]
tools: Read, Grep, Glob, Bash
model: haiku
---

[System prompt for the subagent]
```

## Safety Rules

1. **Never create a hook that modifies code repositories directly.** Hooks should only send notifications, spawn workers, or enqueue events.
2. **Always include error handling in hook handlers.** Use try/catch and log errors.
3. **Keep match() simple and fast.** Complex matching logic is a code smell -- the pattern might not be deterministic enough for a hook.
4. **Test before creating.** Before writing a hook, verify the pattern by reviewing your last 3+ handling decisions for this event type. If any decision was different, it is not ready for a hook.
5. **Log your evolution decisions.** When creating a new artifact, log WHY you decided to evolve and what pattern you observed.
6. **Never create hooks that call LLM APIs.** The whole point of hooks is zero LLM overhead.
7. **One hook per file.** Do not combine multiple patterns into one hook file.

## Evolution Log

When you create a new hook/skill/subagent, append to `~/.teamsland/coordinator/evolution-log.jsonl`:

```json
{"timestamp": "ISO8601", "action": "create_hook", "path": "hooks/meego/issue-assigned.ts", "reason": "Handled issue.assigned 5 times with identical DM notification action", "patternCount": 5}
```
```

---

## 6. Preset Hook Examples

### 6.1 Issue Assigned Notification

```typescript
// ~/.teamsland/coordinator/hooks/meego/issue-assigned.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "Send DM to assignee when an issue is assigned";
export const priority = 50;

export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.assigned";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const assigneeId = typeof event.payload.assigneeId === "string" ? event.payload.assigneeId : "";
  if (!assigneeId) {
    ctx.log.warn({ issueId: event.issueId }, "issue.assigned missing assigneeId");
    return;
  }
  await ctx.notifier.sendDm(
    assigneeId,
    `You have been assigned to task ${event.issueId} (project ${event.projectKey}). Please follow up.`
  );
  ctx.log.info({ issueId: event.issueId, assigneeId }, "Assignment DM sent");
};
```

### 6.2 Sprint Started Summary

```typescript
// ~/.teamsland/coordinator/hooks/meego/sprint-started.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "Post sprint kickoff summary to team channel when a sprint starts";
export const priority = 80;

export const match = (event: MeegoEvent): boolean =>
  event.type === "sprint.started";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const sprintName = typeof event.payload.sprintName === "string" ? event.payload.sprintName : "Unknown Sprint";
  const teamChannelId = ctx.config.lark.notification.teamChannelId;
  if (!teamChannelId) return;
  await ctx.lark.sendGroupMessage(
    teamChannelId,
    `Sprint "${sprintName}" has started for project ${event.projectKey}. Please check your assigned tasks.`
  );
  ctx.log.info({ projectKey: event.projectKey, sprintName }, "Sprint kickoff notification sent");
};
```

### 6.3 CI Build Failed Notification

```typescript
// ~/.teamsland/coordinator/hooks/ci/build-failed.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "Notify team channel when CI build fails";
export const priority = 30;

export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.created" &&
  event.payload.source === "ci" &&
  event.payload.status === "failed";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const teamChannelId = ctx.config.lark.notification.teamChannelId;
  const branch = typeof event.payload.branch === "string" ? event.payload.branch : "unknown";
  const pipelineUrl = typeof event.payload.pipelineUrl === "string" ? event.payload.pipelineUrl : "";

  const message = [
    `CI Build Failed`,
    `Project: ${event.projectKey}`,
    `Branch: ${branch}`,
    pipelineUrl ? `Pipeline: ${pipelineUrl}` : "",
  ].filter(Boolean).join("\n");

  await ctx.lark.sendGroupMessage(teamChannelId, message);
  ctx.log.info({ projectKey: event.projectKey, branch }, "CI failure notification sent");
};
```

### 6.4 Auto-Spawn Worker for Specific Project Issues

```typescript
// ~/.teamsland/coordinator/hooks/meego/auto-spawn-frontend.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "Auto-spawn worker for new issues in the frontend project";
export const priority = 90;

export const match = (event: MeegoEvent): boolean =>
  event.type === "issue.created" &&
  event.projectKey === "FRONTEND" &&
  event.payload.source !== "lark_mention";

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const description = typeof event.payload.description === "string" ? event.payload.description : "";
  const repoPath = ctx.config.repoMapping.find(
    (r) => r.meegoProjectId === event.projectKey
  )?.repos[0]?.path;

  if (!repoPath) {
    ctx.log.warn({ projectKey: event.projectKey }, "No repo mapping for auto-spawn");
    return;
  }

  const task = [title, description].filter(Boolean).join("\n\n");
  const result = await ctx.spawn({ repo: repoPath, task, requester: "auto-hook" });
  ctx.log.info({ issueId: event.issueId, agentId: result.agentId }, "Auto-spawned worker via hook");
};
```

### 6.5 Lark Keyword Auto-Reply

```typescript
// ~/.teamsland/coordinator/hooks/lark/keyword-reply.ts
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "Auto-reply to common keyword queries in Lark group chat";
export const priority = 20;

const KEYWORD_REPLIES: Record<string, string> = {
  "oncall": "Current oncall: See https://internal.example.com/oncall",
  "standup": "Daily standup is at 10:00 AM in the main meeting room.",
  "deploy": "Deployment guide: https://internal.example.com/deploy-guide",
};

export const match = (event: MeegoEvent): boolean => {
  if (event.payload.source !== "lark_mention") return false;
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const lower = title.toLowerCase().trim();
  return lower in KEYWORD_REPLIES;
};

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  const chatId = typeof event.payload.chatId === "string" ? event.payload.chatId : "";
  const messageId = typeof event.payload.messageId === "string" ? event.payload.messageId : "";
  const title = typeof event.payload.title === "string" ? event.payload.title : "";
  const reply = KEYWORD_REPLIES[title.toLowerCase().trim()];

  if (!chatId || !reply) return;

  await ctx.lark.sendGroupMessage(chatId, reply, messageId ? { replyToMessageId: messageId } : undefined);
  ctx.log.info({ keyword: title.trim(), chatId }, "Keyword auto-reply sent");
};
```

---

## 7. Evolution Metrics

### 7.1 What to Measure

| Metric | Description | Goal |
|--------|-------------|------|
| **Hook hit rate** | % of events consumed by hooks vs total events | Should increase over time |
| **Hook latency (p50/p95/p99)** | Time from event arrival to hook completion | < 100ms p99 |
| **Tier distribution** | % events handled at each tier (Hook / Skill / Deep) | More hooks, fewer deep reasoning |
| **Evolution frequency** | New hooks/skills/subagents created per week | Steady growth, then plateau |
| **Hook error rate** | % of hook executions that throw | < 1% |
| **Cost savings** | Estimated LLM token savings from hook-handled events | Should grow with hook count |
| **Event processing latency by tier** | End-to-end latency at each tier | Hooks: <100ms, Skills: <5s, Deep: <30s |

### 7.2 Implementation

```typescript
// packages/hooks/src/metrics.ts
import { createLogger } from "@teamsland/observability";

export class HookMetricsCollector implements HookMetrics {
  private readonly data = {
    hits: new Map<string, number>(),
    errors: new Map<string, number>(),
    matchDurations: new Map<string, number[]>(),
    handleDurations: new Map<string, number[]>(),
    tierDistribution: { hook: 0, skill: 0, deep: 0 },
  };
  private readonly log = createLogger("hooks:metrics");

  recordHookHit(hookId: string, eventType: string): void {
    const key = `${hookId}:${eventType}`;
    this.data.hits.set(key, (this.data.hits.get(key) ?? 0) + 1);
    this.data.tierDistribution.hook++;
  }

  recordHookError(hookId: string, eventType: string): void {
    const key = `${hookId}:${eventType}`;
    this.data.errors.set(key, (this.data.errors.get(key) ?? 0) + 1);
  }

  recordMatchDuration(hookId: string, durationMs: number): void {
    const arr = this.data.matchDurations.get(hookId) ?? [];
    arr.push(durationMs);
    if (arr.length > 1000) arr.shift(); // Rolling window
    this.data.matchDurations.set(hookId, arr);
  }

  recordHandleDuration(hookId: string, durationMs: number): void {
    const arr = this.data.handleDurations.get(hookId) ?? [];
    arr.push(durationMs);
    if (arr.length > 1000) arr.shift();
    this.data.handleDurations.set(hookId, arr);
  }

  /** Snapshot for dashboard / health endpoint */
  getSnapshot(): MetricsSnapshot {
    return {
      tierDistribution: { ...this.data.tierDistribution },
      hookHitCounts: Object.fromEntries(this.data.hits),
      hookErrorCounts: Object.fromEntries(this.data.errors),
      hookLatencies: Object.fromEntries(
        [...this.data.handleDurations.entries()].map(([k, v]) => [k, {
          p50: percentile(v, 50),
          p95: percentile(v, 95),
          p99: percentile(v, 99),
        }])
      ),
    };
  }
}
```

### 7.3 Dashboard Integration

Add a "Hook Analytics" panel to the dashboard:
- Real-time hook hit/miss/error counts
- Tier distribution pie chart (Hook vs Skill vs Deep)
- Hook latency histogram
- Evolution timeline (when hooks/skills/subagents were created)
- Evolution log viewer (`evolution-log.jsonl`)

API endpoints:
```
GET /api/hooks/metrics          -- current metrics snapshot
GET /api/hooks/evolution-log    -- evolution log entries
```

---

## 8. Validation Plan

### 8.1 Unit Tests (`packages/hooks/`)

| Test | Description |
|------|-------------|
| `HookEngine.loadHook` | Loads a valid hook file, verifies match/handle are callable |
| `HookEngine.loadHook` (invalid) | Loads a file with missing exports, verifies graceful skip |
| `HookEngine.processEvent` (match) | Verifies first-match-wins behavior |
| `HookEngine.processEvent` (no match) | Returns false when no hook matches |
| `HookEngine.processEvent` (error) | Hook throws during handle, logged, other hooks still work |
| `HookEngine.processEvent` (timeout) | Hook exceeds timeout, properly cancelled |
| `HookContext.spawn` | Verifies worker spawn via ProcessController |
| `HookContext.queue` | Verifies event re-enqueueing |
| `HookMetrics` | Verifies metric recording and snapshot |

### 8.2 Integration Tests

| Test | Description |
|------|-------------|
| Hot-reload | Write new hook file to disk, verify engine picks it up within 1s |
| Hot-reload (delete) | Delete hook file, verify engine unloads it |
| Hot-reload (modify) | Modify hook file, verify engine reloads updated version |
| End-to-end hook | Send MeegoEvent through pipeline, verify hook intercepts before handler |
| Fallthrough | Send event that no hook matches, verify it reaches existing handlers |
| Preset hooks | Each of the 5 preset hooks runs against sample events |

### 8.3 Self-Evolution Validation

Manual verification with the Coordinator:
1. Run Coordinator and send 3+ identical `issue.assigned` events manually
2. Prompt Coordinator: "You have handled issue.assigned events identically 5 times. Consider self-evolving."
3. Verify Coordinator creates a hook file in `~/.teamsland/coordinator/hooks/`
4. Verify server hot-reloads the new hook
5. Send another `issue.assigned` event, verify it is now handled by the hook (zero LLM)
6. Check `evolution-log.jsonl` for the evolution entry

---

## 9. Risk Analysis

### 9.1 Code Quality of Auto-Generated Hooks

**Risk:** The Coordinator writes hook TypeScript files using Claude's Write tool. The generated code may have bugs, security issues, or fail to compile.

**Mitigations:**
1. **Strict template.** The self-evolve Skill provides an exact template. Claude fills in the blanks rather than writing from scratch.
2. **Validation on load.** `HookEngine.loadHook` validates the module shape (exports `match` and `handle` with correct types). Malformed hooks are rejected with an error log.
3. **Sandboxed execution.** Hooks run within the server process but with a timeout. A runaway hook is killed after the timeout.
4. **Type checking.** Add a `PostToolUse` Claude Code native hook in the Coordinator's `settings.json` that runs `bun --bun tsc --noEmit` on any `.ts` file written to the hooks directory. If type-checking fails, the hook blocks the Write and feeds back the error.
5. **Evolution log audit.** All auto-generated artifacts are logged. Periodically review `evolution-log.jsonl` to catch questionable decisions.
6. **Human review gate (optional).** For production deployments, add a config flag `hooks.requireApproval: true` that stages new hooks in a `hooks-pending/` directory and notifies the admin via Lark for approval before moving to `hooks/`.

### 9.2 Malicious Cycle / Runaway Evolution

**Risk:** The Coordinator creates a hook that generates events that trigger more hooks, causing an infinite loop.

**Mitigations:**
1. **No event emission from hooks by default.** Hooks can only send notifications or spawn workers. The `ctx.queue.enqueue` is available but the self-evolve Skill explicitly warns against creating hooks that enqueue events.
2. **Loop detection.** The engine tracks event provenance. If an event has been through the hook layer more than 3 times (via a `_hookDepth` counter on the event payload), it skips hooks entirely and goes to the queue.
3. **Rate limiting per hook.** Each hook has a configurable rate limit (default: 100 executions per minute). Exceeding the limit disables the hook until the next minute window.
4. **Circuit breaker.** If a hook's error rate exceeds 50% in a 5-minute window, it is automatically disabled and an alert is sent.

### 9.3 Premature Automation

**Risk:** The Coordinator creates a hook after only seeing 2-3 instances of a pattern, but the pattern wasn't actually stable. The hook then mishandles edge cases.

**Mitigations:**
1. **Minimum pattern count.** The self-evolve Skill requires 3+ identical handling decisions before creating a hook. This is a soft constraint enforced by the Skill instructions.
2. **Shadow mode.** New hooks can run in shadow mode for the first N events: the hook executes but the event is ALSO passed to the regular pipeline. If the hook's action differs from the Coordinator's decision, an alert is raised.
3. **Easy rollback.** Deleting a hook file immediately unloads it (hot-reload). The Coordinator can also be instructed to delete hooks that aren't working.

### 9.4 Bun Dynamic Import Limitations

**Risk:** Bun's `import()` may not reliably bust module cache, or may have issues with TypeScript files in user directories.

**Mitigations:**
1. **Timestamp query parameter.** The `?t=${Date.now()}` trick works in Bun for cache busting.
2. **Fallback to compilation.** If direct `.ts` import fails, pre-compile hooks to `.js` using `bun build` before importing.
3. **Integration test.** Dedicated test that modifies a hook file and verifies the engine loads the new version.

### 9.5 Security: Hook File Injection

**Risk:** If someone gains write access to `~/.teamsland/coordinator/hooks/`, they can execute arbitrary code in the server process.

**Mitigations:**
1. **File permissions.** The hooks directory should be owned by the user running teamsland, with `700` permissions.
2. **No network access in hooks.** Hooks should only use the injected `ctx` tools, not `fetch` or raw network. Enforce via code review or lint rules.
3. **Scope restriction.** The HookContext deliberately does NOT expose: database handles, raw file system access, or process management beyond `ctx.spawn`. A hook cannot directly modify teamsland internals.

### 9.6 Performance: Match Overhead on High-Volume Events

**Risk:** If there are many hooks and many events, running `match()` for every hook on every event adds latency.

**Mitigations:**
1. **Pre-filter by event type.** Build an index: `Map<MeegoEventType, LoadedHook[]>`. For each event, only evaluate hooks registered for that event type. This reduces the match loop from O(all hooks) to O(hooks for this type).
2. **Match must be synchronous and fast.** The Skill template enforces this rule. Hooks with slow `match` are logged with a warning.
3. **Benchmark.** Target: 1000 hooks evaluated against 1 event in < 1ms.

---

## 10. Package Structure and File Inventory

### New package: `packages/hooks/`

```
packages/hooks/
  |- package.json
  |- src/
  |    |- index.ts               -- barrel exports
  |    |- types.ts               -- HookModule, HookContext, HookMetrics interfaces
  |    |- engine.ts              -- HookEngine class (load, watch, match, execute)
  |    |- context.ts             -- buildHookContext factory
  |    |- metrics.ts             -- HookMetricsCollector
  |    |- validation.ts          -- isValidHookModule type guard
  |    +- __tests__/
  |         |- engine.test.ts
  |         |- metrics.test.ts
  |         +- fixtures/
  |              |- valid-hook.ts
  |              |- invalid-hook.ts
  |              +- slow-hook.ts
  +- tsconfig.json
```

### Modified files

| File | Change |
|------|--------|
| `apps/server/src/main.ts` | Add HookEngine initialization (step 19.5), intercept events before PersistentQueue enqueue |
| `apps/server/src/dashboard.ts` | Add `/api/hooks/status` and `/api/hooks/metrics` endpoints |
| `packages/types/src/index.ts` | Re-export new hook-related types if shared |
| `config/config.json` | Add `hooks` section (hooksDir, multiMatch, requireApproval, etc.) |

### New files in coordinator workspace

| File | Purpose |
|------|---------|
| `~/.teamsland/coordinator/hooks/meego/issue-assigned.ts` | Preset hook |
| `~/.teamsland/coordinator/hooks/meego/sprint-started.ts` | Preset hook |
| `~/.teamsland/coordinator/hooks/ci/build-failed.ts` | Preset hook |
| `~/.teamsland/coordinator/hooks/meego/auto-spawn-frontend.ts` | Preset hook |
| `~/.teamsland/coordinator/hooks/lark/keyword-reply.ts` | Preset hook |
| `~/.teamsland/coordinator/.claude/skills/self-evolve/SKILL.md` | Evolution skill |
| `~/.teamsland/coordinator/evolution-log.jsonl` | Evolution audit log |

---

## 11. Implementation Order

1. **packages/hooks: types + engine core** -- HookModule interface, HookEngine class with load/match/execute
2. **packages/hooks: hot-reload** -- File watcher, cache busting, error isolation
3. **packages/hooks: HookContext + metrics** -- Context factory, metrics collector
4. **apps/server integration** -- Wire HookEngine into main.ts, intercept events before PersistentQueue
5. **Dashboard endpoints** -- /api/hooks/status, /api/hooks/metrics
6. **Preset hooks** -- Deploy 5 preset hooks to coordinator workspace
7. **Self-evolve Skill** -- Write and deploy SKILL.md
8. **Tests** -- Unit tests for engine, integration tests for hot-reload, end-to-end tests
9. **Evolution validation** -- Manual test of Coordinator self-evolution flow

Estimated effort: 3-5 days for an experienced developer familiar with the codebase.
