# @teamsland/swarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/swarm` package — a task decomposition and parallel Worker orchestration engine. LLM decomposes a `ComplexTask` into a `SubTask` DAG, schedules Workers by dependency tiers with `Promise.allSettled`, and validates the overall result through a quorum check (`minSwarmSuccessRatio`). Provides `TaskPlanner`, `runSwarm`, `runWorker`, and `SwarmOpts` as the public API.

**Architecture:** Six source files: `types.ts` (local `LlmClient`, `SwarmOpts` interfaces), `task-planner.ts` (`TaskPlanner` class — LLM-driven decomposition), `worker.ts` (`runWorker` — single Worker execution unit), `swarm.ts` (`runSwarm` — orchestration + topological sort), `index.ts` (barrel exports). Three injectable interfaces (`LlmClient`, `SubagentRegistry`, `ProcessController`) enable testing without real subprocesses.

**Tech Stack:** TypeScript (strict), Bun, Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/swarm` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has dependencies on `@teamsland/types`, `@teamsland/sidecar`, and `@teamsland/context`. It is missing `@teamsland/observability`. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-swarm-design.md`.

**Dependency injection pattern:** All external dependencies (`planner`, `registry`, `assembler`, `processController`) are injected via `SwarmOpts` — no global state. This enables full testability with Mock/Fake implementations.

**LlmClient is local:** `packages/swarm/src/types.ts` defines its own `LlmClient` interface independent of `@teamsland/memory` to avoid circular dependencies. The swarm version has no `tools` parameter — only `chat()`.

**Topological sort:** `topoSort()` is an internal helper (not exported) using Kahn's BFS algorithm. It partitions SubTasks into tiers where all SubTasks in a tier have no inter-dependencies and can run fully in parallel.

**Quorum check semantics:** `fulfilled / total >= minSwarmSuccessRatio`. When `total = 0` (empty subtask list), ratio is treated as 1 (100%) — always passes.

## Critical Files

- **Modify:** `packages/types/src/swarm.ts` (new file — `SubTask`, `WorkerResult`, `SwarmResult`)
- **Modify:** `packages/types/src/index.ts` (re-export swarm types)
- **Modify:** `packages/swarm/package.json` (add `@teamsland/observability` workspace dep)
- **Create:** `packages/swarm/src/types.ts`
- **Create:** `packages/swarm/src/task-planner.ts`
- **Create:** `packages/swarm/src/__tests__/task-planner.test.ts`
- **Create:** `packages/swarm/src/worker.ts`
- **Create:** `packages/swarm/src/__tests__/worker.test.ts`
- **Create:** `packages/swarm/src/swarm.ts`
- **Create:** `packages/swarm/src/__tests__/swarm.test.ts`
- **Modify:** `packages/swarm/src/index.ts` (barrel exports)

## Conventions

- JSDoc: Chinese, every exported function/class/interface must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- Run tests with: `bunx --bun vitest run packages/swarm/`
- Run typecheck with: `bunx tsc --noEmit --project packages/swarm/tsconfig.json`
- Run lint with: `bunx biome check packages/swarm/src/`

## Shared Test Helpers

All three test files share common Mock/Fake implementations. Define these once per test file (or in a shared `helpers.ts`).

### FakeLlmClient (used in task-planner.test.ts)

```typescript
// packages/swarm/src/__tests__/helpers.ts

import type { LlmClient, LlmResponse } from "../types.js";

/**
 * 预编程 LLM 客户端，用于 TaskPlanner 测试
 */
export class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private index = 0;

  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }

  async chat(_messages: unknown[]): Promise<LlmResponse> {
    const resp = this.responses[this.index];
    if (!resp) throw new Error("FakeLlmClient: 响应序列已耗尽");
    this.index++;
    return resp;
  }
}
```

### MockProcessController (used in worker.test.ts and swarm.test.ts)

```typescript
import type { ProcessController } from "@teamsland/sidecar";

export function createMockProcessController(
  behavior: "success" | "timeout" | "failure",
  output: Record<string, unknown> = {},
): ProcessController {
  return {
    async spawn(_opts) {
      if (behavior === "success") return output;
      if (behavior === "timeout") throw new Error("spawn: timeout after 300s");
      throw new Error("spawn: process exited with code 1");
    },
  } as unknown as ProcessController;
}
```

### MockAssembler (used in worker.test.ts and swarm.test.ts)

```typescript
import type { DynamicContextAssembler } from "@teamsland/context";

export function createMockAssembler(prompt = "mock-prompt"): DynamicContextAssembler {
  return {
    async assemble(_opts) {
      return prompt;
    },
  } as unknown as DynamicContextAssembler;
}
```

### MockRegistry (used in worker.test.ts and swarm.test.ts)

```typescript
import type { SubagentRegistry } from "@teamsland/sidecar";

export function createMockRegistry(): SubagentRegistry {
  return {} as SubagentRegistry;
}
```

---

### Task 1: Add SubTask / WorkerResult / SwarmResult to @teamsland/types

**Files:**
- Create: `packages/types/src/swarm.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Create packages/types/src/swarm.ts**

Create `/Users/bytedance/workspace/teamsland/packages/types/src/swarm.ts`:

```typescript
/**
 * Swarm 子任务
 *
 * 代表 TaskPlanner 拆解后的一个可执行子任务节点。
 * `dependencies` 中的 taskId 必须全部完成后，当前 SubTask 才能开始执行。
 *
 * @example
 * const subtask: SubTask = {
 *   taskId: "subtask-001",
 *   description: "分析 Q1 代码提交记录，汇总主要变更模式",
 *   agentRole: "代码分析师",
 *   dependencies: [],
 * };
 */
