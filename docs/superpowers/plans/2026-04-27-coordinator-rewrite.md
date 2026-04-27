# Coordinator 重写实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写 Coordinator 和 Worker 的 CLI 集成层，正确使用 Claude Code CLI 的 stream-json 双向协议、--session-id、--resume 等能力，消灭全部 20 个架构缺口。

**Architecture:** 保留 CLI 作为执行引擎，Coordinator 通过双向 stream-json 常驻进程处理事件（有效期轮转），Worker 通过 stdout result 事件直接获得完成信号。删除 WorkerLifecycleMonitor、AnomalyDetector、ObservableMessageBus、旧 ProcessController/DataPlane。

**Tech Stack:** Bun, TypeScript, Claude Code CLI 2.1.x, vitest, SQLite (PersistentQueue)

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/sidecar/src/cli-process.ts` | 封装 CLI 进程 spawn/resume/stream-json 解析的底层原语 |
| `packages/sidecar/src/cli-process.test.ts` | CliProcess 单元测试 |
| `packages/sidecar/src/worker-manager.ts` | Worker 生命周期管理（spawn、完成信号、通知） |
| `packages/sidecar/src/worker-manager.test.ts` | WorkerManager 单元测试 |
| `apps/server/src/coordinator-process.ts` | Coordinator 常驻进程管理（session 轮转、真同步 processEvent） |
| `apps/server/src/__tests__/coordinator-process.test.ts` | CoordinatorProcess 单元测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/queue/src/types.ts` | WorkerCompletedPayload 增加 chatId/senderId；删除死类型 |
| `packages/queue/src/index.ts` | 同步删除死类型的 re-export |
| `packages/types/src/coordinator.ts` | CoordinatorEventType 删除死类型；CoordinatorSessionManagerConfig 增加 maxEventsPerSession |
| `packages/types/src/sidecar.ts` | AgentOrigin.senderId 和 chatId 改为必填（非 optional） |
| `packages/sidecar/src/index.ts` | 更新 barrel export：增加新模块，移除旧模块 |
| `apps/server/src/coordinator-event-mapper.ts` | 删除死类型映射；修复 status_changed 字段名；worker_completed 增加 chatId/senderId 提取 |
| `apps/server/src/coordinator-prompt.ts` | 删除死类型 prompt builder；修复 buildMeegoIssueStatusChanged 字段名；buildWorkerCompleted 增加 chatId |
| `apps/server/src/coordinator-context.ts` | extractRequesterId 增加 senderId 识别；删除 StubContextLoader |
| `apps/server/src/coordinator-init.ts` | 删除 settings.json 生成；简化为只生成 system prompt 文件 |
| `apps/server/src/event-handlers.ts` | 增加 lark_dm case；registerAgent 设置 origin；移除 ProcessController/DataPlane 依赖 |
| `apps/server/src/worker-handlers.ts` | 修复 findAssigneeForIssue；失败通知用户 |
| `apps/server/src/init/coordinator.ts` | 用 CoordinatorProcess 替换 CoordinatorSessionManager；删除 WorkerLifecycleMonitor/AnomalyDetector |
| `apps/server/src/main.ts` | 适配新的初始化流程 |

### 删除文件

| 文件 | 原因 |
|------|------|
| `packages/sidecar/src/message-bus.ts` | 零消费者 |
| `packages/sidecar/src/__tests__/message-bus.test.ts` | 对应测试 |
| `apps/server/src/worker-lifecycle.ts` | 被 WorkerManager stdout 监听替代 |
| `apps/server/src/__tests__/worker-lifecycle.test.ts` | 对应测试 |
| `apps/server/src/coordinator.ts` | 被 coordinator-process.ts 替代 |
| `apps/server/src/__tests__/coordinator.test.ts` | 被新测试替代 |
| `apps/server/src/__tests__/coordinator-session-persistence.test.ts` | session 持久化逻辑简化 |
| `apps/server/src/__tests__/coordinator-async.test.ts` | 旧异步模型测试 |
| `apps/server/src/diagnosis-handler.ts` | diagnosis_ready 是死类型 |

---

## Task 1: 清理队列类型系统（删除死类型，修复 payload）

**Files:**
- Modify: `packages/queue/src/types.ts:44-56,225-234,252-259,277-328`
- Modify: `packages/queue/src/index.ts:3-16`
- Modify: `packages/types/src/coordinator.ts:13-26,177-189`
- Modify: `packages/types/src/sidecar.ts:28-38`
- Test: `apps/server/src/__tests__/coordinator-event-mapper.test.ts`

- [ ] **Step 1: 写测试验证 WorkerCompletedPayload 包含 chatId 和 senderId**

在 `apps/server/src/__tests__/coordinator-event-mapper.test.ts` 中增加测试：

```typescript
it("worker_completed: 提取 chatId 和 senderId", () => {
  const msg = createQueueMessage("worker_completed", {
    workerId: "w-1",
    sessionId: "s-1",
    issueId: "ISS-1",
    resultSummary: "done",
    chatId: "oc_xxx",
    senderId: "ou_yyy",
  });
  const event = toCoordinatorEvent(msg);
  expect(event.payload.chatId).toBe("oc_xxx");
  expect(event.payload.senderId).toBe("ou_yyy");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- apps/server/src/__tests__/coordinator-event-mapper.test.ts --run`
Expected: FAIL — `chatId` 和 `senderId` 不在 payload 中

- [ ] **Step 3: 修改 QueueMessageType 删除死类型**

`packages/queue/src/types.ts` 第 44-56 行，将 `QueueMessageType` 改为：

```typescript
export type QueueMessageType =
  | "lark_mention"
  | "lark_dm"
  | "meego_issue_created"
  | "meego_issue_status_changed"
  | "meego_issue_assigned"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly";
```

删除 `"worker_interrupted"` | `"worker_resumed"` | `"diagnosis_ready"`。

- [ ] **Step 4: 修改 WorkerCompletedPayload 增加 chatId 和 senderId**

`packages/queue/src/types.ts` 第 225-234 行，修改为：

```typescript
export interface WorkerCompletedPayload {
  workerId: string;
  sessionId: string;
  issueId: string;
  resultSummary: string;
  chatId?: string;
  senderId?: string;
  senderName?: string;
}
```

- [ ] **Step 5: 修改 WorkerAnomalyPayload 增加 chatId 和 senderId**

`packages/queue/src/types.ts` 第 252-259 行，修改为：

```typescript
export interface WorkerAnomalyPayload {
  workerId: string;
  anomalyType: "timeout" | "error_spike" | "stuck" | "crash" | "unexpected_exit";
  details: string;
  chatId?: string;
  senderId?: string;
}
```

- [ ] **Step 6: 删除死类型的 payload interface**

删除 `packages/queue/src/types.ts` 中的：
- `DiagnosisReadyPayload`（第 277-284 行）
- `WorkerInterruptedPayload`（第 301-306 行）
- `WorkerResumedPayload`（第 322-328 行）

更新 `QueuePayload` union（第 131-139 行）移除这三个类型。

- [ ] **Step 7: 更新 queue barrel export**

`packages/queue/src/index.ts` 删除 `DiagnosisReadyPayload` 的 re-export。

- [ ] **Step 8: 修改 CoordinatorEventType 删除死类型**

`packages/types/src/coordinator.ts` 第 13-26 行，改为：

```typescript
export type CoordinatorEventType =
  | "lark_mention"
  | "lark_dm"
  | "meego_issue_created"
  | "meego_issue_assigned"
  | "meego_issue_status_changed"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "user_query";
```

删除 `"worker_timeout"` | `"worker_interrupted"` | `"worker_resumed"` | `"diagnosis_ready"`。

- [ ] **Step 9: CoordinatorSessionManagerConfig 增加 maxEventsPerSession**

`packages/types/src/coordinator.ts` 第 177-189 行，在 `inferenceTimeoutMs` 后增加：

```typescript
maxEventsPerSession: number;
```

- [ ] **Step 10: AgentOrigin 的 chatId 和 senderId 改为必填**

`packages/types/src/sidecar.ts` 第 28-38 行，修改为：

```typescript
export interface AgentOrigin {
  chatId: string;
  messageId?: string;
  senderId: string;
  senderName?: string;
  assigneeId?: string;
  source: "meego" | "lark_mention" | "lark_dm" | "coordinator";
}
```

