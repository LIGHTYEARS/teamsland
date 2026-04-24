# @teamsland/meego Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the `@teamsland/meego` package — Meego 事件摄入与人工确认工作流。Provides `MeegoEventBus` (SQLite 幂等去重 + handler 调度), `MeegoConnector` (webhook/poll/长连接三模式), and `ConfirmationWatcher` (Lark DM 提醒轮询) as the public API.

**Architecture:** Four source files: `event-bus.ts` (MeegoEventBus — bun:sqlite seen_events dedup), `connector.ts` (MeegoConnector — Bun.serve webhook + setInterval poll + exponential backoff long-connection), `confirmation.ts` (ConfirmationWatcher — polling loop with Lark DM reminder), `index.ts` (barrel re-exports). Dependency injection throughout for testability — no real Meego API calls required in tests.

**Tech Stack:** TypeScript (strict), Bun, bun:sqlite, Bun.serve (webhook), Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/meego` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` already has dependencies on `@teamsland/types`, `@teamsland/lark`, and `@teamsland/session`. The tsconfig references `../types`, `../lark`, and `../session`. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-meego-design.md`.

**Testing approach:** Tests use real bun:sqlite in-memory databases (no mocking needed for SQLite), real HTTP fetch with unique ports for webhook tests, `vi.useFakeTimers()` for time-dependent tests, and `vi.fn()` for LarkNotifier. All tests run under the Bun runtime.

**`fetchConfirmationStatus` constraint:** The current version is a placeholder that always returns `"pending"`. Tests mock this private method via `vi.spyOn(watcher as never, "fetchConfirmationStatus")` to simulate approved/rejected/pending states.

**Webhook URL matching:** The webhook server compares `req.url` against the full URL including host+port+path. In tests, use `127.0.0.1` as host (not `0.0.0.0`) so the URL match works correctly.

## Critical Files

- **Modify:** `packages/meego/package.json` (add `@teamsland/observability` workspace dependency)
- **Create:** `packages/meego/src/event-bus.ts`
- **Create:** `packages/meego/src/connector.ts`
- **Create:** `packages/meego/src/confirmation.ts`
- **Modify:** `packages/meego/src/index.ts` (barrel exports)
- **Create:** `packages/meego/src/__tests__/event-bus.test.ts`
- **Create:** `packages/meego/src/__tests__/connector.test.ts`
- **Create:** `packages/meego/src/__tests__/confirmation.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- Logger: `createLogger("meego:event-bus")`, `createLogger("meego:connector")`, `createLogger("meego:confirmation")` — no bare `console.log`
- Run tests with: `bunx --bun vitest run packages/meego/`
- Run typecheck with: `bunx tsc --noEmit --project packages/meego/tsconfig.json`
- Run lint with: `bunx biome check packages/meego/src/`
- Commits include `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 1: Update packages/meego/package.json with observability dependency

**Files:**
- Modify: `packages/meego/package.json`

- [x] **Step 1: Add @teamsland/observability dependency**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/meego/package.json`:

```json
{
  "name": "@teamsland/meego",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/lark": "workspace:*",
    "@teamsland/session": "workspace:*",
    "@teamsland/observability": "workspace:*"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [x] **Step 2: Update tsconfig.json to add observability reference**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/meego/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"],
  "references": [
    { "path": "../types" },
    { "path": "../lark" },
    { "path": "../session" },
    { "path": "../observability" }
  ]
}
```

- [x] **Step 3: Install dependencies**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`
Expected: Resolves without errors

- [x] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/meego/package.json packages/meego/tsconfig.json bun.lockb && git commit -m "$(cat <<'EOF'
chore(meego): add @teamsland/observability workspace dependency

Required for structured logging in MeegoEventBus, MeegoConnector,
and ConfirmationWatcher — no bare console.log per project conventions.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create event-bus.ts (TDD)

**Files:**
- Create: `packages/meego/src/__tests__/event-bus.test.ts`
- Create: `packages/meego/src/event-bus.ts`

- [x] **Step 1: Create event-bus test first**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/__tests__/event-bus.test.ts`:

