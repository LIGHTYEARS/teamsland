# Capability Alignment (Modules 2+3+4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the coordinator workspace hardening, interrupt/observe/resume chain, and self-evolution with human approval — completing the automation loop for the teamsland AI collaboration platform.

**Architecture:** Module 2 hardens the coordinator workspace (session persistence, self-evolve skill injection, integrity check). Module 3 connects existing `@teamsland/sidecar` controllers (`AnomalyDetector`, `InterruptController`, `ResumeController`) into `apps/server`, adds the missing `ObserverController`, and implements the `diagnosis_ready` handler. Module 4 injects the self-evolve skill, adds evolution logging, and implements the human approval gate for auto-generated hooks.

**Tech Stack:** Bun, TypeScript (strict), Vitest, `@teamsland/sidecar`, `@teamsland/queue`, `@teamsland/types`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/sidecar/src/observer-controller.ts` | Spawn observer workers to diagnose anomalous workers |
| `packages/sidecar/src/__tests__/observer-controller.test.ts` | Unit tests for ObserverController |
| `apps/server/src/__tests__/coordinator-session-persistence.test.ts` | Tests for session persist/load |
| `apps/server/src/evolution-log.ts` | Append/read evolution-log.jsonl entries |
| `apps/server/src/__tests__/evolution-log.test.ts` | Tests for evolution log |

### Modified Files
| File | Change |
|------|--------|
| `packages/queue/src/types.ts` | Add `worker_interrupted`, `worker_resumed` to `QueueMessageType` + payload types |
| `packages/types/src/config.ts` | Add `pendingDir`, `requireApproval` to `HooksConfig` |
| `packages/types/src/coordinator.ts` | Add `worker_interrupted`, `worker_resumed` to `CoordinatorEventType` |
| `apps/server/src/coordinator-init.ts` | Add self-evolve skill + workspace integrity check + evolution-config.json |
| `apps/server/src/coordinator.ts` | Add session persistence (persistSession/loadSession) |
| `apps/server/src/coordinator-prompt.ts:360-376` | Fix `buildDiagnosisReady` field names |
| `apps/server/src/coordinator-event-mapper.ts` | Add `worker_interrupted`/`worker_resumed` mapping |
| `apps/server/src/event-handlers.ts:206-208` | Replace `diagnosis_ready` stub with real handler |
| `apps/server/src/event-handlers.ts:717-746` | Enhance `handleWorkerAnomaly` with observer fallback |
| `apps/server/src/worker-routes.ts` | Add interrupt/resume/observe API endpoints |
| `apps/server/src/dashboard.ts` | Add pending hooks + evolution-log API endpoints |
| `apps/server/src/init/coordinator.ts` | Wire AnomalyDetector, pass InterruptController/ResumeController/ObserverController to deps |
| `apps/server/src/init/sidecar.ts` | Instantiate InterruptController, ResumeController, ObserverController |
| `apps/server/src/main.ts` | Wire new controllers into startup/shutdown sequence |
| `packages/sidecar/src/interrupt-controller.ts:164-165` | Add registry.persist() after interrupt |
| `packages/sidecar/src/resume-controller.ts:223-227` | Fix taskType fallback to use predecessor's |
| `packages/sidecar/src/index.ts` | Export ObserverController |
| `config/config.json` | Add `pendingDir`, `requireApproval` to hooks section |

---

## Task 1: Add Queue Message Types for Interrupt/Resume

**Files:**
- Modify: `packages/queue/src/types.ts:44-52` (QueueMessageType)
- Modify: `packages/queue/src/types.ts:128-133` (QueuePayload union)
- Modify: `packages/types/src/coordinator.ts:13-23` (CoordinatorEventType)
- Modify: `apps/server/src/coordinator-event-mapper.ts` (add mappings)

- [ ] **Step 1: Add `worker_interrupted` and `worker_resumed` to QueueMessageType**

In `packages/queue/src/types.ts`, replace lines 44-52:

```typescript
export type QueueMessageType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_status_changed"
  | "meego_issue_assigned"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_interrupted"
  | "worker_resumed"
  | "diagnosis_ready";
```

- [ ] **Step 2: Add payload types for the new message types**

In `packages/queue/src/types.ts`, after `DiagnosisReadyPayload` (after line 258), add:

```typescript
/**
 * Worker 被打断事件负载
 *
 * 当 Worker 被 InterruptController 中断时发出。
 *
 * @example
 * ```typescript
 * import type { WorkerInterruptedPayload } from "@teamsland/queue";
 *
 * const payload: WorkerInterruptedPayload = {
 *   workerId: "worker-001",
 *   reason: "诊断发现死循环",
 * };
 * ```
 */
export interface WorkerInterruptedPayload {
  /** 被中断的 Worker ID */
  workerId: string;
  /** 中断原因 */
  reason: string;
}

/**
 * Worker 恢复事件负载
 *
 * 当中断的 Worker 通过 ResumeController 恢复时发出。
 *
 * @example
 * ```typescript
 * import type { WorkerResumedPayload } from "@teamsland/queue";
 *
 * const payload: WorkerResumedPayload = {
 *   workerId: "worker-002",
 *   predecessorId: "worker-001",
 * };
 * ```
 */
export interface WorkerResumedPayload {
  /** 新 Worker ID */
  workerId: string;
  /** 前任 Worker ID（被中断的） */
  predecessorId: string;
}
```

- [ ] **Step 3: Add new payloads to the QueuePayload union**

In `packages/queue/src/types.ts`, replace the QueuePayload union (lines 128-133):

```typescript
export type QueuePayload =
  | LarkMentionPayload
  | MeegoEventPayload
  | WorkerCompletedPayload
  | WorkerAnomalyPayload
  | DiagnosisReadyPayload
  | WorkerInterruptedPayload
  | WorkerResumedPayload;
```

- [ ] **Step 4: Add to CoordinatorEventType**

In `packages/types/src/coordinator.ts`, replace lines 13-23:

```typescript
export type CoordinatorEventType =
  | "lark_mention"
  | "meego_issue_created"
  | "meego_issue_assigned"
  | "meego_issue_status_changed"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_timeout"
  | "worker_interrupted"
  | "worker_resumed"
  | "diagnosis_ready"
  | "user_query";
```

- [ ] **Step 5: Add event mapper cases**

In `apps/server/src/coordinator-event-mapper.ts`, inside the `flattenPayload` switch, add cases after `diagnosis_ready` (after line 195):

```typescript
    case "worker_interrupted": {
      const p = payload as {
        workerId: string;
        reason: string;
      };
      return {
        workerId: p.workerId,
        reason: p.reason,
      };
    }
    case "worker_resumed": {
      const p = payload as {
        workerId: string;
        predecessorId: string;
      };
      return {
        workerId: p.workerId,
        predecessorId: p.predecessorId,
      };
    }
```

Also add to `TYPE_MAP` (near line 14):

```typescript
  worker_interrupted: "worker_interrupted",
  worker_resumed: "worker_resumed",
```

And to `PRIORITY_MAP` (near line 35):

```typescript
  worker_interrupted: 1,
  worker_resumed: 2,
```

- [ ] **Step 6: Run type check**

Run: `cd packages/queue && bun run typecheck && cd ../../packages/types && bun run typecheck && cd ../../apps/server && bun run typecheck`

Expected: All pass with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/queue/src/types.ts packages/types/src/coordinator.ts apps/server/src/coordinator-event-mapper.ts
git commit -m "feat(types): add worker_interrupted and worker_resumed queue message types"
```

