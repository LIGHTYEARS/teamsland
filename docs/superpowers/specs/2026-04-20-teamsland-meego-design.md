# @teamsland/meego Design Spec

> **TL;DR**: Meego 事件摄入与人工确认工作流 — SQLite 幂等去重 + webhook/poll/长连接三模式 + Lark DM 提醒轮询。3 个核心类，5 个源文件，依赖注入保障可测试性。

---

## 目录

- [概述](#概述)
- [依赖关系](#依赖关系)
- [文件结构](#文件结构)
- [配置字段（config.json）](#配置字段configjson)
- [MeegoEventBus](#meegoeventbus)
- [MeegoConnector](#meegoconnector)
- [ConfirmationWatcher](#confirmationwatcher)
- [Barrel Exports](#barrel-exports)
- [测试策略](#测试策略)
- [约束与限制](#约束与限制)

---

## 概述

`@teamsland/meego` 负责 Meego 项目管理平台的事件摄入与人工确认工作流。它是整个系统的外部数据入口之一，将 Meego 事件转化为内部可处理的结构化数据，并在高风险操作前发起人工确认闭环。

**核心能力：**
- 基于 `bun:sqlite` 的 `seen_events` 表实现崩溃安全的事件幂等去重
- 支持 webhook / poll / both 三种事件接入模式，运行时按配置选择
- 长连接模式（EventSource-like）支持指数退避自动重连
- `ConfirmationWatcher` 通过 `@teamsland/lark` 向责任人发送飞书私信提醒，最多发 `maxReminders` 次后返回 `"timeout"`

---

## 依赖关系

```
@teamsland/types          — MeegoEvent, MeegoEventType, EventHandler, MeegoConfig, ConfirmationConfig
@teamsland/lark           — LarkNotifier（ConfirmationWatcher DM 提醒）
@teamsland/session        — 仅 package.json 中声明（monorepo 构建顺序），无直接代码依赖
@teamsland/observability  — createLogger（结构化日志）
```

**package.json 新增依赖：** 无（全部为 workspace 依赖）

---

## 文件结构

```
packages/meego/src/
├── event-bus.ts          # MeegoEventBus — SQLite 去重 + handler 调度
├── connector.ts          # MeegoConnector — webhook / poll / 长连接三模式
├── confirmation.ts       # ConfirmationWatcher — 确认状态轮询 + Lark DM 提醒
├── index.ts              # Barrel re-exports
└── __tests__/
    ├── event-bus.test.ts
    ├── connector.test.ts
    └── confirmation.test.ts
```

---

## 配置字段（config.json）

`@teamsland/meego` 消费 `config/config.json` 中的以下字段：

```json
{
  "meego": {
    "spaces": [
      { "spaceId": "xxx", "name": "开放平台前端" }
    ],
    "eventMode": "both",
    "webhook": {
      "host": "0.0.0.0",
      "port": 8080,
      "path": "/meego/webhook"
    },
    "poll": {
      "intervalSeconds": 60,
      "lookbackMinutes": 5
    },
    "longConnection": {
      "enabled": true,
      "reconnectIntervalSeconds": 10
    }
  },
  "confirmation": {
    "reminderIntervalMin": 30,
    "maxReminders": 3,
    "pollIntervalMs": 60000
  }
}
```

配置类型定义均已在 `@teamsland/types` 的 `config.ts` 中声明：`MeegoConfig`、`ConfirmationConfig`。

---

## MeegoEventBus

```typescript
// packages/meego/src/event-bus.ts

import type { Database } from "bun:sqlite";
import type { MeegoEvent, MeegoEventType, EventHandler } from "@teamsland/types";

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
  constructor(db: Database)

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
  on(eventType: MeegoEventType, handler: EventHandler): void

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
  async handle(event: MeegoEvent): Promise<void>

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
  sweepSeenEvents(maxAgeMs?: number): void
}
```

**`seen_events` 表 DDL：**

```sql
CREATE TABLE IF NOT EXISTS seen_events (
  event_id   TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL   -- Unix 毫秒
);
```

**`handle()` 实现细节：**
1. `SELECT 1 FROM seen_events WHERE event_id = ?` — 若有结果则 `logger.debug("duplicate event, skipping")` 后返回
2. `INSERT INTO seen_events (event_id, created_at) VALUES (?, ?)` — `created_at` 用 `Date.now()`
3. 查找 `handlers.get(event.type)` — 若为 undefined 则 `logger.warn("no handlers for event type", { type: event.type })` 后返回
4. `for...of` 串行调用每个 handler 的 `process(event)`，单个 handler 抛出时 catch 记录错误，不中断后续 handler

---

## MeegoConnector

```typescript
// packages/meego/src/connector.ts

import type { MeegoConfig } from "@teamsland/types";
import type { MeegoEventBus } from "./event-bus.js";

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
   */
  constructor(opts: { config: MeegoConfig; eventBus: MeegoEventBus })

  /**
   * 启动事件接收
   *
   * 根据 `config.eventMode` 并发启动对应模式，所有模式共用同一 `signal` 控制停止。
   * `signal` 触发时，webhook 服务器关闭，poll timer 清除，长连接 EventSource 关闭。
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
  async start(signal?: AbortSignal): Promise<void>

  /**
   * 启动 Webhook 模式（私有）
   *
   * 使用 `Bun.serve` 在 `config.webhook.host:port` 监听 HTTP POST 请求。
   * 校验 Content-Type 为 `application/json`，解析 body 为 `MeegoEvent`，
   * 调用 `eventBus.handle(event)`，返回 `200 OK`。
   * 非 POST 请求返回 `405 Method Not Allowed`。
   * JSON 解析失败返回 `400 Bad Request`。
   *
   * @param signal - AbortSignal，触发时关闭 Bun.serve 服务器
   */
  private startWebhook(signal?: AbortSignal): void

  /**
   * 启动轮询模式（私有）
   *
   * 使用 `setInterval` 每 `config.poll.intervalSeconds * 1000` 毫秒执行一次拉取。
   * 每次拉取调用占位 fetch 请求获取近 `lookbackMinutes` 分钟的事件列表，
   * 逐条调用 `eventBus.handle(event)`。
   * signal 触发时清除 interval。
   *
   * @param signal - AbortSignal，触发时清除 setInterval
   */
  private startPoll(signal?: AbortSignal): void

  /**
   * 启动长连接模式（私有）
   *
   * 实现 EventSource-like 长连接，支持指数退避重连。
   * 连接断开时按 `reconnectIntervalSeconds * 2^retryCount`（最大 300s）等待后重连。
   * signal 触发时终止重连循环。
   *
   * @param signal - AbortSignal，触发时终止重连循环
   */
  private startLongConnection(signal?: AbortSignal): void
}
```

**`start()` 调度逻辑：**

```typescript
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
```

**Webhook 服务器结构：**

```typescript
private startWebhook(signal?: AbortSignal): void {
  const { host, port, path } = this.config.webhook;
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: async (req) => {
      if (req.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (req.url !== `http://${host}:${port}${path}`) {
        return new Response("Not Found", { status: 404 });
      }
      let event: MeegoEvent;
      try {
        event = (await req.json()) as MeegoEvent;
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      await this.eventBus.handle(event);
      return new Response("OK", { status: 200 });
    },
  });
  signal?.addEventListener("abort", () => server.stop());
  logger.info("webhook server started", { host, port, path });
}
```

**长连接指数退避参数：**

| 参数 | 值 |
|------|----|
| 初始等待 | `reconnectIntervalSeconds` 秒 |
| 每次翻倍上限 | 300 秒 |
| 重试计数 | `Math.min(retryCount, 8)` 防止溢出 |

---

## ConfirmationWatcher

```typescript
// packages/meego/src/confirmation.ts

import type { LarkNotifier } from "@teamsland/lark";
import type { ConfirmationConfig } from "@teamsland/types";

/**
 * 人工确认监视器
 *
 * 对指定 taskId 发起确认轮询，并按配置的间隔通过飞书私信提醒责任人。
 * 最多发送 `maxReminders` 次提醒，超过后返回 `"timeout"`。
 *
 * 确认状态通过占位函数 `fetchConfirmationStatus(taskId)` 查询，
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
   */
  constructor(opts: { notifier: LarkNotifier; config: ConfirmationConfig })

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
  async watch(
    taskId: string,
    userId: string,
  ): Promise<"approved" | "rejected" | "timeout">
}
```

**`watch()` 提醒调度逻辑：**

```
pollsPerReminder = Math.ceil((reminderIntervalMin * 60 * 1000) / pollIntervalMs)

循环：
  pollCount = 0
  remindersSent = 0

  while (true):
    status = await fetchConfirmationStatus(taskId)
    if status === "approved" || status === "rejected":
      return status

    pollCount++

    if pollCount % pollsPerReminder === 0:
      if remindersSent >= maxReminders:
        return "timeout"
      await notifier.sendDm(userId, reminderMessage(taskId, remindersSent + 1))
      remindersSent++

    await sleep(pollIntervalMs)
```

**提醒消息格式示例（`reminderMessage`）：**

```
[第 N 次提醒] 任务 {taskId} 等待您确认，请尽快处理。
```

**`fetchConfirmationStatus()` 说明：**

当前版本为占位实现，始终返回 `"pending"`（等待外部系统集成时替换）。签名为：

```typescript
async function fetchConfirmationStatus(
  taskId: string,
): Promise<"approved" | "rejected" | "pending">
```

---

## Barrel Exports

```typescript
// packages/meego/src/index.ts

// @teamsland/meego — Meego 事件摄入与人工确认工作流
// 提供：MeegoEventBus（去重调度）、MeegoConnector（三模式接入）、ConfirmationWatcher（确认提醒）

export { MeegoEventBus } from "./event-bus.js";
export { MeegoConnector } from "./connector.js";
export { ConfirmationWatcher } from "./confirmation.js";
```

---

## 测试策略

### 测试工具

- **真实 bun:sqlite 内存库** — `new Database(":memory:")`，无需 mock，直接验证 DDL 和幂等逻辑
- **MockLarkNotifier** — 实现 `{ sendDm: vi.fn() }` 替换真实飞书调用
- **FakeTimer** — `vi.useFakeTimers()` 控制 poll 间隔和提醒时间推进
- **AbortController** — 测试结束时调用 `controller.abort()` 清理 server 和 interval

### 各文件测试重点

| 文件 | 测试策略 | 需要外部服务 |
|------|----------|-------------|
| `event-bus.test.ts` | 真实内存 SQLite，测试去重/调度/sweep | 否 |
| `connector.test.ts` | HTTP fetch 测试 webhook；FakeTimer 测试 poll；AbortController 测试停止 | 否 |
| `confirmation.test.ts` | MockLarkNotifier + FakeTimer，测试提醒周期/超时/提前确认 | 否 |

### MeegoEventBus 测试用例

```typescript
// packages/meego/src/__tests__/event-bus.test.ts

import { describe, it, expect, vi } from "vitest";
import { Database } from "bun:sqlite";
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
    const processFn = vi.fn();
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-001"));
    expect(processFn).toHaveBeenCalledOnce();
  });

  it("重复 eventId 不应重复调用 handler（幂等）", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn();
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

  it("sweepSeenEvents 应清除超时记录", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn();
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-old"));
    bus.sweepSeenEvents(0); // maxAgeMs=0 清除所有记录

    // 清除后同一事件可重新处理
    await bus.handle(makeEvent("evt-old"));
    expect(processFn).toHaveBeenCalledTimes(2);
  });
});
```

### MeegoConnector 测试用例

```typescript
// packages/meego/src/__tests__/connector.test.ts

import { describe, it, expect, vi, afterEach } from "vitest";
import { Database } from "bun:sqlite";
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
        eventId: "e1", issueId: "I-1", projectKey: "FE",
        type: "issue.created", payload: {}, timestamp: Date.now(),
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
});