export interface SubTask {
  /** 子任务唯一标识符 */
  taskId: string;
  /** 子任务的自然语言描述 */
  description: string;
  /** 执行该子任务的 Agent 角色定义 */
  agentRole: string;
  /** 前置依赖的子任务 ID 列表；空数组表示无依赖，可立即执行 */
  dependencies: string[];
}

/**
 * Swarm 单个 Worker 的执行结果
 *
 * @example
 * const result: WorkerResult = {
 *   taskId: "subtask-001",
 *   status: "fulfilled",
 *   output: { summary: "共 47 个提交，主要集中在 packages/memory" },
 * };
 */
export interface WorkerResult {
  /** 对应的子任务 ID */
  taskId: string;
  /** 执行状态 */
  status: "fulfilled" | "rejected";
  /** 成功时的输出数据 */
  output?: Record<string, unknown>;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * runSwarm 整体执行结果
 *
 * @example
 * const result: SwarmResult = {
 *   success: true,
 *   results: [
 *     { taskId: "subtask-001", status: "fulfilled", output: { summary: "..." } },
 *   ],
 *   failedTaskIds: [],
 * };
 */
export interface SwarmResult {
  /** 是否通过法定人数检查（fulfilled / total >= minSwarmSuccessRatio） */
  success: boolean;
  /** 所有子任务的执行结果列表 */
  results: WorkerResult[];
  /** 执行失败的子任务 ID 列表 */
  failedTaskIds: string[];
}
```

- [ ] **Step 2: Re-export from packages/types/src/index.ts**

Open `/Users/bytedance/workspace/teamsland/packages/types/src/index.ts` and add at the bottom:

```typescript
export type { SubTask, WorkerResult, SwarmResult } from "./swarm.js";
```

- [ ] **Step 3: Run typecheck**

Run: `bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/types/src/swarm.ts packages/types/src/index.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/types/src/swarm.ts packages/types/src/index.ts && git commit -m "$(cat <<'EOF'
feat(types): add SubTask, WorkerResult, SwarmResult for @teamsland/swarm

Defines the Swarm type surface: SubTask DAG nodes, per-Worker results,
and the overall SwarmResult with quorum-check outcome.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Update packages/swarm/package.json with @teamsland/observability

**Files:**
- Modify: `packages/swarm/package.json`

- [ ] **Step 1: Add @teamsland/observability dependency**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/swarm/package.json`:

```json
{
  "name": "@teamsland/swarm",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/sidecar": "workspace:*",
    "@teamsland/context": "workspace:*",
    "@teamsland/observability": "workspace:*"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`
Expected: Resolves without errors

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/package.json bun.lockb && git commit -m "$(cat <<'EOF'
chore(swarm): add @teamsland/observability workspace dependency

Required for structured logging via createLogger in all swarm modules.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create types.ts — LlmClient, LlmResponse, SwarmOpts

**Files:**
- Create: `packages/swarm/src/types.ts`

No test file — pure type/interface definitions.

- [ ] **Step 1: Create types.ts**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/types.ts`:

```typescript
import type { SidecarConfig } from "@teamsland/types";
import type { SubagentRegistry, ProcessController } from "@teamsland/sidecar";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { TaskPlanner } from "./task-planner.js";

/**
 * LLM 调用结果
 *
 * @example
 * const resp: LlmResponse = { content: '[{"taskId":"st-1","description":"...","agentRole":"...","dependencies":[]}]' };
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
}

/**
 * Swarm 模块内部 LLM 客户端接口
 *
 * 仅需 chat() 方法（无工具调用），简化可注入接口。
 * 真实实现由调用方（main.ts 或 apps/server）在启动时注入。
 *
 * @example
 * // 测试时使用 FakeLlmClient
 * const fakeLlm: LlmClient = {
 *   async chat(_messages) {
 *     return { content: JSON.stringify([{ taskId: "t1", description: "...", agentRole: "...", dependencies: [] }]) };
 *   },
 * };
 */
export interface LlmClient {
  /**
   * 发送对话消息并获取回复
   * @param messages - 消息历史（role + content 对）
   */
  chat(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<LlmResponse>;
}

/**
 * runSwarm 选项
 *
 * 所有外部依赖均通过此对象注入，便于测试时替换 Mock。
 *
 * @example
 * const opts: SwarmOpts = {
 *   planner,
 *   registry,
 *   assembler,
 *   processController,
 *   config: appConfig.sidecar,
 *   teamId: "team-abc",
 * };
 */
export interface SwarmOpts {
  /** 任务拆解器，负责将 ComplexTask 分解为 SubTask[] */
  planner: TaskPlanner;
  /** Subagent 注册表，用于 Worker 启动与追踪 */
  registry: SubagentRegistry;
  /** 动态上下文组装器，用于构建 Worker Prompt */
  assembler: DynamicContextAssembler;
  /** 进程控制器，负责 Bun.spawn Claude Code 子进程 */
  processController: ProcessController;
  /** Sidecar 配置（workerTimeoutSeconds、minSwarmSuccessRatio） */
  config: SidecarConfig;
  /** 团队 ID，透传给 Worker 上下文组装 */
  teamId: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors (note: task-planner.ts doesn't exist yet — this may emit a "Cannot find module" for the forward reference; that's OK at this step)

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/types.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/src/types.ts && git commit -m "$(cat <<'EOF'
feat(swarm): add types.ts — local LlmClient, LlmResponse, SwarmOpts

Local LlmClient interface (no tools param) avoids circular dep with
@teamsland/memory. SwarmOpts injects all external dependencies for
full testability.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Create task-planner.ts (TDD)

**Files:**
- Create: `packages/swarm/src/task-planner.ts`
- Create: `packages/swarm/src/__tests__/task-planner.test.ts`

Pure LLM-driven decomposition — ideal TDD target with FakeLlmClient.

- [ ] **Step 1: Create task-planner test**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/__tests__/task-planner.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { LlmClient, LlmResponse } from "../types.js";
import { TaskPlanner } from "../task-planner.js";

/** 预编程 LLM 客户端，用于 TaskPlanner 测试 */
class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private index = 0;

  constructor(responses: LlmResponse[]) {
    this.responses = responses;
  }

  async chat(_messages: unknown[]): Promise<LlmResponse> {
    const resp = this.responses[this.index];
    if (!resp) throw new Error("FakeLlmClient: 响应序列已耗尽");
    this.index++;
    return resp;
  }
}

const baseTask = {
  taskId: "task-001",
  description: "分析团队 Q1 开发效率并生成报告",
  teamId: "team-abc",
};

describe("TaskPlanner.decompose()", () => {
  it("正常拆解：返回合法 SubTask[] 列表", async () => {
    const subtasks = [
      { taskId: "st-1", description: "分析提交记录", agentRole: "代码分析师", dependencies: [] },
      { taskId: "st-2", description: "生成报告", agentRole: "报告撰写员", dependencies: ["st-1"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result).toHaveLength(2);
    expect(result[0].taskId).toBe("st-1");
    expect(result[1].dependencies).toEqual(["st-1"]);
  });

  it("无依赖任务：所有 SubTask.dependencies 为空数组", async () => {
    const subtasks = [
      { taskId: "st-1", description: "任务A", agentRole: "角色A", dependencies: [] },
      { taskId: "st-2", description: "任务B", agentRole: "角色B", dependencies: [] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result.every((s) => s.dependencies.length === 0)).toBe(true);
  });

  it("有依赖任务：SubTask A 依赖 SubTask B，验证 dependencies 字段", async () => {
    const subtasks = [
      { taskId: "st-1", description: "准备数据", agentRole: "数据工程师", dependencies: [] },
      { taskId: "st-2", description: "分析数据", agentRole: "数据分析师", dependencies: ["st-1"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result[1].dependencies).toContain("st-1");
  });

  it("空任务列表：LLM 返回 [] 时 decompose() 返回空数组（不抛出）", async () => {
    const llm = new FakeLlmClient([{ content: "[]" }]);
    const planner = new TaskPlanner({ llm });
    const result = await planner.decompose(baseTask);
    expect(result).toEqual([]);
  });

  it("非法 JSON：LLM 返回非 JSON 字符串时抛出含 raw 内容的 Error", async () => {
    const llm = new FakeLlmClient([{ content: "not json at all" }]);
    const planner = new TaskPlanner({ llm });
    await expect(planner.decompose(baseTask)).rejects.toThrow("TaskPlanner");
    await expect(planner.decompose(baseTask)).rejects.toThrow("not json");
  });

  it("非数组 JSON：LLM 返回对象 {} 时抛出不是数组错误", async () => {
    const llm = new FakeLlmClient([{ content: "{}" }, { content: "{}" }]);
    const planner = new TaskPlanner({ llm });
    await expect(planner.decompose(baseTask)).rejects.toThrow("不是数组");
  });

  it("结构不完整：SubTask 缺少 agentRole 字段时抛出结构错误", async () => {
    const malformed = [{ taskId: "st-1", description: "任务A", dependencies: [] }];
    const llm = new FakeLlmClient([{ content: JSON.stringify(malformed) }]);
    const planner = new TaskPlanner({ llm });
    await expect(planner.decompose(baseTask)).rejects.toThrow("结构非法");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/task-planner.test.ts`
Expected: FAIL — `../task-planner.js` does not exist

- [ ] **Step 3: Create task-planner.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/task-planner.ts`:

```typescript
import type { ComplexTask, SubTask } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";
import type { LlmClient } from "./types.js";

const logger = createLogger("swarm:planner");

/**
 * 任务拆解器
 *
 * 将 ComplexTask 委托给 LLM，输出 SubTask[]（有向无环图节点列表）。
 * LlmClient 通过构造函数注入，支持测试时替换 FakeLlmClient。
 *
 * @example
 * const planner = new TaskPlanner({ llm: myLlmClient });
 * const subtasks = await planner.decompose({
 *   taskId: "task-001",
 *   description: "分析团队 Q1 开发效率并生成报告",
 *   teamId: "team-abc",
 * });
 * // subtasks[0] => { taskId: "st-1", description: "...", agentRole: "...", dependencies: [] }
 */
export class TaskPlanner {
  private readonly llm: LlmClient;

  /**
   * 构造 TaskPlanner
   * @param opts - 注入选项
   * @param opts.llm - LLM 客户端（可注入 FakeLlmClient 用于测试）
   */
  constructor(opts: { llm: LlmClient }) {
    this.llm = opts.llm;
  }

  /**
   * 将复杂任务拆解为有序子任务列表
   *
   * 调用 LLM，要求其返回 JSON 格式的 SubTask[]。
   * SubTask.dependencies 中的 taskId 必须引用同一返回列表中的其他 SubTask。
   *
   * @param task - 待拆解的复杂任务
   * @returns 子任务列表（已通过 JSON 解析验证）
   * @throws {Error} LLM 返回非法 JSON 或结构不符合 SubTask[] 时抛出
   *
   * @example
   * const planner = new TaskPlanner({ llm });
   * const subtasks = await planner.decompose({
   *   taskId: "t-1",
   *   description: "对比两个版本的 API 性能并出具报告",
   *   teamId: "team-1",
   * });
   * console.log(subtasks.length); // e.g. 3
   */
  async decompose(task: ComplexTask): Promise<SubTask[]> {
    logger.info({ taskId: task.taskId }, "开始任务拆解");

    const systemPrompt = [
      "你是一个任务拆解专家。",
      "请将用户提供的复杂任务拆解为若干可并行执行的子任务。",
      "输出格式：JSON 数组，每个元素满足以下结构：",
      "  { taskId: string, description: string, agentRole: string, dependencies: string[] }",
      "要求：",
      "  1. taskId 唯一，格式建议 st-1、st-2……",
      "  2. dependencies 仅引用同一数组中其他 SubTask 的 taskId",
      "  3. 无依赖的 SubTask 的 dependencies 为空数组",
      "  4. 不要输出 JSON 以外的任何文本",
    ].join("\n");

    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: `任务描述：${task.description}` },
    ]);