---

## Task 2: Fix coordinator-prompt.ts `buildDiagnosisReady` Field Mismatch

**Files:**
- Modify: `apps/server/src/coordinator-prompt.ts:360-376`

- [ ] **Step 1: Fix the field name mismatch**

The event mapper outputs `{ targetWorkerId, observerWorkerId, report }` but the prompt builder reads `{ diagnosisId, summary }`. In `apps/server/src/coordinator-prompt.ts`, replace lines 360-376:

```typescript
  private buildDiagnosisReady(event: CoordinatorEvent): string {
    const { payload } = event;
    const targetWorkerId = extractString(payload, "targetWorkerId");
    const observerWorkerId = extractString(payload, "observerWorkerId");
    const report = extractString(payload, "report");

    return [
      "## 诊断报告就绪",
      "",
      `目标 Worker: ${targetWorkerId}`,
      `观察者 Worker: ${observerWorkerId}`,
      `诊断报告:`,
      report,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "请审阅诊断结果并决定后续行动：中断并恢复 / 继续观察 / 注入提示。",
    ].join("\n");
  }
```

- [ ] **Step 2: Add prompt builders for new event types**

After `buildDiagnosisReady`, add handlers for `worker_interrupted` and `worker_resumed`. First, add them to the `promptHandlers` map (near line 78):

```typescript
    "worker_interrupted": (e) => this.buildWorkerInterrupted(e),
    "worker_resumed": (e) => this.buildWorkerResumed(e),
```

Then add the methods:

```typescript
  private buildWorkerInterrupted(event: CoordinatorEvent): string {
    const { payload } = event;
    const workerId = extractString(payload, "workerId");
    const reason = extractString(payload, "reason");

    return [
      "## Worker 已中断",
      "",
      `Worker ID: ${workerId}`,
      `中断原因: ${reason}`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "Worker 已被中断，请确认是否需要进一步处理。",
    ].join("\n");
  }

  private buildWorkerResumed(event: CoordinatorEvent): string {
    const { payload } = event;
    const workerId = extractString(payload, "workerId");
    const predecessorId = extractString(payload, "predecessorId");

    return [
      "## Worker 已恢复",
      "",
      `新 Worker ID: ${workerId}`,
      `前任 Worker ID: ${predecessorId}`,
      `时间: ${formatTimestamp(event.timestamp)}`,
      "",
      "---",
      "",
      "中断的 Worker 已通过 relay 方式恢复运行，请持续关注。",
    ].join("\n");
  }
```

- [ ] **Step 3: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/coordinator-prompt.ts
git commit -m "fix(coordinator): fix buildDiagnosisReady field names and add interrupt/resume prompt builders"
```

---

## Task 3: Fix InterruptController and ResumeController Bugs

**Files:**
- Modify: `packages/sidecar/src/interrupt-controller.ts:164-165`
- Modify: `packages/sidecar/src/resume-controller.ts:223-227`

- [ ] **Step 1: Add registry persist to InterruptController**

In `packages/sidecar/src/interrupt-controller.ts`, after line 165 (`record.interruptReason = req.reason`), add:

```typescript
    await this.registry.persist();
```

Note: `registry.persist()` is already `async` and saves to disk. This ensures the interrupted state survives server restarts.

- [ ] **Step 2: Fix ResumeController taskType fallback**

In `packages/sidecar/src/resume-controller.ts`, find where `taskType` is determined for skill injection (around line 223-227). The current code passes `taskType` from `req.taskType` with a fallback. Change the fallback from `"default"` to use the predecessor's original task type. Find the line that looks like:

```typescript
const taskType = req.taskType ?? "default";
```

And replace with:

```typescript
const taskType = req.taskType ?? predecessor.workerType ?? "default";
```

This ensures Skills injected on resume match the original worker's type.

- [ ] **Step 3: Run existing sidecar tests**

Run: `cd packages/sidecar && bun run test:run`

Expected: All existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/interrupt-controller.ts packages/sidecar/src/resume-controller.ts
git commit -m "fix(sidecar): add registry persist on interrupt and fix resume taskType fallback"
```

---

## Task 4: Implement ObserverController

**Files:**
- Create: `packages/sidecar/src/observer-controller.ts`
- Create: `packages/sidecar/src/__tests__/observer-controller.test.ts`
- Modify: `packages/sidecar/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/__tests__/observer-controller.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ObserverController } from "../observer-controller.js";
import type { SubagentRegistry } from "../registry.js";
import type { ProcessController } from "../process-controller.js";
import type { TranscriptReader, TranscriptSummary } from "../transcript-reader.js";
import type { Logger } from "@teamsland/observability";

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockSummary(): TranscriptSummary {
  return {
    totalEntries: 42,
    toolCalls: ["Read", "Edit", "Bash"],
    errors: ["Error: file not found"],
    lastAssistantMessage: "I encountered an error reading the file",
    durationMs: 120_000,
  };
}

describe("ObserverController", () => {
  it("should spawn an observer worker for a target agent", async () => {
    const mockRecord = {
      agentId: "worker-001",
      pid: 12345,
      sessionId: "sess-001",
      worktreePath: "/tmp/worktree-001",
      status: "running" as const,
      taskPrompt: "Fix the login bug",
      startedAt: Date.now() - 60_000,
      retryCount: 0,
      createdAt: Date.now() - 60_000,
      issueId: "ISSUE-42",
    };

    const registry = {
      get: vi.fn().mockReturnValue(mockRecord),
      register: vi.fn(),
    } as unknown as SubagentRegistry;

    const processCtrl = {
      spawn: vi.fn().mockResolvedValue({
        pid: 99999,
        sessionId: "obs-sess-001",
      }),
    } as unknown as ProcessController;

    const transcriptReader = {
      resolveTranscriptPath: vi.fn().mockReturnValue("/home/.claude/projects/abc/sess-001.jsonl"),
      summarizeStructured: vi.fn().mockResolvedValue(createMockSummary()),
    } as unknown as TranscriptReader;

    const controller = new ObserverController(
      registry,
      processCtrl,
      transcriptReader,
      createMockLogger(),
    );

    const result = await controller.observe({
      targetAgentId: "worker-001",
      anomalyType: "timeout",
      mode: "diagnosis",
    });

    expect(result.observerAgentId).toContain("observer-");
    expect(result.pid).toBe(99999);
    expect(registry.get).toHaveBeenCalledWith("worker-001");
    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "observing",
        workerType: "observer",
        observeTargetId: "worker-001",
      }),
    );
    expect(processCtrl.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompt: expect.stringContaining("Observer"),
      }),
    );
  });

  it("should throw if target agent not found", async () => {
    const registry = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as SubagentRegistry;

    const controller = new ObserverController(
      registry,
      {} as ProcessController,
      {} as TranscriptReader,
      createMockLogger(),
    );

    await expect(
      controller.observe({
        targetAgentId: "nonexistent",
        anomalyType: "crash",
        mode: "diagnosis",
      }),
    ).rejects.toThrow("nonexistent");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/sidecar && bun run test:run -- src/__tests__/observer-controller.test.ts`

Expected: FAIL — `observer-controller.ts` does not exist yet.

- [ ] **Step 3: Implement ObserverController**