```typescript
import { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import { MeegoEventBus } from "../event-bus.js";
import type { MeegoEvent } from "@teamsland/types";

const makeEvent = (id: string): MeegoEvent => ({
  eventId: id,
  issueId: "ISSUE-1",
  projectKey: "FE",
  type: "issue.created",
  payload: {},
  timestamp: Date.now(),
});

describe("MeegoEventBus", () => {
  it("首次 handle 应调用 handler", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-001"));
    expect(processFn).toHaveBeenCalledOnce();
  });

  it("重复 eventId 不应重复调用 handler（幂等）", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-dup"));
    await bus.handle(makeEvent("evt-dup"));
    expect(processFn).toHaveBeenCalledOnce();
  });

  it("无 handler 的事件类型不应抛出", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    await expect(bus.handle(makeEvent("evt-003"))).resolves.toBeUndefined();
  });

  it("同一事件类型注册多个 handler，应按顺序全部调用", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const order: number[] = [];
    bus.on("issue.created", { process: vi.fn().mockImplementation(async () => { order.push(1); }) });
    bus.on("issue.created", { process: vi.fn().mockImplementation(async () => { order.push(2); }) });

    await bus.handle(makeEvent("evt-multi"));
    expect(order).toEqual([1, 2]);
  });

  it("handler 抛出错误不应中断后续 handler", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const failHandler = { process: vi.fn().mockRejectedValue(new Error("handler error")) };
    const successHandler = { process: vi.fn().mockResolvedValue(undefined) };
    bus.on("issue.created", failHandler);
    bus.on("issue.created", successHandler);

    await expect(bus.handle(makeEvent("evt-err"))).resolves.toBeUndefined();
    expect(successHandler.process).toHaveBeenCalledOnce();
  });

  it("sweepSeenEvents 应清除超时记录，允许重新处理同一事件", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-old"));
    bus.sweepSeenEvents(0); // maxAgeMs=0 清除所有记录

    // 清除后同一事件可重新处理
    await bus.handle(makeEvent("evt-old"));
    expect(processFn).toHaveBeenCalledTimes(2);
  });

  it("sweepSeenEvents 默认 1 小时内的记录不清除", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-fresh"));
    bus.sweepSeenEvents(); // 默认 1h，不应清除刚写入的记录

    await bus.handle(makeEvent("evt-fresh"));
    expect(processFn).toHaveBeenCalledOnce(); // 仍然幂等
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/event-bus.test.ts`
Expected: FAIL — `../event-bus.js` does not exist

- [x] **Step 3: Create event-bus.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/event-bus.ts`:

```typescript
import type { Database } from "bun:sqlite";
import type { EventHandler, MeegoEvent, MeegoEventType } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("meego:event-bus");

/**
 * Meego 事件总线
 *
 * 基于 bun:sqlite 实现崩溃安全的事件幂等去重，并将事件调度给已注册的处理器。
 * 使用 `seen_events` 表存储已处理的 event_id，重启后不会重复处理同一事件。
 *
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { MeegoEventBus } from "@teamsland/meego";
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * const db = new Database(":memory:");
 * const bus = new MeegoEventBus(db);
 *
 * bus.on("issue.created", {
 *   async process(event: MeegoEvent) {
 *     console.log("新 Issue:", event.issueId);
 *   },
 * });
 *
 * await bus.handle({
 *   eventId: "evt-001",
 *   issueId: "ISSUE-42",
 *   projectKey: "FE",
 *   type: "issue.created",
 *   payload: { title: "新增登录页面" },
 *   timestamp: Date.now(),
 * });
 * ```
 */
export class MeegoEventBus {
  private readonly db: Database;
  private readonly handlers: Map<MeegoEventType, EventHandler[]>;

  /**
   * 构造函数
   *
   * 接受外部传入的 `Database` 实例（便于测试注入内存库），
   * 并创建 `seen_events` 表（如不存在）。
   *
   * @param db - bun:sqlite Database 实例
   *
   * @example
   * ```typescript
   * import { Database } from "bun:sqlite";
   * const bus = new MeegoEventBus(new Database(":memory:"));
   * ```
   */
  constructor(db: Database) {
    this.db = db;
    this.handlers = new Map();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS seen_events (
        event_id   TEXT    PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);
    logger.debug("MeegoEventBus initialized");
  }

