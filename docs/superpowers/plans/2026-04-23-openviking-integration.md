# Phase 3: OpenViking 集成实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace teamsland's self-built memory layer (sqlite-vec + node-llama-cpp) with OpenViking REST API, using ByteDance Ark for embedding/VLM.

**Architecture:** OpenViking runs as an external service (managed: false). teamsland connects via HTTP client with heartbeat-based health monitoring. Unhealthy → auto-degrade to NullVikingMemoryClient. Coordinator context loading, worker writeback, and a viking-manage skill all route through VikingMemoryClient.

**Tech Stack:** Bun, TypeScript strict, Vitest, OpenViking REST API, ByteDance Ark (volcengine) embedding/VLM

**Spec:** `docs/superpowers/specs/2026-04-23-openviking-integration-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/types/src/config.ts` | Modify | Add `OpenVikingConfig` interface + `openViking?` to `AppConfig` |
| `packages/memory/src/viking-memory-client.ts` | Create | `IVikingMemoryClient` interface, `VikingMemoryClient`, `NullVikingMemoryClient`, all types |
| `packages/memory/src/viking-health-monitor.ts` | Create | `VikingHealthMonitor` heartbeat manager |
| `packages/memory/src/index.ts` | Modify | Re-export Viking modules |
| `packages/memory/src/__tests__/viking-memory-client.test.ts` | Create | Unit tests for client + null client |
| `packages/memory/src/__tests__/viking-health-monitor.test.ts` | Create | Unit tests for health monitor |
| `config/openviking.conf` | Create | OpenViking server config (Ark API keys) |
| `config/config.json` | Modify | Add `openViking` block |
| `apps/server/src/init/viking.ts` | Create | `initViking()` — creates client + health monitor |
| `apps/server/src/main.ts` | Modify | Insert Phase 1.5 initViking, shutdown healthMonitor.stop() |
| `apps/server/src/coordinator-context.ts` | Modify | Switch LiveContextLoader to use vikingClient |
| `apps/server/src/init/coordinator.ts` | Modify | Pass vikingClient instead of memoryStore/embedder |
| `apps/server/src/viking-routes.ts` | Create | `/api/viking/*` proxy endpoints |
| `apps/server/src/dashboard.ts` | Modify | Wire viking routes into routeRequest |
| `apps/server/src/event-handlers.ts` | Modify | Add Viking writeback on worker_completed |
| `config/coordinator-skills/skills/viking-manage/SKILL.md` | Create | Coordinator skill for knowledge base management |
| `scripts/viking-init.ts` | Create | One-time knowledge import script |

---

### Task 1: OpenVikingConfig 类型 + config.json

**Files:**
- Modify: `packages/types/src/config.ts:679-708`
- Modify: `config/config.json:151-152`

- [ ] **Step 1: Add OpenVikingConfig interface to types**

In `packages/types/src/config.ts`, add before the `AppConfig` interface (before line 666):

```typescript
// ─── OpenViking 配置 ───

/**
 * OpenViking 外部服务连接配置
 *
 * teamsland 通过 HTTP 调用独立部署的 OpenViking server，
 * 心跳检测健康状态，不健康时自动降级到 NullVikingMemoryClient。
 *
 * @example
 * ```typescript
 * import type { OpenVikingConfig } from "@teamsland/types";
 *
 * const cfg: OpenVikingConfig = {
 *   baseUrl: "http://127.0.0.1:1933",
 *   agentId: "teamsland",
 *   timeoutMs: 30000,
 *   heartbeatIntervalMs: 30000,
 *   heartbeatFailThreshold: 3,
 * };
 * ```
 */
export interface OpenVikingConfig {
  /** OpenViking server HTTP 地址 */
  baseUrl: string;
  /** agent 标识（X-OpenViking-Agent header） */
  agentId: string;
  /** API Key（X-API-Key header，dev 模式可省略） */
  apiKey?: string;
  /** 请求超时（毫秒） */
  timeoutMs: number;
  /** 心跳检测间隔（毫秒） */
  heartbeatIntervalMs: number;
  /** 连续心跳失败几次后降级 */
  heartbeatFailThreshold: number;
}
```

- [ ] **Step 2: Add openViking field to AppConfig**

In the `AppConfig` interface, add after the `hooks?` field (line 707):

```typescript
  /** OpenViking 记忆服务配置（可选，未配置时使用 NullClient） */
  openViking?: OpenVikingConfig;
```

- [ ] **Step 3: Add openViking block to config.json**

In `config/config.json`, add before the closing `}` (after line 151):

```json
  "openViking": {
    "baseUrl": "http://127.0.0.1:1933",
    "agentId": "teamsland",
    "timeoutMs": 30000,
    "heartbeatIntervalMs": 30000,
    "heartbeatFailThreshold": 3
  }
```

- [ ] **Step 4: Run typecheck**

Run: `bun run --filter '@teamsland/types' typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/config.ts config/config.json
git commit -m "feat(types): add OpenVikingConfig and config.json entry"
```


---