describe("MeegoConnector — poll 模式", () => {
  it("启动后应按 intervalSeconds 触发轮询", () => {
    vi.useFakeTimers();
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const config: MeegoConfig = {
      ...makeConfig(18082),
      eventMode: "poll",
    };
    const ac = new AbortController();
    const connector = new MeegoConnector({ config, eventBus: bus });
    const pollSpy = vi.spyOn(connector as never, "startPoll");
    connector.start(ac.signal);
    expect(pollSpy).toHaveBeenCalledOnce();
    vi.useRealTimers();
    ac.abort();
  });
});
```

### ConfirmationWatcher 测试用例

```typescript
// packages/meego/src/__tests__/confirmation.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

  it("确认状态变为 approved 时立即返回 approved", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    // fetchConfirmationStatus 首次返回 approved
    vi.spyOn(watcher as never, "fetchConfirmationStatus")
      .mockResolvedValue("approved");

    const result = await watcher.watch("task-001", "user_001");
    expect(result).toBe("approved");
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("达到 maxReminders 次提醒后超时返回 timeout", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus")
      .mockResolvedValue("pending");

    const watchPromise = watcher.watch("task-002", "user_002");
    // 推进时间触发 maxReminders 次提醒
    await vi.runAllTimersAsync();
    const result = await watchPromise;
    expect(result).toBe("timeout");
    expect(sendDm).toHaveBeenCalledTimes(2);
  });

  it("rejected 状态立即返回 rejected", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus")
      .mockResolvedValue("rejected");

    const result = await watcher.watch("task-003", "user_003");
    expect(result).toBe("rejected");
  });
});
```

### 运行命令

```bash
# 需要 bun 运行时（bun:sqlite）
bunx --bun vitest run packages/meego/
```

---

## 约束与限制

1. **seen_events 不跨重启共享** — 默认传入内存库时（测试场景），重启后去重状态丢失。生产环境必须传入持久化文件路径的 `Database` 实例。

2. **`fetchConfirmationStatus` 为占位实现** — 当前版本始终返回 `"pending"`。接入真实 Meego API 时需替换此函数，签名保持不变。

3. **Webhook 事件校验弱** — 当前实现仅验证 JSON 格式，未校验 Meego 签名头。生产接入时需在 `startWebhook()` 中增加 HMAC 签名验证逻辑。

4. **poll 模式 fetch 为占位** — `startPoll()` 的 Meego API 调用需替换为真实 Meego REST API 端点，当前为占位 fetch，实际不发出请求。

5. **长连接无消息帧解析** — `startLongConnection()` 实现了重连循环骨架，但 SSE 消息帧解析（`data:` 行提取）需在接入真实 Meego 长连接 endpoint 后补充。

6. **ConfirmationWatcher 无并发保护** — 同一 `taskId` 不应同时被多个 `watch()` 调用监听。调用方需在应用层保证互斥（例如 task 状态机约束）。

7. **`startPoll()` 的 interval 泄漏** — 若 `start()` 在 `signal` 未传入时被调用，poll timer 将持续运行直到进程退出。生产环境应始终传入 `AbortSignal`。