- [ ] **Step 11: 更新 coordinator-event-mapper 的 worker_completed 提取器**

`apps/server/src/coordinator-event-mapper.ts` 第 161-163 行，改为：

```typescript
worker_completed: (payload: Record<string, unknown>) => ({
  workerId: payload.workerId,
  sessionId: payload.sessionId,
  issueId: payload.issueId,
  resultSummary: payload.resultSummary,
  chatId: payload.chatId,
  senderId: payload.senderId,
  senderName: payload.senderName,
}),
```

- [ ] **Step 12: 删除 mapper 中的死类型映射**

删除 `coordinator-event-mapper.ts` 中 `TYPE_MAP`（第 14-26 行）、`PRIORITY_MAP`（第 38-50 行）、`PAYLOAD_EXTRACTORS`（第 85-185 行）里所有 `diagnosis_ready`、`worker_interrupted`、`worker_resumed` 的条目。

- [ ] **Step 13: 修复 meego_issue_status_changed 字段名**

`coordinator-event-mapper.ts` 第 141-149 行，将 `status` → `newStatus`，`previousStatus` → `oldStatus`：

```typescript
meego_issue_status_changed: (payload: Record<string, unknown>) => ({
  issueId: (payload as MeegoEventPayload).event?.payload?.issueId,
  projectKey: (payload as MeegoEventPayload).event?.payload?.projectKey,
  newStatus: (payload as MeegoEventPayload).event?.payload?.status,
  oldStatus: (payload as MeegoEventPayload).event?.payload?.previousStatus,
}),
```

- [ ] **Step 14: 运行测试确认通过**

Run: `bun run test -- apps/server/src/__tests__/coordinator-event-mapper.test.ts --run`
Expected: PASS

- [ ] **Step 15: 运行全量 typecheck 确认类型一致**

Run: `bun run typecheck`
Expected: 可能有类型错误需要在后续 Task 中修复（coordinator.ts 等文件引用了被删除的类型），记录但不在此 Task 修复。

- [ ] **Step 16: Commit**

```bash
git add packages/queue/src/types.ts packages/queue/src/index.ts packages/types/src/coordinator.ts packages/types/src/sidecar.ts apps/server/src/coordinator-event-mapper.ts apps/server/src/__tests__/coordinator-event-mapper.test.ts
git commit -m "refactor(types): remove dead queue types, add chatId/senderId to worker payloads"
```

---

## Task 2: 构建 CliProcess 底层原语

**Files:**
- Create: `packages/sidecar/src/cli-process.ts`
- Create: `packages/sidecar/src/__tests__/cli-process.test.ts`
- Modify: `packages/sidecar/src/index.ts`

- [ ] **Step 1: 写 CliProcess 的类型定义和测试骨架**

创建 `packages/sidecar/src/__tests__/cli-process.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}));

import { CliProcess, type CliProcessOpts, type ResultEvent } from "../cli-process.js";

function createMockSpawn(): CliProcessOpts["spawnFn"] {
  return vi.fn().mockImplementation((args: string[], _opts: unknown) => {
    const stdin = {
      write: vi.fn(),
      flush: vi.fn(),
      end: vi.fn(),
    };
    // 模拟 stdout 发出 system init + result
    const initLine = JSON.stringify({
      type: "system", subtype: "init", session_id: "test-session-001",
    });
    const resultLine = JSON.stringify({
      type: "result", subtype: "success", result: "test output",
      session_id: "test-session-001", duration_ms: 100, num_turns: 1,
    });
    const stdout = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(initLine + "\n" + resultLine + "\n"));
        controller.close();
      },
    });
    const stderr = new ReadableStream({ start(c) { c.close(); } });
    return {
      pid: 12345,
      stdin,
      stdout,
      stderr,
      exited: Promise.resolve(0),
      killed: false,
      kill: vi.fn(),
    };
  });
}

describe("CliProcess", () => {
  it("sendMessage: 写入 stream-json 格式并等待 result 事件", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "test-session-001",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    const result = await cli.sendMessage("say hello");
    expect(result.type).toBe("result");
    expect(result.result).toBe("test output");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("sendMessage: 超时抛出错误", async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
      // stdout 永远不发 result
      const stdout = new ReadableStream({ start() { /* never close */ } });
      const stderr = new ReadableStream({ start(c) { c.close(); } });
      return {
        pid: 12345, stdin, stdout, stderr,
        exited: new Promise<number>(() => {}),
        killed: false, kill: vi.fn(),
      };
    });
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
      resultTimeoutMs: 100,
    });
    await cli.start();
    await expect(cli.sendMessage("hello")).rejects.toThrow("timeout");
  });

  it("isAlive: 进程退出后返回 false", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    await cli.sendMessage("hello"); // 消费 stdout 使其关闭
    // 等进程退出
    await vi.waitFor(() => expect(cli.isAlive()).toBe(false));
  });

  it("terminate: 关闭 stdin 并等待进程退出", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    await cli.terminate();
    expect(cli.isAlive()).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- packages/sidecar/src/__tests__/cli-process.test.ts --run`
Expected: FAIL — `../cli-process.js` 不存在

- [ ] **Step 3: 实现 CliProcess**

创建 `packages/sidecar/src/cli-process.ts`：

```typescript
import { createLogger } from "@teamsland/observability";

const logger = createLogger("sidecar:cli-process");

export interface ResultEvent {
  type: "result";
  subtype: string;
  result: string;
  session_id: string;
  duration_ms: number;
  num_turns: number;
  is_error?: boolean;
  total_cost_usd?: number;
}

export interface AssistantEvent {
  type: "assistant";
  message: {
    content: Array<{ type: string; text?: string }>;
  };
  session_id: string;
}

export type StreamEvent =
  | { type: "system"; subtype: string; session_id: string; [k: string]: unknown }
  | AssistantEvent
  | ResultEvent
  | { type: string; [k: string]: unknown };

interface BunLikeStdin {
  write(data: string | Uint8Array): number | void;
  flush?(): void;
  end(): void;
}

interface BunLikeProcess {
  pid: number;
  stdin: BunLikeStdin;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  killed: boolean;
  kill(signal?: number): void;
}

export interface CliProcessOpts {
  sessionId: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  spawnFn?: (args: string[], opts: { cwd?: string; env?: Record<string, string>; stdio: string[] }) => BunLikeProcess;
  resultTimeoutMs?: number;
  resumeSessionId?: string;
}

export class CliProcess {
  private proc: BunLikeProcess | null = null;
  private buffer = "";
  private pendingResult: {
    resolve: (event: ResultEvent) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private alive = false;
  private streamDone = false;

  readonly sessionId: string;
  private readonly args: string[];
  private readonly cwd?: string;
  private readonly env?: Record<string, string>;
  private readonly spawnFn: NonNullable<CliProcessOpts["spawnFn"]>;
  private readonly resultTimeoutMs: number;
  private readonly resumeSessionId?: string;

  private onExitCallback: ((code: number) => void) | null = null;
  private onStreamEventCallback: ((event: StreamEvent) => void) | null = null;

  constructor(opts: CliProcessOpts) {
    this.sessionId = opts.sessionId;
    this.args = opts.args;
    this.cwd = opts.cwd;
    this.env = opts.env;
    this.spawnFn = opts.spawnFn ?? defaultSpawnFn;
    this.resultTimeoutMs = opts.resultTimeoutMs ?? 5 * 60 * 1000;
    this.resumeSessionId = opts.resumeSessionId;
  }

  async start(): Promise<void> {
    const cliArgs = [
      "claude", "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      ...this.args,
    ];

    if (this.resumeSessionId) {
      cliArgs.push("--resume", this.resumeSessionId);
    } else {
      cliArgs.push("--session-id", this.sessionId);
    }

    this.proc = this.spawnFn(cliArgs, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.alive = true;
    this.streamDone = false;
    this.consumeStdout();
    this.consumeStderr();

    this.proc.exited.then((code) => {
      this.alive = false;
      logger.info({ sessionId: this.sessionId, code }, "CLI 进程退出");
      this.onExitCallback?.(code);
      // 如果有 pending result，reject 它
      if (this.pendingResult) {
        this.pendingResult.reject(new Error(`CLI process exited with code ${code} before result`));
        clearTimeout(this.pendingResult.timer);
        this.pendingResult = null;
      }
    });
  }

  sendMessage(content: string): Promise<ResultEvent> {
    if (!this.proc || !this.alive) {
      return Promise.reject(new Error("CLI process not alive"));
    }

    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content },
    });
    this.proc.stdin.write(msg + "\n");
    this.proc.stdin.flush?.();

    return new Promise<ResultEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResult = null;
        reject(new Error(`Result timeout after ${this.resultTimeoutMs}ms`));
      }, this.resultTimeoutMs);

      this.pendingResult = { resolve, reject, timer };
    });
  }

  async terminate(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.stdin.end();
    } catch { /* stdin may already be closed */ }
    try {
      await Promise.race([
        this.proc.exited,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("terminate timeout")), 5000)
        ),
      ]);
    } catch {
      this.proc.kill(9);
    }
    this.alive = false;
  }

  isAlive(): boolean {
    return this.alive && !this.streamDone;
  }

  onExit(callback: (code: number) => void): void {
    this.onExitCallback = callback;
  }

  onStreamEvent(callback: (event: StreamEvent) => void): void {
    this.onStreamEventCallback = callback;
  }

  private consumeStdout(): void {
    const reader = this.proc!.stdout.getReader();
    const decoder = new TextDecoder();

    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            this.streamDone = true;
            break;
          }
          this.buffer += decoder.decode(value, { stream: true });
          this.processBuffer();
        }
      } catch (err) {
        logger.warn({ err, sessionId: this.sessionId }, "stdout 读取错误");
        this.streamDone = true;
      }
    };
    read();
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as StreamEvent;
        this.onStreamEventCallback?.(event);

        if (event.type === "result" && this.pendingResult) {
          clearTimeout(this.pendingResult.timer);
          this.pendingResult.resolve(event as ResultEvent);
          this.pendingResult = null;
        }
      } catch {
        logger.debug({ line: line.slice(0, 200), sessionId: this.sessionId }, "无法解析 NDJSON 行");
      }
    }
  }

  private consumeStderr(): void {
    const reader = this.proc!.stderr.getReader();
    const decoder = new TextDecoder();
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true }).trim();
          if (text) logger.debug({ stderr: text.slice(0, 500), sessionId: this.sessionId }, "CLI stderr");
        }
      } catch { /* ignore */ }
    };
    read();
  }
}

function defaultSpawnFn(args: string[], opts: { cwd?: string; env?: Record<string, string>; stdio: string[] }) {
  const [cmd, ...rest] = args;
  return Bun.spawn([cmd, ...rest], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test -- packages/sidecar/src/__tests__/cli-process.test.ts --run`