  /**
   * 注册事件处理器
   *
   * 同一事件类型可注册多个处理器，按注册顺序串行调用。
   *
   * @param eventType - 监听的事件类型
   * @param handler - 实现 EventHandler 接口的处理器
   *
   * @example
   * ```typescript
   * bus.on("issue.status_changed", {
   *   async process(event) {
   *     console.log(`Issue ${event.issueId} 状态变更`);
   *   },
   * });
   * ```
   */
  on(eventType: MeegoEventType, handler: EventHandler): void {
    const existing = this.handlers.get(eventType);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventType, [handler]);
    }
  }

  /**
   * 处理单个事件
   *
   * 流程：查询 seen_events → 若已存在则跳过 → 写入 seen_events → 调度给 handlers。
   * 若该 eventType 无注册处理器，记录 warn 日志并返回。
   *
   * @param event - 待处理的 Meego 事件
   *
   * @example
   * ```typescript
   * await bus.handle({
   *   eventId: "evt-002",
   *   issueId: "ISSUE-43",
   *   projectKey: "FE",
   *   type: "issue.assigned",
   *   payload: { assignee: "user_001" },
   *   timestamp: Date.now(),
   * });
   * ```
   */
  async handle(event: MeegoEvent): Promise<void> {
    // 幂等检查
    const row = this.db.query("SELECT 1 FROM seen_events WHERE event_id = ?").get(event.eventId);
    if (row !== null) {
      logger.debug("duplicate event, skipping", { eventId: event.eventId });
      return;
    }

    // 写入已见记录
    this.db.run("INSERT INTO seen_events (event_id, created_at) VALUES (?, ?)", [event.eventId, Date.now()]);

    // 查找处理器
    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers || eventHandlers.length === 0) {
      logger.warn("no handlers for event type", { type: event.type });
      return;
    }

    logger.debug("dispatching event", { eventId: event.eventId, type: event.type, handlerCount: eventHandlers.length });

    // 串行调用所有处理器，单个失败不中断后续
    for (const handler of eventHandlers) {
      try {
        await handler.process(event);
      } catch (err) {
        logger.error("handler error", { eventId: event.eventId, type: event.type, error: err });
      }
    }
  }

  /**
   * 清理旧的已见事件记录
   *
   * 删除 `seen_events` 中 `created_at` 早于 `(Date.now() - maxAgeMs)` 的行。
   * 建议由应用层定期调用（例如每小时一次）。
   *
   * @param maxAgeMs - 保留时间窗口（毫秒），默认 3_600_000（1 小时）
   *
   * @example
   * ```typescript
   * // 清理 2 小时前的旧记录
   * bus.sweepSeenEvents(2 * 60 * 60 * 1000);
   * ```
   */
  sweepSeenEvents(maxAgeMs = 3_600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.run("DELETE FROM seen_events WHERE created_at < ?", [cutoff]);
    logger.debug("swept seen_events", { deleted: result.changes, cutoffMs: cutoff });
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/event-bus.test.ts`
Expected: All 7 tests pass

- [x] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/meego/tsconfig.json`
Expected: No errors

- [x] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/meego/src/event-bus.ts packages/meego/src/__tests__/event-bus.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [x] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/meego/src/event-bus.ts packages/meego/src/__tests__/event-bus.test.ts && git commit -m "$(cat <<'EOF'
feat(meego): add event-bus.ts — MeegoEventBus SQLite dedup + handler dispatch

TDD: 7 tests covering first-time dispatch, idempotent dedup, missing handler,
multiple handlers in order, error isolation, sweep cleanup, and sweep retention.
Uses real bun:sqlite in-memory DB — no mocking needed.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create connector.ts (TDD)

**Files:**
- Create: `packages/meego/src/__tests__/connector.test.ts`
- Create: `packages/meego/src/connector.ts`

- [x] **Step 1: Create connector test first**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/__tests__/connector.test.ts`:

```typescript
import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeegoEventBus } from "../event-bus.js";
import { MeegoConnector } from "../connector.js";
import type { MeegoConfig } from "@teamsland/types";

const makeConfig = (port: number): MeegoConfig => ({
  spaces: [],
  eventMode: "webhook",
  webhook: { host: "127.0.0.1", port, path: "/meego/webhook" },
  poll: { intervalSeconds: 60, lookbackMinutes: 5 },
  longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
});

