# @teamsland/swarm Design Spec

> **TL;DR**: 任务拆解与并行 Worker 编排层 — LLM 将复杂任务分解为 SubTask DAG，按依赖层级并行调度 Claude Code Worker，收集输出并通过法定人数检查（quorum check）决定整体成败。3 个核心导出（TaskPlanner、runSwarm、runWorker），6 个源文件，全接口注入，完全可测。

---

## 目录

- [概述](#概述)
- [依赖关系](#依赖关系)
- [文件结构](#文件结构)
- [配置说明](#配置说明)
- [类型扩展（@teamsland/types）](#类型扩展teamslantypes)
- [本地接口：LlmClient](#本地接口llmclient)
- [本地类型：SubTask / SwarmOpts](#本地类型subtask--swarmopts)
- [TaskPlanner](#taskplanner)
- [runWorker](#runworker)
- [runSwarm](#runswarm)
- [Barrel Exports](#barrel-exports)
- [测试策略](#测试策略)
- [约束与限制](#约束与限制)

---

## 概述

`@teamsland/swarm` 是团队 AI 协作平台的任务并行执行引擎。它解决的问题是：当一个复杂任务无法由单一 Agent 完成时，如何自动拆解为可并行的子任务，并以最大并发度执行，同时保证整体结果的可靠性。

**核心能力：**
- `TaskPlanner`：将 `ComplexTask` 委托给 LLM 拆解为 `SubTask[]`，每个 SubTask 携带依赖列表，形成有向无环图（DAG）
- 拓扑排序：按依赖关系将 SubTask 分层（tier），同一层内无依赖关系，可完全并行
- 并行调度：每层使用 `Promise.allSettled` + `workerTimeoutSeconds` 超时执行所有 Worker
- 法定人数检查：`fulfilled / total >= minSwarmSuccessRatio` 才视为 Swarm 成功
- `runWorker`：单个 Worker 执行单元，通过 `DynamicContextAssembler` 构建 Prompt，通过 `ProcessController` 启动 Claude Code 子进程

**设计原则：**
- 所有外部依赖（planner、registry、assembler、processController）通过参数注入，无全局状态
- LlmClient 作为本地接口定义在 `types.ts`，与 `@teamsland/memory` 的同名接口独立，便于测试
- Worker 之间不共享内存，通过 SubTask 的 `dependencies` 字段隐式传递上下文

---

## 依赖关系

```
@teamsland/types         — ComplexTask, SwarmResult, SidecarConfig, TaskConfig
@teamsland/sidecar       — SubagentRegistry, ProcessController
@teamsland/context       — DynamicContextAssembler
@teamsland/observability — createLogger
```

**package.json 依赖：**
- `@teamsland/types`: workspace 依赖（类型）
- `@teamsland/sidecar`: workspace 依赖（进程控制、注册表）
- `@teamsland/context`: workspace 依赖（动态上下文组装）
- `@teamsland/observability`: workspace 依赖（结构化日志）

---

## 文件结构

```
packages/swarm/src/
├── types.ts              # SubTask、SwarmOpts、本地 LlmClient 接口
├── task-planner.ts       # TaskPlanner — LLM 任务拆解
├── worker.ts             # runWorker — 单个 Worker 执行
├── swarm.ts              # runSwarm — 编排 + 拓扑排序
├── index.ts              # Barrel re-exports
└── __tests__/
    ├── task-planner.test.ts
    ├── worker.test.ts
    └── swarm.test.ts
```

---

## 配置说明

`@teamsland/swarm` 直接从 `SidecarConfig`（`@teamsland/types`）读取以下字段，通过 `SwarmOpts.config` 注入，无需独立配置节。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sidecar.workerTimeoutSeconds` | `number` | `300` | 单个 Worker 最大执行时间（秒），超时后视为失败 |
| `sidecar.minSwarmSuccessRatio` | `number` | `0.5` | Swarm 法定人数阈值，`fulfilled / total` 低于此值时整体失败 |

`config/config.json` 中对应片段示例：

```json
{
  "sidecar": {
    "workerTimeoutSeconds": 300,
    "minSwarmSuccessRatio": 0.5
  }
}
```

---

## 类型扩展（@teamsland/types）

需要在 `packages/types/src/swarm.ts` 中新增以下类型，并在 `packages/types/src/index.ts` 中重新导出。

```typescript
// packages/types/src/swarm.ts

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

同时需要确认 `ComplexTask`（`@teamsland/types`）已包含以下字段，供 `TaskPlanner` 和 `runWorker` 读取：

```typescript
// packages/types/src/task.ts — ComplexTask（已有，仅列出 swarm 涉及的字段）

export interface ComplexTask {
  /** 任务唯一标识符 */
  taskId: string;
  /** 任务完整描述 */
  description: string;
  /** 团队 ID */
  teamId: string;
  /** 任务配置（超时、重试等） */
  config?: TaskConfig;
}
```

---

## 本地接口：LlmClient

`LlmClient` 在 `packages/swarm/src/types.ts` 中作为本地接口定义，不从 `@teamsland/memory` 导入，以避免跨包循环依赖。

```typescript
// packages/swarm/src/types.ts（LlmClient 部分）

/**
 * LLM 调用结果
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
```

---

## 本地类型：SubTask / SwarmOpts

```typescript
// packages/swarm/src/types.ts（SwarmOpts 部分）

import type { SidecarConfig } from "@teamsland/types";
import type { SubagentRegistry, ProcessController } from "@teamsland/sidecar";
import type { DynamicContextAssembler } from "@teamsland/context";
import type { TaskPlanner } from "./task-planner.js";

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

---

## TaskPlanner

```typescript
// packages/swarm/src/task-planner.ts

import type { ComplexTask } from "@teamsland/types";
import type { LlmClient } from "./types.js";
import type { SubTask } from "@teamsland/types";
import { createLogger } from "@teamsland/observability";

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
  private readonly logger = createLogger("swarm:planner");

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
    this.logger.info({ taskId: task.taskId }, "开始任务拆解");

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
    this.logger.info({ taskId: task.taskId, count: subtasks.length }, "任务拆解完成");
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

**关键行为：**
- `decompose()` 完全由 LLM 驱动，不对 SubTask 数量做任何假设
- 若 LLM 返回空数组 `[]`，`decompose()` 正常返回，`runSwarm` 将跳过执行并返回空结果
- 若 JSON 解析失败，抛出带有 raw 内容前 200 字符的错误，方便调试
- logger channel: `"swarm:planner"`

---

## runWorker

```typescript
// packages/swarm/src/worker.ts

import type { ComplexTask, SubTask } from "@teamsland/types";
import type { SwarmOpts } from "./types.js";
import { createLogger } from "@teamsland/observability";

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

**关键行为：**
- `opts.assembler.assemble()` 负责将 `subtask.description`、`subtask.agentRole`、`task.teamId` 组装成完整 Claude Code Prompt
- `opts.processController.spawn()` 内部使用 `Bun.spawn` 启动 Claude CLI，通过 `timeoutMs` 控制超时
- 超时时 `spawn()` 应抛出包含 `"timeout"` 关键字的错误（约定，由 `@teamsland/sidecar` 定义）
- `runWorker` 不捕获错误，让 `runSwarm` 的 `Promise.allSettled` 统一处理
- logger channel: `"swarm:worker"`

---

## runSwarm

```typescript
// packages/swarm/src/swarm.ts

import type { ComplexTask, SwarmResult, WorkerResult } from "@teamsland/types";
import type { SubTask } from "@teamsland/types";
import type { SwarmOpts } from "./types.js";
import { runWorker } from "./worker.js";
import { createLogger } from "@teamsland/observability";

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
 *
 * @param subtasks - 子任务列表（包含 dependencies 字段）
 * @returns 分层后的二维数组，每层是一个 SubTask[]
 * @throws {Error} 检测到循环依赖时抛出
 */
function topoSort(subtasks: SubTask[]): SubTask[][] {
  const idToTask = new Map<string, SubTask>(subtasks.map((s) => [s.taskId, s]));
  const inDegree = new Map<string, number>(subtasks.map((s) => [s.taskId, 0]));

  for (const subtask of subtasks) {
    for (const dep of subtask.dependencies) {
      inDegree.set(subtask.taskId, (inDegree.get(subtask.taskId) ?? 0) + 1);
      if (!idToTask.has(dep)) {
        throw new Error(`topoSort: 未知依赖 ${dep}（来自 subtask ${subtask.taskId}）`);
      }
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

**关键行为：**

| 场景 | 处理方式 |
|------|----------|
| 空子任务列表 | 直接返回 `{ success: true, results: [], failedTaskIds: [] }` |
| Worker 超时 | `Promise.allSettled` 捕获 rejected，记为失败，继续后续层 |
| Worker 失败 | 同上；不中断同层其他 Worker |
| 循环依赖 | `topoSort` 抛出 `Error`，`runSwarm` 向上传播 |
| 未知依赖 ID | `topoSort` 抛出 `Error` |
| 法定人数不足 | 返回 `success: false`，不抛出，由调用方决策 |

**拓扑排序算法说明：**
- 标准 Kahn 算法（BFS 变体），逐层剥离入度为 0 的节点
- 时间复杂度 O(V + E)，V = 子任务数，E = 依赖边数
- 循环检测：若某一轮 `tier` 为空但 `remaining` 非空，则存在环

---

## Barrel Exports

```typescript
// packages/swarm/src/index.ts

// @teamsland/swarm — TaskPlanner, runSwarm, runWorker
// 任务拆解与并行 Worker 编排：LLM 分解复杂任务为 SubTask DAG，按依赖层级并行执行

export { TaskPlanner } from "./task-planner.js";
export { runSwarm } from "./swarm.js";
export { runWorker } from "./worker.js";
export type { SubTask, SwarmOpts } from "./types.js";
```

注意：`SubTask` 同时在 `@teamsland/types` 导出（供全平台使用），此处重新导出 `types.ts` 中的 `SwarmOpts`（Swarm 内部选项，不进入 `@teamsland/types`）。`LlmClient`、`LlmResponse` 属于包内部接口，不对外导出。

---

## 测试策略

### 测试工具

**FakeLlmClient** — 返回预编程的 `LlmResponse` 序列：

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

**MockProcessController** — 模拟 Claude Code 子进程行为：

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

### task-planner.test.ts

| 测试用例 | 描述 |
|----------|------|
| 正常拆解 | FakeLlmClient 返回合法 JSON，验证 `decompose()` 返回正确 SubTask[] |
| 无依赖任务 | 所有 SubTask.dependencies 为空数组，验证返回结构 |
| 有依赖任务 | SubTask A 依赖 SubTask B，验证 dependencies 字段 |
| 空任务列表 | LLM 返回 `[]`，验证 `decompose()` 返回空数组（不抛出） |
| 非法 JSON | LLM 返回 `"not json"`，验证抛出含 raw 内容的 Error |
| 非数组 JSON | LLM 返回 `{}`，验证抛出 "不是数组" 错误 |
| 结构不完整 | SubTask 缺少 agentRole 字段，验证抛出结构错误 |

### worker.test.ts

| 测试用例 | 描述 |
|----------|------|
| 成功执行 | MockProcessController 返回 output，验证 `runWorker()` 透传返回值 |
| 超时失败 | MockProcessController 抛出 timeout 错误，验证 `runWorker()` 向上传播 |
| 进程失败 | MockProcessController 抛出非超时错误，验证错误传播 |
| assembler 调用 | 验证 `opts.assembler.assemble()` 被调用，且参数包含 `subtask.description`、`subtask.agentRole` |

### swarm.test.ts

| 测试用例 | 描述 |
|----------|------|
| 全部成功 | 3 个无依赖 SubTask 全部 fulfilled，验证 `success: true`，`failedTaskIds: []` |
| 部分失败（quorum 通过） | 5 个 SubTask 中 3 个 fulfilled（ratio=0.6 >= 0.5），验证 `success: true` |
| 部分失败（quorum 不通过） | 5 个 SubTask 中 1 个 fulfilled（ratio=0.2 < 0.5），验证 `success: false` |
| 超时处理 | Worker 超时被记为 rejected，不阻断同层其他 Worker |
| 空子任务 | planner 返回 `[]`，验证 `success: true, results: []` |
| 有依赖的 DAG | SubTask A → SubTask B → SubTask C，验证按层顺序执行（B 先于 A，C 先于 B） |
| 循环依赖 | SubTask A.dependencies = ["B"]，SubTask B.dependencies = ["A"]，验证 `runSwarm` 抛出循环依赖错误 |
| minSwarmSuccessRatio 边界 | 恰好 50% 成功（ratio = 0.5 = minSwarmSuccessRatio），验证 `success: true` |

**拓扑排序单元测试（可内嵌于 swarm.test.ts）：**

| 测试用例 | 描述 |
|----------|------|
| 无依赖列表 | 所有节点在第一层 |
| 线性链 | A→B→C 分为三层 |
| 钻石形 | A、B 无依赖；C 依赖 A、B；分为 [A,B]、[C] 两层 |
| 循环检测 | A↔B 循环，抛出错误 |
| 未知依赖 ID | 引用不存在的 taskId，抛出错误 |

### 运行命令

```bash
# 单包运行
bunx --bun vitest run packages/swarm/

# 整体 CI
bun run test:run
```

---

## 约束与限制

1. **LlmClient 接口本地定义** — `@teamsland/swarm` 的 `LlmClient` 与 `@teamsland/memory` 的同名接口互相独立。两者均只需 `chat()` 方法，但参数签名略有不同（swarm 版本无 tools 参数）。调用方注入时需注意适配。

2. **拓扑排序后每层的 Worker 数量** — Swarm 对并发数不设上限，单层内所有 SubTask 全部并发执行。若 LLM 拆解出大量无依赖子任务（如 20+），可能同时启动大量 Claude Code 进程，消耗系统资源。调用方可在 `SwarmOpts` 层面增加并发限制（当前版本不内置）。

3. **Worker 间不共享上下文** — 当前版本的 `runWorker` 不将前驱 Worker 的输出传递给后继 Worker。依赖关系仅用于调度顺序，不用于数据流。如需数据流传递，需在 `assembler.assemble()` 的实现中从 `SessionDB` 或外部存储读取前驱输出。

4. **minSwarmSuccessRatio 语义** — `fulfilled / total >= minSwarmSuccessRatio`，其中 `total` 是所有子任务数量（不是层数）。当 `total = 0`（空子任务）时 ratio 视为 1（100%），始终通过。

5. **超时粒度为 Worker 级** — `workerTimeoutSeconds` 控制单个 Worker 的最大执行时间，不控制整体 Swarm 超时。极端情况下，若所有 Worker 均超时，Swarm 总耗时可达 `tiers.length * workerTimeoutSeconds`（最坏情况为全串行 DAG）。

6. **循环依赖抛出而非降级** — `topoSort` 检测到循环依赖时抛出 Error（而非跳过或降级），这是设计决策。循环依赖意味着 LLM 拆解有误，应由调用方记录错误并考虑重试 `decompose()`。

7. **Biome 格式约束** — 行宽 120，2-space 缩进，`import type` 用于所有类型导入，禁止 `any` 和 `!` 非空断言。`topoSort` 的认知复杂度应低于 15，如超出需拆分为子函数。