Expected: PASS

- [ ] **Step 5: 更新 sidecar barrel export**

`packages/sidecar/src/index.ts` 增加：

```typescript
export type { AssistantEvent, CliProcessOpts, ResultEvent, StreamEvent } from "./cli-process.js";
export { CliProcess } from "./cli-process.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/cli-process.ts packages/sidecar/src/__tests__/cli-process.test.ts packages/sidecar/src/index.ts
git commit -m "feat(sidecar): add CliProcess primitive for stream-json bidirectional CLI communication"
```

---

## Task 3: 构建 WorkerManager

**Files:**
- Create: `packages/sidecar/src/worker-manager.ts`
- Create: `packages/sidecar/src/__tests__/worker-manager.test.ts`
- Modify: `packages/sidecar/src/index.ts`

- [ ] **Step 1: 写 WorkerManager 测试**

创建 `packages/sidecar/src/__tests__/worker-manager.test.ts`：

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}));

import type { AgentRecord } from "@teamsland/types";
import { WorkerManager, type SpawnWorkerParams, type WorkerEvent } from "../worker-manager.js";

function createMockRegistry() {
  const map = new Map<string, AgentRecord>();
  return {
    register: vi.fn((record: AgentRecord) => map.set(record.agentId, record)),
    unregister: vi.fn((id: string) => map.delete(id)),
    get: vi.fn((id: string) => map.get(id)),
    allRunning: vi.fn(() => [...map.values()]),
    runningCount: vi.fn(() => map.size),
  };
}

function createMockQueue() {
  return {
    enqueue: vi.fn(),
  };
}

function createMockNotifier() {
  return {
    sendDm: vi.fn(),
    sendCard: vi.fn(),
  };
}

function createMockSpawnFn(resultText = "task done") {
  return vi.fn().mockImplementation(() => {
    const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "w-session-1" });
    const resultLine = JSON.stringify({
      type: "result", subtype: "success", result: resultText,
      session_id: "w-session-1", duration_ms: 5000, num_turns: 3,
    });
    const stdout = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(initLine + "\n" + resultLine + "\n"));
        controller.close();
      },
    });
    const stderr = new ReadableStream({ start(c) { c.close(); } });
    return { pid: 99, stdin, stdout, stderr, exited: Promise.resolve(0), killed: false, kill: vi.fn() };
  });
}