describe("MeegoConnector — webhook 模式", () => {
  it("POST 有效事件应返回 200 且 handle 被调用", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const handleSpy = vi.spyOn(bus, "handle");

    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18080), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18080/meego/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: "e1",
        issueId: "I-1",
        projectKey: "FE",
        type: "issue.created",
        payload: {},
        timestamp: Date.now(),
      }),
    });
    expect(resp.status).toBe(200);
    expect(handleSpy).toHaveBeenCalledOnce();
    ac.abort();
  });

  it("非 POST 请求应返回 405", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18081), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18081/meego/webhook");
    expect(resp.status).toBe(405);
    ac.abort();
  });

  it("body 为非法 JSON 应返回 400", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18082), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18082/meego/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(resp.status).toBe(400);
    ac.abort();
  });

  it("AbortController abort 后服务器停止", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18083), eventBus: bus });
    await connector.start(ac.signal);

    // 先确认服务正常
    const resp = await fetch("http://127.0.0.1:18083/meego/webhook");
    expect(resp.status).toBe(405);

    // abort 后应停止
    ac.abort();
    // 给服务器时间关闭
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 连接应被拒绝
    await expect(fetch("http://127.0.0.1:18083/meego/webhook")).rejects.toThrow();
  });
});

describe("MeegoConnector — poll 模式", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("eventMode=poll 时 startPoll 应被调用", async () => {
    vi.useFakeTimers();
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const config: MeegoConfig = {
      ...makeConfig(18084),
      eventMode: "poll",
    };
    const ac = new AbortController();
    const connector = new MeegoConnector({ config, eventBus: bus });
    const pollSpy = vi.spyOn(connector as never, "startPoll");
    await connector.start(ac.signal);
    expect(pollSpy).toHaveBeenCalledOnce();
    ac.abort();
  });

  it("eventMode=both 时 startWebhook 和 startPoll 均应被调用", async () => {
    vi.useFakeTimers();
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const config: MeegoConfig = {
      ...makeConfig(18085),
      eventMode: "both",
    };
    const ac = new AbortController();
    const connector = new MeegoConnector({ config, eventBus: bus });
    const webhookSpy = vi.spyOn(connector as never, "startWebhook");
    const pollSpy = vi.spyOn(connector as never, "startPoll");
    await connector.start(ac.signal);
    expect(webhookSpy).toHaveBeenCalledOnce();
    expect(pollSpy).toHaveBeenCalledOnce();
    ac.abort();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/connector.test.ts`
Expected: FAIL — `../connector.js` does not exist

- [x] **Step 3: Create connector.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/connector.ts`:

```typescript
import type { MeegoConfig, MeegoEvent } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";
import type { MeegoEventBus } from "./event-bus.js";

const logger = createLogger("meego:connector");

/**
 * Meego 事件连接器
 *
 * 根据 `config.eventMode` 启动一种或多种事件接收模式：
 * - `"webhook"` — 启动 Bun HTTP 服务器接收推送
 * - `"poll"` — 定时轮询 Meego API 拉取最近事件
 * - `"both"` — 同时启动 webhook 和 poll
 *
 * 长连接（`longConnection.enabled: true`）始终独立于 eventMode 运行。
 *
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { MeegoEventBus, MeegoConnector } from "@teamsland/meego";
 * import type { MeegoConfig } from "@teamsland/types";
 *
 * const db = new Database(":memory:");
 * const bus = new MeegoEventBus(db);
 * const config: MeegoConfig = {
 *   spaces: [{ spaceId: "xxx", name: "开放平台前端" }],
 *   eventMode: "webhook",
 *   webhook: { host: "0.0.0.0", port: 8080, path: "/meego/webhook" },
 *   poll: { intervalSeconds: 60, lookbackMinutes: 5 },
 *   longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
 * };
 *
 * const connector = new MeegoConnector({ config, eventBus: bus });
 * const controller = new AbortController();
 * await connector.start(controller.signal);
 *
 * // 优雅停止
 * controller.abort();
 * ```
 */
export class MeegoConnector {
  private readonly config: MeegoConfig;
  private readonly eventBus: MeegoEventBus;

  /**
   * @param opts.config - Meego 完整配置
   * @param opts.eventBus - 已构建的 MeegoEventBus 实例
   *
   * @example
   * ```typescript
   * const connector = new MeegoConnector({ config, eventBus: bus });
   * ```
   */
  constructor(opts: { config: MeegoConfig; eventBus: MeegoEventBus }) {
    this.config = opts.config;
    this.eventBus = opts.eventBus;
  }

  /**
   * 启动事件接收
   *
   * 根据 `config.eventMode` 并发启动对应模式，所有模式共用同一 `signal` 控制停止。
   * `signal` 触发时，webhook 服务器关闭，poll timer 清除，长连接循环终止。
   *
   * @param signal - 可选的 AbortSignal，用于优雅停止
   *
   * @example
   * ```typescript
   * const ac = new AbortController();
   * await connector.start(ac.signal);
   * setTimeout(() => ac.abort(), 5000); // 5 秒后停止
   * ```
   */
  async start(signal?: AbortSignal): Promise<void> {
    const { eventMode, longConnection } = this.config;

    if (eventMode === "webhook" || eventMode === "both") {
      this.startWebhook(signal);
    }
    if (eventMode === "poll" || eventMode === "both") {
      this.startPoll(signal);
    }
    if (longConnection.enabled) {
      this.startLongConnection(signal);
    }
  }

  /**
   * 启动 Webhook 模式（私有）
   *
   * 使用 `Bun.serve` 在 `config.webhook.host:port` 监听 HTTP POST 请求。
   * 校验请求方法，解析 body 为 `MeegoEvent`，调用 `eventBus.handle(event)`，返回 `200 OK`。
   * 非 POST 请求返回 `405 Method Not Allowed`；JSON 解析失败返回 `400 Bad Request`。
   *
   * @param signal - AbortSignal，触发时关闭 Bun.serve 服务器
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动
   * this.startWebhook(signal);
   * ```
   */
  private startWebhook(signal?: AbortSignal): void {
    const { host, port, path } = this.config.webhook;
    const eventBus = this.eventBus;

    const server = Bun.serve({
      hostname: host,
      port,
      fetch: async (req) => {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }

        const expectedUrl = `http://${host}:${port}${path}`;
        if (req.url !== expectedUrl) {
          return new Response("Not Found", { status: 404 });
        }

        let event: MeegoEvent;
        try {
          event = (await req.json()) as MeegoEvent;
        } catch {
          return new Response("Bad Request", { status: 400 });
        }

        await eventBus.handle(event);
        return new Response("OK", { status: 200 });
      },
    });

    signal?.addEventListener("abort", () => {
      server.stop();
      logger.info("webhook server stopped");
    });

    logger.info("webhook server started", { host, port, path });
  }

  /**
   * 启动轮询模式（私有）
   *
   * 使用 `setInterval` 每 `config.poll.intervalSeconds * 1000` 毫秒执行一次拉取。
   * 每次拉取调用占位 fetch 获取近 `lookbackMinutes` 分钟的事件列表，
   * 逐条调用 `eventBus.handle(event)`。signal 触发时清除 interval。
   *
   * @param signal - AbortSignal，触发时清除 setInterval
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动
   * this.startPoll(signal);
   * ```
   */
  private startPoll(signal?: AbortSignal): void {
    const { intervalSeconds, lookbackMinutes } = this.config.poll;
    const eventBus = this.eventBus;

    const poll = async (): Promise<void> => {
      logger.debug("poll tick", { lookbackMinutes });
      // 占位实现：真实 Meego REST API 接入时替换此处
      // const since = Date.now() - lookbackMinutes * 60 * 1000;
      // const events = await fetchMeegoEvents(since);
      // for (const event of events) { await eventBus.handle(event); }
      void lookbackMinutes;
      void eventBus;
    };

    const timer = setInterval(() => {
      poll().catch((err) => {
        logger.error("poll error", { error: err });
      });
    }, intervalSeconds * 1000);

    signal?.addEventListener("abort", () => {
      clearInterval(timer);
      logger.info("poll stopped");
    });

    logger.info("poll started", { intervalSeconds, lookbackMinutes });
  }

  /**
   * 启动长连接模式（私有）
   *
   * 实现 EventSource-like 长连接，支持指数退避重连。
   * 连接断开时按 `reconnectIntervalSeconds * 2^retryCount`（最大 300s）等待后重连。
   * signal 触发时终止重连循环。
   *
   * @param signal - AbortSignal，触发时终止重连循环
   *
   * @example
   * ```typescript
   * // 内部调用，由 start() 驱动（仅 longConnection.enabled=true 时）
   * this.startLongConnection(signal);
   * ```
   */
  private startLongConnection(signal?: AbortSignal): void {
    const { reconnectIntervalSeconds } = this.config.longConnection;

    const connect = async (): Promise<void> => {
      let retryCount = 0;

      while (true) {
        if (signal?.aborted) {
          logger.info("long-connection terminated by signal");
          return;
        }

        logger.debug("long-connection attempt", { retryCount });

        try {
          // 占位实现：真实 EventSource/SSE endpoint 接入时替换此处
          // const source = new EventSource(endpoint);
          // await waitForClose(source, signal);
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          retryCount = 0; // 成功连接后重置重试计数
        } catch (err) {
          logger.warn("long-connection error, will retry", { error: err, retryCount });
        }

        if (signal?.aborted) return;

        const cappedRetry = Math.min(retryCount, 8);
        const waitMs = Math.min(reconnectIntervalSeconds * Math.pow(2, cappedRetry), 300) * 1000;
        logger.debug("long-connection backoff", { waitMs, retryCount });
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        retryCount++;
      }
    };

    connect().catch((err) => {
      logger.error("long-connection fatal", { error: err });
    });

    logger.info("long-connection started", { reconnectIntervalSeconds });
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/connector.test.ts`
Expected: All 5 tests pass

- [x] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/meego/tsconfig.json`
Expected: No errors

- [x] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/meego/src/connector.ts packages/meego/src/__tests__/connector.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [x] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/meego/src/connector.ts packages/meego/src/__tests__/connector.test.ts && git commit -m "$(cat <<'EOF'
feat(meego): add connector.ts — MeegoConnector webhook/poll/long-connection

TDD: 5 tests covering POST 200, GET 405, bad JSON 400, AbortController stop,
poll mode invocation, and both-mode dispatch. Uses real HTTP fetch + unique
ports. Long-connection uses exponential backoff up to 300s.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create confirmation.ts (TDD)

**Files:**
- Create: `packages/meego/src/__tests__/confirmation.test.ts`
- Create: `packages/meego/src/confirmation.ts`

- [x] **Step 1: Create confirmation test first**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/__tests__/confirmation.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationWatcher } from "../confirmation.js";
import type { ConfirmationConfig } from "@teamsland/types";

const makeConfig = (): ConfirmationConfig => ({
  reminderIntervalMin: 1,
  maxReminders: 2,
  pollIntervalMs: 100,
});

describe("ConfirmationWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetchConfirmationStatus 首次返回 approved 时立即返回 approved，不发送提醒", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("approved");

    const result = await watcher.watch("task-001", "user_001");
    expect(result).toBe("approved");
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("fetchConfirmationStatus 首次返回 rejected 时立即返回 rejected", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("rejected");

    const result = await watcher.watch("task-002", "user_002");
    expect(result).toBe("rejected");
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("达到 maxReminders 次提醒后仍为 pending 时返回 timeout", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("pending");

    const watchPromise = watcher.watch("task-003", "user_003");
    await vi.runAllTimersAsync();
    const result = await watchPromise;
    expect(result).toBe("timeout");
    expect(sendDm).toHaveBeenCalledTimes(2); // maxReminders=2
  });

  it("提醒消息包含任务 ID 和提醒次数", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("pending");

    const watchPromise = watcher.watch("task-004", "user_004");
    await vi.runAllTimersAsync();
    await watchPromise;

    // 第一次提醒应包含任务 ID
    const firstCall = sendDm.mock.calls[0];
    expect(firstCall[0]).toBe("user_004");
    expect(firstCall[1]).toContain("task-004");
    expect(firstCall[1]).toContain("1");
  });

  it("在第 2 次提醒后 poll 到 approved 时正常返回 approved", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const config: ConfirmationConfig = {
      reminderIntervalMin: 1,
      maxReminders: 3,   // 3 次提醒机会
      pollIntervalMs: 100,
    };
    const watcher = new ConfirmationWatcher({ notifier, config });

    // pending → pending → ... → approved（在若干 poll 后）
    let callCount = 0;
    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockImplementation(async () => {
      callCount++;
      // pollsPerReminder = ceil(1 * 60 * 1000 / 100) = 600
      // 在第 601 次 poll（第 1 次提醒后第 1 次 poll）返回 approved
      if (callCount > 601) return "approved";
      return "pending";
    });

    const watchPromise = watcher.watch("task-005", "user_005");
    await vi.runAllTimersAsync();
    const result = await watchPromise;
    expect(result).toBe("approved");
    expect(sendDm).toHaveBeenCalledTimes(1); // 只发了 1 次提醒
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/confirmation.test.ts`
Expected: FAIL — `../confirmation.js` does not exist

- [x] **Step 3: Create confirmation.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/meego/src/confirmation.ts`:

```typescript
import type { LarkNotifier } from "@teamsland/lark";
import type { ConfirmationConfig } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("meego:confirmation");

/**
 * 构建提醒消息文本
 *
 * @param taskId - 任务 ID
 * @param reminderNumber - 当前是第几次提醒
 * @returns 格式化的提醒消息
 */
function reminderMessage(taskId: string, reminderNumber: number): string {
  return `[第 ${reminderNumber} 次提醒] 任务 ${taskId} 等待您确认，请尽快处理。`;
}

/**
 * 查询确认状态（占位实现）
 *
 * 当前版本始终返回 `"pending"`，接入真实 Meego API 时替换。
 *
 * @param taskId - 任务 ID
 * @returns 确认状态
 */
async function fetchConfirmationStatus(
  taskId: string,
): Promise<"approved" | "rejected" | "pending"> {
  // 占位实现：始终返回 pending，等待真实 API 接入时替换
  void taskId;
  return "pending";
}

/**
 * 人工确认监视器
 *
 * 对指定 taskId 发起确认轮询，并按配置的间隔通过飞书私信提醒责任人。
 * 最多发送 `maxReminders` 次提醒，超过后返回 `"timeout"`。
 *
 * 确认状态通过内部 `fetchConfirmationStatus(taskId)` 查询，
 * 返回 `"approved"` 或 `"rejected"` 时立即返回结果。
 *
 * @example
 * ```typescript
 * import { ConfirmationWatcher } from "@teamsland/meego";
 * import { LarkNotifier } from "@teamsland/lark";
 *
 * declare const notifier: LarkNotifier;
 * const watcher = new ConfirmationWatcher({
 *   notifier,
 *   config: { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 },
 * });
 *
 * const result = await watcher.watch("task-001", "user_abc");
 * // result: "approved" | "rejected" | "timeout"
 * console.log("确认结果:", result);
 * ```
 */
export class ConfirmationWatcher {
  private readonly notifier: LarkNotifier;
  private readonly config: ConfirmationConfig;

  /**
   * @param opts.notifier - LarkNotifier 实例（用于发送飞书私信）
   * @param opts.config - 确认流程配置
   *
   * @example
   * ```typescript
   * const watcher = new ConfirmationWatcher({ notifier, config });
   * ```
   */
  constructor(opts: { notifier: LarkNotifier; config: ConfirmationConfig }) {
    this.notifier = opts.notifier;
    this.config = opts.config;
  }

  /**
   * 监听确认结果
   *
   * 每隔 `pollIntervalMs` 毫秒查询一次确认状态。
   * 每隔 `reminderIntervalMin` 分钟（转换为 poll 轮数）发送一次飞书私信提醒。
   * 提醒次数达到 `maxReminders` 后，下一次 poll 仍未确认则返回 `"timeout"`。
   *
   * @param taskId - 待确认的任务 ID
   * @param userId - 飞书用户 ID，用于发送私信提醒
   * @returns `"approved"` | `"rejected"` | `"timeout"`
   *
   * @example
   * ```typescript
   * const outcome = await watcher.watch("task-999", "user_xyz");
   * if (outcome === "approved") {
   *   console.log("已批准，继续执行");
   * } else if (outcome === "rejected") {
   *   console.log("已拒绝，中止操作");
   * } else {
   *   console.log("超时，升级处理");
   * }
   * ```
   */
  async watch(taskId: string, userId: string): Promise<"approved" | "rejected" | "timeout"> {
    const { reminderIntervalMin, maxReminders, pollIntervalMs } = this.config;
    const pollsPerReminder = Math.ceil((reminderIntervalMin * 60 * 1000) / pollIntervalMs);

    let pollCount = 0;
    let remindersSent = 0;

    logger.info("watching confirmation", { taskId, userId, maxReminders, pollsPerReminder });

    while (true) {
      const status = await this.fetchConfirmationStatus(taskId);

      if (status === "approved" || status === "rejected") {
        logger.info("confirmation resolved", { taskId, status, pollCount, remindersSent });
        return status;
      }

      pollCount++;

      if (pollCount % pollsPerReminder === 0) {
        if (remindersSent >= maxReminders) {
          logger.warn("confirmation timeout", { taskId, maxReminders, pollCount });
          return "timeout";
        }

        const msg = reminderMessage(taskId, remindersSent + 1);
        await this.notifier.sendDm(userId, msg);
        remindersSent++;
        logger.debug("reminder sent", { taskId, userId, remindersSent });
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * 查询确认状态（可在测试中 mock 此方法）
   *
   * @param taskId - 任务 ID
   * @returns 确认状态
   */
  private async fetchConfirmationStatus(
    taskId: string,
  ): Promise<"approved" | "rejected" | "pending"> {
    return fetchConfirmationStatus(taskId);
  }
}
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/src/__tests__/confirmation.test.ts`
Expected: All 5 tests pass

- [x] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/meego/tsconfig.json`
Expected: No errors

- [x] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/meego/src/confirmation.ts packages/meego/src/__tests__/confirmation.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [x] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/meego/src/confirmation.ts packages/meego/src/__tests__/confirmation.test.ts && git commit -m "$(cat <<'EOF'
feat(meego): add confirmation.ts — ConfirmationWatcher polling + Lark DM reminders

TDD: 5 tests covering approved/rejected immediate return, timeout after
maxReminders, reminder message format, and mid-sequence approval.
Uses vi.useFakeTimers() + mock LarkNotifier — no real Lark API calls.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Update barrel exports in index.ts

**Files:**
- Modify: `packages/meego/src/index.ts`

- [x] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/meego/src/index.ts`:

```typescript
// @teamsland/meego — Meego 事件摄入与人工确认工作流
// 提供：MeegoEventBus（去重调度）、MeegoConnector（三模式接入）、ConfirmationWatcher（确认提醒）

export { MeegoEventBus } from "./event-bus.js";
export { MeegoConnector } from "./connector.js";
export { ConfirmationWatcher } from "./confirmation.js";
```

- [x] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/meego/tsconfig.json`
Expected: No errors

- [x] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/meego/src/index.ts`
Expected: No errors

- [x] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/meego/src/index.ts && git commit -m "$(cat <<'EOF'
feat(meego): add barrel exports — MeegoEventBus, MeegoConnector, ConfirmationWatcher

Public API surface for @teamsland/meego package.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full Verification

- [x] **Step 1: Run all meego tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/meego/`
Expected: All tests pass (event-bus: 7, connector: 5, confirmation: 5 — total 17)

- [x] **Step 2: Run typecheck for meego package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/meego/tsconfig.json`
Expected: No errors

- [x] **Step 3: Run lint on entire meego package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/meego/src/`
Expected: No errors

- [x] **Step 4: Verify exported API surface**

Run:
```bash
cd /Users/bytedance/workspace/teamsland && bun -e "
import {
  MeegoEventBus,
  MeegoConnector,
  ConfirmationWatcher,
} from './packages/meego/src/index.ts';
console.log('MeegoEventBus:', typeof MeegoEventBus);
console.log('MeegoConnector:', typeof MeegoConnector);
console.log('ConfirmationWatcher:', typeof ConfirmationWatcher);
"
```
Expected:
```
MeegoEventBus: function
MeegoConnector: function
ConfirmationWatcher: function
```

- [x] **Step 5: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/meego/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output (or only in catch clauses like `catch (err: unknown)`)

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/meego/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No non-null assertions

- [x] **Step 6: Verify file count**

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/meego/src/*.ts | wc -l`
Expected: 4 (event-bus, connector, confirmation, index)

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/meego/src/__tests__/*.test.ts | wc -l`
Expected: 3 test files

- [x] **Step 7: Verify no bare console.log**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn 'console\.' packages/meego/src/ --include='*.ts' | grep -v '__tests__'`
Expected: No output (all logging via createLogger)

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/meego/` — all 17 tests pass
2. `bunx tsc --noEmit --project packages/meego/tsconfig.json` — exits 0
3. `bunx biome check packages/meego/src/` — no errors
4. All exported classes have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. All 3 exports from barrel: `MeegoEventBus`, `MeegoConnector`, `ConfirmationWatcher`
7. `MeegoEventBus`: bun:sqlite `seen_events` table, idempotent dedup, multi-handler dispatch, error isolation, `sweepSeenEvents()`
8. `MeegoConnector`: Bun.serve webhook (200/405/400), setInterval poll, exponential backoff long-connection, AbortController stop
9. `ConfirmationWatcher`: polling loop with `pollsPerReminder`, Lark DM reminders up to `maxReminders`, returns `"approved"` | `"rejected"` | `"timeout"`
10. `fetchConfirmationStatus` is a private method (mockable via `vi.spyOn`) wrapping the module-level placeholder
11. All logging via `createLogger("meego:*")` — no bare `console.log`
12. Webhook tests use real HTTP fetch + unique ports per test group
13. Confirmation tests use `vi.useFakeTimers()` + mock `LarkNotifier.sendDm`
