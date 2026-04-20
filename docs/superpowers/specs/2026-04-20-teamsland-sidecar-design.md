# @teamsland/sidecar Design Spec

> **TL;DR**: Claude Code 子进程管理层 — `Bun.spawn` 进程控制 + SubagentRegistry 崩溃恢复 + NDJSON 流解析 + ObservableMessageBus 追踪注入 + Alerter 冷却告警。5 个核心类，无全局状态，全接口注入，完全可测。

---

## 目录

- [概述](#概述)
- [依赖关系](#依赖关系)
- [文件结构](#文件结构)
- [类型依赖（@teamsland/types）](#类型依赖teamslantypes)
- [配置说明（SidecarConfig）](#配置说明sidecarconfig)
- [ProcessController](#processcontroller)
- [SubagentRegistry](#subagentregistry)
- [SidecarDataPlane](#sidecardataplane)
- [ObservableMessageBus](#observablemessagebus)
- [Alerter](#alerter)
- [Barrel Exports](#barrel-exports)
- [测试策略](#测试策略)
- [约束与限制](#约束与限制)

---

## 概述

`@teamsland/sidecar` 是 Claude Code 子进程的完整生命周期管理器。它负责：

- **进程控制**：通过 `Bun.spawn` 启动 Claude CLI，写入 JSON 信封，接收 NDJSON stdout 流
- **注册表管理**：在内存和磁盘双重维护 Agent 注册表，支持崩溃后恢复
- **数据平面**：解析 NDJSON 事件流，按类型路由，拦截 Worker 不应执行的工具调用
- **消息总线**：透明代理 Agent 间消息，自动注入 traceId，结构化记录
- **告警**：指标超阈值时向飞书发送卡片，带 5 分钟每指标冷却窗口

**核心设计原则：**
- 所有依赖通过构造函数注入（logger、registry、notifier、sessionDb）
- 无全局单例 — 调用方负责实例生命周期
- 崩溃恢复通过 `restoreOnStartup()` 实现，清理死进程，重建存活 Agent 状态
- Worker 工具拦截（`delegate`、`spawn_agent`、`memory_write`）在数据平面层执行，不依赖 Claude CLI 配置

---

## 依赖关系

```
@teamsland/types         — TaskConfig, TeamMessage, AgentRecord, AgentStatus,
                           RegistryState, SidecarConfig
@teamsland/lark          — LarkNotifier（容量告警、失败 DM）
@teamsland/session       — SessionDB（消息持久化）
@teamsland/observability — createLogger
@teamsland/memory        — (可选，用于失败场景写入 — 可延后实现)
```

**package.json 依赖：**
- `@teamsland/types`: workspace 依赖（类型）
- `@teamsland/lark`: workspace 依赖（通知）
- `@teamsland/session`: workspace 依赖（消息持久化）
- `@teamsland/observability`: workspace 依赖（日志）

---

## 文件结构

```
packages/sidecar/src/
├── process-controller.ts  # ProcessController — Bun.spawn Claude Code 子进程
├── registry.ts            # SubagentRegistry — Agent 生命周期 + 磁盘持久化
├── data-plane.ts          # SidecarDataPlane — NDJSON 流解析 + 事件路由
├── message-bus.ts         # ObservableMessageBus — traceId 注入 + 结构化日志
├── alerter.ts             # Alerter — 冷却窗口控制的飞书告警
├── index.ts               # Barrel re-exports
└── __tests__/
    ├── process-controller.test.ts
    ├── registry.test.ts
    ├── data-plane.test.ts
    ├── message-bus.test.ts
    └── alerter.test.ts
```

---

## 类型依赖（@teamsland/types）

以下类型已在 `@teamsland/types` 中定义，`@teamsland/sidecar` 直接使用，无需扩展：

```typescript
// packages/types/src/sidecar.ts — 已有

export type AgentStatus = "running" | "completed" | "failed";

export interface AgentRecord {
  agentId: string;
  pid: number;
  sessionId: string;
  issueId: string;
  worktreePath: string;
  status: AgentStatus;
  retryCount: number;
  createdAt: number;
}

export interface RegistryState {
  agents: AgentRecord[];
  updatedAt: number;
}

// packages/types/src/config.ts — 已有

export interface SidecarConfig {
  maxConcurrentSessions: number;
  maxRetryCount: number;
  maxDelegateDepth: number;
  workerTimeoutSeconds: number;
  healthCheckTimeoutMs: number;
  minSwarmSuccessRatio: number;
}

// packages/types/src/message.ts — 已有

export interface TeamMessage {
  traceId: string;
  fromAgent: string;
  toAgent: string;
  type: TeamMessageType;
  payload: unknown;
  timestamp: number;
}
```

`SpawnResult` 和 `CapacityError` 是 `@teamsland/sidecar` 内部定义，通过 barrel 导出。

---

## 配置说明（SidecarConfig）

从 `config/config.json` 的 `sidecar` 段读取：

```json
{
  "sidecar": {
    "maxConcurrentSessions": 20,
    "maxRetryCount": 3,
    "maxDelegateDepth": 2,
    "workerTimeoutSeconds": 300,
    "healthCheckTimeoutMs": 30000,
    "minSwarmSuccessRatio": 0.5
  },
  "lark": {
    "notification": {
      "teamChannelId": "oc_xxxx"
    }
  }
}
```

`Alerter` 使用 `lark.notification.teamChannelId` 作为告警目标频道。

---

## ProcessController

```typescript
// packages/sidecar/src/process-controller.ts

import type { Logger } from "@teamsland/observability";

/**
 * 子进程启动参数
 *
 * @example
 * ```typescript
 * import type { SpawnParams } from "./process-controller.js";
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
  constructor(opts: { logger: Logger })

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
  spawn(params: SpawnParams): Promise<SpawnResult>

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
  interrupt(pid: number, hard?: boolean): void

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
  isAlive(pid: number): boolean
}
```

**spawn 内部实现细节：**

```typescript
// 启动命令
const proc = Bun.spawn(
  [
    "claude", "-p",
    "--output-format", "stream-json",
    "--input-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
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

// tee stdout 到调试日志文件
const debugPath = `/tmp/req-${params.issueId}.jsonl`;
// 使用 TransformStream 将 stdout tee 到文件，同时返回可消费的流
```

**isAlive 实现：**

```typescript
isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

---

## SubagentRegistry

```typescript
// packages/sidecar/src/registry.ts

import type { SidecarConfig, AgentRecord, RegistryState } from "@teamsland/types";
import type { LarkNotifier } from "@teamsland/lark";

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
 * import { createLogger } from "@teamsland/observability";
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
  constructor(opts: SubagentRegistryOpts)

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
  register(record: AgentRecord): void

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
  unregister(agentId: string): void

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
  get(agentId: string): AgentRecord | undefined

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
  runningCount(): number

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
  allRunning(): AgentRecord[]

  /**
   * 将注册表状态原子写入磁盘
   *
   * 策略：先写临时文件，再 rename 覆盖目标文件，保证原子性。
   * 使用 `Bun.write()` 进行文件操作。
   *
   * @example
   * ```typescript
   * await registry.persist();
   * ```
   */
  persist(): Promise<void>

  /**
   * 启动时从磁盘恢复注册表
   *
   * 行为：
   * 1. 读取 registryPath 文件（不存在则跳过）
   * 2. 解析 JSON 为 RegistryState
   * 3. 对每条记录调用 isAlive(pid)，死进程直接丢弃
   * 4. 将存活的 AgentRecord 重新加载到内存注册表
   *
   * 设计为幂等操作，多次调用无副作用。
   *
   * @example
   * ```typescript
   * // 在 main.ts 启动时调用
   * await registry.restoreOnStartup();
   * logger.info({ count: registry.runningCount() }, "注册表恢复完成");
   * ```
   */
  restoreOnStartup(): Promise<void>

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
  toRegistryState(): RegistryState
}
```

**persist 原子写入实现：**

```typescript
async persist(): Promise<void> {
  const state = this.toRegistryState();
  const json = JSON.stringify(state, null, 2);
  const tmpPath = `${this.registryPath}.tmp`;
  await Bun.write(tmpPath, json);
  // rename 操作在同一文件系统内是原子的
  await Bun.file(tmpPath).rename(this.registryPath);
}
```

**restoreOnStartup 核心逻辑：**

```typescript
async restoreOnStartup(): Promise<void> {
  const file = Bun.file(this.registryPath);
  if (!(await file.exists())) return;

  const text = await file.text();
  const state = JSON.parse(text) as RegistryState;

  let restored = 0;
  let cleaned = 0;
  for (const record of state.agents) {
    if (this.isAliveFn(record.pid)) {
      this.map.set(record.agentId, record);
      restored++;
    } else {
      cleaned++;
    }
  }
  this.logger.info({ restored, cleaned }, "注册表恢复完成");
}
```

注意：`isAlive` 逻辑通过 `ProcessController.isAlive()` 调用，或直接内联（registry 不依赖 ProcessController，使用相同的 `process.kill(pid, 0)` 模式）。

---

## SidecarDataPlane

```typescript
// packages/sidecar/src/data-plane.ts

import type { SubagentRegistry } from "./registry.js";
import type { SessionDB } from "@teamsland/session";

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
 * const dataPlane = new SidecarDataPlane({ registry, sessionDb });
 *
 * // 消费进程 stdout 流
 * await dataPlane.processStream("agent-001", spawnResult.stdout);
 * ```
 */
export class SidecarDataPlane {
  constructor(opts: {
    registry: SubagentRegistry;
    sessionDb: SessionDB;
  })

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
   * // processStream 在后台持续消费，不阻塞调用方
   * dataPlane.processStream(agentId, stdout).catch((err) => {
   *   logger.error({ err, agentId }, "流处理异常");
   * });
   * ```
   */
  processStream(agentId: string, stdout: ReadableStream<Uint8Array>): Promise<void>
}
```

**事件路由详情：**

| 事件类型 | 写入 SessionDB | 更新 AgentStatus | 其他行为 |
|---------|---------------|-----------------|---------|
| `tool_use` | 是（非拦截工具）| — | 拦截工具：warn + 跳过 |
| `result` | 是 | `"completed"` | — |
| `error` | 是 | `"failed"` | 记录 error 日志 |
| `system` | 否 | — | 提取元数据，info 日志 |
| `assistant` | 是 | — | 写消息内容 |
| `log` | 否 | — | debug 日志 |

**拦截工具列表：**

```typescript
const INTERCEPTED_TOOLS: Set<string> = new Set([
  "delegate",
  "spawn_agent",
  "memory_write",
]);
```

**processStream 核心逻辑：**

```typescript
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
        this.routeEvent(agentId, trimmed);
      }
    }
    // 处理残余 buffer
    if (buffer.trim()) {
      this.routeEvent(agentId, buffer.trim());
    }
  } finally {
    reader.releaseLock();
    this.registry.unregister(agentId);
  }
}
```

---

## ObservableMessageBus

```typescript
// packages/sidecar/src/message-bus.ts

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
 *   // traceId 缺失时自动注入
 * } as TeamMessage);
 * ```
 */
export class ObservableMessageBus {
  constructor(opts: { logger: Logger })

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
  send(msg: TeamMessage): void

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
  on(handler: (msg: TeamMessage) => void): void
}
```

**send 实现细节：**

```typescript
send(msg: TeamMessage): void {
  // traceId 注入：空字符串或 undefined 均触发
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
```

---

## Alerter

```typescript
// packages/sidecar/src/alerter.ts

import type { LarkNotifier } from "@teamsland/lark";

/**
 * 飞书告警器
 *
 * 监控数值指标，超过阈值时发送飞书卡片告警。
 * 每个指标独立维护 5 分钟冷却窗口，避免告警风暴。
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
  constructor(opts: {
    /** 飞书通知器 */
    notifier: LarkNotifier;
    /** 告警目标频道 ID */
    channelId: string;
    /** 每指标冷却时间（毫秒），默认 300000（5 分钟） */
    cooldownMs?: number;
  })

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
   * @param threshold - 告警阈值（超过则触发）
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
  check(metric: string, value: number, threshold: number): Promise<void>
}
```

**冷却机制实现：**

```typescript
// 内部冷却 Map：指标名 → 最后告警 Unix 毫秒
private readonly cooldownMap = new Map<string, number>();

async check(metric: string, value: number, threshold: number): Promise<void> {
  if (value <= threshold) return;

  const lastFired = this.cooldownMap.get(metric) ?? 0;
  const now = Date.now();
  if (now - lastFired < this.cooldownMs) return; // 冷却中，跳过

  this.cooldownMap.set(metric, now);
  await this.notifier.sendCard(this.channelId, {
    title: `⚠️ 告警：${metric}`,
    content: `当前值 **${value}** 超过阈值 **${threshold}**`,
    timestamp: new Date(now).toISOString(),
  });
}
```

---

## Barrel Exports

```typescript
// packages/sidecar/src/index.ts

// @teamsland/sidecar — ProcessController, SubagentRegistry, SidecarDataPlane,
//                       ObservableMessageBus, Alerter
// Claude Code 子进程管理：进程控制 + Agent 注册 + NDJSON 流解析 + 消息总线 + 告警

export { ProcessController } from "./process-controller.js";
export type { SpawnResult, SpawnParams } from "./process-controller.js";

export { SubagentRegistry, CapacityError } from "./registry.js";

export { SidecarDataPlane } from "./data-plane.js";
export type { SidecarEventType, InterceptedTool } from "./data-plane.js";

export { ObservableMessageBus } from "./message-bus.js";

export { Alerter } from "./alerter.js";
```

---

## 测试策略

### 测试工具

- **FakeProcess** — 实现与 `Bun.spawn` 返回对象相同接口的伪对象，提供可控的 stdout ReadableStream 和可观测的 stdin 写入
- **FakeLarkNotifier** — 实现 `LarkNotifier` 接口，记录所有调用参数供断言
- **FakeSessionDB** — 实现 `SessionDB` 接口（或使用真实 SessionDB 配合内存 SQLite 路径）

### 各文件测试重点

| 文件 | 测试策略 | Mock 依赖 |
|------|---------|---------|
| `process-controller.test.ts` | Mock `Bun.spawn`，返回 FakeProcess | `Bun.spawn` |
| `registry.test.ts` | 临时文件，真实 JSON 读写 | 无 |
| `data-plane.test.ts` | 构造 FakeReadableStream 注入 NDJSON | FakeSessionDB |
| `message-bus.test.ts` | 纯内存测试，无外部依赖 | 无 |
| `alerter.test.ts` | FakeLarkNotifier 记录调用 | FakeLarkNotifier |

### ProcessController 测试

```typescript
// packages/sidecar/src/__tests__/process-controller.test.ts
import { describe, it, expect, vi } from "vitest";
import { ProcessController } from "../process-controller.js";

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
    expect(JSON.parse(writtenData[0])).toMatchObject({ prompt: "hello" });
  });

  it("interrupt: hard=false 发送 SIGINT", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    controller.interrupt(9999);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGINT");
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

### SubagentRegistry 测试

```typescript
// packages/sidecar/src/__tests__/registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubagentRegistry, CapacityError } from "../registry.js";

describe("SubagentRegistry", () => {
  it("register: 容量超限抛出 CapacityError", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 1, ...restConfig },
      notifier: fakeNotifier,
    });
    registry.register(makeRecord("agent-a", 1001));
    expect(() => registry.register(makeRecord("agent-b", 1002)))
      .toThrow(CapacityError);
  });

  it("persist/restoreOnStartup: 存活进程正确恢复，死进程被清除", async () => {
    const path = join(tmpdir(), `test-registry-${Date.now()}.json`);
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: fakeNotifier,
      registryPath: path,
    });

    registry.register(makeRecord("agent-alive", process.pid)); // 当前进程 PID
    registry.register(makeRecord("agent-dead", 999999999));   // 不存在的 PID
    await registry.persist();

    const restored = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: fakeNotifier,
      registryPath: path,
    });
    await restored.restoreOnStartup();

    expect(restored.runningCount()).toBe(1);
    expect(restored.get("agent-alive")).toBeDefined();
    expect(restored.get("agent-dead")).toBeUndefined();
  });
});
```

### SidecarDataPlane 测试

```typescript
// packages/sidecar/src/__tests__/data-plane.test.ts
import { describe, it, expect } from "vitest";
import { SidecarDataPlane } from "../data-plane.js";

describe("SidecarDataPlane", () => {
  it("processStream: 拦截 delegate 工具调用，不写入 SessionDB", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: async (msg: unknown) => { appendedMessages.push(msg); return 1; },
    };

    const dataPlane = new SidecarDataPlane({
      registry: fakeRegistry,
      sessionDb: fakeSessionDb as never,
    });

    const lines = [
      JSON.stringify({ type: "tool_use", name: "delegate", input: {} }),
      JSON.stringify({ type: "assistant", content: "已完成分析" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // delegate 被拦截，只有 assistant 消息写入 DB
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: result 事件更新 AgentRecord 状态为 completed", async () => {
    // ...
  });

  it("processStream: 单行 JSON 解析失败不中断整个流", async () => {
    // 包含一行无效 JSON，其余行正常处理
    // ...
  });
});
```

### ObservableMessageBus 测试

```typescript
// packages/sidecar/src/__tests__/message-bus.test.ts
import { describe, it, expect, vi } from "vitest";
import { ObservableMessageBus } from "../message-bus.js";

describe("ObservableMessageBus", () => {
  it("send: traceId 为空时自动注入 UUID", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "" });

    expect(received[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("send: traceId 非空时保留原值", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "custom-trace-id" });

    expect(received[0]).toBe("custom-trace-id");
  });

  it("on: 多个 handler 均被调用", () => {
    const callCounts = [0, 0];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on(() => callCounts[0]++);
    bus.on(() => callCounts[1]++);

    bus.send({ ...baseMsg, traceId: "t1" });

    expect(callCounts).toEqual([1, 1]);
  });
});
```

### Alerter 测试

```typescript
// packages/sidecar/src/__tests__/alerter.test.ts
import { describe, it, expect, vi } from "vitest";
import { Alerter } from "../alerter.js";

describe("Alerter", () => {
  it("check: 超过阈值时发送飞书卡片", async () => {
    const sentCards: unknown[] = [];
    const fakeNotifier = {
      sendCard: async (channelId: string, card: unknown) => {
        sentCards.push({ channelId, card });
      },
    };

    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("concurrent_agents", 19, 18);

    expect(sentCards).toHaveLength(1);
  });

  it("check: 冷却窗口内不重复发送", async () => {
    const sentCount = { value: 0 };
    const fakeNotifier = {
      sendCard: async () => { sentCount.value++; },
    };

    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("cpu_usage", 95, 80);
    await alerter.check("cpu_usage", 95, 80); // 第二次在冷却期内

    expect(sentCount.value).toBe(1);
  });

  it("check: 不同指标冷却窗口相互独立", async () => {
    const sentCount = { value: 0 };
    const fakeNotifier = {
      sendCard: async () => { sentCount.value++; },
    };

    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("metric_a", 100, 90);
    await alerter.check("metric_b", 100, 90); // 不同指标，不受 metric_a 的冷却影响

    expect(sentCount.value).toBe(2);
  });

  it("check: 未超过阈值时不发送", async () => {
    const sentCount = { value: 0 };
    const fakeNotifier = {
      sendCard: async () => { sentCount.value++; },
    };

    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("memory_usage", 70, 80); // 70 <= 80，不触发

    expect(sentCount.value).toBe(0);
  });
});
```

### 运行命令

```bash
# 全部测试
bunx --bun vitest run packages/sidecar/

# 单文件
bunx --bun vitest run packages/sidecar/src/__tests__/registry.test.ts
```

---

## 约束与限制

1. **Bun.spawn 必须使用 `"pipe"` stdin/stdout** — 使用 `"inherit"` 或 `null` 时无法注入信封或消费 NDJSON 流。测试中 mock `Bun.spawn` 时必须返回实现了 `stdin.write/end` 和 `stdout`（ReadableStream）的对象。

2. **NDJSON 流不保证行对齐** — `Uint8Array` chunk 可能在行边界之间切割。`processStream` 必须维护行 buffer（见上述实现），不能逐 chunk 解析。

3. **stdout tee 到文件的性能影响** — `/tmp/req-{issueId}.jsonl` 的磁盘写入与流处理串行。若 Claude CLI 输出量极大（> 100MB），可能成为瓶颈。当前阶段可接受，后续优化可改为异步写入队列。

4. **registry.json rename 限制** — `Bun.file().rename()` 仅在同一文件系统内保证原子性。若 `registryPath` 与 `/tmp` 跨文件系统，需改用 `fs.rename`（也是原子的，但 Bun API 不保证）。默认路径使用 `/tmp` 规避此问题。

5. **Worker 工具拦截是软拦截** — 数据平面拦截 `delegate`、`spawn_agent`、`memory_write` 仅影响持久化和路由，不阻止 Claude CLI 内部执行这些工具调用（通过 `--permission-mode bypassPermissions` 已绕过 Claude 的内置权限检查）。真正的递归防护需要在 Orchestrator 层通过 `maxDelegateDepth` 配置实现。

6. **ObservableMessageBus handler 异常隔离** — 当前实现中 handler 抛出异常会中断后续 handler。如需严格隔离，需将 `for...of` 改为 `try/catch` 包裹每个 handler 调用。当前阶段保持简单，handler 文档要求不抛出异常。

7. **Alerter 的 `sendCard` 接口假设** — `LarkNotifier.sendCard()` 接受 `(channelId: string, card: { title: string; content: string; timestamp: string })` 格式。若 `@teamsland/lark` 的实际接口不同，需调整 Alerter 的调用方式。

---

## 验证标准

- `bunx tsc --noEmit --project packages/sidecar/tsconfig.json` 零错误
- `bunx biome check packages/sidecar/src/` 零错误
- `bunx vitest run packages/sidecar/` 全部通过
- 所有导出的类、方法、接口有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
- 所有 logger 使用 `createLogger("sidecar:*")` 命名空间前缀