    const subtasks = parseSubTasks(response.content);
    logger.info({ taskId: task.taskId, count: subtasks.length }, "任务拆解完成");
    return subtasks;
  }
}

/**
 * 解析 LLM 返回的 SubTask JSON
 *
 * 内部辅助函数，不导出。
 * @throws {Error} JSON 解析失败或结构不符时抛出
 */
function parseSubTasks(raw: string): SubTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    throw new Error(`TaskPlanner: LLM 返回非法 JSON — ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("TaskPlanner: LLM 返回值不是数组");
  }

  return parsed.map((item, index) => {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).taskId !== "string" ||
      typeof (item as Record<string, unknown>).description !== "string" ||
      typeof (item as Record<string, unknown>).agentRole !== "string" ||
      !Array.isArray((item as Record<string, unknown>).dependencies)
    ) {
      throw new Error(`TaskPlanner: 第 ${index} 个子任务结构非法`);
    }
    const rec = item as Record<string, unknown>;
    return {
      taskId: rec.taskId as string,
      description: rec.description as string,
      agentRole: rec.agentRole as string,
      dependencies: rec.dependencies as string[],
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/task-planner.test.ts`
Expected: All 7 tests pass

Note on the "非法 JSON" test: the test calls `planner.decompose` twice because the first call will consume the one available response from FakeLlmClient. The second call will throw "响应序列已耗尽". Adjust either the test (use two separate `FakeLlmClient` instances) or match the actual error message pattern carefully.

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/task-planner.ts packages/swarm/src/__tests__/task-planner.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/src/task-planner.ts packages/swarm/src/__tests__/task-planner.test.ts && git commit -m "$(cat <<'EOF'
feat(swarm): add TaskPlanner — LLM-driven task decomposition (TDD)

TDD: 7 tests covering successful decomposition, empty array, malformed
JSON, non-array JSON, and missing agentRole field validation.
Uses FakeLlmClient for deterministic test behavior.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Create worker.ts (TDD)

**Files:**
- Create: `packages/swarm/src/worker.ts`
- Create: `packages/swarm/src/__tests__/worker.test.ts`

- [ ] **Step 1: Create worker test**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/__tests__/worker.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { SubTask, ComplexTask, SidecarConfig } from "@teamsland/types";
import type { SubagentRegistry, ProcessController } from "@teamsland/sidecar";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { SwarmOpts } from "../types.js";
import { runWorker } from "../worker.js";
import { TaskPlanner } from "../task-planner.js";

/** 构建测试用 SwarmOpts */
function buildOpts(
  behavior: "success" | "timeout" | "failure",
  output: Record<string, unknown> = { result: "ok" },
  assembleSpy?: ReturnType<typeof vi.fn>,
): SwarmOpts {
  const assemblerFn = assembleSpy ?? vi.fn(async () => "mock-prompt");
  const processController: ProcessController = {
    async spawn(_o) {
      if (behavior === "success") return output;
      if (behavior === "timeout") throw new Error("spawn: timeout after 300s");
      throw new Error("spawn: process exited with code 1");
    },
  } as unknown as ProcessController;

  return {
    planner: {} as TaskPlanner,
    registry: {} as SubagentRegistry,
    assembler: { assemble: assemblerFn } as unknown as DynamicContextAssembler,
    processController,
    config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SidecarConfig,
    teamId: "team-test",
  };
}

const subtask: SubTask = {
  taskId: "st-1",
  description: "分析提交记录",
  agentRole: "代码分析师",
  dependencies: [],
};

const task: ComplexTask = {
  taskId: "task-001",
  description: "分析团队 Q1 效率",
  teamId: "team-test",
};

describe("runWorker()", () => {
  it("成功执行：透传 processController 返回值", async () => {
    const output = { summary: "共 47 个提交" };
    const opts = buildOpts("success", output);
    const result = await runWorker(subtask, task, opts);
    expect(result).toEqual(output);
  });

  it("超时失败：processController 抛出 timeout 错误，runWorker 向上传播", async () => {
    const opts = buildOpts("timeout");
    await expect(runWorker(subtask, task, opts)).rejects.toThrow("timeout");
  });

  it("进程失败：processController 抛出非超时错误，错误传播", async () => {
    const opts = buildOpts("failure");
    await expect(runWorker(subtask, task, opts)).rejects.toThrow("process exited");
  });

  it("assembler.assemble() 被调用，且参数包含 subtask.description 和 subtask.agentRole", async () => {
    const assembleSpy = vi.fn(async () => "mock-prompt");
    const opts = buildOpts("success", {}, assembleSpy);
    await runWorker(subtask, task, opts);
    expect(assembleSpy).toHaveBeenCalledOnce();
    const callArg = assembleSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg.taskDescription).toBe(subtask.description);
    expect(callArg.agentRole).toBe(subtask.agentRole);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/worker.test.ts`
Expected: FAIL — `../worker.js` does not exist

- [ ] **Step 3: Create worker.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/worker.ts`:

```typescript
import type { ComplexTask, SubTask } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";
import type { SwarmOpts } from "./types.js";

const logger = createLogger("swarm:worker");

/**
 * 执行单个 Swarm Worker
 *
 * 通过 DynamicContextAssembler 构建子任务的 Prompt，
 * 通过 ProcessController 启动 Claude Code 子进程，收集并返回输出。
 *
 * 该函数是 runSwarm 的内部执行单元，通常不直接调用，但作为命名导出以便测试。
 *
 * @param subtask - 当前执行的子任务
 * @param task - 父复杂任务（提供 teamId、taskId 等上下文）
 * @param opts - Swarm 运行选项（注入所有依赖）
 * @returns Worker 输出（key-value 结构，由 Claude Code 子进程返回）
 * @throws {Error} 子进程失败或超时时抛出
 *
 * @example
 * const output = await runWorker(
 *   { taskId: "st-1", description: "分析提交记录", agentRole: "代码分析师", dependencies: [] },
 *   { taskId: "task-001", description: "...", teamId: "team-abc" },
 *   opts,
 * );
 * console.log(output.summary); // "共 47 个提交……"
 */
export async function runWorker(
  subtask: SubTask,
  task: ComplexTask,
  opts: SwarmOpts,
): Promise<Record<string, unknown>> {
  logger.info({ taskId: subtask.taskId, role: subtask.agentRole }, "Worker 启动");

  const prompt = await opts.assembler.assemble({
    taskDescription: subtask.description,
    agentRole: subtask.agentRole,
    teamId: task.teamId,
    parentTaskId: task.taskId,
  });

  const result = await opts.processController.spawn({
    prompt,
    teamId: task.teamId,
    agentId: subtask.taskId,
    registry: opts.registry,
    timeoutMs: opts.config.workerTimeoutSeconds * 1000,
  });

  logger.info({ taskId: subtask.taskId }, "Worker 完成");
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/worker.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/worker.ts packages/swarm/src/__tests__/worker.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/src/worker.ts packages/swarm/src/__tests__/worker.test.ts && git commit -m "$(cat <<'EOF'
feat(swarm): add runWorker — single Worker execution unit (TDD)

TDD: 4 tests covering successful execution, timeout propagation,
process failure, and assembler call argument verification.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create swarm.ts (TDD)

**Files:**
- Create: `packages/swarm/src/swarm.ts`
- Create: `packages/swarm/src/__tests__/swarm.test.ts`

This is the core orchestration file. Uses topological sort (Kahn's BFS) internally.

- [ ] **Step 1: Create swarm test**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/__tests__/swarm.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { SubTask, ComplexTask, SidecarConfig } from "@teamsland/types";
import type { SubagentRegistry, ProcessController } from "@teamsland/sidecar";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { SwarmOpts } from "../types.js";
import { TaskPlanner } from "../task-planner.js";
import { runSwarm } from "../swarm.js";
import type { LlmClient, LlmResponse } from "../types.js";

/** 预编程 LLM 客户端，用于 TaskPlanner */
class FakeLlmClient implements LlmClient {
  private responses: LlmResponse[];
  private index = 0;
  constructor(responses: LlmResponse[]) { this.responses = responses; }
  async chat(_m: unknown[]): Promise<LlmResponse> {
    const r = this.responses[this.index++];
    if (!r) throw new Error("FakeLlmClient exhausted");
    return r;
  }
}

/** 构建测试用 SwarmOpts */
function buildOpts(
  subtasks: SubTask[],
  workerBehavior: "success" | "timeout" | "failure" | ((taskId: string) => "success" | "timeout" | "failure") = "success",
  minRatio = 0.5,
): SwarmOpts {
  const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
  const planner = new TaskPlanner({ llm });

  const processController: ProcessController = {
    async spawn(o) {
      const behavior = typeof workerBehavior === "function" ? workerBehavior(o.agentId as string) : workerBehavior;
      if (behavior === "success") return { result: "ok", taskId: o.agentId };
      if (behavior === "timeout") throw new Error("spawn: timeout after 300s");
      throw new Error("spawn: process exited with code 1");
    },
  } as unknown as ProcessController;

  return {
    planner,
    registry: {} as SubagentRegistry,
    assembler: { assemble: async () => "mock-prompt" } as unknown as DynamicContextAssembler,
    processController,
    config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: minRatio } as SidecarConfig,
    teamId: "team-test",
  };
}

const baseTask: ComplexTask = {
  taskId: "task-001",
  description: "分析团队 Q1 效率",
  teamId: "team-test",
};

describe("runSwarm()", () => {
  it("全部成功：3 个无依赖 SubTask 全部 fulfilled，success: true，failedTaskIds: []", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r1", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r2", dependencies: [] },
      { taskId: "st-3", description: "C", agentRole: "r3", dependencies: [] },
    ];
    const result = await runSwarm(baseTask, buildOpts(subtasks, "success"));
    expect(result.success).toBe(true);
    expect(result.failedTaskIds).toEqual([]);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.status === "fulfilled")).toBe(true);
  });

  it("部分失败（quorum 通过）：5 个 SubTask 中 3 个 fulfilled（ratio=0.6>=0.5），success: true", async () => {
    const subtasks: SubTask[] = Array.from({ length: 5 }, (_, i) => ({
      taskId: `st-${i + 1}`,
      description: `task ${i}`,
      agentRole: "r",
      dependencies: [],
    }));
    // st-1, st-2 fail; st-3, st-4, st-5 succeed
    const behavior = (taskId: string) =>
      taskId === "st-1" || taskId === "st-2" ? "failure" as const : "success" as const;
    const result = await runSwarm(baseTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.success).toBe(true);
    expect(result.failedTaskIds).toHaveLength(2);
  });

  it("部分失败（quorum 不通过）：5 个 SubTask 中 1 个 fulfilled（ratio=0.2<0.5），success: false", async () => {
    const subtasks: SubTask[] = Array.from({ length: 5 }, (_, i) => ({
      taskId: `st-${i + 1}`,
      description: `task ${i}`,
      agentRole: "r",
      dependencies: [],
    }));
    // only st-1 succeeds
    const behavior = (taskId: string) => taskId === "st-1" ? "success" as const : "failure" as const;
    const result = await runSwarm(baseTask, buildOpts(subtasks, behavior, 0.5));
    expect(result.success).toBe(false);
    expect(result.failedTaskIds).toHaveLength(4);
  });

  it("超时处理：Worker 超时被记为 rejected，不阻断同层其他 Worker", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r", dependencies: [] },
    ];
    const behavior = (taskId: string) => taskId === "st-1" ? "timeout" as const : "success" as const;
    const result = await runSwarm(baseTask, buildOpts(subtasks, behavior, 0.5));
    // st-2 still runs despite st-1 timeout
    expect(result.results.find((r) => r.taskId === "st-2")?.status).toBe("fulfilled");
    expect(result.results.find((r) => r.taskId === "st-1")?.status).toBe("rejected");
  });

  it("空子任务：planner 返回 []，success: true，results: []", async () => {
    const opts = buildOpts([]);
    const result = await runSwarm(baseTask, opts);
    expect(result.success).toBe(true);
    expect(result.results).toEqual([]);
    expect(result.failedTaskIds).toEqual([]);
  });

  it("有依赖的 DAG：A→B→C（C 依赖 B，B 依赖 A），按层执行（先 A，再 B，再 C）", async () => {
    const executionOrder: string[] = [];
    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: ["st-a"] },
      { taskId: "st-c", description: "C", agentRole: "r", dependencies: ["st-b"] },
    ];
    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });
    const processController: ProcessController = {
      async spawn(o) {
        executionOrder.push(o.agentId as string);
        return {};
      },
    } as unknown as ProcessController;
    const opts: SwarmOpts = {
      planner,
      registry: {} as SubagentRegistry,
      assembler: { assemble: async () => "p" } as unknown as DynamicContextAssembler,
      processController,
      config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SidecarConfig,
      teamId: "team-test",
    };
    await runSwarm(baseTask, opts);
    expect(executionOrder).toEqual(["st-a", "st-b", "st-c"]);
  });

  it("循环依赖：A.dependencies=[B]，B.dependencies=[A]，runSwarm 抛出循环依赖错误", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: ["st-b"] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: ["st-a"] },
    ];
    const opts = buildOpts(subtasks);
    await expect(runSwarm(baseTask, opts)).rejects.toThrow("循环依赖");
  });

  it("minSwarmSuccessRatio 边界：恰好 50% 成功（ratio=0.5=minSwarmSuccessRatio），success: true", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-2", description: "B", agentRole: "r", dependencies: [] },
    ];
    const behavior = (taskId: string) => taskId === "st-1" ? "success" as const : "failure" as const;
    const result = await runSwarm(baseTask, buildOpts(subtasks, behavior, 0.5));
    // 1/2 = 0.5 >= 0.5
    expect(result.success).toBe(true);
  });
});

describe("topoSort edge cases (via runSwarm)", () => {
  it("钻石形依赖：A、B 无依赖；C 依赖 A 和 B — 分为 [A,B] 和 [C] 两层", async () => {
    const executionBatches: string[][] = [];
    let currentBatch: string[] = [];
    let activeBatchSize = 0;

    const subtasks: SubTask[] = [
      { taskId: "st-a", description: "A", agentRole: "r", dependencies: [] },
      { taskId: "st-b", description: "B", agentRole: "r", dependencies: [] },
      { taskId: "st-c", description: "C", agentRole: "r", dependencies: ["st-a", "st-b"] },
    ];

    const llm = new FakeLlmClient([{ content: JSON.stringify(subtasks) }]);
    const planner = new TaskPlanner({ llm });

    // Track which tasks ran concurrently by watching Promise resolution order
    // A simpler check: st-c must run AFTER both st-a and st-b
    const completedBefore = new Set<string>();
    const processController: ProcessController = {
      async spawn(o) {
        const taskId = o.agentId as string;
        if (taskId === "st-c") {
          expect(completedBefore.has("st-a")).toBe(true);
          expect(completedBefore.has("st-b")).toBe(true);
        }
        completedBefore.add(taskId);
        return {};
      },
    } as unknown as ProcessController;

    const opts: SwarmOpts = {
      planner,
      registry: {} as SubagentRegistry,
      assembler: { assemble: async () => "p" } as unknown as DynamicContextAssembler,
      processController,
      config: { workerTimeoutSeconds: 300, minSwarmSuccessRatio: 0.5 } as SidecarConfig,
      teamId: "team-test",
    };
    const result = await runSwarm(baseTask, opts);
    expect(result.success).toBe(true);
  });

  it("未知依赖 ID：引用不存在的 taskId，runSwarm 抛出错误", async () => {
    const subtasks: SubTask[] = [
      { taskId: "st-1", description: "A", agentRole: "r", dependencies: ["non-existent"] },
    ];
    const opts = buildOpts(subtasks);
    await expect(runSwarm(baseTask, opts)).rejects.toThrow("未知依赖");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/swarm.test.ts`
Expected: FAIL — `../swarm.js` does not exist

- [ ] **Step 3: Create swarm.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/swarm/src/swarm.ts`:

```typescript
import type { ComplexTask, SwarmResult, WorkerResult, SubTask } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";
import type { SwarmOpts } from "./types.js";
import { runWorker } from "./worker.js";

const logger = createLogger("swarm:orchestrator");

/**
 * 执行 Swarm 任务编排
 *
 * 完整流程：
 * 1. `planner.decompose(task)` → SubTask[]
 * 2. 拓扑排序，将 SubTask 按依赖分层（每层内可完全并行）
 * 3. 逐层以 `Promise.allSettled` + `workerTimeoutSeconds` 执行 Worker
 * 4. 收集所有层的输出与失败信息
 * 5. 法定人数检查：`fulfilled / total >= minSwarmSuccessRatio`
 * 6. 返回 SwarmResult
 *
 * @param task - 待执行的复杂任务
 * @param opts - Swarm 运行选项（注入所有依赖）
 * @returns Swarm 整体执行结果
 * @throws {Error} 拓扑排序检测到循环依赖时抛出；法定人数不足时以 success: false 返回（不抛出）
 *
 * @example
 * const result = await runSwarm(
 *   { taskId: "task-001", description: "分析团队 Q1 效率", teamId: "team-abc" },
 *   { planner, registry, assembler, processController, config, teamId: "team-abc" },
 * );
 * if (!result.success) {
 *   console.error("Swarm 未通过法定人数", result.failedTaskIds);
 * }
 */
export async function runSwarm(task: ComplexTask, opts: SwarmOpts): Promise<SwarmResult> {
  logger.info({ taskId: task.taskId }, "Swarm 启动");

  // Step 1: 任务拆解
  const subtasks = await opts.planner.decompose(task);

  if (subtasks.length === 0) {
    logger.warn({ taskId: task.taskId }, "Swarm 收到空子任务列表，直接返回成功");
    return { success: true, results: [], failedTaskIds: [] };
  }

  // Step 2: 拓扑排序分层
  const tiers = topoSort(subtasks);
  logger.info({ taskId: task.taskId, tiers: tiers.length, total: subtasks.length }, "拓扑排序完成");

  const allResults: WorkerResult[] = [];

  // Step 3 & 4: 逐层并行执行
  for (const tier of tiers) {
    const tierResults = await Promise.allSettled(
      tier.map((subtask) => runWorker(subtask, task, opts)),
    );

    for (let i = 0; i < tier.length; i++) {
      const subtask = tier[i];
      const settled = tierResults[i];
      if (settled.status === "fulfilled") {
        allResults.push({ taskId: subtask.taskId, status: "fulfilled", output: settled.value });
      } else {
        const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        allResults.push({ taskId: subtask.taskId, status: "rejected", error: reason });
        logger.warn({ taskId: subtask.taskId, error: reason }, "Worker 失败");
      }
    }
  }

  // Step 5: 法定人数检查
  const fulfilled = allResults.filter((r) => r.status === "fulfilled").length;
  const total = allResults.length;
  const ratio = total === 0 ? 1 : fulfilled / total;
  const success = ratio >= opts.config.minSwarmSuccessRatio;

  const failedTaskIds = allResults.filter((r) => r.status === "rejected").map((r) => r.taskId);

  logger.info(
    { taskId: task.taskId, fulfilled, total, ratio, success },
    success ? "Swarm 通过法定人数" : "Swarm 未通过法定人数",
  );

  return { success, results: allResults, failedTaskIds };
}

/**
 * 将 SubTask 列表按依赖关系拓扑排序分层
 *
 * 内部辅助函数，不导出。
 * 同一层内的 SubTask 之间无依赖，可完全并行。
 * 使用标准 Kahn 算法（BFS 变体）。
 *
 * @param subtasks - 子任务列表（包含 dependencies 字段）
 * @returns 分层后的二维数组，每层是一个 SubTask[]
 * @throws {Error} 检测到循环依赖或引用未知 taskId 时抛出
 */
function topoSort(subtasks: SubTask[]): SubTask[][] {
  const idToTask = new Map<string, SubTask>(subtasks.map((s) => [s.taskId, s]));
  const inDegree = new Map<string, number>(subtasks.map((s) => [s.taskId, 0]));

  for (const subtask of subtasks) {
    for (const dep of subtask.dependencies) {
      if (!idToTask.has(dep)) {
        throw new Error(`topoSort: 未知依赖 ${dep}（来自 subtask ${subtask.taskId}）`);
      }
      inDegree.set(subtask.taskId, (inDegree.get(subtask.taskId) ?? 0) + 1);
    }
  }

  const tiers: SubTask[][] = [];
  let remaining = new Set(subtasks.map((s) => s.taskId));

  while (remaining.size > 0) {
    const tier = [...remaining]
      .filter((id) => (inDegree.get(id) ?? 0) === 0)
      .map((id) => idToTask.get(id) as SubTask);

    if (tier.length === 0) {
      throw new Error("topoSort: 检测到循环依赖，无法完成拓扑排序");
    }

    tiers.push(tier);

    for (const subtask of tier) {
      remaining.delete(subtask.taskId);
    }

    // 减少被完成任务所解锁的后继任务的入度
    for (const subtask of tier) {
      for (const candidate of remaining) {
        const candidateTask = idToTask.get(candidate) as SubTask;
        if (candidateTask.dependencies.includes(subtask.taskId)) {
          inDegree.set(candidate, (inDegree.get(candidate) ?? 1) - 1);
        }
      }
    }
  }

  return tiers;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/src/__tests__/swarm.test.ts`
Expected: All 10 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/swarm.ts packages/swarm/src/__tests__/swarm.test.ts`
Expected: No errors. If `topoSort` cognitive complexity exceeds 15, extract `buildInDegreeMap()` and `drainTier()` as sub-functions.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/src/swarm.ts packages/swarm/src/__tests__/swarm.test.ts && git commit -m "$(cat <<'EOF'
feat(swarm): add runSwarm — Kahn topo-sort + Promise.allSettled orchestration (TDD)

TDD: 10 tests covering full success, partial failure (quorum pass/fail),
timeout handling, empty subtasks, linear DAG ordering, diamond deps,
circular dependency detection, unknown dep ID, and quorum boundary.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Update barrel exports in index.ts

**Files:**
- Modify: `packages/swarm/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/swarm/src/index.ts`:

```typescript
// @teamsland/swarm — TaskPlanner, runSwarm, runWorker
// 任务拆解与并行 Worker 编排：LLM 分解复杂任务为 SubTask DAG，按依赖层级并行执行

export { TaskPlanner } from "./task-planner.js";
export { runSwarm } from "./swarm.js";
export { runWorker } from "./worker.js";
export type { LlmClient, LlmResponse, SwarmOpts } from "./types.js";
```

Note: `SubTask` is exported from `@teamsland/types` for platform-wide use. `LlmClient` and `LlmResponse` are re-exported here as package-internal interfaces for callers who need to implement them (e.g. to build a real `LlmClient` wrapper).

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/index.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/swarm/src/index.ts && git commit -m "$(cat <<'EOF'
feat(swarm): add barrel exports — TaskPlanner, runSwarm, runWorker, SwarmOpts

Public API surface: 3 functions/classes + 3 interface types.
LlmClient and LlmResponse re-exported for callers implementing adapters.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full Verification

- [ ] **Step 1: Run all swarm tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/swarm/`
Expected: All tests pass (task-planner: 7 tests, worker: 4 tests, swarm: 10 tests = 21 total)

- [ ] **Step 2: Run typecheck for swarm package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/swarm/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run typecheck for types package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/types/tsconfig.json`
Expected: No errors

- [ ] **Step 4: Run lint on entire swarm package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/swarm/src/`
Expected: No errors

- [ ] **Step 5: Verify exported API surface**

Run:
```bash
cd /Users/bytedance/workspace/teamsland && bun -e "
import {
  TaskPlanner,
  runSwarm,
  runWorker,
} from './packages/swarm/src/index.ts';
console.log('TaskPlanner:', typeof TaskPlanner);
console.log('runSwarm:', typeof runSwarm);
console.log('runWorker:', typeof runWorker);
"
```
Expected:
```
TaskPlanner: function
runSwarm: function
runWorker: function
```

- [ ] **Step 6: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/swarm/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/swarm/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No non-null assertions

- [ ] **Step 7: Verify file count**

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/swarm/src/*.ts | wc -l`
Expected: 5 (types, task-planner, worker, swarm, index)

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/swarm/src/__tests__/*.test.ts | wc -l`
Expected: 3 test files

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/swarm/` — all 21 tests pass (7 + 4 + 10)
2. `bunx tsc --noEmit --project packages/swarm/tsconfig.json` — exits 0
3. `bunx tsc --noEmit --project packages/types/tsconfig.json` — exits 0
4. `bunx biome check packages/swarm/src/` — no errors
5. All exported functions/classes have Chinese JSDoc with `@example`
6. No `any`, no `!` non-null assertions in source files
7. All 3 value exports from barrel: `TaskPlanner`, `runSwarm`, `runWorker`
8. `@teamsland/types` extended with `SubTask`, `WorkerResult`, `SwarmResult` in `swarm.ts`
9. `packages/swarm/package.json` includes `@teamsland/observability` workspace dep
10. All logger channels use `createLogger`: `"swarm:planner"`, `"swarm:worker"`, `"swarm:orchestrator"`
11. `topoSort` is internal (not exported) and handles: empty tiers → circular dependency error, unknown dep ID → error
12. `runSwarm` returns `success: true, results: [], failedTaskIds: []` for empty subtask list
13. `runSwarm` returns `success: false` (does NOT throw) when quorum fails
14. FakeLlmClient and MockProcessController used throughout tests — no real processes or LLM calls