Create `packages/sidecar/src/observer-controller.ts`:

```typescript
// @teamsland/sidecar — Observer Controller
// 生成观察者 Worker 以诊断异常 Worker

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@teamsland/observability";
import type { AgentRecord } from "@teamsland/types";
import type { ProcessController } from "./process-controller.js";
import type { SubagentRegistry } from "./registry.js";
import type { TranscriptReader, TranscriptSummary } from "./transcript-reader.js";

/**
 * 观察请求
 *
 * @example
 * ```typescript
 * import type { ObserveRequest } from "@teamsland/sidecar";
 *
 * const req: ObserveRequest = {
 *   targetAgentId: "worker-001",
 *   anomalyType: "timeout",
 *   mode: "diagnosis",
 * };
 * ```
 */
export interface ObserveRequest {
  /** 目标 Worker ID */
  targetAgentId: string;
  /** 触发观察的异常类型 */
  anomalyType: string;
  /** 观察模式 */
  mode: "progress" | "quality" | "diagnosis";
}

/**
 * 观察结果
 *
 * @example
 * ```typescript
 * import type { ObserveResult } from "@teamsland/sidecar";
 *
 * const result: ObserveResult = {
 *   observerAgentId: "observer-abc",
 *   pid: 12345,
 *   sessionId: "sess-001",
 * };
 * ```
 */
export interface ObserveResult {
  /** 观察者 Worker ID */
  observerAgentId: string;
  /** 观察者进程 PID */
  pid: number;
  /** 观察者 Session ID */
  sessionId: string;
}

/**
 * 观察者控制器
 *
 * 生成 Observer Worker 以读取目标 Worker 的 transcript 并输出诊断报告。
 * Observer 运行在临时目录中，不需要 worktree。
 *
 * @example
 * ```typescript
 * import { ObserverController } from "@teamsland/sidecar";
 *
 * const controller = new ObserverController(registry, processCtrl, transcriptReader, logger);
 * const result = await controller.observe({
 *   targetAgentId: "worker-001",
 *   anomalyType: "timeout",
 *   mode: "diagnosis",
 * });
 * console.log(result.observerAgentId);
 * ```
 */
export class ObserverController {
  constructor(
    private readonly registry: SubagentRegistry,
    private readonly processCtrl: ProcessController,
    private readonly transcriptReader: TranscriptReader,
    private readonly logger: Logger,
  ) {}

  /**
   * 为目标 Worker 生成观察者
   *
   * @param req - 观察请求
   * @returns 观察者信息
   *
   * @example
   * ```typescript
   * const result = await controller.observe({
   *   targetAgentId: "worker-001",
   *   anomalyType: "crash",
   *   mode: "diagnosis",
   * });
   * ```
   */
  async observe(req: ObserveRequest): Promise<ObserveResult> {
    const target = this.registry.get(req.targetAgentId);
    if (!target) {
      throw new Error(`目标 Worker ${req.targetAgentId} 不存在`);
    }

    const transcriptPath = this.transcriptReader.resolveTranscriptPath(
      target.worktreePath,
      target.sessionId,
    );
    const summary = await this.transcriptReader.summarizeStructured(transcriptPath);

    const prompt = buildObserverPrompt(req.mode, target, summary, req.anomalyType);

    const tmpDir = join(tmpdir(), `observer-${randomUUID().slice(0, 8)}`);
    await mkdir(tmpDir, { recursive: true });

    const spawnResult = await this.processCtrl.spawn({
      issueId: `observer-${req.targetAgentId}`,
      worktreePath: tmpDir,
      initialPrompt: prompt,
    });

    const observerAgentId = `observer-${spawnResult.sessionId}`;

    this.registry.register({
      agentId: observerAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      issueId: `observer-${req.targetAgentId}`,
      worktreePath: tmpDir,
      status: "observing",
      workerType: "observer",
      observeTargetId: req.targetAgentId,
      retryCount: 0,
      createdAt: Date.now(),
    });

    this.logger.info(
      { observerAgentId, targetAgentId: req.targetAgentId, mode: req.mode },
      "Observer Worker 已启动",
    );

    return {
      observerAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
    };
  }
}

/**
 * 构建观察者提示词
 *
 * @example
 * ```typescript
 * const prompt = buildObserverPrompt("diagnosis", target, summary, "timeout");
 * ```
 */
export function buildObserverPrompt(
  mode: "progress" | "quality" | "diagnosis",
  target: AgentRecord,
  summary: TranscriptSummary,
  anomalyType: string,
): string {
  const base = [
    "You are an Observer agent. Your job is to diagnose why a worker agent is having trouble.",
    "",
    "## Target Worker",
    `- Agent ID: ${target.agentId}`,
    `- Task: ${target.taskPrompt ?? target.taskBrief ?? "未知任务"}`,
    `- Status: ${target.status}`,
    `- Anomaly: ${anomalyType}`,
    `- Running since: ${new Date(target.createdAt).toISOString()}`,
    "",
    "## Transcript Summary",
    `- Total entries: ${summary.totalEntries}`,
    `- Tool calls: ${summary.toolCalls.join(", ") || "none"}`,
    `- Errors: ${summary.errors.length > 0 ? summary.errors.join("\n  ") : "none"}`,
    `- Last assistant message: ${summary.lastAssistantMessage || "none"}`,
    `- Duration: ${Math.round(summary.durationMs / 1000)}s`,
  ];

  if (mode === "diagnosis") {
    base.push(
      "",
      "## Your Task",
      "Analyze the transcript and produce a diagnosis. Output ONLY a JSON object:",
      "",
      "```json",
      "{",
      '  "verdict": "retry_loop" | "persistent_error" | "stuck" | "waiting_input" | "unknown",',
      '  "recommendation": "interrupt" | "let_continue" | "inject_hint",',
      '  "analysis": "Brief explanation of what went wrong",',
      '  "correctionInstructions": "If recommending interrupt+resume, what should the resumed worker do differently"',
      "}",
      "```",
    );
  } else if (mode === "progress") {
    base.push(
      "",
      "## Your Task",
      "Summarize what the worker has accomplished so far. Output a brief progress report.",
    );
  } else {
    base.push(
      "",
      "## Your Task",
      "Assess the quality of the worker's work. Output a verdict: good / needs_improvement / problematic.",
    );
  }

  return base.join("\n");
}
```

- [ ] **Step 4: Export from barrel**

In `packages/sidecar/src/index.ts`, add:

```typescript
export { ObserverController, buildObserverPrompt } from "./observer-controller.js";
export type { ObserveRequest, ObserveResult } from "./observer-controller.js";
```

- [ ] **Step 5: Run the test**

Run: `cd packages/sidecar && bun run test:run -- src/__tests__/observer-controller.test.ts`

Expected: PASS — both test cases pass.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/observer-controller.ts packages/sidecar/src/__tests__/observer-controller.test.ts packages/sidecar/src/index.ts
git commit -m "feat(sidecar): implement ObserverController for anomaly diagnosis"
```

---

## Task 5: Session Persistence for CoordinatorSessionManager