describe("WorkerManager", () => {
  afterEach(() => vi.restoreAllMocks());

  it("spawnWorker: 注册 worker 并在 result 后入队 worker_completed", async () => {
    const registry = createMockRegistry();
    const queue = createMockQueue();
    const notifier = createMockNotifier();
    const spawnFn = createMockSpawnFn("task done");

    const mgr = new WorkerManager({
      registry: registry as any,
      queue: queue as any,
      notifier: notifier as any,
      spawnFn,
      workerSystemPromptPath: "/tmp/worker.md",
      defaultAllowedTools: ["Read", "Edit"],
    });

    const events: WorkerEvent[] = [];
    mgr.onWorkerEvent((e) => events.push(e));

    const workerId = await mgr.spawnWorker({
      prompt: "fix the bug",
      issueId: "ISS-1",
      projectKey: "PROJ",
      origin: { chatId: "oc_xxx", senderId: "ou_yyy", source: "lark_mention" },
    });

    // 等 result 事件被处理
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(registry.register).toHaveBeenCalledOnce();
    const registered = registry.register.mock.calls[0][0];
    expect(registered.origin.chatId).toBe("oc_xxx");
    expect(registered.origin.senderId).toBe("ou_yyy");

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_completed",
        payload: expect.objectContaining({
          workerId,
          resultSummary: "task done",
          chatId: "oc_xxx",
          senderId: "ou_yyy",
        }),
      }),
    );
  });

  it("spawnWorker: 进程异常退出时入队 worker_anomaly 并通知用户", async () => {
    const registry = createMockRegistry();
    const queue = createMockQueue();
    const notifier = createMockNotifier();

    const spawnFn = vi.fn().mockImplementation(() => {
      const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
      const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "w-s-2" });
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(initLine + "\n"));
          controller.close(); // 没有 result 就关了
        },
      });
      const stderr = new ReadableStream({ start(c) { c.close(); } });
      return { pid: 100, stdin, stdout, stderr, exited: Promise.resolve(1), killed: false, kill: vi.fn() };
    });

    const mgr = new WorkerManager({
      registry: registry as any,
      queue: queue as any,
      notifier: notifier as any,
      spawnFn,
      workerSystemPromptPath: "/tmp/worker.md",
      defaultAllowedTools: ["Read"],
    });

    const events: WorkerEvent[] = [];
    mgr.onWorkerEvent((e) => events.push(e));

    await mgr.spawnWorker({
      prompt: "do something",
      issueId: "ISS-2",
      projectKey: "PROJ",
      origin: { chatId: "oc_aaa", senderId: "ou_bbb", source: "lark_dm" },
    });

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));

    expect(queue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "worker_anomaly",
        payload: expect.objectContaining({
          anomalyType: "unexpected_exit",
          chatId: "oc_aaa",
          senderId: "ou_bbb",
        }),
      }),
    );
    expect(notifier.sendDm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- packages/sidecar/src/__tests__/worker-manager.test.ts --run`
Expected: FAIL — `../worker-manager.js` 不存在

- [ ] **Step 3: 实现 WorkerManager**

创建 `packages/sidecar/src/worker-manager.ts`：

```typescript
import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { AgentOrigin, AgentRecord } from "@teamsland/types";
import { CliProcess, type CliProcessOpts, type ResultEvent } from "./cli-process.js";
import type { SubagentRegistry } from "./registry.js";

const logger = createLogger("sidecar:worker-manager");

export interface WorkerManagerOpts {
  registry: SubagentRegistry;
  queue: { enqueue(opts: { type: string; payload: Record<string, unknown>; priority: string; traceId: string }): string };
  notifier: { sendDm(userId: string, text: string): Promise<void>; sendCard(title: string, content: string, level?: string): Promise<void> };
  spawnFn?: CliProcessOpts["spawnFn"];
  workerSystemPromptPath: string;
  defaultAllowedTools: string[];
  maxBudgetPerWorker?: number;
}

export interface SpawnWorkerParams {
  prompt: string;
  issueId: string;
  projectKey: string;
  origin: AgentOrigin;
  allowedTools?: string[];
  worktreeName?: string;
  maxBudgetUsd?: number;
}

export interface WorkerEvent {
  type: "completed" | "failed";
  workerId: string;
  issueId: string;
  result?: string;
  exitCode?: number | null;
  origin: AgentOrigin;
}

export class WorkerManager {
  private readonly registry: WorkerManagerOpts["registry"];
  private readonly queue: WorkerManagerOpts["queue"];
  private readonly notifier: WorkerManagerOpts["notifier"];
  private readonly spawnFn: CliProcessOpts["spawnFn"];
  private readonly workerSystemPromptPath: string;
  private readonly defaultAllowedTools: string[];
  private readonly maxBudgetPerWorker: number;

  private readonly activeProcesses = new Map<string, CliProcess>();
  private workerEventCallback: ((event: WorkerEvent) => void) | null = null;

  constructor(opts: WorkerManagerOpts) {
    this.registry = opts.registry;
    this.queue = opts.queue;
    this.notifier = opts.notifier;
    this.spawnFn = opts.spawnFn;
    this.workerSystemPromptPath = opts.workerSystemPromptPath;
    this.defaultAllowedTools = opts.defaultAllowedTools;
    this.maxBudgetPerWorker = opts.maxBudgetPerWorker ?? 2.0;
  }

  onWorkerEvent(callback: (event: WorkerEvent) => void): void {
    this.workerEventCallback = callback;
  }

  async spawnWorker(params: SpawnWorkerParams): Promise<string> {
    const workerId = randomUUID();
    const tools = params.allowedTools ?? this.defaultAllowedTools;

    const record: AgentRecord = {
      agentId: workerId,
      pid: 0, // 会在 start 后更新
      sessionId: workerId,
      issueId: params.issueId,
      worktreePath: "",
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
      origin: params.origin,
      taskPrompt: params.prompt.slice(0, 500),
    };
    this.registry.register(record);

    const cliArgs = [
      "--bare",
      "--append-system-prompt-file", this.workerSystemPromptPath,
      "--allowedTools", tools.join(","),
      "--dangerously-skip-permissions",
    ];

    if (params.maxBudgetUsd ?? this.maxBudgetPerWorker) {
      cliArgs.push("--max-budget-usd", String(params.maxBudgetUsd ?? this.maxBudgetPerWorker));
    }
    if (params.worktreeName) {
      cliArgs.push("--worktree", params.worktreeName);
    }

    const cli = new CliProcess({
      sessionId: workerId,
      args: cliArgs,
      spawnFn: this.spawnFn,
    });

    this.activeProcesses.set(workerId, cli);
    await cli.start();

    // 监听进程退出（异常退出时 handleFailed）
    let resultReceived = false;

    cli.onExit((code) => {
      if (!resultReceived) {
        this.handleWorkerFailed(workerId, code);
      }
      this.activeProcesses.delete(workerId);
    });

    // 发送初始 prompt，异步等 result
    cli.sendMessage(params.prompt).then(
      (result) => {
        resultReceived = true;
        this.handleWorkerCompleted(workerId, result);
      },
      (err) => {
        logger.error({ err, workerId }, "Worker sendMessage 失败");
        // onExit 会处理
      },
    );

    return workerId;
  }

  async sendToWorker(workerId: string, message: string): Promise<ResultEvent> {
    const cli = this.activeProcesses.get(workerId);
    if (!cli || !cli.isAlive()) {
      throw new Error(`Worker ${workerId} is not alive`);
    }
    return cli.sendMessage(message);
  }

  private handleWorkerCompleted(workerId: string, resultEvent: ResultEvent): void {
    const record = this.registry.get(workerId);
    if (!record) return;

    const event: WorkerEvent = {
      type: "completed",
      workerId,
      issueId: record.issueId,
      result: resultEvent.result,
      origin: record.origin!,
    };
    this.workerEventCallback?.(event);

    this.queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: record.agentId,
        sessionId: record.sessionId,
        issueId: record.issueId,
        resultSummary: resultEvent.result,
        chatId: record.origin?.chatId,
        senderId: record.origin?.senderId,
        senderName: record.origin?.senderName,
      },
      priority: "normal",
      traceId: `worker-${workerId}-completed`,
    });

    this.registry.unregister(workerId);
  }

  private async handleWorkerFailed(workerId: string, exitCode: number | null): Promise<void> {
    const record = this.registry.get(workerId);
    if (!record) return;

    const event: WorkerEvent = {
      type: "failed",
      workerId,
      issueId: record.issueId,
      exitCode,
      origin: record.origin!,
    };
    this.workerEventCallback?.(event);

    // 通知用户
    if (record.origin?.senderId) {
      try {
        await this.notifier.sendDm(
          record.origin.senderId,
          `⚠️ 任务 ${record.issueId} 处理失败 (exit code: ${exitCode})。团队已收到通知。`,
        );
      } catch (err) {
        logger.warn({ err, workerId }, "通知用户失败");
      }
    }

    // 通知团队频道
    try {
      await this.notifier.sendCard(
        "Worker 异常退出",
        `Worker ${workerId} (任务: ${record.issueId}) 以 exit code ${exitCode} 退出`,
        "error",
      );
    } catch (err) {
      logger.warn({ err, workerId }, "通知团队频道失败");
    }

    this.queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: record.agentId,
        anomalyType: "unexpected_exit",
        details: `exit code: ${exitCode}`,
        chatId: record.origin?.chatId,
        senderId: record.origin?.senderId,
      },
      priority: "high",
      traceId: `worker-${workerId}-failed`,
    });

    this.registry.unregister(workerId);
  }

  async terminateAll(): Promise<void> {
    const promises = [...this.activeProcesses.values()].map((cli) => cli.terminate());
    await Promise.allSettled(promises);
    this.activeProcesses.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test -- packages/sidecar/src/__tests__/worker-manager.test.ts --run`
Expected: PASS

- [ ] **Step 5: 更新 sidecar barrel export**

`packages/sidecar/src/index.ts` 增加：

```typescript
export type { SpawnWorkerParams, WorkerEvent, WorkerManagerOpts } from "./worker-manager.js";
export { WorkerManager } from "./worker-manager.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/worker-manager.ts packages/sidecar/src/__tests__/worker-manager.test.ts packages/sidecar/src/index.ts
git commit -m "feat(sidecar): add WorkerManager with stdout result signal and origin tracking"
```

---

## Task 4: 构建 CoordinatorProcess（真同步 + session 轮转）

**Files:**
- Create: `apps/server/src/coordinator-process.ts`
- Create: `apps/server/src/__tests__/coordinator-process.test.ts`

- [ ] **Step 1: 写 CoordinatorProcess 测试**

创建 `apps/server/src/__tests__/coordinator-process.test.ts`：

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
}));

import type { CoordinatorEvent } from "@teamsland/types";
import { CoordinatorProcess } from "../coordinator-process.js";

function makeEvent(overrides: Partial<CoordinatorEvent> = {}): CoordinatorEvent {
  return {
    type: "lark_mention",
    id: "evt-1",
    timestamp: Date.now(),
    priority: 1,
    payload: { chatId: "oc_xxx", senderId: "ou_yyy", message: "hello" },
    ...overrides,
  };
}

function createMockSpawnFn(resultText = "I spawned a worker") {
  return vi.fn().mockImplementation(() => {
    const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
    const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "coord-s-1" });
    const resultLine = JSON.stringify({
      type: "result", subtype: "success", result: resultText,
      session_id: "coord-s-1", duration_ms: 2000, num_turns: 2,
    });
    const stdout = new ReadableStream({
      start(controller) {
        // 延迟 emit 以模拟真实推理
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(initLine + "\n"));
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(resultLine + "\n"));
            // 不关闭 — 常驻进程
          }, 50);
        }, 10);
      },
    });
    const stderr = new ReadableStream({ start(c) { c.close(); } });
    return { pid: 200, stdin, stdout, stderr, exited: new Promise(() => {}), killed: false, kill: vi.fn() };
  });
}

function createMockContextLoader() {
  return {
    load: vi.fn().mockResolvedValue({
      taskStateSummary: "无运行中 Worker",
      recentMessages: "",
      relevantMemories: "",
    }),
  };
}

function createMockPromptBuilder() {
  return {
    build: vi.fn().mockReturnValue("formatted prompt"),
  };
}

describe("CoordinatorProcess", () => {
  afterEach(() => vi.restoreAllMocks());

  it("processEvent: 真同步等待 result 后返回", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Bash(teamsland *)", "Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 20,
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader() as any,
      promptBuilder: createMockPromptBuilder() as any,
      spawnFn,
    });

    const result = await coord.processEvent(makeEvent());

    expect(result.result).toBe("I spawned a worker");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("processEvent: 连续两个事件复用同一个进程", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 20,
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader() as any,
      promptBuilder: createMockPromptBuilder() as any,
      spawnFn,
    });

    await coord.processEvent(makeEvent({ id: "evt-1" }));
    await coord.processEvent(makeEvent({ id: "evt-2" }));

    // 同一个进程，只 spawn 一次
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("processEvent: 事件数达上限后轮转 session", async () => {
    const spawnFn = createMockSpawnFn();
    const coord = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 2, // 2 个事件后轮转
        resultTimeoutMs: 10_000,
      },
      contextLoader: createMockContextLoader() as any,
      promptBuilder: createMockPromptBuilder() as any,
      spawnFn,
    });

    await coord.processEvent(makeEvent({ id: "evt-1" }));
    await coord.processEvent(makeEvent({ id: "evt-2" }));
    // 第 3 个事件应该触发新进程
    await coord.processEvent(makeEvent({ id: "evt-3" }));

    // spawn 被调用两次：第一次初始，第二次轮转
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- apps/server/src/__tests__/coordinator-process.test.ts --run`
Expected: FAIL

- [ ] **Step 3: 实现 CoordinatorProcess**

创建 `apps/server/src/coordinator-process.ts`：

```typescript
import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import { CliProcess, type CliProcessOpts, type ResultEvent } from "@teamsland/sidecar";
import type {
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorState,
} from "@teamsland/types";

const logger = createLogger("server:coordinator-process");

export interface CoordinatorPromptBuilderLike {
  build(event: CoordinatorEvent, context: CoordinatorContext): string;
}

export interface CoordinatorProcessConfig {
  workspacePath: string;
  systemPromptPath: string;
  allowedTools: string[];
  sessionMaxLifetimeMs: number;
  maxEventsPerSession: number;
  resultTimeoutMs: number;
}

export interface CoordinatorProcessOpts {
  config: CoordinatorProcessConfig;
  contextLoader: CoordinatorContextLoader;
  promptBuilder: CoordinatorPromptBuilderLike;
  spawnFn?: CliProcessOpts["spawnFn"];
}

export class CoordinatorProcess {
  private cli: CliProcess | null = null;
  private sessionId: string | null = null;
  private eventCount = 0;
  private startedAt = 0;
  private state: CoordinatorState = "idle";
  private stateChangeCallback: ((state: CoordinatorState, eventId?: string) => void) | null = null;

  private readonly config: CoordinatorProcessConfig;
  private readonly contextLoader: CoordinatorContextLoader;
  private readonly promptBuilder: CoordinatorPromptBuilderLike;
  private readonly spawnFn?: CliProcessOpts["spawnFn"];

  constructor(opts: CoordinatorProcessOpts) {
    this.config = opts.config;
    this.contextLoader = opts.contextLoader;
    this.promptBuilder = opts.promptBuilder;
    this.spawnFn = opts.spawnFn;
  }

  async processEvent(event: CoordinatorEvent): Promise<ResultEvent> {
    const cli = await this.ensureProcess();

    this.setState("running", event.id);

    const context = await this.contextLoader.load(event);
    const prompt = this.promptBuilder.build(event, context);

    try {
      const result = await cli.sendMessage(prompt);
      this.eventCount++;
      this.setState("idle", event.id);

      if (this.shouldRotateSession()) {
        await this.rotateSession();
      }

      return result;
    } catch (err) {
      logger.error({ err, eventId: event.id }, "processEvent 失败");
      this.setState("failed", event.id);
      // 进程可能已经死了，下次 ensureProcess 会重新 spawn
      this.cli = null;
      throw err;
    }
  }

  getState(): CoordinatorState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  onStateChange(callback: (state: CoordinatorState, eventId?: string) => void): void {
    this.stateChangeCallback = callback;
  }

  async reset(): Promise<void> {
    if (this.cli) {
      await this.cli.terminate();
      this.cli = null;
    }
    this.sessionId = null;
    this.eventCount = 0;
    this.setState("idle");
  }

  private async ensureProcess(): Promise<CliProcess> {
    if (this.cli?.isAlive()) return this.cli;

    // 如果有未过期的旧 session，用 --resume 恢复
    const shouldResume = this.sessionId && !this.isSessionExpired();

    const newSessionId = shouldResume ? null : randomUUID();
    if (newSessionId) {
      this.sessionId = newSessionId;
    }

    const args = [
      "--bare",
      "--append-system-prompt-file", this.config.systemPromptPath,
      "--allowedTools", this.config.allowedTools.join(","),
      "--dangerously-skip-permissions",
    ];

    this.cli = new CliProcess({
      sessionId: this.sessionId!,
      args,
      cwd: this.config.workspacePath,
      spawnFn: this.spawnFn,
      resultTimeoutMs: this.config.resultTimeoutMs,
      resumeSessionId: shouldResume ? this.sessionId! : undefined,
    });

    this.setState("spawning");
    await this.cli.start();

    if (newSessionId) {
      this.startedAt = Date.now();
      this.eventCount = 0;
    }

    this.cli.onExit((code) => {
      logger.info({ code, sessionId: this.sessionId }, "Coordinator CLI 进程退出");
      // 不清空 sessionId — 允许 --resume 恢复
    });

    return this.cli;
  }

  private shouldRotateSession(): boolean {
    if (this.eventCount >= this.config.maxEventsPerSession) return true;
    if (Date.now() - this.startedAt > this.config.sessionMaxLifetimeMs) return true;
    return false;
  }

  private async rotateSession(): Promise<void> {
    logger.info(
      { sessionId: this.sessionId, eventCount: this.eventCount },
      "Session 有效期到达，轮转",
    );
    if (this.cli) {
      await this.cli.terminate();
      this.cli = null;
    }
    // 不清空 sessionId — 允许 --resume 恢复。但标记为过期。
    this.sessionId = null;
    this.eventCount = 0;
    this.startedAt = 0;
  }

  private isSessionExpired(): boolean {
    if (!this.startedAt) return true;
    return Date.now() - this.startedAt > this.config.sessionMaxLifetimeMs;
  }

  private setState(newState: CoordinatorState, eventId?: string): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateChangeCallback?.(newState, eventId);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test -- apps/server/src/__tests__/coordinator-process.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/coordinator-process.ts apps/server/src/__tests__/coordinator-process.test.ts
git commit -m "feat(server): add CoordinatorProcess with true-sync processEvent and session rotation"
```

---

## Task 5: 修复 Prompt 层和 Context 层

**Files:**
- Modify: `apps/server/src/coordinator-prompt.ts:69-83,300-317,342-362,390-474`
- Modify: `apps/server/src/coordinator-context.ts:11-15,192-197`
- Test: `apps/server/src/__tests__/coordinator-prompt.test.ts`
- Test: `apps/server/src/__tests__/coordinator-context.test.ts`

- [ ] **Step 1: 写测试验证 buildWorkerCompleted 包含 chatId**

在 `apps/server/src/__tests__/coordinator-prompt.test.ts` 增加：

```typescript
it("buildWorkerCompleted: 包含 chatId 和 senderId", () => {
  const builder = new CoordinatorPromptBuilder();
  const event: CoordinatorEvent = {
    type: "worker_completed",
    id: "e-1",
    timestamp: Date.now(),
    priority: 2,
    payload: {
      workerId: "w-1",
      issueId: "ISS-1",
      resultSummary: "bug fixed",
      chatId: "oc_xxx",
      senderId: "ou_yyy",
    },
  };
  const context = { taskStateSummary: "", recentMessages: "", relevantMemories: "" };
  const prompt = builder.build(event, context);
  expect(prompt).toContain("oc_xxx");
  expect(prompt).toContain("ou_yyy");
});
```

- [ ] **Step 2: 写测试验证 buildMeegoIssueStatusChanged 使用正确字段名**

```typescript
it("buildMeegoIssueStatusChanged: 使用 oldStatus 和 newStatus", () => {
  const builder = new CoordinatorPromptBuilder();
  const event: CoordinatorEvent = {
    type: "meego_issue_status_changed",
    id: "e-2",
    timestamp: Date.now(),
    priority: 4,
    payload: { issueId: "ISS-2", projectKey: "PROJ", oldStatus: "open", newStatus: "in_progress" },
  };
  const context = { taskStateSummary: "", recentMessages: "", relevantMemories: "" };
  const prompt = builder.build(event, context);
  expect(prompt).toContain("open");
  expect(prompt).toContain("in_progress");
  expect(prompt).not.toContain("N/A");
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `bun run test -- apps/server/src/__tests__/coordinator-prompt.test.ts --run`
Expected: FAIL — 死类型在 promptHandlers 中引用不存在的 CoordinatorEventType

- [ ] **Step 4: 修改 coordinator-prompt.ts**

1. 删除 `promptHandlers`（第 69-83 行）中的 `worker_timeout`、`diagnosis_ready`、`worker_interrupted`、`worker_resumed` 条目
2. 删除对应的 `buildWorkerTimeout`（390-408）、`buildDiagnosisReady`（413-432）、`buildWorkerInterrupted`（437-453）、`buildWorkerResumed`（458-474）方法
3. 修改 `buildMeegoIssueStatusChanged`（300-317）读 `oldStatus`/`newStatus`（与 mapper 修复后一致）
4. 修改 `buildWorkerCompleted`（342-362）增加 chatId 和 senderId 信息：

```typescript
private buildWorkerCompleted(event: CoordinatorEvent): string {
  const workerId = extractString(event.payload, "workerId");
  const issueId = extractString(event.payload, "issueId");
  const resultSummary = extractString(event.payload, "resultSummary");
  const chatId = extractString(event.payload, "chatId", "");
  const senderId = extractString(event.payload, "senderId", "");

  return [
    `## Worker 完成通知`,
    `- Worker ID: ${workerId}`,
    `- 任务 ID: ${issueId}`,
    `- 结果摘要: ${resultSummary}`,
    chatId ? `- 来源聊天: ${chatId}` : "",
    senderId ? `- 请求者: ${senderId}` : "",
    ``,
    `请整理结果摘要，通过 lark-cli 回复相关聊天。`,
    chatId ? `回复目标: ${chatId}` : "无聊天上下文，发送到团队频道。",
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 5: 修改 coordinator-context.ts**

1. 删除 `StubContextLoader`（第 11-15 行）
2. 修改 `extractRequesterId`（第 192-197 行）增加 `senderId` 识别：

```typescript
function extractRequesterId(event: CoordinatorEvent): string | undefined {
  const p = event.payload;
  return (p.requesterId as string) ?? (p.userId as string) ?? (p.senderId as string) ?? undefined;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `bun run test -- apps/server/src/__tests__/coordinator-prompt.test.ts apps/server/src/__tests__/coordinator-context.test.ts --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/coordinator-prompt.ts apps/server/src/coordinator-context.ts apps/server/src/__tests__/coordinator-prompt.test.ts apps/server/src/__tests__/coordinator-context.test.ts
git commit -m "fix(server): remove dead type prompts, fix status_changed field names, add chatId to worker_completed prompt"
```

---

## Task 6: 修复 event-handlers 和 worker-handlers

**Files:**
- Modify: `apps/server/src/event-handlers.ts:43-76,158-206,247-271`
- Modify: `apps/server/src/worker-handlers.ts:23-63,124-147,161-205,242-245`
- Test: `apps/server/src/__tests__/worker-event-handlers.test.ts`

- [ ] **Step 1: 写测试验证 lark_dm 有 handler**

在 `apps/server/src/__tests__/unified-consumer.test.ts` 或新建测试中增加：

```typescript
it("registerQueueConsumer: lark_dm 不被静默丢弃", async () => {
  // 验证 switch 中有 case "lark_dm"
  const mockQueue = createMockQueue();
  const mockDeps = createMockDeps();
  registerQueueConsumer(mockQueue as any, mockDeps as any);

  // 模拟 lark_dm 消息
  const handler = mockQueue.consume.mock.calls[0][0];
  const msg = createQueueMessage("lark_dm", {
    event: makeMeegoEvent(),
    chatId: "oc_xxx",
    senderId: "ou_yyy",
    senderName: "Alice",
    senderDepartment: "Engineering",
    messageId: "msg-1",
  });

  // 应该不抛异常，不打印 "未知的队列消息类型"
  await expect(handler(msg)).resolves.not.toThrow();
});
```

- [ ] **Step 2: 修改 event-handlers.ts 增加 lark_dm case**

在 `registerQueueConsumer`（第 158-206 行）的 switch 中增加：

```typescript
case "lark_dm": {
  // legacy 路径：当 Coordinator 未启用时，lark_dm 按 lark_mention 处理
  await handleLarkMentionMessage(
    msg,
    createIssueCreatedHandler(deps),
    deps,
  );
  break;
}
```

- [ ] **Step 3: 修改 registerAgent 设置 origin**

在 `event-handlers.ts` 的 `registerAgent` 函数（第 247 行起），register 调用中增加 origin：

```typescript
deps.registry.register({
  agentId,
  pid: spawnResult.pid,
  sessionId: spawnResult.sessionId,
  issueId: params.issueId,
  worktreePath: params.worktreePath,
  status: "running" as const,
  retryCount: 0,
  createdAt: Date.now(),
  origin: {
    chatId: params.chatId ?? "",
    senderId: params.senderId ?? "",
    source: params.source ?? "meego",
  },
  taskBrief: params.description?.slice(0, 200),
  taskPrompt: params.initialPrompt?.slice(0, 500),
});
```

注：需要在 `registerAgent` 的参数类型中增加 `chatId`、`senderId`、`source` 字段，并在 `spawnAgent` 调用处传递这些值。

- [ ] **Step 4: 修复 findAssigneeForIssue**

在 `worker-handlers.ts` 第 242-245 行，修改为从 registry 的 origin 获取 senderId：

```typescript
function findAssigneeForIssue(deps: EventHandlerDeps, workerId: string): string | undefined {
  const record = deps.registry.get(workerId);
  return record?.origin?.senderId;
}
```

- [ ] **Step 5: 修改 notifyWorkerCompleted 使用正确的 senderId**

`worker-handlers.ts` 第 124-147 行的 `notifyWorkerCompleted`，改为先尝试 DM 发送者，fallback 到团队频道：

```typescript
async function notifyWorkerCompleted(
  deps: EventHandlerDeps,
  workerId: string,
  issueId: string,
  resultSummary: string,
): Promise<void> {
  const senderId = findAssigneeForIssue(deps, workerId);
  const message = `✅ 任务 ${issueId} 已完成：${resultSummary.slice(0, 200)}`;

  if (senderId) {
    try {
      await deps.notifier.sendDm(senderId, message);
      return;
    } catch (err) {
      logger.warn({ err, senderId }, "DM 通知失败，降级到团队频道");
    }
  }
  await deps.notifier.sendCard("任务完成", message, "success");
}
```

- [ ] **Step 6: 修改 handleWorkerAnomaly 通知用户**

`worker-handlers.ts` 的 `notifyWorkerAnomaly`（第 212 行起），增加 DM 通知：

```typescript
async function notifyWorkerAnomaly(
  deps: EventHandlerDeps,
  workerId: string,
  anomalyType: string,
  details: string,
): Promise<void> {
  const record = deps.registry.get(workerId);
  const senderId = record?.origin?.senderId;
  const message = `⚠️ 任务异常 (${anomalyType}): ${details.slice(0, 200)}`;

  // 通知用户
  if (senderId) {
    try {
      await deps.notifier.sendDm(senderId, message);
    } catch (err) {
      logger.warn({ err, senderId }, "DM 通知失败");
    }
  }
  // 始终通知团队频道
  await deps.notifier.sendCard("Worker 异常", message, "error");
}
```

- [ ] **Step 7: 运行相关测试**

Run: `bun run test -- apps/server/src/__tests__/worker-event-handlers.test.ts apps/server/src/__tests__/unified-consumer.test.ts --run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/event-handlers.ts apps/server/src/worker-handlers.ts apps/server/src/__tests__/worker-event-handlers.test.ts apps/server/src/__tests__/unified-consumer.test.ts
git commit -m "fix(server): add lark_dm handler, fix findAssigneeForIssue, notify users on failure"
```

---

## Task 7: 重写初始化流程（init/coordinator.ts + main.ts）

**Files:**
- Modify: `apps/server/src/init/coordinator.ts:3-12,27-34,64-157`
- Modify: `apps/server/src/main.ts:8-21,74-103,147-164`
- Modify: `apps/server/src/coordinator-init.ts:322-342`

- [ ] **Step 1: 修改 CoordinatorResult 类型**

`apps/server/src/init/coordinator.ts` 第 27-34 行，改为：

```typescript
export interface CoordinatorResult {
  coordinator: CoordinatorProcess | null;
  workerManager: WorkerManager | null;
}
```

删除 `lifecycleMonitor` 和 `anomalyDetector` 字段。

- [ ] **Step 2: 重写 initCoordinator 函数**

`apps/server/src/init/coordinator.ts` 第 64-157 行，改为：

```typescript
import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { PersistentQueue } from "@teamsland/queue";
import { SubagentRegistry, WorkerManager } from "@teamsland/sidecar";
import type { AppConfig } from "@teamsland/types";
import { CoordinatorProcess } from "../coordinator-process.js";
import { LiveContextLoader } from "../coordinator-context.js";
import { initCoordinatorWorkspace } from "../coordinator-init.js";
import { CoordinatorPromptBuilder } from "../coordinator-prompt.js";

const logger = createLogger("init:coordinator");

export interface CoordinatorResult {
  coordinator: CoordinatorProcess | null;
  workerManager: WorkerManager | null;
}

export async function initCoordinator(
  config: AppConfig,
  queue: PersistentQueue,
  registry: SubagentRegistry,
  controller: AbortController,
  parentLogger: unknown,
  vikingClient: IVikingMemoryClient,
  notifier: { sendDm(userId: string, text: string): Promise<void>; sendCard(title: string, content: string, level?: string): Promise<void> },
): Promise<CoordinatorResult> {
  if (!config.coordinator?.enabled) {
    return { coordinator: null, workerManager: null };
  }

  // 验证 claude 二进制可用
  try {
    Bun.spawnSync(["claude", "--version"]);
  } catch {
    logger.error("claude 二进制不可用，Coordinator 无法启动");
    return { coordinator: null, workerManager: null };
  }

  // 初始化工作区
  const workspacePath = await initCoordinatorWorkspace(config);

  // 构建上下文加载器和 prompt 构建器
  const contextLoader = new LiveContextLoader({ registry, vikingClient });
  const promptBuilder = new CoordinatorPromptBuilder();

  // 创建 CoordinatorProcess
  const coordinator = new CoordinatorProcess({
    config: {
      workspacePath,
      systemPromptPath: `${workspacePath}/CLAUDE.md`,
      allowedTools: [
        "Bash(teamsland *)", "Bash(lark-cli *)", "Bash(bytedcli *)",
        "Bash(curl *)", "Bash(cat *)", "Bash(echo *)", "Bash(date *)", "Read",
      ],
      sessionMaxLifetimeMs: config.coordinator.sessionMaxLifetimeMs ?? 30 * 60 * 1000,
      maxEventsPerSession: config.coordinator.maxEventsPerSession ?? 20,
      resultTimeoutMs: config.coordinator.inferenceTimeoutMs ?? 5 * 60 * 1000,
    },
    contextLoader,
    promptBuilder,
  });

  // 创建 WorkerManager
  const workerManager = new WorkerManager({
    registry,
    queue,
    notifier,
    workerSystemPromptPath: `${workspacePath}/worker-system.md`,
    defaultAllowedTools: [
      "Bash(git *)", "Bash(teamsland *)", "Bash(lark-cli *)", "Read", "Edit", "Write",
    ],
    maxBudgetPerWorker: config.coordinator.maxBudgetPerWorker ?? 2.0,
  });

  logger.info({ workspacePath }, "Coordinator 初始化完成");
  return { coordinator, workerManager };
}
```

- [ ] **Step 3: 重写 main.ts 的 Coordinator 集成**

`apps/server/src/main.ts` 第 74-103 行，改为：

```typescript
// Phase 5.5: Coordinator
const { coordinator, workerManager } = await initCoordinator(
  config, queue, registry, controller, logger, vikingClient, notifier,
);

if (coordinator) {
  // 死信通知
  queue.onDeadLetter((msg) => {
    notifier.sendCard(
      "消息进入死信队列",
      `类型: ${msg.type}, ID: ${msg.id}, 重试: ${msg.retryCount}`,
      "error",
    ).catch(() => {});
  });

  // 队列消费：真同步
  queue.consume(async (msg) => {
    try {
      const event = toCoordinatorEvent(msg);
      await coordinator.processEvent(event);
    } catch (err) {
      logger.error({ err, msgId: msg.id }, "Coordinator processEvent 失败");
      await notifier.sendCard(
        "Coordinator 处理失败",
        `消息 ${msg.id} (${msg.type}) 处理失败: ${String(err)}`,
        "error",
      ).catch(() => {});
      throw err; // 让队列 nack
    }
  });
}
```

- [ ] **Step 4: 更新 shutdown handler**

`apps/server/src/main.ts` 的 shutdown 部分（第 147-164 行），替换为：

```typescript
if (coordinator) {
  await coordinator.reset();
}
if (workerManager) {
  await workerManager.terminateAll();
}
```

删除 `coordinator.anomalyDetector.stopAll()` 和 `coordinator.lifecycleMonitor` 相关代码。

- [ ] **Step 5: 删除 coordinator-init.ts 中的 settings.json 生成**

`apps/server/src/coordinator-init.ts` 第 322-342 行的 `generateSettingsJson` 函数，保留但标记 deprecated，或直接删除调用它的地方（`writeWorkspaceFiles` 中第 108 行左右的 `.claude/settings.json` 写入）。

工具白名单现在通过 `--allowedTools` 传递，不再需要 settings.json。

- [ ] **Step 6: 清理 import**

- `main.ts`：删除 `WorkerLifecycleMonitor`、`AnomalyDetector` 的 import
- `init/coordinator.ts`：删除旧 import，增加 `CoordinatorProcess`、`WorkerManager`

- [ ] **Step 7: 运行 typecheck**

Run: `bun run typecheck`
Expected: PASS（或只剩下即将删除的旧文件的错误）

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/init/coordinator.ts apps/server/src/main.ts apps/server/src/coordinator-init.ts
git commit -m "refactor(server): rewire init with CoordinatorProcess and WorkerManager, remove lifecycle monitor"
```

---

## Task 8: 删除旧模块 + 清理 sidecar barrel

**Files:**
- Delete: `packages/sidecar/src/message-bus.ts`
- Delete: `packages/sidecar/src/__tests__/message-bus.test.ts`
- Delete: `packages/sidecar/src/anomaly-detector.ts`
- Delete: `packages/sidecar/src/__tests__/anomaly-detector.test.ts`
- Delete: `apps/server/src/worker-lifecycle.ts`
- Delete: `apps/server/src/__tests__/worker-lifecycle.test.ts`
- Delete: `apps/server/src/coordinator.ts`
- Delete: `apps/server/src/__tests__/coordinator.test.ts`
- Delete: `apps/server/src/__tests__/coordinator-session-persistence.test.ts`
- Delete: `apps/server/src/__tests__/coordinator-async.test.ts`
- Delete: `apps/server/src/diagnosis-handler.ts`
- Modify: `packages/sidecar/src/index.ts`
- Modify: `packages/sidecar/src/data-plane.ts` (移除 ObservableMessageBus 依赖)

- [ ] **Step 1: 删除 message-bus**

```bash
rm packages/sidecar/src/message-bus.ts packages/sidecar/src/__tests__/message-bus.test.ts
```

- [ ] **Step 2: 删除 anomaly-detector**

```bash
rm packages/sidecar/src/anomaly-detector.ts packages/sidecar/src/__tests__/anomaly-detector.test.ts
```

- [ ] **Step 3: 删除 worker-lifecycle**

```bash
rm apps/server/src/worker-lifecycle.ts apps/server/src/__tests__/worker-lifecycle.test.ts
```

- [ ] **Step 4: 删除旧 coordinator 和相关测试**

```bash
rm apps/server/src/coordinator.ts
rm apps/server/src/__tests__/coordinator.test.ts
rm apps/server/src/__tests__/coordinator-session-persistence.test.ts
rm apps/server/src/__tests__/coordinator-async.test.ts
```

- [ ] **Step 5: 删除 diagnosis-handler**

```bash
rm apps/server/src/diagnosis-handler.ts
```

- [ ] **Step 6: 更新 sidecar barrel export**

`packages/sidecar/src/index.ts` 删除：

```typescript
// 删除这些行
export type { Anomaly, AnomalyDetectorOpts, AnomalyType } from "./anomaly-detector.js";
export { AnomalyDetector } from "./anomaly-detector.js";
export { ObservableMessageBus } from "./message-bus.js";
```

- [ ] **Step 7: 从 data-plane.ts 移除 ObservableMessageBus 依赖**

`packages/sidecar/src/data-plane.ts` 第 4 行和第 81 行：
- 删除 `import type { ObservableMessageBus } from "./message-bus.js";`
- 删除构造函数中的 `messageBus` 参数
- 删除 `emitMessage` 方法（第 266-278 行）
- 在 `routeEvent` 中删除 `this.emitMessage(...)` 调用

注意：data-plane.ts 可能在其他地方仍被使用（如 TranscriptReader），保留文件但移除 message bus 依赖。

- [ ] **Step 8: 清理所有引用旧模块的 import**

搜索并修复所有引用已删除模块的文件：

```bash
grep -r "WorkerLifecycleMonitor\|AnomalyDetector\|ObservableMessageBus\|diagnosis-handler\|coordinator\.js" apps/server/src/ --include="*.ts" -l
```

修复每个文件的 import。

- [ ] **Step 9: 删除 event-handlers.ts 中对 diagnosis_ready 的引用**

`apps/server/src/event-handlers.ts` 第 21 行删除：

```typescript
import { handleDiagnosisReady } from "./diagnosis-handler.js";
```

以及 `registerQueueConsumer` switch 中的 `case "diagnosis_ready"` 分支。

- [ ] **Step 10: 运行 typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 11: 运行全量测试**

Run: `bun run test:run`
Expected: PASS（部分测试因删除文件而消失，剩余测试通过）

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor: remove WorkerLifecycleMonitor, AnomalyDetector, ObservableMessageBus, old Coordinator"
```

---

## Task 9: 端到端集成验证

**Files:**
- Modify: `apps/server/src/__tests__/event-pipeline.test.ts`（或新建集成测试）

- [ ] **Step 1: 写端到端集成测试——lark_mention → Coordinator 处理 → result**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
  }),
  withSpan: (_ns: string, _op: string, fn: () => unknown) => fn(),
}));

import { CoordinatorProcess } from "../coordinator-process.js";
import { toCoordinatorEvent } from "../coordinator-event-mapper.js";
import type { QueueMessage } from "@teamsland/queue";

describe("端到端集成", () => {
  it("lark_mention 事件经过 mapper → CoordinatorProcess → 拿到 result", async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
      const resultLine = JSON.stringify({
        type: "result", subtype: "success",
        result: "已为用户 ou_yyy 在群 oc_xxx 中安排了 Worker 处理任务 ISS-1",
        session_id: "coord-1", duration_ms: 3000, num_turns: 2,
      });
      const initLine = JSON.stringify({ type: "system", subtype: "init", session_id: "coord-1" });
      const stdout = new ReadableStream({
        start(controller) {
          setTimeout(() => {
            controller.enqueue(new TextEncoder().encode(initLine + "\n" + resultLine + "\n"));
          }, 10);
        },
      });
      const stderr = new ReadableStream({ start(c) { c.close(); } });
      return { pid: 300, stdin, stdout, stderr, exited: new Promise(() => {}), killed: false, kill: vi.fn() };
    });

    const contextLoader = {
      load: vi.fn().mockResolvedValue({
        taskStateSummary: "",
        recentMessages: "",
        relevantMemories: "",
      }),
    };
    const promptBuilder = {
      build: vi.fn().mockReturnValue("test prompt"),
    };

    const coordinator = new CoordinatorProcess({
      config: {
        workspacePath: "/tmp/coord",
        systemPromptPath: "/tmp/coord/system.md",
        allowedTools: ["Read"],
        sessionMaxLifetimeMs: 30 * 60 * 1000,
        maxEventsPerSession: 20,
        resultTimeoutMs: 10_000,
      },
      contextLoader: contextLoader as any,
      promptBuilder: promptBuilder as any,
      spawnFn,
    });

    // 模拟 queue message
    const queueMsg: QueueMessage = {
      id: "msg-1",
      type: "lark_mention",
      payload: {
        event: {
          eventType: "issue.created",
          payload: {
            issueId: "ISS-1",
            projectKey: "PROJ",
            title: "fix bug",
            description: "用户消息",
          },
        } as any,
        chatId: "oc_xxx",
        senderId: "ou_yyy",
        messageId: "lark-msg-1",
      },
      priority: "normal",
      status: "processing",
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      scheduledAt: Date.now(),
      traceId: "trace-1",
    };

    // 转换为 CoordinatorEvent
    const event = toCoordinatorEvent(queueMsg);
    expect(event.type).toBe("lark_mention");
    expect(event.payload.chatId).toBe("oc_xxx");

    // 处理事件（真同步）
    const result = await coordinator.processEvent(event);
    expect(result.type).toBe("result");
    expect(result.subtype).toBe("success");
    expect(result.result).toContain("ISS-1");

    // promptBuilder 被调用时收到了正确的事件
    expect(promptBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({ type: "lark_mention" }),
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `bun run test -- apps/server/src/__tests__/event-pipeline.test.ts --run`
Expected: PASS

- [ ] **Step 3: 运行全量测试套件**

Run: `bun run test:run`
Expected: ALL PASS

- [ ] **Step 4: 运行 typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: 运行 lint**

Run: `bun run lint`
Expected: PASS 或只有 warning

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/__tests__/event-pipeline.test.ts
git commit -m "test(server): add end-to-end integration test for coordinator rewrite"
```

---

## Task 10: 手动验证（需要实际 Claude CLI）

这个 Task 不能在单元测试中完成，需要实际启动服务验证。

- [ ] **Step 1: 启动 server**

```bash
bun run dev:server
```

确认无启动错误。

- [ ] **Step 2: 通过 dashboard 检查 Coordinator 状态**

访问 `http://localhost:3001/api/coordinator/status`，确认返回正常状态。

- [ ] **Step 3: 模拟 Lark 消息触发（如果有测试环境）**

通过 Lark 发送 @bot 消息，观察：
1. 消息进入队列
2. Coordinator CLI 进程启动
3. stdout 事件流正常
4. result 事件返回后队列 ack
5. 如果 Coordinator 决定 spawn worker，worker CLI 进程启动
6. worker result 事件返回后通知用户

- [ ] **Step 4: 验证 session 轮转**

连续发送 20+ 条消息，观察 Coordinator 是否在达到 `maxEventsPerSession` 后轮转 session。

- [ ] **Step 5: 验证失败通知**

强制杀死一个 worker 进程，验证：
1. 用户收到 DM 通知
2. 团队频道收到告警卡片
3. `worker_anomaly` 事件入队

- [ ] **Step 6: 最终 Commit（如有修复）**

```bash
git add -A
git commit -m "fix: manual testing fixes for coordinator rewrite"
```