### Task 2: VikingMemoryClient + NullVikingMemoryClient + Types

**Files:**
- Create: `packages/memory/src/viking-memory-client.ts`
- Create: `packages/memory/src/__tests__/viking-memory-client.test.ts`

- [ ] **Step 1: Write failing tests for NullVikingMemoryClient**

Create `packages/memory/src/__tests__/viking-memory-client.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { NullVikingMemoryClient } from "../viking-memory-client.js";

describe("NullVikingMemoryClient", () => {
  const client = new NullVikingMemoryClient();

  it("healthCheck returns false", async () => {
    expect(await client.healthCheck()).toBe(false);
  });

  it("find returns empty result", async () => {
    const result = await client.find("test query");
    expect(result.total).toBe(0);
    expect(result.memories).toEqual([]);
    expect(result.resources).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it("read returns empty string", async () => {
    expect(await client.read("viking://any")).toBe("");
  });

  it("abstract returns empty string", async () => {
    expect(await client.abstract("viking://any")).toBe("");
  });

  it("overview returns empty string", async () => {
    expect(await client.overview("viking://any")).toBe("");
  });

  it("write resolves without error", async () => {
    await expect(client.write("viking://any", "content")).resolves.toBeUndefined();
  });

  it("ls returns empty array", async () => {
    expect(await client.ls("viking://any")).toEqual([]);
  });

  it("mkdir resolves without error", async () => {
    await expect(client.mkdir("viking://any")).resolves.toBeUndefined();
  });

  it("rm resolves without error", async () => {
    await expect(client.rm("viking://any")).resolves.toBeUndefined();
  });

  it("addResource returns stub result", async () => {
    const result = await client.addResource("/path", { to: "viking://any" });
    expect(result.uri).toBe("");
  });

  it("createSession returns null-session", async () => {
    expect(await client.createSession()).toBe("null-session");
  });

  it("getSessionContext returns empty context", async () => {
    const ctx = await client.getSessionContext("any");
    expect(ctx.latest_archive_overview).toBe("");
    expect(ctx.messages).toEqual([]);
    expect(ctx.estimatedTokens).toBe(0);
  });

  it("addMessage resolves without error", async () => {
    await expect(client.addMessage("s", "user", "hi")).resolves.toBeUndefined();
  });

  it("commitSession returns stub result", async () => {
    const result = await client.commitSession("any");
    expect(result.status).toBe("accepted");
    expect(result.session_id).toBe("");
  });

  it("deleteSession resolves without error", async () => {
    await expect(client.deleteSession("any")).resolves.toBeUndefined();
  });

  it("getTask returns stub status", async () => {
    const task = await client.getTask("any");
    expect(task.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- packages/memory/src/__tests__/viking-memory-client.test.ts`
Expected: FAIL — module `../viking-memory-client.js` not found

- [ ] **Step 3: Implement types, interface, VikingMemoryClient, NullVikingMemoryClient**

Create `packages/memory/src/viking-memory-client.ts` with the full implementation. This file contains:
1. All type interfaces (`FindResultItem`, `FindResult`, `FindOptions`, `WriteOptions`, `AddResourceOptions`, `ResourceResult`, `FsEntry`, `SessionContext`, `CommitResult`, `TaskStatus`)
2. `IVikingMemoryClient` interface
3. `VikingMemoryClient` class with `request<T>()` base
4. `NullVikingMemoryClient` class

The full code is specified in the design spec Section 2. Key implementation details:

- `VikingMemoryClient` constructor takes `OpenVikingConfig` from `@teamsland/types`
- `request<T>()` sets `X-OpenViking-Agent` and optional `X-API-Key` headers
- `healthCheck()` catches all errors and returns boolean
- Each method maps to the corresponding OpenViking REST endpoint per spec Section 2.2
- `NullVikingMemoryClient` implements every method with safe no-op returns

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test -- packages/memory/src/__tests__/viking-memory-client.test.ts`
Expected: All 16 tests PASS

- [ ] **Step 5: Write failing tests for VikingMemoryClient HTTP behavior**

Add to the same test file:

```typescript
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { VikingMemoryClient } from "../viking-memory-client.js";