**Files:**
- Modify: `apps/server/src/coordinator.ts`
- Create: `apps/server/src/__tests__/coordinator-session-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/coordinator-session-persistence.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  persistSession,
  loadSession,
  type PersistedSession,
} from "../coordinator.js";

describe("Session Persistence", () => {
  const testDir = join(tmpdir(), `coord-test-${randomUUID().slice(0, 8)}`);

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("should persist and load a session", async () => {
    mkdirSync(testDir, { recursive: true });

    const session: PersistedSession = {
      sessionId: "sess-001",
      chatId: "oc_xxx",
      startedAt: Date.now() - 10_000,
      processedEvents: ["evt-1", "evt-2"],
    };

    await persistSession(testDir, session);
    const loaded = await loadSession(testDir);

    expect(loaded).toEqual(session);
  });

  it("should return null when no session file exists", async () => {
    mkdirSync(testDir, { recursive: true });
    const loaded = await loadSession(testDir);
    expect(loaded).toBeNull();
  });

  it("should clear session file when persisting null", async () => {
    mkdirSync(testDir, { recursive: true });

    await persistSession(testDir, {
      sessionId: "sess-001",
      chatId: "oc_xxx",
      startedAt: Date.now(),
      processedEvents: [],
    });

    await persistSession(testDir, null);
    const loaded = await loadSession(testDir);
    expect(loaded).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun run test:run -- src/__tests__/coordinator-session-persistence.test.ts`

Expected: FAIL — `persistSession` and `loadSession` are not exported from `coordinator.ts`.

- [ ] **Step 3: Implement session persistence functions**

In `apps/server/src/coordinator.ts`, add the following after the import block (after line 12):

```typescript
import { unlink } from "node:fs/promises";
import { join } from "node:path";
```

Then, before the `CoordinatorSessionManager` class (around line 130), add:

```typescript
const SESSION_FILE = ".session.json";

/**
 * 持久化 Session 数据结构
 *
 * @example
 * ```typescript
 * import type { PersistedSession } from "./coordinator.js";
 *
 * const session: PersistedSession = {
 *   sessionId: "sess-001",
 *   chatId: "oc_xxx",
 *   startedAt: Date.now(),
 *   processedEvents: ["evt-1"],
 * };
 * ```
 */
export interface PersistedSession {
  /** Claude Code Session ID */
  sessionId: string;
  /** 关联的 Chat ID */
  chatId: string | undefined;
  /** 开始时间 (Unix ms) */
  startedAt: number;
  /** 已处理事件 ID 列表 */
  processedEvents: string[];
}

/**
 * 持久化当前 Session 到磁盘
 *
 * 传入 null 则删除持久化文件。使用 .tmp + rename 保证原子写入。
 *
 * @example
 * ```typescript
 * await persistSession("/path/to/workspace", { sessionId: "sess-001", chatId: "oc_xxx", startedAt: Date.now(), processedEvents: [] });
 * await persistSession("/path/to/workspace", null); // 清除
 * ```
 */
export async function persistSession(
  workspacePath: string,
  session: PersistedSession | null,
): Promise<void> {
  const filePath = join(workspacePath, SESSION_FILE);
  if (!session) {
    await unlink(filePath).catch(() => {});
    return;
  }
  const tmpPath = `${filePath}.tmp`;
  await Bun.write(tmpPath, JSON.stringify(session));
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, filePath);
}

/**
 * 从磁盘加载持久化 Session
 *
 * @returns PersistedSession 或 null（文件不存在时）
 *
 * @example
 * ```typescript
 * const session = await loadSession("/path/to/workspace");
 * if (session) console.log(session.sessionId);
 * ```
 */
export async function loadSession(
  workspacePath: string,
): Promise<PersistedSession | null> {
  const filePath = join(workspacePath, SESSION_FILE);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;
  return JSON.parse(await file.text()) as PersistedSession;
}
```

- [ ] **Step 4: Wire persistence into CoordinatorSessionManager**

In the `spawnNewSession` method (around line 350), after `this.scheduleIdleTimeout()`, add:

```typescript
    await persistSession(this.config.workspacePath, {
      sessionId: this.activeSession.sessionId,
      chatId: this.activeSession.chatId,
      startedAt: this.activeSession.startedAt,
      processedEvents: this.activeSession.processedEvents,
    });
```

In the `continueSession` method (around line 395), after `this.scheduleIdleTimeout()`, add:

```typescript
    await persistSession(this.config.workspacePath, {
      sessionId: this.activeSession.sessionId,
      chatId: this.activeSession.chatId,
      startedAt: this.activeSession.startedAt,
      processedEvents: this.activeSession.processedEvents,
    });
```

In the `destroySession` method (around line 524), after `this.activeSession = null`, add:

```typescript
    persistSession(this.config.workspacePath, null).catch((err: unknown) => {
      logger.warn({ err }, "清除持久化 session 失败");
    });
```

- [ ] **Step 5: Run tests**

Run: `cd apps/server && bun run test:run -- src/__tests__/coordinator-session-persistence.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/coordinator.ts apps/server/src/__tests__/coordinator-session-persistence.test.ts
git commit -m "feat(coordinator): add session persistence to survive server restarts"
```

---

## Task 6: Self-Evolve Skill Injection + Workspace Integrity Check

**Files:**
- Modify: `apps/server/src/coordinator-init.ts`
- Modify: `packages/types/src/config.ts`
- Modify: `config/config.json`

- [ ] **Step 1: Add `pendingDir` and `requireApproval` to HooksConfig**

In `packages/types/src/config.ts`, replace the `HooksConfig` interface (lines 653-660):

```typescript
export interface HooksConfig {
  /** hooks 文件目录路径 */
  hooksDir: string;
  /** 待审批 hooks 文件目录路径 */
  pendingDir?: string;
  /** handle 超时时间（毫秒），默认 30000 */
  defaultTimeoutMs: number;
  /** 是否允许多个 hook 匹配同一事件，默认 false */
  multiMatch: boolean;
  /** 自动生成的 hook 是否需要人工审批 */
  requireApproval?: boolean;
}
```

- [ ] **Step 2: Update config.json**

In `config/config.json`, replace the hooks section (lines 145-149):

```json
  "hooks": {
    "hooksDir": "~/.teamsland/coordinator/hooks",
    "pendingDir": "~/.teamsland/coordinator/hooks-pending",
    "defaultTimeoutMs": 30000,
    "multiMatch": false,
    "requireApproval": true
  }
```

- [ ] **Step 3: Add self-evolve skill and workspace dirs to coordinator-init.ts**

In `apps/server/src/coordinator-init.ts`, add to the `WORKSPACE_DIRS` constant (after line 24, before the closing `}`):

```typescript
  selfEvolve: ".claude/skills/self-evolve",
```

In the `writeWorkspaceFiles` function, add a new entry to the files array (after the `meegoQuery` entry):

```typescript
    {
      path: join(WORKSPACE_DIRS.selfEvolve, "SKILL.md"),
      content: generateSelfEvolveSkill(),
    },
```

- [ ] **Step 4: Add the self-evolve skill template function**

At the end of `apps/server/src/coordinator-init.ts`, add:

```typescript
function generateSelfEvolveSkill(): string {
  return `---
name: self-evolve
description: >
  分析重复事件模式并创建自动化产物（hook、skill 或 subagent），
  减少 LLM 开销。当你发现同类事件已处理 3 次以上且决策模式相同时使用。
---

# 自我进化指南

你是 teamsland 的 Coordinator（大脑）。你的工作是处理团队事件并做出决策。
随着时间推移，你应该识别模式并将其自动化，减少自身的 LLM 开销。

## 三个层级

