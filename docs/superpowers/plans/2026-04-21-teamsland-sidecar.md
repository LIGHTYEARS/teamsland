# @teamsland/sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/sidecar` package — Claude Code 子进程的完整生命周期管理器。提供 `ProcessController`（Bun.spawn 子进程控制）、`SubagentRegistry`（Agent 注册表 + 崩溃恢复）、`SidecarDataPlane`（NDJSON 流解析 + 事件路由）、`ObservableMessageBus`（traceId 注入 + 结构化日志）、`Alerter`（冷却窗口控制飞书告警）作为公开 API。

**Architecture:** Five source files: `process-controller.ts` (ProcessController — Bun.spawn 子进程启动/中断/存活检测), `registry.ts` (SubagentRegistry — Agent 生命周期 + 磁盘持久化 + 崩溃恢复), `data-plane.ts` (SidecarDataPlane — NDJSON 流解析 + 工具拦截 + 事件路由), `message-bus.ts` (ObservableMessageBus — traceId 注入 + 结构化日志), `alerter.ts` (Alerter — 冷却窗口控制的飞书告警), and `index.ts` (barrel exports). All dependencies injected via constructor — no global singletons.

**Tech Stack:** TypeScript (strict), Bun, Bun.spawn, ReadableStream (NDJSON), Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/sidecar` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has dependencies on `@teamsland/types`, `@teamsland/memory`, `@teamsland/lark`, and `@teamsland/session`. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-sidecar-design.md`.

**Testing approach:** All five classes are fully injectable — no global state, no real Bun.spawn calls, no real LarkNotifier calls in tests. Tests use fake objects (`FakeProcess`, `FakeLarkNotifier`, fake ReadableStream) injected at construction time.

**Bun.spawn mock constraint:** `vi.spyOn(Bun, "spawn")` must return an object implementing `{ pid, stdin: { write, end }, stdout: ReadableStream, stderr }`. Tests construct this object manually.

**NDJSON stream constraint:** `processStream` must maintain a line buffer across chunks — `Uint8Array` chunks may split across line boundaries. Never parse per-chunk; always split on `\n` and buffer remainder.

**ProcessController.isAlive constraint:** Uses `process.kill(pid, 0)` — a signal-0 probe. When process does not exist, `kill` throws; catch and return `false`.

**Registry atomic write constraint:** `persist()` writes to `${registryPath}.tmp` then renames to `registryPath`. Both files must be on the same filesystem for atomicity — default path `/tmp/teamsland-registry.json` satisfies this.

## Critical Files

- **Modify:** `packages/sidecar/package.json` (add @teamsland/observability workspace dep)
- **Create:** `packages/sidecar/src/process-controller.ts`
- **Create:** `packages/sidecar/src/registry.ts`
- **Create:** `packages/sidecar/src/data-plane.ts`
- **Create:** `packages/sidecar/src/message-bus.ts`
- **Create:** `packages/sidecar/src/alerter.ts`
- **Modify:** `packages/sidecar/src/index.ts` (barrel exports)
- **Create:** `packages/sidecar/src/__tests__/process-controller.test.ts`
- **Create:** `packages/sidecar/src/__tests__/registry.test.ts`
- **Create:** `packages/sidecar/src/__tests__/data-plane.test.ts`
- **Create:** `packages/sidecar/src/__tests__/message-bus.test.ts`
- **Create:** `packages/sidecar/src/__tests__/alerter.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- `createdAt` stored as Unix milliseconds (`Date.now()`)
- Run tests with: `bunx --bun vitest run packages/sidecar/`
- Run typecheck with: `bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
- Run lint with: `bunx biome check packages/sidecar/src/`

## Shared Test Helpers

Tests share common fake objects. Define these helpers inline at the top of each test file that needs them:

```typescript
import { vi } from "vitest";
import type { Logger } from "@teamsland/observability";

/** 测试用假 Logger，静默所有调用 */
const fakeLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;
```

### makeNdjsonStream helper (used in process-controller and data-plane tests)

```typescript
/**
 * 将 NDJSON 行数组转换为 ReadableStream<Uint8Array>
 *
 * 每行以 "\n" 结尾，合并为单个 Uint8Array chunk 写入流。
 */
function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => l + "\n").join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
```

### FakeLarkNotifier (used in registry and alerter tests)

```typescript
/**
 * 测试用假 LarkNotifier，记录所有调用参数
 */
interface FakeLarkNotifier {
  sendDm: ReturnType<typeof vi.fn>;
  sendCard: ReturnType<typeof vi.fn>;
}

function makeFakeLarkNotifier(): FakeLarkNotifier {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}
```

### makeRecord helper (used in registry tests)

```typescript
import type { AgentRecord } from "@teamsland/types";

function makeRecord(agentId: string, pid: number): AgentRecord {
  return {
    agentId,
    pid,
    sessionId: `sess-${agentId}`,
    issueId: `ISSUE-${agentId}`,
    worktreePath: `/tmp/worktree-${agentId}`,
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
  };
}
```

---

### Task 1: Update packages/sidecar/package.json — add @teamsland/observability

**Files:**
- Modify: `packages/sidecar/package.json`