describe("VikingMemoryClient", () => {
  let server: ReturnType<typeof Bun.serve>;
  let client: VikingMemoryClient;
  const port = 19330;

  beforeAll(() => {
    server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health") {
          return Response.json({ status: "ok" });
        }
        if (url.pathname === "/api/v1/search/find" && req.method === "POST") {
          return Response.json({
            status: "ok",
            result: { memories: [], resources: [], skills: [], total: 0 },
          });
        }
        if (url.pathname === "/api/v1/content/read") {
          return Response.json({ status: "ok", result: "file content" });
        }
        if (url.pathname === "/api/v1/sessions" && req.method === "POST") {
          return Response.json({ status: "ok", result: { session_id: "test-session" } });
        }
        return Response.json({ status: "error", error: { message: "not found" } }, { status: 404 });
      },
    });

    client = new VikingMemoryClient({
      baseUrl: `http://127.0.0.1:${port}`,
      agentId: "test",
      timeoutMs: 5000,
      heartbeatIntervalMs: 30000,
      heartbeatFailThreshold: 3,
    });
  });

  afterAll(() => {
    server.stop();
  });

  it("healthCheck returns true when server is up", async () => {
    expect(await client.healthCheck()).toBe(true);
  });

  it("find returns parsed result", async () => {
    const result = await client.find("test");
    expect(result.total).toBe(0);
  });

  it("read returns content string", async () => {
    const content = await client.read("viking://test");
    expect(content).toBe("file content");
  });

  it("createSession returns session id", async () => {
    const id = await client.createSession();
    expect(id).toBe("test-session");
  });

  it("healthCheck returns false when server is down", async () => {
    const badClient = new VikingMemoryClient({
      baseUrl: "http://127.0.0.1:19999",
      agentId: "test",
      timeoutMs: 1000,
      heartbeatIntervalMs: 30000,
      heartbeatFailThreshold: 3,
    });
    expect(await badClient.healthCheck()).toBe(false);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test -- packages/memory/src/__tests__/viking-memory-client.test.ts`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/viking-memory-client.ts packages/memory/src/__tests__/viking-memory-client.test.ts
git commit -m "feat(memory): add VikingMemoryClient, NullVikingMemoryClient, and types"
```


---

### Task 3: VikingHealthMonitor

**Files:**
- Create: `packages/memory/src/viking-health-monitor.ts`
- Create: `packages/memory/src/__tests__/viking-health-monitor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/memory/src/__tests__/viking-health-monitor.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IVikingMemoryClient } from "../viking-memory-client.js";
import { VikingHealthMonitor } from "../viking-health-monitor.js";

function makeMockClient(healthy: boolean): IVikingMemoryClient {
  return {
    healthCheck: vi.fn().mockResolvedValue(healthy),
    find: vi.fn(),
    read: vi.fn(),
    abstract: vi.fn(),
    overview: vi.fn(),
    write: vi.fn(),
    ls: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    addResource: vi.fn(),
    createSession: vi.fn(),
    getSessionContext: vi.fn(),
    addMessage: vi.fn(),
    commitSession: vi.fn(),
    deleteSession: vi.fn(),
    getTask: vi.fn(),
  } as unknown as IVikingMemoryClient;
}

describe("VikingHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts unhealthy, becomes healthy after successful check", async () => {
    const real = makeMockClient(true);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as any,
      nullClient as any,
      { intervalMs: 1000, failThreshold: 3 },
    );

    expect(monitor.isHealthy).toBe(false);
    monitor.start();
    // start() calls check() synchronously, but check is async
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.client).toBe(real);
    monitor.stop();
  });

  it("degrades after failThreshold consecutive failures", async () => {
    const real = makeMockClient(false);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as any,
      nullClient as any,
      { intervalMs: 1000, failThreshold: 2 },
    );

    // First make it healthy
    (real.healthCheck as any).mockResolvedValueOnce(true);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(true);

    // Now fail twice
    (real.healthCheck as any).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(true); // 1 fail, threshold is 2

    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(false); // 2 fails = degraded
    expect(monitor.client).toBe(nullClient);
    monitor.stop();
  });

  it("recovers after failure streak ends", async () => {
    const real = makeMockClient(false);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as any,
      nullClient as any,
      { intervalMs: 1000, failThreshold: 1 },
    );

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(false);

    // Now succeed
    (real.healthCheck as any).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.client).toBe(real);
    monitor.stop();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- packages/memory/src/__tests__/viking-health-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement VikingHealthMonitor**

Create `packages/memory/src/viking-health-monitor.ts`:

```typescript
import { createLogger } from "@teamsland/observability";
import type { IVikingMemoryClient, NullVikingMemoryClient, VikingMemoryClient } from "./viking-memory-client.js";

const logger = createLogger("memory:viking-health");

/**
 * OpenViking 心跳监控器
 *
 * 定时调用 GET /health 检测 OpenViking server 可用性，
 * 连续失败超过阈值时自动切换到降级 client，恢复后自动切回。
 *
 * @example
 * ```typescript
 * import { VikingHealthMonitor } from "@teamsland/memory";
 *
 * const monitor = new VikingHealthMonitor(realClient, nullClient, {
 *   intervalMs: 30000,
 *   failThreshold: 3,
 * });
 * monitor.start();
 * const client = monitor.client; // 自动选择健康的 client
 * ```
 */
export class VikingHealthMonitor {
  private failCount = 0;
  private healthy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly realClient: VikingMemoryClient,
    private readonly nullClient: NullVikingMemoryClient,
    private readonly config: { intervalMs: number; failThreshold: number },
  ) {}

  /** 当前应使用的 client */
  get client(): IVikingMemoryClient {
    return this.healthy ? this.realClient : this.nullClient;
  }

  /** 是否健康 */
  get isHealthy(): boolean {
    return this.healthy;
  }

  /** 启动心跳定时器 */
  start(): void {
    this.check();
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const ok = await this.realClient.healthCheck();
    if (ok) {
      if (!this.healthy) {
        logger.info("OpenViking 连接已恢复");
      }
      this.failCount = 0;
      this.healthy = true;
    } else {
      this.failCount++;
      if (this.failCount >= this.config.failThreshold && this.healthy) {
        logger.warn({ failCount: this.failCount }, "OpenViking 连续心跳失败，切换到降级模式");
        this.healthy = false;
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test -- packages/memory/src/__tests__/viking-health-monitor.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Update memory package index.ts**

In `packages/memory/src/index.ts`, add at the end:

```typescript
// OpenViking
export type {
  AddResourceOptions,
  CommitResult,
  FindOptions,
  FindResult,
  FindResultItem,
  FsEntry,
  IVikingMemoryClient,
  ResourceResult,
  SessionContext,
  TaskStatus,
  WriteOptions,
} from "./viking-memory-client.js";
export { NullVikingMemoryClient, VikingMemoryClient } from "./viking-memory-client.js";
export { VikingHealthMonitor } from "./viking-health-monitor.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/viking-health-monitor.ts packages/memory/src/__tests__/viking-health-monitor.test.ts packages/memory/src/index.ts
git commit -m "feat(memory): add VikingHealthMonitor and re-export Viking modules"
```


---

### Task 4: OpenViking Config File + Server Init Module

**Files:**
- Create: `config/openviking.conf`
- Create: `apps/server/src/init/viking.ts`

- [ ] **Step 1: Create openviking.conf**

Create `config/openviking.conf`:

```json
{
  "storage": {
    "workspace": "./data/openviking"
  },
  "embedding": {
    "max_concurrent": 10,
    "dense": {
      "provider": "volcengine",
      "api_key": "a7c779b0-b6d1-4e0e-8f9b-bba1292f7d65",
      "api_base": "https://ark-cn-beijing.bytedance.net/api/v3",
      "model": "ep-20260324224619-zgcl6",
      "dimension": 1024,
      "input": "multimodal"
    }
  },
  "vlm": {
    "provider": "volcengine",
    "api_key": "ark-882be2ec-52c5-4641-a40c-cfb3dcfd1a67-a7bdb",
    "api_base": "https://ark-cn-beijing.bytedance.net/api/v3",
    "model": "ep-20260320212524-n9bst",
    "max_concurrent": 10
  },
  "server": {
    "host": "127.0.0.1",
    "port": 1933,
    "auth_mode": "dev"
  },
  "log": {
    "level": "INFO",
    "output": "stdout"
  }
}
```

- [ ] **Step 2: Create initViking module**

Create `apps/server/src/init/viking.ts`:

```typescript
import { NullVikingMemoryClient, VikingHealthMonitor, VikingMemoryClient } from "@teamsland/memory";
import type { IVikingMemoryClient } from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/**
 * Viking 初始化结果
 *
 * @example
 * ```typescript
 * import type { VikingResult } from "./init/viking.js";
 *
 * const viking: VikingResult = await initViking(config, logger);
 * const client = viking.healthMonitor?.client ?? viking.nullClient;
 * ```
 */
export interface VikingResult {
  /** 心跳监控器（未配置 OpenViking 时为 null） */
  healthMonitor: VikingHealthMonitor | null;
  /** 降级 client（始终可用） */
  nullClient: NullVikingMemoryClient;
}

/**
 * 初始化 OpenViking 连接和心跳监控
 *
 * 如果 config.openViking 存在，创建真实 client 和心跳监控器。
 * 否则返回 null monitor + NullClient。
 *
 * @example
 * ```typescript
 * import { initViking } from "./init/viking.js";
 *
 * const viking = initViking(config, logger);
 * ```
 */
export function initViking(
  config: AppConfig,
  logger: ReturnType<typeof createLogger>,
): VikingResult {
  const nullClient = new NullVikingMemoryClient();

  if (!config.openViking) {
    logger.info("OpenViking 未配置，使用 NullVikingMemoryClient");
    return { healthMonitor: null, nullClient };
  }

  const realClient = new VikingMemoryClient(config.openViking);
  const healthMonitor = new VikingHealthMonitor(realClient, nullClient, {
    intervalMs: config.openViking.heartbeatIntervalMs,
    failThreshold: config.openViking.heartbeatFailThreshold,
  });
  healthMonitor.start();
  logger.info({ baseUrl: config.openViking.baseUrl }, "OpenViking 心跳监控已启动");

  return { healthMonitor, nullClient };
}

/**
 * 获取当前活跃的 Viking client
 *
 * @example
 * ```typescript
 * const client = getVikingClient(viking);
 * await client.find("query");
 * ```
 */
export function getVikingClient(viking: VikingResult): IVikingMemoryClient {
  return viking.healthMonitor?.client ?? viking.nullClient;
}
```

- [ ] **Step 3: Commit**

```bash
git add config/openviking.conf apps/server/src/init/viking.ts
git commit -m "feat(server): add openviking.conf and initViking module"
```


---

### Task 5: Wire initViking into main.ts

**Files:**
- Modify: `apps/server/src/main.ts:19-20,27,36,60-71,119-129`

- [ ] **Step 1: Add import**

At line 19 in `main.ts`, add:

```typescript
import { getVikingClient, initViking } from "./init/viking.js";
```

- [ ] **Step 2: Insert Phase 1.5 after Phase 1**

After line 27 (`const storage = await initStorage(config, logger);`), insert:

```typescript
    // ── Phase 1.5: OpenViking 连接 ──
    const viking = initViking(config, logger);
```

- [ ] **Step 3: Pass vikingClient to initCoordinator**

Replace lines 60-71 (the initCoordinator call) with:

```typescript
    // ── Phase 5.5: Coordinator ──
    const vikingClient = getVikingClient(viking);
    const coordinator = await initCoordinator(
      config,
      queue,
      sidecar.registry,
      controller,
      logger,
      vikingClient,
    );
```

This removes the `memoryStoreForCoordinator` and `storage.embedder` and `TEAM_ID` args, replacing them with `vikingClient`.

- [ ] **Step 4: Remove unused import of TeamMemoryStore**

Remove line 6: `import { TeamMemoryStore } from "@teamsland/memory";`

Also remove `import { initStorage, TEAM_ID } from "./init/storage.js";` and replace with `import { initStorage } from "./init/storage.js";` (TEAM_ID is no longer passed to initCoordinator).

- [ ] **Step 5: Add healthMonitor.stop() to shutdown**

In the `shutdown` function (around line 115-131), add before `await shutdownTracing()`:

```typescript
      if (viking.healthMonitor) viking.healthMonitor.stop();
```

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: PASS (no lint errors)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): wire initViking into main.ts startup and shutdown"
```


---

### Task 6: Adapt LiveContextLoader to use VikingMemoryClient

**Files:**
- Modify: `apps/server/src/coordinator-context.ts`
- Modify: `apps/server/src/init/coordinator.ts:66-94`

- [ ] **Step 1: Rewrite LiveContextLoaderOpts and constructor**

In `apps/server/src/coordinator-context.ts`, replace the import block (lines 1-8) with:

```typescript
// @teamsland/server — Coordinator 上下文加载器

import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger, withSpan } from "@teamsland/observability";
import type { PersistentQueue, QueueMessage } from "@teamsland/queue";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { CoordinatorContext, CoordinatorContextLoader, CoordinatorEvent } from "@teamsland/types";
```

Replace `LiveContextLoaderOpts` interface (lines 37-52) with:

```typescript
export interface LiveContextLoaderOpts {
  /** Agent 注册表（获取运行中 Worker 列表） */
  registry: SubagentRegistry;
  /** 持久化消息队列（事件分发核心，保留但不再作为上下文来源） */
  queue: PersistentQueue;
  /** OpenViking client（替代 store + embedder） */
  vikingClient: IVikingMemoryClient;
}
```

Replace class fields and constructor (lines 82-98) with:

```typescript
export class LiveContextLoader implements CoordinatorContextLoader {
  private readonly registry: SubagentRegistry;
  private readonly queue: PersistentQueue;
  private readonly vikingClient: IVikingMemoryClient;

  constructor(opts: LiveContextLoaderOpts) {
    this.registry = opts.registry;
    this.queue = opts.queue;
    this.vikingClient = opts.vikingClient;
  }
```

- [ ] **Step 2: Rewrite load() to use vikingClient**

Replace the `load()` method (lines 114-128) with:

```typescript
  async load(event: CoordinatorEvent): Promise<CoordinatorContext> {
    return withSpan("coordinator-context", "load", async () => {
      const query = buildMemoryQuery(event);
      const requesterId = extractRequesterId(event);
      const coordSessionId = `coord-${event.payload.chatId ?? event.id}`;

      const [taskResult, vikingTasksResult, agentMemResult, userMemResult, sessionResult] =
        await Promise.allSettled([
          this.loadTaskStateSummary(),
          query ? this.vikingClient.find(query, { targetUri: "viking://resources/tasks/active/", limit: 5 }) : Promise.resolve({ memories: [], resources: [], skills: [], total: 0 }),
          query ? this.vikingClient.find(query, { targetUri: "viking://agent/teamsland/memories/", limit: 5 }) : Promise.resolve({ memories: [], resources: [], skills: [], total: 0 }),
          query && requesterId ? this.vikingClient.find(query, { targetUri: `viking://user/${requesterId}/memories/`, limit: 3 }) : Promise.resolve({ memories: [], resources: [], skills: [], total: 0 }),
          this.vikingClient.getSessionContext(coordSessionId, 8000),
        ]);

      const taskSummary = taskResult.status === "fulfilled" ? taskResult.value : "";
      const vikingTasks = vikingTasksResult.status === "fulfilled" ? formatFindResult(vikingTasksResult.value, "活跃任务") : "";
      const agentMem = agentMemResult.status === "fulfilled" ? formatFindResult(agentMemResult.value, "Agent 记忆") : "";
      const userMem = userMemResult.status === "fulfilled" ? formatFindResult(userMemResult.value, "用户记忆") : "";
      const sessionCtx = sessionResult.status === "fulfilled" ? formatSessionContext(sessionResult.value) : "";

      return {
        taskStateSummary: [taskSummary, vikingTasks].filter(Boolean).join("\n"),
        recentMessages: sessionCtx,
        relevantMemories: [agentMem, userMem].filter(Boolean).join("\n"),
      };
    });
  }
```

- [ ] **Step 3: Remove old methods, add new helpers**

Remove `loadRecentMessages()` (lines 150-161) and `loadRelevantMemories()` (lines 169-189).

Add these helper functions after the class:

```typescript
function extractRequesterId(event: CoordinatorEvent): string | undefined {
  const payload = event.payload;
  if (typeof payload.requesterId === "string") return payload.requesterId;
  if (typeof payload.userId === "string") return payload.userId;
  return undefined;
}

function formatFindResult(result: import("@teamsland/memory").FindResult, label: string): string {
  const items = [...result.memories, ...result.resources, ...result.skills];
  if (items.length === 0) return "";
  return items.map((item) => `- [${label}] ${item.abstract}`).join("\n");
}

function formatSessionContext(ctx: import("@teamsland/memory").SessionContext): string {
  const parts: string[] = [];
  if (ctx.latest_archive_overview) {
    parts.push(`[对话历史概要] ${ctx.latest_archive_overview}`);
  }
  for (const msg of ctx.messages) {
    const content = msg.parts.map((p: any) => (typeof p === "string" ? p : p.text ?? "")).join("");
    parts.push(`- [${msg.role}] ${content.slice(0, 200)}`);
  }
  return parts.join("\n");
}
```

- [ ] **Step 4: Update initCoordinator to pass vikingClient**

In `apps/server/src/init/coordinator.ts`, change the function signature (lines 66-75) to:

```typescript
export async function initCoordinator(
  config: AppConfig,
  queue: PersistentQueue,
  registry: SubagentRegistry,
  controller: AbortController,
  parentLogger: ReturnType<typeof createLogger>,
  vikingClient: IVikingMemoryClient,
): Promise<CoordinatorResult> {
```

Update the import (line 1-4):

```typescript
import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
```

Remove unused imports of `Embedder`, `TeamMemoryStore`.

Update the LiveContextLoader creation (lines 88-94):

```typescript
  const contextLoader = new LiveContextLoader({
    registry,
    queue,
    vikingClient,
  });
```

- [ ] **Step 5: Run existing tests**

Run: `bun run test -- apps/server/src/__tests__/coordinator-context.test.ts`
If the test file exists, fix any failures caused by the constructor change. The mock will need to provide `vikingClient` instead of `memoryStore`/`embedder`/`teamId`.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/coordinator-context.ts apps/server/src/init/coordinator.ts
git commit -m "feat(server): switch LiveContextLoader to VikingMemoryClient"
```


---

### Task 7: Viking Proxy Routes + Dashboard Wiring

**Files:**
- Create: `apps/server/src/viking-routes.ts`
- Modify: `apps/server/src/dashboard.ts:16-17,181-251`

- [ ] **Step 1: Create viking-routes.ts**

Create `apps/server/src/viking-routes.ts`:

```typescript
import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:viking-routes");

/**
 * 处理 /api/viking/* 代理路由
 *
 * teamsland server 作为 OpenViking 的薄代理，
 * Coordinator 通过 viking-manage skill 调用这些端点。
 *
 * @example
 * ```typescript
 * import { handleVikingRoutes } from "./viking-routes.js";
 *
 * const result = await handleVikingRoutes(req, url, vikingClient);
 * ```
 */
export async function handleVikingRoutes(
  req: Request,
  url: URL,
  vikingClient: IVikingMemoryClient,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/viking/")) return null;

  // 检查 client 是否可用
  const isNull = !(await vikingClient.healthCheck());

  if (req.method === "POST" && url.pathname === "/api/viking/resource") {
    if (isNull) return unavailable();
    const body = await req.json() as { path: string; to: string; reason?: string; wait?: boolean; ignore_dirs?: string; include?: string; exclude?: string };
    const result = await vikingClient.addResource(body.path, {
      to: body.to,
      reason: body.reason,
      wait: body.wait,
      ignore_dirs: body.ignore_dirs,
      include: body.include,
      exclude: body.exclude,
    });
    logger.info({ path: body.path, to: body.to }, "Viking addResource");
    return Response.json({ status: "ok", result });
  }

  if (req.method === "POST" && url.pathname === "/api/viking/find") {
    if (isNull) return unavailable();
    const body = await req.json() as { query: string; targetUri?: string; limit?: number };
    const result = await vikingClient.find(body.query, {
      targetUri: body.targetUri,
      limit: body.limit,
    });
    return Response.json({ status: "ok", result });
  }

  if (req.method === "GET" && url.pathname === "/api/viking/read") {
    if (isNull) return unavailable();
    const uri = url.searchParams.get("uri");
    if (!uri) return Response.json({ error: "uri parameter required" }, { status: 400 });
    const content = await vikingClient.read(uri);
    return Response.json({ status: "ok", result: content });
  }

  if (req.method === "GET" && url.pathname === "/api/viking/ls") {
    if (isNull) return unavailable();
    const uri = url.searchParams.get("uri");
    if (!uri) return Response.json({ error: "uri parameter required" }, { status: 400 });
    const entries = await vikingClient.ls(uri);
    return Response.json({ status: "ok", result: entries });
  }

  if (req.method === "POST" && url.pathname === "/api/viking/write") {
    if (isNull) return unavailable();
    const body = await req.json() as { uri: string; content: string; mode?: "replace" | "create" };
    await vikingClient.write(body.uri, body.content, { mode: body.mode });
    logger.info({ uri: body.uri }, "Viking write");
    return Response.json({ status: "ok" });
  }

  if (req.method === "DELETE" && url.pathname === "/api/viking/fs") {
    if (isNull) return unavailable();
    const uri = url.searchParams.get("uri");
    const recursive = url.searchParams.get("recursive") === "true";
    if (!uri) return Response.json({ error: "uri parameter required" }, { status: 400 });
    await vikingClient.rm(uri, recursive);
    logger.info({ uri, recursive }, "Viking rm");
    return Response.json({ status: "ok" });
  }

  return null;
}

function unavailable(): Response {
  return Response.json({ error: "OpenViking unavailable" }, { status: 503 });
}
```

- [ ] **Step 2: Wire into dashboard routeRequest**

In `apps/server/src/dashboard.ts`:

Add import at top (around line 16):
```typescript
import { handleVikingRoutes } from "./viking-routes.js";
```

In `routeRequest` function, add the `vikingClient` to the `ctx` type (line 199):
```typescript
    vikingClient: IVikingMemoryClient | null | undefined;
```

In `startDashboard` function, add `vikingClient` to the destructured deps and the ctx object.

In `routeRequest`, add after the git routes block (around line 240):
```typescript
  // Viking 代理路由（/api/viking/*）
  if (ctx.vikingClient) {
    const vikingResult = handleVikingRoutes(req, url, ctx.vikingClient);
    if (vikingResult) return vikingResult;
  }
```

The `vikingClient` is passed from `initDashboard()` which needs to be updated in `apps/server/src/init/dashboard.ts` to accept it as a parameter. Add it to the `initDashboard` function signature and pass through to `startDashboard`.

In `main.ts`, update the `initDashboard` call to also pass `vikingClient`.

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/viking-routes.ts apps/server/src/dashboard.ts apps/server/src/init/dashboard.ts apps/server/src/main.ts
git commit -m "feat(server): add /api/viking/* proxy routes"
```


---

### Task 8: Worker Writeback to Viking on Completion

**Files:**
- Modify: `apps/server/src/event-handlers.ts:632-665`

- [ ] **Step 1: Add vikingClient to EventHandlerDeps**

In `apps/server/src/event-handlers.ts`, add to the `EventHandlerDeps` interface (around line 86):

```typescript
  /** OpenViking client（worker 完成时写回记忆） */
  vikingClient?: IVikingMemoryClient | null;
```

Add the import at top:
```typescript
import type { IVikingMemoryClient } from "@teamsland/memory";
```

- [ ] **Step 2: Add writebackToViking helper function**

Add after the `handleWorkerCompleted` function:

```typescript
async function writebackToViking(
  client: IVikingMemoryClient,
  workerId: string,
  issueId: string,
  resultSummary: string,
): Promise<void> {
  const taskId = workerId.replace("worker-", "");
  const now = new Date().toISOString();
  const taskMd = [
    `# task-${taskId}`,
    "",
    `- **status**: completed`,
    `- **worker_id**: ${workerId}`,
    `- **updated_at**: ${now}`,
    "",
    "## Brief",
    "",
    issueId,
    "",
    "## Result",
    "",
    resultSummary,
  ].join("\n");

  // 写任务状态到 completed
  const completedUri = `viking://resources/tasks/completed/task-${taskId}.md`;
  const activeUri = `viking://resources/tasks/active/task-${taskId}.md`;
  await client.write(completedUri, taskMd, { mode: "create" });
  await client.rm(activeUri).catch(() => {});

  // Session 提交 → 触发记忆提取
  const sessionId = await client.createSession(`worker-${taskId}`);
  await client.addMessage(sessionId, "user", issueId);
  await client.addMessage(sessionId, "assistant", resultSummary);
  await client.commitSession(sessionId);
}
```

- [ ] **Step 3: Call writebackToViking in handleWorkerCompleted**

In the `handleWorkerCompleted` function, after `deps.registry.unregister(workerId)` (line 638), add:

```typescript
  // Viking 写回（异步，失败不影响主流程）
  if (deps.vikingClient) {
    writebackToViking(deps.vikingClient, workerId, issueId, resultSummary).catch((err: unknown) => {
      logger.warn({ workerId, err }, "Viking 写回失败");
    });
  }
```

- [ ] **Step 4: Wire vikingClient into event handler registration**

In the file where `registerQueueConsumer` passes `deps`, ensure `vikingClient` is included in the deps. This is in `apps/server/src/init/events.ts` — check how `EventHandlerDeps` is constructed and add `vikingClient: getVikingClient(viking)`.

- [ ] **Step 5: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/event-handlers.ts apps/server/src/init/events.ts
git commit -m "feat(server): add Viking writeback on worker_completed"
```

---

### Task 9: Coordinator viking-manage Skill

**Files:**
- Create: `config/coordinator-skills/skills/viking-manage/SKILL.md`

- [ ] **Step 1: Create skill file**

Create `config/coordinator-skills/skills/viking-manage/SKILL.md` with the exact content from spec Section 5.2:

```markdown
# viking-manage

管理 OpenViking 知识库资源。

## 能力

- 添加代码仓库：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "/path/to/repo", "to": "viking://resources/{name}/", "wait": false}'

- 添加飞书文档：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "https://xxx.feishu.cn/docx/xxx", "to": "viking://resources/lark-docs/{title}/", "wait": false}'

- 搜索知识库：
  curl -X POST http://localhost:3001/api/viking/find \
    -H "Content-Type: application/json" \
    -d '{"query": "搜索关键词", "limit": 5}'

- 查看目录：
  curl "http://localhost:3001/api/viking/ls?uri=viking://resources/"

- 读取内容：
  curl "http://localhost:3001/api/viking/read?uri=viking://resources/{name}/README.md"

## 使用场景

当用户要求：
- "帮我加一个仓库" → addResource
- "导入这个飞书文档" → addResource
- "搜一下关于 xxx 的知识" → find
- "看看知识库里有什么" → ls

## 注意

- addResource 是异步操作（wait: false），导入后语义处理在后台进行
- 仓库路径必须是部署机器上的绝对路径
- URI 命名遵循 viking://resources/{name}/ 格式
```

- [ ] **Step 2: Commit**

```bash
git add config/coordinator-skills/skills/viking-manage/SKILL.md
git commit -m "feat(coordinator): add viking-manage skill for knowledge base management"
```

---

### Task 10: Knowledge Import Script

**Files:**
- Create: `scripts/viking-init.ts`

- [ ] **Step 1: Create viking-init.ts**

Create `scripts/viking-init.ts`:

```typescript
#!/usr/bin/env bun
/**
 * OpenViking 知识导入脚本
 *
 * 一次性执行：创建目录结构 + 导入 config.repoMapping 中的代码仓库。
 *
 * 用法: bun run scripts/viking-init.ts
 */

import { VikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

const logger = createLogger("scripts:viking-init");

async function main(): Promise<void> {
  // 加载配置
  const configFile = Bun.file("config/config.json");
  const config = (await configFile.json()) as AppConfig;

  if (!config.openViking) {
    logger.error("config.json 中缺少 openViking 配置");
    process.exit(1);
  }

  const client = new VikingMemoryClient(config.openViking);

  // 检查连通性
  const healthy = await client.healthCheck();
  if (!healthy) {
    logger.error({ baseUrl: config.openViking.baseUrl }, "无法连接 OpenViking server");
    process.exit(1);
  }
  logger.info("OpenViking server 连接正常");

  // 创建目录结构
  logger.info("创建目录结构...");
  await client.mkdir("viking://resources/tasks/", "团队任务状态存储");
  await client.mkdir("viking://resources/tasks/active/", "进行中的任务");
  await client.mkdir("viking://resources/tasks/completed/", "已完成的任务");
  await client.mkdir("viking://resources/lark-docs/", "飞书文档归档");
  logger.info("目录结构创建完成");

  // 导入代码仓库
  for (const mapping of config.repoMapping) {
    for (const repo of mapping.repos) {
      logger.info({ path: repo.path, name: repo.name }, "导入代码仓库...");
      const result = await client.addResource(repo.path, {
        to: `viking://resources/${repo.name}/`,
        reason: `代码仓库: ${repo.name}`,
        wait: false,
      });
      logger.info({ uri: result.uri, taskId: result.task_id }, "仓库导入已提交");
    }
  }

  logger.info("知识导入已全部提交，语义处理将在后台完成");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "知识导入失败");
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/viking-init.ts
git commit -m "feat(scripts): add viking-init.ts knowledge import script"
```

---

### Task 11: Full Integration Test

**Files:** None (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `bun run test:run`
Expected: All tests PASS

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: PASS

- [ ] **Step 3: Verify typecheck**

Run: `bun run --filter '@teamsland/*' typecheck`
Expected: PASS

- [ ] **Step 4: Verify server starts**

Run: `bun run --filter '@teamsland/server' dev` (or `bash scripts/start.sh server`)
Expected: Server starts, logs "OpenViking 心跳监控已启动" (if OpenViking server is not running, logs heartbeat failures and degrades gracefully)

- [ ] **Step 5: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixes for OpenViking wiring"
```