1. **Hook**（零 LLM）— \`~/.teamsland/coordinator/hooks/\` 中的 TypeScript 文件，由 server 直接执行
2. **Skill**（轻量 LLM）— \`.claude/skills/\` 中的 SKILL.md，为你提供 playbook
3. **Subagent**（隔离 LLM）— \`.claude/agents/\` 中的 .md，委托给子会话

## 何时创建什么

### 创建 Hook：
- 事件类型和动作 100% 确定性（不需要判断）
- 动作简单：发通知、spawn worker、调用 API
- 你已经以完全相同方式处理了 3+ 次
- 例如："issue.assigned 总是给 assignee 发 DM" → Hook

### 创建 Skill：
- 模式大致固定但需要轻微 LLM 判断
- 你需要 playbook 但细节因事件不同
- 例如："sprint.started → 汇总 sprint 项目并发到群聊" → Skill

### 创建 Subagent：
- 任务需要多步推理但属于已知类别
- 应在隔离环境中运行以避免污染上下文
- 例如："CI 失败分诊 → 读日志、定位根因、建议修复" → Subagent

## 审批模式

读取 \`~/.teamsland/coordinator/evolution-config.json\`：
- 若 \`requireApproval: true\`：写入 \`hooks-pending/\` 而非 \`hooks/\`，然后通过 Lark DM 通知管理员
- 若 \`requireApproval: false\` 或文件不存在：直接写入 \`hooks/\`

## Hook 文件模板

\`\`\`typescript
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "[描述这个 hook 做什么]";
export const priority = 100;

export const match = (event: MeegoEvent): boolean => {
  return event.type === "[EVENT_TYPE]";
};

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  // ctx.lark      — 发消息、搜联系人、读文档
  // ctx.notifier  — 发结构化通知
  // ctx.spawn()   — spawn worker（绕过队列）
  // ctx.queue     — 入队到 Coordinator
  // ctx.registry  — 查询 worker 状态
  // ctx.config    — 读配置
  // ctx.log       — 结构化日志
};
\`\`\`

## 进化日志

创建新 hook/skill/subagent 时，追加到 \`~/.teamsland/coordinator/evolution-log.jsonl\`：

\`\`\`json
{"timestamp": "ISO8601", "action": "create_hook", "path": "hooks/meego/xxx.ts", "reason": "处理了 5 次相同的 issue.assigned 通知", "patternCount": 5}
\`\`\`

## 安全规则

1. **永远不要创建直接修改代码仓库的 hook。** Hook 只能发通知、spawn worker 或入队事件。
2. **始终在 hook handler 中包含错误处理。**
3. **保持 match() 简单快速。**
4. **创建前测试。** 回顾最近 3+ 次处理决策，若有不同则不适合创建 hook。
5. **记录进化决策。** 创建新产物时记录原因和观察到的模式。
6. **永远不要创建调用 LLM API 的 hook。**
7. **一个文件一个 hook。**
`;
}
```

- [ ] **Step 5: Add workspace integrity check**

In `apps/server/src/coordinator-init.ts`, after the `initCoordinatorWorkspace` function, add:

```typescript
/**
 * 验证 Coordinator 工作目录完整性
 *
 * 检查所有必需文件是否存在。缺失的文件将在下次 initCoordinatorWorkspace 调用时被重新创建。
 *
 * @example
 * ```typescript
 * const { ok, missing } = await verifyWorkspaceIntegrity("~/.teamsland/coordinator");
 * if (!ok) logger.warn({ missing }, "Workspace 完整性检查失败");
 * ```
 */