- [ ] **Step 1: Add @teamsland/observability dependency**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/sidecar/package.json`:

```json
{
  "name": "@teamsland/sidecar",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/memory": "workspace:*",
    "@teamsland/lark": "workspace:*",
    "@teamsland/session": "workspace:*",
    "@teamsland/observability": "workspace:*"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Install dependencies**

Run: `bun install`
Expected: Resolves without errors

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/package.json bun.lockb && git commit -m "$(cat <<'EOF'
chore(sidecar): add @teamsland/observability workspace dependency

Required for structured logging via createLogger("sidecar:*") in all
five sidecar modules.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create process-controller.ts — ProcessController (TDD)

**Files:**
- Create: `packages/sidecar/src/process-controller.ts`
- Create: `packages/sidecar/src/__tests__/process-controller.test.ts`

- [ ] **Step 1: Create process-controller test**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/__tests__/process-controller.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@teamsland/observability";
import { ProcessController } from "../process-controller.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => l + "\n").join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProcessController", () => {
  it("spawn: 向 stdin 写入 JSON 信封后关闭", async () => {
    const writtenData: string[] = [];
    const fakeProc = {
      pid: 12345,
      stdin: {
        write: (data: string) => writtenData.push(data),
        end: vi.fn(),
      },
      stdout: makeNdjsonStream([
        JSON.stringify({ type: "system", session_id: "sess-abc" }),
      ]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    const result = await controller.spawn({
      issueId: "42",
      worktreePath: "/tmp",
      initialPrompt: "hello",
    });

    expect(result.pid).toBe(12345);
    expect(result.sessionId).toBe("sess-abc");
    expect(fakeProc.stdin.end).toHaveBeenCalledOnce();
    expect(JSON.parse(writtenData[0])).toMatchObject({ prompt: "hello" });
  });

  it("spawn: 返回的 stdout 是 ReadableStream", async () => {
    const fakeProc = {
      pid: 99,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: makeNdjsonStream([
        JSON.stringify({ type: "system", session_id: "sess-xyz" }),
      ]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    const result = await controller.spawn({
      issueId: "99",
      worktreePath: "/tmp",
      initialPrompt: "test",
    });

    expect(result.stdout).toBeInstanceOf(ReadableStream);
  });

  it("interrupt: hard=false 发送 SIGINT", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    controller.interrupt(9999);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGINT");
  });

  it("interrupt: hard=true 发送 SIGKILL", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    controller.interrupt(9999, true);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGKILL");
  });

  it("isAlive: 进程存在时返回 true", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    expect(controller.isAlive(12345)).toBe(true);
  });

  it("isAlive: 进程不存在时返回 false", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const controller = new ProcessController({ logger: fakeLogger });
    expect(controller.isAlive(99999)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: FAIL — `../process-controller.js` does not exist

- [ ] **Step 3: Create process-controller.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/process-controller.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { Logger } from "@teamsland/observability";

/**
 * 子进程启动参数
 *
 * @example
 * ```typescript
 * import type { SpawnParams } from "@teamsland/sidecar";
 *
 * const params: SpawnParams = {
 *   issueId: "ISSUE-42",
 *   worktreePath: "/repos/frontend/.worktrees/req-42",
 *   initialPrompt: "请实现用户登录功能",
 * };
 * ```
 */
export interface SpawnParams {
  /** 关联的 Meego Issue ID */
  issueId: string;
  /** Git worktree 工作目录路径 */
  worktreePath: string;
  /** 初始任务提示词 */
  initialPrompt: string;
}

/**
 * 进程启动结果
 *
 * @example
 * ```typescript
 * import type { SpawnResult } from "@teamsland/sidecar";
 *
 * const result: SpawnResult = {
 *   pid: 12345,
 *   sessionId: "sess-abc",
 *   stdout: new ReadableStream(),
 * };
 * ```
 */
export interface SpawnResult {
  /** Claude CLI 进程 PID */
  pid: number;
  /** 关联的会话 ID（从首条 system 事件中提取） */
  sessionId: string;
  /** Claude CLI stdout ReadableStream，供 SidecarDataPlane 消费 */
  stdout: ReadableStream<Uint8Array>;
}

/**
 * Claude Code 子进程控制器
 *
 * 负责通过 `Bun.spawn` 启动和管理 Claude CLI 子进程。
 * stdout 同时 tee 到 `/tmp/req-{issueId}.jsonl` 便于离线调试。
 *
 * @example
 * ```typescript
 * import { ProcessController } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const controller = new ProcessController({ logger: createLogger("sidecar:process") });
 *
 * const result = await controller.spawn({
 *   issueId: "ISSUE-42",
 *   worktreePath: "/repos/frontend/.worktrees/req-42",
 *   initialPrompt: "请为 /api/login 添加 rate limiting",
 * });
 * console.log("pid:", result.pid, "session:", result.sessionId);
 * ```
 */
export class ProcessController {
  private readonly logger: Logger;

  constructor(opts: { logger: Logger }) {
    this.logger = opts.logger;
  }

  /**
   * 启动 Claude Code 子进程
   *
   * 执行命令：
   * `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions`
   *
   * 行为：
   * 1. 以 `params.worktreePath` 为 CWD 调用 `Bun.spawn`
   * 2. 向 stdin 写入单条 JSON 信封（含 `initialPrompt`）后关闭 stdin
   * 3. 从 stdout 读取首条 NDJSON 行，解析出 `sessionId`（system 事件）
   * 4. 将 stdout tee 到 `/tmp/req-{issueId}.jsonl` 供调试
   * 5. 返回 `SpawnResult`
   *
   * @param params - 启动参数
   * @returns 进程启动结果
   *
   * @example
   * ```typescript
   * const { pid, sessionId, stdout } = await controller.spawn({
   *   issueId: "ISSUE-42",
   *   worktreePath: "/repos/fe/.worktrees/req-42",
   *   initialPrompt: "重构 AuthService",
   * });
   * ```
   */
  async spawn(params: SpawnParams): Promise<SpawnResult> {
    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "bypassPermissions",
      ],
      {
        cwd: params.worktreePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // 写入 JSON 信封并关闭 stdin
    const envelope = JSON.stringify({ prompt: params.initialPrompt });
    proc.stdin.write(envelope + "\n");
    proc.stdin.end();

    this.logger.info(
      { pid: proc.pid, issueId: params.issueId },
      "Claude CLI 子进程已启动",
    );

    // 从 stdout 读取首行提取 sessionId
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sessionId = randomUUID(); // fallback

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines[lines.length - 1] ?? "";
      for (let i = 0; i < lines.length - 1; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed.type === "system" && typeof parsed.session_id === "string") {
            sessionId = parsed.session_id;
          }
        } catch {
          // 首行解析失败，使用 fallback sessionId
        }
        break outer;
      }
    }
    reader.releaseLock();

    // tee stdout 到调试日志文件（后台写入，不阻塞调用方）
    const debugPath = `/tmp/req-${params.issueId}.jsonl`;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const teeStream = proc.stdout.pipeThrough(new TransformStream());

    // 启动后台 tee 写入
    (async () => {
      try {
        const writer = writable.getWriter();
        const teeReader = teeStream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await teeReader.read();
          if (done) break;
          chunks.push(value);
          await writer.write(value);
        }
        await writer.close();
        teeReader.releaseLock();
        // 写入调试文件
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        await Bun.write(debugPath, merged);
      } catch (err) {
        this.logger.warn({ err, debugPath }, "stdout tee 写入失败");
      }
    })();

    return {
      pid: proc.pid,
      sessionId,
      stdout: readable,
    };
  }

  /**
   * 中断子进程
   *
   * - `hard = false`（默认）：发送 SIGINT，允许优雅退出
   * - `hard = true`：发送 SIGKILL，立即终止
   *
   * @param pid - 目标进程 PID
   * @param hard - 是否强制终止，默认 false
   *
   * @example
   * ```typescript
   * // 优雅中断
   * controller.interrupt(12345);
   *
   * // 强制终止
   * controller.interrupt(12345, true);
   * ```
   */
  interrupt(pid: number, hard = false): void {
    const signal = hard ? "SIGKILL" : "SIGINT";
    process.kill(pid, signal);
    this.logger.info({ pid, signal }, "子进程中断信号已发送");
  }

  /**
   * 检查进程是否存活
   *
   * 通过 `process.kill(pid, 0)` 探测进程是否存在。
   * 若进程不存在或无权访问，返回 false。
   *
   * @param pid - 目标进程 PID
   * @returns 进程存活返回 true，否则 false
   *
   * @example
   * ```typescript
   * if (!controller.isAlive(12345)) {
   *   logger.warn({ pid: 12345 }, "进程已退出，触发重试");
   * }
   * ```
   */
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: All 6 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/process-controller.ts packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/process-controller.ts packages/sidecar/src/__tests__/process-controller.test.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add process-controller.ts — ProcessController Bun.spawn wrapper

TDD: 6 tests covering spawn JSON envelope write, sessionId extraction,
stdout ReadableStream return, interrupt SIGINT/SIGKILL, and isAlive probe.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create registry.ts — SubagentRegistry (TDD)

**Files:**
- Create: `packages/sidecar/src/registry.ts`
- Create: `packages/sidecar/src/__tests__/registry.test.ts`

- [ ] **Step 1: Create registry test**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/__tests__/registry.test.ts`:

```typescript
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRecord, SidecarConfig } from "@teamsland/types";
import { SubagentRegistry, CapacityError } from "../registry.js";

const restConfig: Omit<SidecarConfig, "maxConcurrentSessions"> = {
  maxRetryCount: 3,
  maxDelegateDepth: 2,
  workerTimeoutSeconds: 300,
  healthCheckTimeoutMs: 30000,
  minSwarmSuccessRatio: 0.5,
};

function makeFakeLarkNotifier() {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRecord(agentId: string, pid: number): AgentRecord {
  return {
    agentId,
    pid,
    sessionId: `sess-${agentId}`,
    issueId: `ISSUE-${agentId}`,
    worktreePath: `/tmp/worktree-${agentId}`,
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
  };
}

describe("SubagentRegistry", () => {
  it("register: 正常注册后可通过 get 检索", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    expect(registry.get("agent-a")).toBeDefined();
    expect(registry.get("agent-a")?.pid).toBe(1001);
  });

  it("register: 容量超限抛出 CapacityError", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 1, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    expect(() => registry.register(makeRecord("agent-b", 1002))).toThrow(CapacityError);
  });

  it("CapacityError: current 和 max 字段正确", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 2, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.register(makeRecord("agent-b", 1002));
    try {
      registry.register(makeRecord("agent-c", 1003));
      expect.fail("应抛出 CapacityError");
    } catch (err) {
      expect(err).toBeInstanceOf(CapacityError);
      const capacityErr = err as CapacityError;
      expect(capacityErr.current).toBe(2);
      expect(capacityErr.max).toBe(2);
    }
  });

  it("unregister: 移除已注册的 Agent", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.unregister("agent-a");
    expect(registry.get("agent-a")).toBeUndefined();
    expect(registry.runningCount()).toBe(0);
  });

  it("unregister: 不存在的 agentId 静默忽略", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    expect(() => registry.unregister("nonexistent")).not.toThrow();
  });

  it("runningCount: 正确反映注册表大小", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    expect(registry.runningCount()).toBe(0);
    registry.register(makeRecord("agent-a", 1001));
    expect(registry.runningCount()).toBe(1);
    registry.register(makeRecord("agent-b", 1002));
    expect(registry.runningCount()).toBe(2);
  });

  it("allRunning: 返回所有注册的 AgentRecord 快照", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.register(makeRecord("agent-b", 1002));
    const all = registry.allRunning();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.agentId).sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("persist/restoreOnStartup: 存活进程正确恢复，死进程被清除", async () => {
    const path = join(tmpdir(), `test-registry-${Date.now()}.json`);

    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });

    // process.pid 是当前进程，必然存活；999999999 不存在
    registry.register(makeRecord("agent-alive", process.pid));
    registry.register(makeRecord("agent-dead", 999999999));
    await registry.persist();

    const restored = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });
    await restored.restoreOnStartup();

    expect(restored.runningCount()).toBe(1);
    expect(restored.get("agent-alive")).toBeDefined();
    expect(restored.get("agent-dead")).toBeUndefined();
  });

  it("restoreOnStartup: 文件不存在时静默跳过", async () => {
    const path = join(tmpdir(), `nonexistent-registry-${Date.now()}.json`);
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });
    await expect(registry.restoreOnStartup()).resolves.toBeUndefined();
    expect(registry.runningCount()).toBe(0);
  });

  it("toRegistryState: 快照包含所有 Agent 和 updatedAt", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    const state = registry.toRegistryState();
    expect(state.agents).toHaveLength(1);
    expect(state.updatedAt).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/registry.test.ts`
Expected: FAIL — `../registry.js` does not exist

- [ ] **Step 3: Create registry.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/registry.ts`:

```typescript
import type { AgentRecord, RegistryState, SidecarConfig } from "@teamsland/types";
import type { LarkNotifier } from "@teamsland/lark";
import type { Logger } from "@teamsland/observability";

/**
 * 容量超限错误
 *
 * 当并发 Agent 数量达到 `SidecarConfig.maxConcurrentSessions` 时抛出。
 * 调用方应捕获此错误并通过 LarkNotifier 发送 DM 通知任务发起人。
 *
 * @example
 * ```typescript
 * import { SubagentRegistry, CapacityError } from "@teamsland/sidecar";
 *
 * try {
 *   registry.register(record);
 * } catch (err) {
 *   if (err instanceof CapacityError) {
 *     await notifier.sendDm(userId, `容量已满（${err.current}/${err.max}），任务排队等待`);
 *   }
 * }
 * ```
 */
export class CapacityError extends Error {
  /** 当前运行中的 Agent 数量 */
  readonly current: number;
  /** 最大允许并发数 */
  readonly max: number;

  constructor(current: number, max: number) {
    super(`容量超限：当前 ${current} / 最大 ${max}`);
    this.name = "CapacityError";
    this.current = current;
    this.max = max;
  }
}

/**
 * SubagentRegistry 构造参数
 */
export interface SubagentRegistryOpts {
  /** Sidecar 配置（用于读取 maxConcurrentSessions） */
  config: SidecarConfig;
  /** 飞书通知器（容量告警时发送 DM） */
  notifier: LarkNotifier;
  /** 注册表持久化文件路径，默认 `/tmp/teamsland-registry.json` */
  registryPath?: string;
  /** 可选 logger，不传则不记录日志 */
  logger?: Logger;
}

/**
 * Agent 注册表
 *
 * 维护所有运行中 Claude Code 子进程的内存索引，支持崩溃恢复。
 * 持久化采用 write-tmp + rename 的原子写入策略。
 *
 * @example
 * ```typescript
 * import { SubagentRegistry } from "@teamsland/sidecar";
 *
 * const registry = new SubagentRegistry({
 *   config: sidecarConfig,
 *   notifier: larkNotifier,
 *   registryPath: "/var/run/teamsland/registry.json",
 * });
 *
 * await registry.restoreOnStartup();
 * ```
 */
export class SubagentRegistry {
  private readonly map = new Map<string, AgentRecord>();
  private readonly config: SidecarConfig;
  private readonly registryPath: string;
  private readonly logger: Logger | undefined;

  constructor(opts: SubagentRegistryOpts) {
    this.config = opts.config;
    this.registryPath = opts.registryPath ?? "/tmp/teamsland-registry.json";
    this.logger = opts.logger;
  }

  /**
   * 注册 Agent
   *
   * 将 AgentRecord 添加到内存注册表。
   * 若当前运行数 >= maxConcurrentSessions，抛出 CapacityError。
   *
   * @param record - Agent 记录
   * @throws {CapacityError} 容量超限时抛出
   *
   * @example
   * ```typescript
   * registry.register({
   *   agentId: "agent-001",
   *   pid: 12345,
   *   sessionId: "sess-abc",
   *   issueId: "ISSUE-42",
   *   worktreePath: "/repos/fe/.worktrees/req-42",
   *   status: "running",
   *   retryCount: 0,
   *   createdAt: Date.now(),
   * });
   * ```
   */
  register(record: AgentRecord): void {
    const current = this.map.size;
    if (current >= this.config.maxConcurrentSessions) {
      throw new CapacityError(current, this.config.maxConcurrentSessions);
    }
    this.map.set(record.agentId, record);
    this.logger?.info({ agentId: record.agentId, pid: record.pid }, "Agent 注册成功");
  }

  /**
   * 注销 Agent
   *
   * 从内存注册表中移除指定 agentId 的记录。
   * 若 agentId 不存在则静默忽略。
   *
   * @param agentId - Agent 唯一标识
   *
   * @example
   * ```typescript
   * registry.unregister("agent-001");
   * ```
   */
  unregister(agentId: string): void {
    this.map.delete(agentId);
    this.logger?.info({ agentId }, "Agent 注销完成");
  }

  /**
   * 获取单条 Agent 记录
   *
   * @param agentId - Agent 唯一标识
   * @returns Agent 记录，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const record = registry.get("agent-001");
   * if (record) {
   *   console.log("状态:", record.status);
   * }
   * ```
   */
  get(agentId: string): AgentRecord | undefined {
    return this.map.get(agentId);
  }

  /**
   * 获取当前运行中的 Agent 数量
   *
   * @returns 内存注册表中的条目总数
   *
   * @example
   * ```typescript
   * console.log(`当前运行: ${registry.runningCount()} 个 Agent`);
   * ```
   */
  runningCount(): number {
    return this.map.size;
  }

  /**
   * 获取所有运行中的 Agent 记录列表
   *
   * @returns AgentRecord 数组（快照，修改不影响内部状态）
   *
   * @example
   * ```typescript
   * for (const agent of registry.allRunning()) {
   *   console.log(agent.agentId, agent.pid);
   * }
   * ```
   */
  allRunning(): AgentRecord[] {
    return [...this.map.values()];
  }

  /**
   * 将注册表状态原子写入磁盘
   *
   * 策略：先写临时文件，再 rename 覆盖目标文件，保证原子性。
   *
   * @example
   * ```typescript
   * await registry.persist();
   * ```
   */
  async persist(): Promise<void> {
    const state = this.toRegistryState();
    const json = JSON.stringify(state, null, 2);
    const tmpPath = `${this.registryPath}.tmp`;
    await Bun.write(tmpPath, json);
    // rename 在同一文件系统内是原子操作
    const fs = await import("node:fs/promises");
    await fs.rename(tmpPath, this.registryPath);
    this.logger?.info({ path: this.registryPath }, "注册表已持久化");
  }

  /**
   * 启动时从磁盘恢复注册表
   *
   * 行为：
   * 1. 读取 registryPath 文件（不存在则跳过）
   * 2. 解析 JSON 为 RegistryState
   * 3. 对每条记录检查 isAlive(pid)，死进程直接丢弃
   * 4. 将存活的 AgentRecord 重新加载到内存注册表
   *
   * 设计为幂等操作，多次调用无副作用。
   *
   * @example
   * ```typescript
   * await registry.restoreOnStartup();
   * logger.info({ count: registry.runningCount() }, "注册表恢复完成");
   * ```
   */
  async restoreOnStartup(): Promise<void> {
    const file = Bun.file(this.registryPath);
    if (!(await file.exists())) return;

    const text = await file.text();
    const state = JSON.parse(text) as RegistryState;

    let restored = 0;
    let cleaned = 0;
    for (const record of state.agents) {
      if (this.isAlive(record.pid)) {
        this.map.set(record.agentId, record);
        restored++;
      } else {
        cleaned++;
      }
    }
    this.logger?.info({ restored, cleaned }, "注册表恢复完成");
  }

  /**
   * 导出注册表状态快照
   *
   * @returns RegistryState 快照（含所有运行中 Agent + 更新时间戳）
   *
   * @example
   * ```typescript
   * const state = registry.toRegistryState();
   * console.log(state.agents.length, state.updatedAt);
   * ```
   */
  toRegistryState(): RegistryState {
    return {
      agents: this.allRunning(),
      updatedAt: Date.now(),
    };
  }

  /** 探测进程存活（内联实现，避免依赖 ProcessController） */
  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/registry.test.ts`
Expected: All 10 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/registry.ts packages/sidecar/src/__tests__/registry.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/registry.ts packages/sidecar/src/__tests__/registry.test.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add registry.ts — SubagentRegistry + CapacityError

TDD: 10 tests covering register/unregister, capacity enforcement,
persist/restoreOnStartup dead-process cleanup, and toRegistryState.
Atomic write via tmp-file rename pattern.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create data-plane.ts — SidecarDataPlane (TDD)

**Files:**
- Create: `packages/sidecar/src/data-plane.ts`
- Create: `packages/sidecar/src/__tests__/data-plane.test.ts`

- [ ] **Step 1: Create data-plane test**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/__tests__/data-plane.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "@teamsland/observability";
import { SidecarDataPlane } from "../data-plane.js";
import type { SubagentRegistry } from "../registry.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => l + "\n").join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function makeNdjsonStreamChunked(lines: string[], chunkSize: number): ReadableStream<Uint8Array> {
  const text = lines.map((l) => l + "\n").join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      let offset = 0;
      while (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      }
      controller.close();
    },
  });
}

function makeFakeRegistry(): SubagentRegistry {
  const records = new Map<string, { status: string; pid: number }>();
  return {
    get: (agentId: string) => records.get(agentId) as never,
    unregister: vi.fn((agentId: string) => { records.delete(agentId); }),
    register: vi.fn(),
    runningCount: vi.fn().mockReturnValue(0),
    allRunning: vi.fn().mockReturnValue([]),
    persist: vi.fn().mockResolvedValue(undefined),
    restoreOnStartup: vi.fn().mockResolvedValue(undefined),
    toRegistryState: vi.fn().mockReturnValue({ agents: [], updatedAt: 0 }),
  } as unknown as SubagentRegistry;
}

describe("SidecarDataPlane", () => {
  it("processStream: 拦截 delegate 工具调用，不写入 SessionDB", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "tool_use", name: "delegate", input: {} }),
      JSON.stringify({ type: "assistant", content: "已完成分析" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // delegate 被拦截，只有 assistant 消息写入 DB
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 拦截 spawn_agent 工具调用", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "tool_use", name: "spawn_agent", input: {} }),
      JSON.stringify({ type: "tool_use", name: "bash", input: { command: "ls" } }),
    ];

    await dataPlane.processStream("agent-002", makeNdjsonStream(lines));

    // spawn_agent 拦截，bash 正常写入
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 流结束后自动注销 Agent", async () => {
    const registry = makeFakeRegistry();
    const fakeSessionDb = { appendMessage: vi.fn().mockResolvedValue(1) };

    const dataPlane = new SidecarDataPlane({
      registry,
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    await dataPlane.processStream("agent-001", makeNdjsonStream([]));

    expect(registry.unregister).toHaveBeenCalledWith("agent-001");
  });

  it("processStream: 单行 JSON 解析失败不中断整个流", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      "INVALID JSON {{{",
      JSON.stringify({ type: "assistant", content: "正常消息" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // 无效 JSON 跳过，assistant 消息正常写入
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 跨 chunk 的行正确拼接", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "assistant", content: "消息一" }),
      JSON.stringify({ type: "assistant", content: "消息二" }),
    ];

    // 使用小 chunk size 模拟跨行切割
    await dataPlane.processStream("agent-001", makeNdjsonStreamChunked(lines, 5));

    expect(appendedMessages).toHaveLength(2);
  });

  it("processStream: log 事件不写入 SessionDB", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "log", message: "调试信息" }),
      JSON.stringify({ type: "system", session_id: "sess-123" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // log 和 system 均不写入 DB
    expect(appendedMessages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/data-plane.test.ts`
Expected: FAIL — `../data-plane.js` does not exist

- [ ] **Step 3: Create data-plane.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/data-plane.ts`:

```typescript
import type { Logger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type { SubagentRegistry } from "./registry.js";

/**
 * NDJSON 事件类型
 */
export type SidecarEventType =
  | "tool_use"
  | "result"
  | "error"
  | "system"
  | "assistant"
  | "log";

/**
 * 被拦截的 Worker 工具名称
 *
 * Worker 子进程不得调用这些工具（防止递归委派）。
 * 数据平面层拦截后记录警告，不转发给调用方。
 */
export type InterceptedTool = "delegate" | "spawn_agent" | "memory_write";

const INTERCEPTED_TOOLS: Set<string> = new Set([
  "delegate",
  "spawn_agent",
  "memory_write",
]);

/**
 * Sidecar 数据平面
 *
 * 消费 Claude Code 的 NDJSON stdout 流，按事件类型路由，
 * 持久化消息到 SessionDB，并拦截 Worker 不应执行的工具调用。
 *
 * @example
 * ```typescript
 * import { SidecarDataPlane } from "@teamsland/sidecar";
 *
 * const dataPlane = new SidecarDataPlane({ registry, sessionDb, logger });
 *
 * // 消费进程 stdout 流（后台运行，不阻塞调用方）
 * dataPlane.processStream("agent-001", spawnResult.stdout).catch((err) => {
 *   logger.error({ err }, "流处理异常");
 * });
 * ```
 */
export class SidecarDataPlane {
  private readonly registry: SubagentRegistry;
  private readonly sessionDb: SessionDB;
  private readonly logger: Logger;

  constructor(opts: {
    registry: SubagentRegistry;
    sessionDb: SessionDB;
    logger: Logger;
  }) {
    this.registry = opts.registry;
    this.sessionDb = opts.sessionDb;
    this.logger = opts.logger;
  }

  /**
   * 处理 Agent stdout NDJSON 流
   *
   * 逐行读取 ReadableStream，解析 JSON 事件，按 `type` 字段路由：
   * - `tool_use`：检查是否为拦截工具，是则记录警告并跳过，否则写入 SessionDB
   * - `result`：写入 SessionDB，更新 AgentRecord.status 为 "completed"
   * - `error`：写入 SessionDB，更新 AgentRecord.status 为 "failed"，记录错误日志
   * - `system`：提取 sessionId 等元数据，记录 info 日志
   * - `assistant`：写入 SessionDB（消息内容）
   * - `log`：记录 debug 日志，不写入 SessionDB
   *
   * 流结束后自动从 registry 注销 Agent。
   * 任何单行解析错误只记录 warn，不中断流处理。
   *
   * @param agentId - 目标 Agent ID（用于查找 registry 记录）
   * @param stdout - Claude CLI 的 stdout ReadableStream
   *
   * @example
   * ```typescript
   * const { pid, sessionId, stdout } = await controller.spawn(params);
   * dataPlane.processStream(agentId, stdout).catch((err) => {
   *   logger.error({ err, agentId }, "流处理异常");
   * });
   * ```
   */
  async processStream(agentId: string, stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          await this.routeEvent(agentId, trimmed);
        }
      }
      // 处理残余 buffer
      if (buffer.trim()) {
        await this.routeEvent(agentId, buffer.trim());
      }
    } finally {
      reader.releaseLock();
      this.registry.unregister(agentId);
    }
  }

  /** 解析单行 JSON 并按事件类型路由 */
  private async routeEvent(agentId: string, line: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.logger.warn({ agentId, line }, "NDJSON 行解析失败，跳过");
      return;
    }

    const type = event.type as string | undefined;

    switch (type) {
      case "tool_use": {
        const toolName = event.name as string | undefined;
        if (toolName && INTERCEPTED_TOOLS.has(toolName)) {
          this.logger.warn({ agentId, toolName }, "拦截 Worker 禁止工具调用");
          return;
        }
        await this.appendToSession(agentId, event);
        break;
      }
      case "result": {
        await this.appendToSession(agentId, event);
        this.updateStatus(agentId, "completed");
        break;
      }
      case "error": {
        await this.appendToSession(agentId, event);
        this.updateStatus(agentId, "failed");
        this.logger.error({ agentId, event }, "Agent 进程报错");
        break;
      }
      case "system": {
        this.logger.info({ agentId, sessionId: event.session_id }, "system 事件");
        break;
      }
      case "assistant": {
        await this.appendToSession(agentId, event);
        break;
      }
      case "log": {
        this.logger.debug({ agentId, event }, "log 事件");
        break;
      }
      default: {
        this.logger.debug({ agentId, type }, "未知事件类型");
        break;
      }
    }
  }

  /** 将事件写入 SessionDB */
  private async appendToSession(agentId: string, event: Record<string, unknown>): Promise<void> {
    const record = this.registry.get(agentId);
    const sessionId = record?.sessionId ?? agentId;
    try {
      await this.sessionDb.appendMessage({
        sessionId,
        role: "assistant",
        content: JSON.stringify(event),
        createdAt: Date.now(),
      });
    } catch (err) {
      this.logger.warn({ agentId, err }, "写入 SessionDB 失败");
    }
  }

  /** 更新 AgentRecord 状态 */
  private updateStatus(agentId: string, status: "completed" | "failed"): void {
    const record = this.registry.get(agentId);
    if (record) {
      record.status = status;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/data-plane.test.ts`
Expected: All 6 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/data-plane.ts packages/sidecar/src/__tests__/data-plane.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/data-plane.ts packages/sidecar/src/__tests__/data-plane.test.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add data-plane.ts — SidecarDataPlane NDJSON stream router

TDD: 6 tests covering tool interception (delegate/spawn_agent), auto-unregister
on stream close, JSON parse error resilience, cross-chunk line buffering,
and log/system event non-persistence.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create message-bus.ts — ObservableMessageBus (TDD)

**Files:**
- Create: `packages/sidecar/src/message-bus.ts`
- Create: `packages/sidecar/src/__tests__/message-bus.test.ts`

- [ ] **Step 1: Create message-bus test**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/__tests__/message-bus.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { TeamMessage } from "@teamsland/types";
import type { Logger } from "@teamsland/observability";
import { ObservableMessageBus } from "../message-bus.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

const baseMsg: TeamMessage = {
  traceId: "existing-trace",
  fromAgent: "orchestrator",
  toAgent: "agent-001",
  type: "delegation",
  payload: { issueId: "ISSUE-42" },
  timestamp: Date.now(),
};

describe("ObservableMessageBus", () => {
  it("send: traceId 为空字符串时自动注入 UUID", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "" });

    expect(received[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("send: traceId 非空时保留原值", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "custom-trace-id" });

    expect(received[0]).toBe("custom-trace-id");
  });

  it("send: 注入的 UUID 每次不同", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "" });
    bus.send({ ...baseMsg, traceId: "" });

    expect(received[0]).not.toBe(received[1]);
  });

  it("on: 多个 handler 均被调用", () => {
    const callCounts = [0, 0];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on(() => callCounts[0]++);
    bus.on(() => callCounts[1]++);

    bus.send({ ...baseMsg, traceId: "t1" });

    expect(callCounts).toEqual([1, 1]);
  });

  it("send: handler 接收到完整消息字段", () => {
    const received: TeamMessage[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg));

    bus.send(baseMsg);

    expect(received[0].fromAgent).toBe("orchestrator");
    expect(received[0].toAgent).toBe("agent-001");
    expect(received[0].type).toBe("delegation");
    expect(received[0].payload).toEqual({ issueId: "ISSUE-42" });
  });

  it("send: 记录结构化日志（info 被调用）", () => {
    const infoSpy = vi.fn();
    const loggerWithSpy = { ...fakeLogger, info: infoSpy };
    const bus = new ObservableMessageBus({ logger: loggerWithSpy as unknown as Logger });

    bus.send(baseMsg);

    expect(infoSpy).toHaveBeenCalledOnce();
    const [fields] = infoSpy.mock.calls[0];
    expect(fields).toMatchObject({
      fromAgent: "orchestrator",
      toAgent: "agent-001",
      type: "delegation",
    });
  });

  it("on: 无 handler 注册时 send 不抛出异常", () => {
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    expect(() => bus.send(baseMsg)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/message-bus.test.ts`
Expected: FAIL — `../message-bus.js` does not exist

- [ ] **Step 3: Create message-bus.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/message-bus.ts`:

```typescript
import { randomUUID } from "node:crypto";
import type { TeamMessage } from "@teamsland/types";
import type { Logger } from "@teamsland/observability";

/**
 * 可观测消息总线
 *
 * Agent 间消息传递的透明代理层，提供两个关键能力：
 * 1. **traceId 注入**：发送时自动补全缺失的 traceId（`crypto.randomUUID()`）
 * 2. **结构化日志**：每条消息均以结构化字段记录（fromAgent、toAgent、type、traceId）
 *
 * 不修改消息的其他字段，保持格式透明。
 *
 * @example
 * ```typescript
 * import { ObservableMessageBus } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const bus = new ObservableMessageBus({
 *   logger: createLogger("sidecar:bus"),
 * });
 *
 * bus.on((msg) => {
 *   console.log("收到消息:", msg.type, "来自:", msg.fromAgent);
 * });
 *
 * bus.send({
 *   fromAgent: "orchestrator",
 *   toAgent: "agent-001",
 *   type: "delegation",
 *   payload: { issueId: "ISSUE-42" },
 *   timestamp: Date.now(),
 *   traceId: "", // 空值将被自动替换为 UUID
 * });
 * ```
 */
export class ObservableMessageBus {
  private readonly logger: Logger;
  private readonly handlers: Array<(msg: TeamMessage) => void> = [];

  constructor(opts: { logger: Logger }) {
    this.logger = opts.logger;
  }

  /**
   * 发送消息
   *
   * 若 `msg.traceId` 为空或未定义，自动生成并注入 UUID。
   * 注入后以结构化字段记录日志，再同步调用所有已注册的 handler。
   *
   * @param msg - 待发送的团队消息
   *
   * @example
   * ```typescript
   * bus.send({
   *   traceId: "", // 空值将被自动替换为 UUID
   *   fromAgent: "orchestrator",
   *   toAgent: "agent-002",
   *   type: "status_update",
   *   payload: { status: "running" },
   *   timestamp: Date.now(),
   * });
   * ```
   */
  send(msg: TeamMessage): void {
    const traced: TeamMessage = {
      ...msg,
      traceId: msg.traceId || randomUUID(),
    };

    this.logger.info(
      {
        traceId: traced.traceId,
        fromAgent: traced.fromAgent,
        toAgent: traced.toAgent,
        type: traced.type,
      },
      "消息发送",
    );

    for (const handler of this.handlers) {
      handler(traced);
    }
  }

  /**
   * 注册消息处理器
   *
   * 同一个 bus 实例可注册多个 handler，消息发送时依次调用。
   * handler 应避免抛出异常（异常会中断后续 handler 的调用）。
   *
   * @param handler - 消息处理函数
   *
   * @example
   * ```typescript
   * bus.on((msg) => {
   *   if (msg.type === "task_result") {
   *     console.log("任务完成:", msg.payload);
   *   }
   * });
   * ```
   */
  on(handler: (msg: TeamMessage) => void): void {
    this.handlers.push(handler);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/message-bus.test.ts`
Expected: All 7 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/message-bus.ts packages/sidecar/src/__tests__/message-bus.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/message-bus.ts packages/sidecar/src/__tests__/message-bus.test.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add message-bus.ts — ObservableMessageBus traceId injection

TDD: 7 tests covering empty traceId UUID injection, existing traceId
preservation, UUID uniqueness, multi-handler dispatch, message field
integrity, structured logging, and zero-handler safety.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create alerter.ts — Alerter (TDD)

**Files:**
- Create: `packages/sidecar/src/alerter.ts`
- Create: `packages/sidecar/src/__tests__/alerter.test.ts`

- [ ] **Step 1: Create alerter test**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/__tests__/alerter.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { Alerter } from "../alerter.js";

function makeFakeNotifier() {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Alerter", () => {
  it("check: 超过阈值时发送飞书卡片", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("concurrent_agents", 19, 18);

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
    const [channelId] = fakeNotifier.sendCard.mock.calls[0];
    expect(channelId).toBe("oc_test");
  });

  it("check: 等于阈值时不发送（value <= threshold 不触发）", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("concurrent_agents", 18, 18);

    expect(fakeNotifier.sendCard).not.toHaveBeenCalled();
  });

  it("check: 未超过阈值时不发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("memory_usage", 70, 80);

    expect(fakeNotifier.sendCard).not.toHaveBeenCalled();
  });

  it("check: 冷却窗口内不重复发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("cpu_usage", 95, 80);
    await alerter.check("cpu_usage", 95, 80); // 第二次在冷却期内

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
  });

  it("check: 不同指标冷却窗口相互独立", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("metric_a", 100, 90);
    await alerter.check("metric_b", 100, 90); // 不同指标，不受 metric_a 冷却影响

    expect(fakeNotifier.sendCard).toHaveBeenCalledTimes(2);
  });

  it("check: 冷却过期后可再次发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 0, // 零冷却时间，立即过期
    });

    await alerter.check("cpu", 95, 80);
    await alerter.check("cpu", 95, 80);

    expect(fakeNotifier.sendCard).toHaveBeenCalledTimes(2);
  });

  it("check: 卡片内容包含指标名和数值", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("error_rate_pct", 15, 10);

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
    const [, card] = fakeNotifier.sendCard.mock.calls[0];
    expect(card.title).toContain("error_rate_pct");
    expect(card.content).toContain("15");
    expect(card.content).toContain("10");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/alerter.test.ts`
Expected: FAIL — `../alerter.js` does not exist

- [ ] **Step 3: Create alerter.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/sidecar/src/alerter.ts`:

```typescript
import type { LarkNotifier } from "@teamsland/lark";

/**
 * 飞书告警器
 *
 * 监控数值指标，超过阈值时发送飞书卡片告警。
 * 每个指标独立维护冷却窗口（默认 5 分钟），避免告警风暴。
 *
 * @example
 * ```typescript
 * import { Alerter } from "@teamsland/sidecar";
 *
 * const alerter = new Alerter({
 *   notifier: larkNotifier,
 *   channelId: "oc_team_channel",
 *   cooldownMs: 5 * 60 * 1000, // 5 分钟，默认值
 * });
 *
 * // 在健康检查循环中调用
 * await alerter.check("concurrent_agents", registry.runningCount(), 18);
 * await alerter.check("error_rate_pct", errorRate, 10);
 * ```
 */
export class Alerter {
  private readonly notifier: LarkNotifier;
  private readonly channelId: string;
  private readonly cooldownMs: number;
  /** 指标名 → 最后告警 Unix 毫秒 */
  private readonly cooldownMap = new Map<string, number>();

  constructor(opts: {
    /** 飞书通知器 */
    notifier: LarkNotifier;
    /** 告警目标频道 ID */
    channelId: string;
    /** 每指标冷却时间（毫秒），默认 300000（5 分钟） */
    cooldownMs?: number;
  }) {
    this.notifier = opts.notifier;
    this.channelId = opts.channelId;
    this.cooldownMs = opts.cooldownMs ?? 300_000;
  }

  /**
   * 检查指标并在必要时发送告警
   *
   * 当 `value > threshold` 且该指标不在冷却窗口内时：
   * 1. 更新指标的最后告警时间戳
   * 2. 通过 LarkNotifier 向 channelId 发送飞书卡片
   * 3. 卡片内容包含：指标名、当前值、阈值、时间戳
   *
   * 若处于冷却期，静默跳过（不发送，不记录 warn）。
   *
   * @param metric - 指标名称（用于冷却 Map 的 key 和卡片标题）
   * @param value - 当前指标值
   * @param threshold - 告警阈值（严格超过则触发）
   *
   * @example
   * ```typescript
   * // 检查并发 Agent 数是否超过容量的 90%
   * await alerter.check(
   *   "concurrent_agents",
   *   registry.runningCount(),
   *   Math.floor(config.maxConcurrentSessions * 0.9),
   * );
   * ```
   */
  async check(metric: string, value: number, threshold: number): Promise<void> {
    if (value <= threshold) return;

    const lastFired = this.cooldownMap.get(metric) ?? 0;
    const now = Date.now();
    if (now - lastFired < this.cooldownMs) return;

    this.cooldownMap.set(metric, now);
    await this.notifier.sendCard(this.channelId, {
      title: `告警：${metric}`,
      content: `当前值 ${value} 超过阈值 ${threshold}`,
      timestamp: new Date(now).toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/src/__tests__/alerter.test.ts`
Expected: All 7 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/alerter.ts packages/sidecar/src/__tests__/alerter.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/alerter.ts packages/sidecar/src/__tests__/alerter.test.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add alerter.ts — Alerter cooldown-gated Lark alerts

TDD: 7 tests covering threshold triggering, equality non-triggering,
cooldown suppression, independent per-metric cooldowns, cooldown expiry,
and card content validation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Update barrel exports in index.ts

**Files:**
- Modify: `packages/sidecar/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/sidecar/src/index.ts`:

```typescript
// @teamsland/sidecar — ProcessController, SubagentRegistry, SidecarDataPlane,
//                       ObservableMessageBus, Alerter
// Claude Code 子进程管理：进程控制 + Agent 注册 + NDJSON 流解析 + 消息总线 + 告警

export { ProcessController } from "./process-controller.js";
export type { SpawnResult, SpawnParams } from "./process-controller.js";

export { SubagentRegistry, CapacityError } from "./registry.js";
export type { SubagentRegistryOpts } from "./registry.js";

export { SidecarDataPlane } from "./data-plane.js";
export type { SidecarEventType, InterceptedTool } from "./data-plane.js";

export { ObservableMessageBus } from "./message-bus.js";

export { Alerter } from "./alerter.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/index.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/sidecar/src/index.ts && git commit -m "$(cat <<'EOF'
feat(sidecar): add barrel exports — full public API surface

Exports: ProcessController, SubagentRegistry, CapacityError,
SidecarDataPlane, ObservableMessageBus, Alerter, and all interface types.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full Verification

- [ ] **Step 1: Run all sidecar tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/sidecar/`
Expected: All tests pass (process-controller × 6, registry × 10, data-plane × 6, message-bus × 7, alerter × 7 = 36 total)

- [ ] **Step 2: Run typecheck for sidecar package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/sidecar/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on entire sidecar package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/sidecar/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "
import {
  ProcessController, SubagentRegistry, CapacityError,
  SidecarDataPlane, ObservableMessageBus, Alerter,
} from './packages/sidecar/src/index.ts';
console.log('ProcessController:', typeof ProcessController);
console.log('SubagentRegistry:', typeof SubagentRegistry);
console.log('CapacityError:', typeof CapacityError);
console.log('SidecarDataPlane:', typeof SidecarDataPlane);
console.log('ObservableMessageBus:', typeof ObservableMessageBus);
console.log('Alerter:', typeof Alerter);
"`
Expected:
```
ProcessController: function
SubagentRegistry: function
CapacityError: function
SidecarDataPlane: function
ObservableMessageBus: function
Alerter: function
```

- [ ] **Step 5: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/sidecar/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output (or only in type-safe positions like `catch (err: unknown)`)

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/sidecar/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No non-null assertions

- [ ] **Step 6: Verify file count**

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/sidecar/src/*.ts | wc -l`
Expected: 6 (process-controller, registry, data-plane, message-bus, alerter, index)

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/sidecar/src/__tests__/*.test.ts | wc -l`
Expected: 5 test files

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/sidecar/` — all 36 tests pass
2. `bunx tsc --noEmit --project packages/sidecar/tsconfig.json` — exits 0
3. `bunx biome check packages/sidecar/src/` — no errors
4. All exported functions/classes have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. All 6 exports from barrel: ProcessController, SubagentRegistry, CapacityError, SidecarDataPlane, ObservableMessageBus, Alerter
7. `@teamsland/observability` added to package.json as workspace dep
8. `SubagentRegistry.restoreOnStartup()` correctly skips dead PIDs and restores live ones
9. `SidecarDataPlane.processStream()` maintains line buffer across Uint8Array chunks
10. `SidecarDataPlane` intercepts `delegate`, `spawn_agent`, `memory_write` tool calls
11. `Alerter.check()` uses per-metric independent cooldown Map (not global)
12. `ObservableMessageBus.send()` injects UUID only when traceId is falsy
13. `ProcessController.isAlive()` uses `process.kill(pid, 0)` probe with try/catch
14. `SubagentRegistry.persist()` uses atomic tmp-file-rename pattern