export async function verifyWorkspaceIntegrity(
  workspacePath: string,
): Promise<{ ok: boolean; missing: string[] }> {
  const required = [
    "CLAUDE.md",
    ".claude/settings.json",
    join(WORKSPACE_DIRS.teamslandSpawn, "SKILL.md"),
    join(WORKSPACE_DIRS.larkMessage, "SKILL.md"),
    join(WORKSPACE_DIRS.larkDocs, "SKILL.md"),
    join(WORKSPACE_DIRS.meegoQuery, "SKILL.md"),
    join(WORKSPACE_DIRS.selfEvolve, "SKILL.md"),
  ];
  const missing: string[] = [];
  for (const rel of required) {
    const file = Bun.file(join(workspacePath, rel));
    if (!(await file.exists())) missing.push(rel);
  }
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 6: Add evolution-config.json to workspace init**

In the `writeWorkspaceFiles` function's files array, add:

```typescript
    {
      path: "evolution-config.json",
      content: JSON.stringify(
        {
          requireApproval: true,
          minPatternCount: 3,
          notifyUserId: null,
          notifyChannelId: null,
        },
        null,
        2,
      ),
    },
```

- [ ] **Step 7: Ensure hooks and hooks-pending dirs are created**

In the `createDirectories` function, add directory creation for the hooks dirs. After the `WORKSPACE_DIRS` loop, add:

```typescript
  for (const extraDir of ["hooks", "hooks-pending"]) {
    const fullPath = join(basePath, extraDir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
    }
  }
```

- [ ] **Step 8: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/coordinator-init.ts packages/types/src/config.ts config/config.json
git commit -m "feat(coordinator): add self-evolve skill injection, workspace integrity check, and evolution config"
```

---

## Task 7: Evolution Log Utility

**Files:**
- Create: `apps/server/src/evolution-log.ts`
- Create: `apps/server/src/__tests__/evolution-log.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/__tests__/evolution-log.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { appendEvolutionLog, readEvolutionLog } from "../evolution-log.js";

describe("Evolution Log", () => {
  const testDir = join(tmpdir(), `evo-test-${randomUUID().slice(0, 8)}`);

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  it("should append and read entries", async () => {
    mkdirSync(testDir, { recursive: true });

    await appendEvolutionLog(testDir, {
      timestamp: "2026-04-23T10:00:00Z",
      action: "create_hook",
      path: "hooks/meego/issue-assigned.ts",
      reason: "处理了 5 次相同的 issue.assigned",
      patternCount: 5,
    });

    await appendEvolutionLog(testDir, {
      timestamp: "2026-04-23T11:00:00Z",
      action: "approve_hook",
      path: "hooks/meego/issue-assigned.ts",
      reason: "管理员审批通过",
      approvedBy: "admin",
    });

    const entries = await readEvolutionLog(testDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe("create_hook");
    expect(entries[1].action).toBe("approve_hook");
  });

  it("should return empty array when log file does not exist", async () => {
    mkdirSync(testDir, { recursive: true });
    const entries = await readEvolutionLog(testDir);
    expect(entries).toEqual([]);
  });

  it("should handle limit and offset", async () => {
    mkdirSync(testDir, { recursive: true });

    for (let i = 0; i < 5; i++) {
      await appendEvolutionLog(testDir, {
        timestamp: `2026-04-23T${10 + i}:00:00Z`,
        action: "create_hook",
        path: `hooks/test-${i}.ts`,
        reason: `Test ${i}`,
      });
    }

    const page = await readEvolutionLog(testDir, 2, 1);
    expect(page).toHaveLength(2);
    expect(page[0].path).toBe("hooks/test-1.ts");
    expect(page[1].path).toBe("hooks/test-2.ts");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/server && bun run test:run -- src/__tests__/evolution-log.test.ts`

Expected: FAIL — `evolution-log.ts` does not exist.

- [ ] **Step 3: Implement evolution log**

Create `apps/server/src/evolution-log.ts`:

```typescript
// @teamsland/server — Evolution Log
// 追加/读取 Coordinator 自我进化日志

import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_FILE = "evolution-log.jsonl";

/**
 * 进化日志条目
 *
 * @example
 * ```typescript
 * import type { EvolutionLogEntry } from "./evolution-log.js";
 *
 * const entry: EvolutionLogEntry = {
 *   timestamp: new Date().toISOString(),
 *   action: "create_hook",
 *   path: "hooks/meego/issue-assigned.ts",
 *   reason: "处理了 5 次相同的 issue.assigned",
 *   patternCount: 5,
 * };
 * ```
 */
export interface EvolutionLogEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 动作类型 */
  action: "create_hook" | "create_skill" | "create_subagent" | "approve_hook" | "reject_hook";
  /** 产物路径 */
  path: string;
  /** 原因 */
  reason: string;
  /** 模式出现次数 */
  patternCount?: number;
  /** 审批人 */
  approvedBy?: string;
  /** 拒绝原因 */
  rejectedReason?: string;
}

/**
 * 追加一条进化日志
 *
 * @example
 * ```typescript
 * await appendEvolutionLog("/path/to/workspace", {
 *   timestamp: new Date().toISOString(),
 *   action: "create_hook",
 *   path: "hooks/meego/issue-assigned.ts",
 *   reason: "识别到重复模式",
 * });
 * ```
 */
export async function appendEvolutionLog(
  workspacePath: string,
  entry: EvolutionLogEntry,
): Promise<void> {
  const logPath = join(workspacePath, LOG_FILE);
  const line = JSON.stringify(entry) + "\n";
  await appendFile(logPath, line);
}

/**
 * 读取进化日志
 *
 * @param workspacePath - 工作目录路径
 * @param limit - 返回条数上限（默认 100）
 * @param offset - 跳过前 N 条（默认 0）
 * @returns 日志条目数组
 *
 * @example
 * ```typescript
 * const entries = await readEvolutionLog("/path/to/workspace", 10, 0);
 * ```
 */
export async function readEvolutionLog(
  workspacePath: string,
  limit = 100,
  offset = 0,
): Promise<EvolutionLogEntry[]> {
  const logPath = join(workspacePath, LOG_FILE);
  const file = Bun.file(logPath);
  if (!(await file.exists())) return [];

  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);
  const entries = lines.map((line) => JSON.parse(line) as EvolutionLogEntry);
  return entries.slice(offset, offset + limit);
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/server && bun run test:run -- src/__tests__/evolution-log.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/evolution-log.ts apps/server/src/__tests__/evolution-log.test.ts
git commit -m "feat(server): add evolution log utility for self-evolution tracking"
```

---

## Task 8: Wire Controllers into Server Init

**Files:**
- Modify: `apps/server/src/init/sidecar.ts`
- Modify: `apps/server/src/init/coordinator.ts`
- Modify: `apps/server/src/event-handlers.ts`

- [ ] **Step 1: Add ObserverController to SidecarResult**

In `apps/server/src/init/sidecar.ts`, add imports:

```typescript
import { InterruptController, ObserverController, ResumeController, TranscriptReader } from "@teamsland/sidecar";
```

Add to `SidecarResult` interface:

```typescript
  interruptController: InterruptController;
  resumeController: ResumeController;
  observerController: ObserverController;
  transcriptReader: TranscriptReader;
```

In `initSidecar`, after the `dataPlane` instantiation, add:

```typescript
  const transcriptReader = new TranscriptReader(createLogger("sidecar:transcript"));
  const interruptController = new InterruptController(processController, registry, transcriptReader, createLogger("sidecar:interrupt"));
  const observerController = new ObserverController(registry, processController, transcriptReader, createLogger("sidecar:observer"));
```

Note: `ResumeController` requires `skillInjector` and `claudeMdInjector` which are constructed in `worker-routes.ts` during spawn setup. Rather than constructing it here, export it as a lazy factory:

```typescript
  const createResumeController = (skillInjector: SkillInjector, claudeMdInjector: ClaudeMdInjector) =>
    new ResumeController(registry, transcriptReader, skillInjector, claudeMdInjector, processController, createLogger("sidecar:resume"));
```

Add `createResumeController` to `SidecarResult`. The actual `ResumeController` instance will be created in `initCoordinator` or `initEvents` where the injectors are available.

Return them in the result object.

- [ ] **Step 2: Wire AnomalyDetector into coordinator init**

In `apps/server/src/init/coordinator.ts`, add import:

```typescript
import { AnomalyDetector } from "@teamsland/sidecar";
```

After `WorkerLifecycleMonitor` instantiation (around line 111), add:

```typescript
  const anomalyDetector = new AnomalyDetector({
    registry,
    workerTimeoutMs: config.sidecar.workerTimeoutMs ?? 300_000,
    logger: createLogger("coordinator:anomaly"),
  });

  anomalyDetector.onAnomaly(async (anomaly) => {
    queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: anomaly.agentId,
        anomalyType: anomaly.type as "timeout" | "error_spike" | "stuck" | "crash",
        details: anomaly.details,
      },
      traceId: `anomaly-${anomaly.agentId}-${anomaly.type}`,
      priority: "high",
    });
  });

  // AnomalyDetector monitors per-agent. The WorkerLifecycleMonitor already
  // polls all agents. AnomalyDetector will be wired to monitor new agents
  // as they are registered. For now, start monitoring all currently running agents.
  for (const agent of registry.allRunning()) {
    anomalyDetector.startMonitoring(agent.agentId);
  }
```

Add `anomalyDetector` to the return type `CoordinatorResult` and return it.

- [ ] **Step 3: Add controllers to EventHandlerDeps**

In `apps/server/src/event-handlers.ts`, add to `EventHandlerDeps` interface (around line 52):

```typescript
  interruptController?: InterruptController | null;
  resumeController?: ResumeController | null;
  observerController?: ObserverController | null;
```

Add imports:

```typescript
import type { InterruptController, ObserverController, ResumeController } from "@teamsland/sidecar";
```

- [ ] **Step 4: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass (with possible warnings about unused vars which is fine at this stage).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/init/sidecar.ts apps/server/src/init/coordinator.ts apps/server/src/event-handlers.ts
git commit -m "feat(server): wire InterruptController, ResumeController, ObserverController into server init"
```

---

## Task 9: Implement `diagnosis_ready` Handler and Enhance `handleWorkerAnomaly`

**Files:**
- Modify: `apps/server/src/event-handlers.ts:206-208` (diagnosis_ready)
- Modify: `apps/server/src/event-handlers.ts:717-746` (handleWorkerAnomaly)

- [ ] **Step 1: Replace the diagnosis_ready stub**

In `apps/server/src/event-handlers.ts`, replace the `diagnosis_ready` case (lines 206-208):

```typescript
    case "diagnosis_ready": {
      await handleDiagnosisReady(msg, deps);
      break;
    }
```

- [ ] **Step 2: Implement handleDiagnosisReady function**

Add a new function in `event-handlers.ts`:

```typescript
/**
 * 处理诊断就绪消息
 *
 * Observer Worker 完成诊断后的后续动作：
 * - interrupt: 中断目标 Worker 并恢复
 * - let_continue: 不做任何操作
 * - inject_hint: 向 Worker stdin 注入提示
 *
 * @example
 * ```typescript
 * await handleDiagnosisReady(msg, deps);
 * ```
 */
async function handleDiagnosisReady(msg: QueueMessage, deps: EventHandlerDeps): Promise<void> {
  const payload = msg.payload as DiagnosisReadyPayload;
  const { targetWorkerId, observerWorkerId, report } = payload;

  logger.info({ targetWorkerId, observerWorkerId, msgId: msg.id }, "处理诊断就绪消息");

  let diagnosis: {
    verdict: string;
    recommendation: string;
    analysis: string;
    correctionInstructions: string;
  };

  try {
    diagnosis = JSON.parse(report) as typeof diagnosis;
  } catch {
    logger.error({ report }, "诊断报告 JSON 解析失败，回退到 Coordinator 处理");
    if (deps.coordinatorManager) {
      const event = toCoordinatorEvent(msg);
      await deps.coordinatorManager.processEvent(event);
    }
    return;
  }

  logger.info(
    { targetWorkerId, verdict: diagnosis.verdict, recommendation: diagnosis.recommendation },
    "诊断结论",
  );

  if (diagnosis.recommendation === "interrupt" && deps.interruptController && deps.resumeController) {
    try {
      await deps.interruptController.interrupt({
        agentId: targetWorkerId,
        reason: diagnosis.analysis,
      });
      logger.info({ targetWorkerId }, "Worker 已根据诊断中断");

      const resumeResult = await deps.resumeController.resume({
        predecessorId: targetWorkerId,
        correctionInstructions: diagnosis.correctionInstructions,
      });
      logger.info({ newWorkerId: resumeResult.newAgentId }, "Worker 已恢复");
    } catch (err: unknown) {
      logger.error({ err, targetWorkerId }, "中断/恢复流程失败");
    }
  } else if (diagnosis.recommendation === "let_continue") {
    logger.info({ targetWorkerId }, "诊断建议：继续运行");
  } else {
    // inject_hint or unknown — delegate to coordinator if available
    if (deps.coordinatorManager) {
      const event = toCoordinatorEvent(msg);
      await deps.coordinatorManager.processEvent(event);
    }
  }
}
```

Add the necessary import at the top:

```typescript
import type { DiagnosisReadyPayload } from "@teamsland/queue";
import { toCoordinatorEvent } from "./coordinator-event-mapper.js";
```

(Check if `toCoordinatorEvent` is already imported — it may be used elsewhere in the file.)

- [ ] **Step 3: Enhance handleWorkerAnomaly with observer fallback**

In `apps/server/src/event-handlers.ts`, in the `handleWorkerAnomaly` function (around line 745), after the coordinator fallback and before the Lark DM notification, add the observer path:

Find the existing pattern:
```typescript
    // Coordinator 不可用或出错时的回退通知
    await notifyWorkerAnomaly(deps, workerId, anomalyType, details);
```

And wrap it:

```typescript
    // Coordinator 不可用时，尝试自动启动 Observer
    if (deps.observerController) {
      try {
        const result = await deps.observerController.observe({
          targetAgentId: workerId,
          anomalyType,
          mode: "diagnosis",
        });
        logger.info({ observerAgentId: result.observerAgentId, targetWorkerId: workerId }, "已自动启动 Observer 诊断");
        return;
      } catch (observeErr: unknown) {
        logger.error({ err: observeErr, workerId }, "自动启动 Observer 失败，回退到通知");
      }
    }

    await notifyWorkerAnomaly(deps, workerId, anomalyType, details);
```

- [ ] **Step 4: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/event-handlers.ts
git commit -m "feat(server): implement diagnosis_ready handler and enhance worker anomaly with observer fallback"
```

---

## Task 10: Add API Endpoints for Interrupt/Resume/Observe

**Files:**
- Modify: `apps/server/src/worker-routes.ts`

- [ ] **Step 1: Add interrupt endpoint**

In `apps/server/src/worker-routes.ts`, in the `dispatchSubRoute` function (around line 549-569), add new cases:

```typescript
    case "interrupt": {
      if (req.method !== "POST") return methodNotAllowed();
      return handleInterruptWorker(req, agentId, deps);
    }
    case "resume": {
      if (req.method !== "POST") return methodNotAllowed();
      return handleResumeWorker(req, agentId, deps);
    }
    case "observe": {
      if (req.method !== "POST") return methodNotAllowed();
      return handleObserveWorker(req, agentId, deps);
    }
```

- [ ] **Step 2: Implement the handler functions**

Add after the existing handler functions:

```typescript
/**
 * 中断指定 Worker
 *
 * @example
 * ```
 * POST /api/workers/:id/interrupt
 * Body: { "reason": "手动中断" }
 * ```
 */
async function handleInterruptWorker(
  req: Request,
  agentId: string,
  deps: WorkerRouteDeps,
): Promise<Response> {
  if (!deps.interruptController) {
    return jsonResponse({ error: "InterruptController 未配置" }, 503);
  }

  let reason = "手动中断";
  try {
    const body = (await req.json()) as { reason?: string };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    // 使用默认 reason
  }

  try {
    const result = await deps.interruptController.interrupt({ agentId, reason });
    return jsonResponse(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 400);
  }
}

/**
 * 恢复指定 Worker（relay 模式）
 *
 * @example
 * ```
 * POST /api/workers/:id/resume
 * Body: { "correctionInstructions": "避免修改 package.json" }
 * ```
 */
async function handleResumeWorker(
  req: Request,
  agentId: string,
  deps: WorkerRouteDeps,
): Promise<Response> {
  if (!deps.resumeController) {
    return jsonResponse({ error: "ResumeController 未配置" }, 503);
  }

  let correctionInstructions = "";
  try {
    const body = (await req.json()) as { correctionInstructions?: string };
    if (typeof body.correctionInstructions === "string") {
      correctionInstructions = body.correctionInstructions;
    }
  } catch {
    // 使用空指令
  }

  try {
    const result = await deps.resumeController.resume({
      predecessorId: agentId,
      correctionInstructions,
    });
    return jsonResponse(result, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 400);
  }
}

/**
 * 为指定 Worker 启动观察者
 *
 * @example
 * ```
 * POST /api/workers/:id/observe
 * Body: { "mode": "diagnosis" }
 * ```
 */
async function handleObserveWorker(
  req: Request,
  agentId: string,
  deps: WorkerRouteDeps,
): Promise<Response> {
  if (!deps.observerController) {
    return jsonResponse({ error: "ObserverController 未配置" }, 503);
  }

  let mode: "progress" | "quality" | "diagnosis" = "diagnosis";
  try {
    const body = (await req.json()) as { mode?: string };
    if (body.mode === "progress" || body.mode === "quality" || body.mode === "diagnosis") {
      mode = body.mode;
    }
  } catch {
    // 使用默认 mode
  }

  try {
    const result = await deps.observerController.observe({
      targetAgentId: agentId,
      anomalyType: "manual",
      mode,
    });
    return jsonResponse(result, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 400);
  }
}
```

- [ ] **Step 3: Add controller types to WorkerRouteDeps**

In `WorkerRouteDeps` interface, add:

```typescript
  interruptController?: InterruptController | null;
  resumeController?: ResumeController | null;
  observerController?: ObserverController | null;
```

Add imports:

```typescript
import type { InterruptController, ObserverController, ResumeController } from "@teamsland/sidecar";
```

- [ ] **Step 4: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/worker-routes.ts
git commit -m "feat(server): add interrupt/resume/observe API endpoints"
```

---

## Task 11: Add Dashboard Endpoints for Evolution Management

**Files:**
- Modify: `apps/server/src/dashboard.ts`

- [ ] **Step 1: Add pending hooks and evolution-log endpoints**

In `apps/server/src/dashboard.ts`, in the `handleHookRoutes` function (after the existing `/api/hooks/metrics` handler), add:

```typescript
  // GET /api/hooks/pending — 待审批 hook 列表
  if (req.method === "GET" && url.pathname === "/api/hooks/pending") {
    const pendingDir = config.hooks?.pendingDir;
    if (!pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);

    const resolvedDir = pendingDir.startsWith("~")
      ? join(homedir(), pendingDir.slice(1))
      : pendingDir;

    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(resolvedDir).catch(() => [] as string[]);
      const pending = files
        .filter((f) => f.endsWith(".ts"))
        .map((f) => ({
          filename: f,
          path: join(resolvedDir, f),
        }));
      return jsonResponse({ pending });
    } catch {
      return jsonResponse({ pending: [] });
    }
  }

  // POST /api/hooks/:filename/approve — 审批通过
  const approveMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const filename = approveMatch[1];
    const pendingDir = config.hooks?.pendingDir;
    const hooksDir = config.hooks?.hooksDir;
    if (!pendingDir || !hooksDir) return jsonResponse({ error: "hooks 目录未配置" }, 400);

    const resolvedPending = pendingDir.startsWith("~") ? join(homedir(), pendingDir.slice(1)) : pendingDir;
    const resolvedHooks = hooksDir.startsWith("~") ? join(homedir(), hooksDir.slice(1)) : hooksDir;
    const { rename } = await import("node:fs/promises");

    try {
      await rename(join(resolvedPending, filename), join(resolvedHooks, filename));
      const { appendEvolutionLog } = await import("./evolution-log.js");
      const workspacePath = config.coordinator?.workspacePath ?? "~/.teamsland/coordinator";
      const resolvedWorkspace = workspacePath.startsWith("~") ? join(homedir(), workspacePath.slice(1)) : workspacePath;
      await appendEvolutionLog(resolvedWorkspace, {
        timestamp: new Date().toISOString(),
        action: "approve_hook",
        path: `hooks/${filename}`,
        reason: "Dashboard 审批通过",
      });
      return jsonResponse({ approved: filename });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  }

  // POST /api/hooks/:filename/reject — 拒绝
  const rejectMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const filename = rejectMatch[1];
    const pendingDir = config.hooks?.pendingDir;
    if (!pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);

    const resolvedPending = pendingDir.startsWith("~") ? join(homedir(), pendingDir.slice(1)) : pendingDir;
    const { unlink } = await import("node:fs/promises");

    let reason = "未指定原因";
    try {
      const body = (await req.json()) as { reason?: string };
      if (typeof body.reason === "string") reason = body.reason;
    } catch { /* use default */ }

    try {
      await unlink(join(resolvedPending, filename));
      const { appendEvolutionLog } = await import("./evolution-log.js");
      const workspacePath = config.coordinator?.workspacePath ?? "~/.teamsland/coordinator";
      const resolvedWorkspace = workspacePath.startsWith("~") ? join(homedir(), workspacePath.slice(1)) : workspacePath;
      await appendEvolutionLog(resolvedWorkspace, {
        timestamp: new Date().toISOString(),
        action: "reject_hook",
        path: `hooks-pending/${filename}`,
        reason,
        rejectedReason: reason,
      });
      return jsonResponse({ rejected: filename });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: msg }, 400);
    }
  }

  // GET /api/hooks/evolution-log — 进化日志
  if (req.method === "GET" && url.pathname === "/api/hooks/evolution-log") {
    const { readEvolutionLog } = await import("./evolution-log.js");
    const workspacePath = config.coordinator?.workspacePath ?? "~/.teamsland/coordinator";
    const resolvedWorkspace = workspacePath.startsWith("~") ? join(homedir(), workspacePath.slice(1)) : workspacePath;
    const limit = Number(url.searchParams.get("limit")) || 100;
    const offset = Number(url.searchParams.get("offset")) || 0;
    const entries = await readEvolutionLog(resolvedWorkspace, limit, offset);
    return jsonResponse({ entries, total: entries.length });
  }
```

Add import at the top of the file:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
```

(Check if these are already imported.)

- [ ] **Step 2: Run type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/dashboard.ts
git commit -m "feat(dashboard): add pending hooks approval and evolution log API endpoints"
```

---

## Task 12: Wire Everything Together in main.ts

**Files:**
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/src/init/coordinator.ts`

- [ ] **Step 1: Import verifyWorkspaceIntegrity**

In `apps/server/src/main.ts`, add import:

```typescript
import { verifyWorkspaceIntegrity } from "./coordinator-init.js";
```

- [ ] **Step 2: Add workspace integrity check after coordinator init**

After the coordinator init phase (Phase 5.5), add:

```typescript
  // ── Phase 5.6: Workspace 完整性校验 ──
  if (config.coordinator?.enabled) {
    const workspacePath = config.coordinator.workspacePath?.startsWith("~")
      ? join(homedir(), config.coordinator.workspacePath.slice(1))
      : config.coordinator.workspacePath ?? join(homedir(), ".teamsland/coordinator");
    const integrity = await verifyWorkspaceIntegrity(workspacePath);
    if (!integrity.ok) {
      logger.warn({ missing: integrity.missing }, "Coordinator workspace 完整性检查失败，缺失文件将在下次 init 时重建");
    }
  }
```

Add `homedir` import:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
```

- [ ] **Step 3: Pass controllers to event handler deps**

In the init sequence where `deps` is built for event handlers (in `initEvents` or wherever the deps object is constructed), ensure `interruptController`, `resumeController`, and `observerController` from `sidecar` are passed through.

This likely requires updating `initEvents` to accept the sidecar controllers and pass them into the deps object. In `apps/server/src/init/events.ts`, add the controllers to the deps construction:

```typescript
  const deps: EventHandlerDeps = {
    // ...existing...
    interruptController: sidecar.interruptController ?? null,
    resumeController: sidecar.resumeController ?? null,
    observerController: sidecar.observerController ?? null,
  };
```

- [ ] **Step 4: Update shutdown handler**

In the shutdown handler in `main.ts`, add cleanup for the anomaly detector if it was wired:

```typescript
  if (coordinator.anomalyDetector) coordinator.anomalyDetector.stopAll();
```

- [ ] **Step 5: Run full type check**

Run: `cd apps/server && bun run typecheck`

Expected: Pass.

- [ ] **Step 6: Run all tests**

Run: `bun run test:run`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/main.ts apps/server/src/init/coordinator.ts apps/server/src/init/events.ts
git commit -m "feat(server): wire all controllers and integrity check into startup sequence"
```

---

## Task 13: Run Full Lint and Verify

**Files:**
- All modified files

- [ ] **Step 1: Run Biome lint**

Run: `bun run lint`

Expected: Pass with no errors.

- [ ] **Step 2: Run full test suite**

Run: `bun run test:run`

Expected: All tests pass.

- [ ] **Step 3: Run type check across all packages**

Run: `bun run typecheck`

Expected: Pass.

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: lint fixes for capability alignment modules 2-4"
```
