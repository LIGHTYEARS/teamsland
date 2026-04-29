import type { MeegoEvent, OriginData } from "@teamsland/types";

// ─── Hook 模块定义 ───

/**
 * Hook 模块接口 — 每个 hook `.ts` 文件必须导出的结构
 *
 * 包含事件匹配函数 `match` 和处理函数 `handle`，可选优先级和描述。
 *
 * @example
 * ```typescript
 * import type { HookModule } from "@teamsland/hooks";
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * const hook: HookModule = {
 *   match: (event: MeegoEvent) => event.type === "issue.created",
 *   handle: async (event, ctx) => {
 *     ctx.log.info({ issueId: event.issueId }, "处理新建事件");
 *   },
 *   priority: 10,
 *   description: "新建工单通知 hook",
 * };
 * ```
 */
export interface HookModule {
  /** 事件匹配函数，返回 true 表示该 hook 应处理此事件 */
  match: (event: MeegoEvent) => boolean;
  /** 事件处理函数 */
  handle: (event: MeegoEvent, ctx: HookContext) => Promise<void>;
  /** 优先级，数值越小越先执行 */
  priority?: number;
  /** hook 描述信息 */
  description?: string;
}

// ─── 已加载 Hook 运行时表示 ───

/**
 * 已加载 Hook 的运行时表示
 *
 * 包含 hook 的唯一标识、文件路径、模块引用和加载时间等运行时信息。
 *
 * @example
 * ```typescript
 * import type { LoadedHook } from "@teamsland/hooks";
 *
 * const loaded: LoadedHook = {
 *   id: "notify/on-create",
 *   filePath: "/app/hooks/notify/on-create.ts",
 *   module: myHookModule,
 *   timeoutMs: 30000,
 *   loadedAt: Date.now(),
 * };
 * ```
 */
export interface LoadedHook {
  /** 相对路径（不含 .ts 扩展名）作为唯一标识 */
  id: string;
  /** hook 文件绝对路径 */
  filePath: string;
  /** 已加载的 hook 模块 */
  module: HookModule;
  /** handle 执行超时时间（毫秒） */
  timeoutMs: number;
  /** 加载时间戳（Unix 毫秒） */
  loadedAt: number;
}

// ─── Hook 状态（可序列化，供 Dashboard API 使用） ───

/**
 * Hook 状态信息，供 Dashboard API 返回
 *
 * 可序列化的 hook 状态摘要，不包含模块引用。
 *
 * @example
 * ```typescript
 * import type { HookStatus } from "@teamsland/hooks";
 *
 * const status: HookStatus = {
 *   id: "notify/on-create",
 *   filePath: "/app/hooks/notify/on-create.ts",
 *   loadedAt: 1714000000000,
 *   description: "新建工单通知",
 *   priority: 10,
 * };
 * ```
 */
export interface HookStatus {
  /** hook 唯一标识 */
  id: string;
  /** hook 文件绝对路径 */
  filePath: string;
  /** 加载时间戳（Unix 毫秒） */
  loadedAt: number;
  /** hook 描述信息 */
  description?: string;
  /** 优先级 */
  priority: number;
}

// ─── Hook 引擎配置 ───

/**
 * Hook 引擎配置
 *
 * 控制 hook 文件目录、默认超时和多匹配行为。
 *
 * @example
 * ```typescript
 * import type { HookEngineConfig } from "@teamsland/hooks";
 *
 * const config: HookEngineConfig = {
 *   hooksDir: "./hooks",
 *   defaultTimeoutMs: 30000,
 *   multiMatch: false,
 * };
 * ```
 */
export interface HookEngineConfig {
  /** hook 文件目录路径 */
  hooksDir: string;
  /** handle 执行默认超时时间（毫秒），默认 30000 */
  defaultTimeoutMs: number;
  /** 是否允许多个 hook 匹配同一事件，默认 false */
  multiMatch: boolean;
}

// ─── Hook 上下文 ───

/**
 * Hook 上下文 — 注入到每个 hook handler 中的运行时依赖
 *
 * 提供飞书消息发送、通知、进程派生、队列入队、注册表查询、配置读取、日志和指标收集等能力。
 *
 * @example
 * ```typescript
 * import type { HookContext } from "@teamsland/hooks";
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * async function handleEvent(event: MeegoEvent, ctx: HookContext): Promise<void> {
 *   ctx.log.info({ eventId: event.issueId }, "开始处理事件");
 *   await ctx.lark.sendGroupMessage("oc_xxx", `事件 ${event.issueId} 已触发`);
 *   ctx.metrics.recordHookHit("my-hook", event.type);
 * }
 * ```
 */
export interface HookContext {
  /** 飞书消息操作 */
  lark: HookLarkAccess;
  /** 通知器操作 */
  notifier: HookNotifierAccess;
  /** 派生子进程 */
  spawn: (opts: HookSpawnOptions) => Promise<HookSpawnResult>;
  /** 消息队列 */
  queue: { enqueue: (event: MeegoEvent) => Promise<void> };
  /** Agent 注册表 */
  registry: HookRegistryAccess;
  /** 只读配置 */
  config: Readonly<Record<string, unknown>>;
  /** 结构化日志 */
  log: HookLogger;
  /** 指标收集 */
  metrics: HookMetrics;
}

// ─── 最小化访问接口（避免在类型层面导入完整包） ───

/**
 * 飞书消息操作接口（最小化子集）
 *
 * 提供群消息发送、私聊和历史消息读取能力，避免在类型层面引入完整的飞书 SDK。
 *
 * @example
 * ```typescript
 * import type { HookLarkAccess } from "@teamsland/hooks";
 *
 * async function notify(lark: HookLarkAccess): Promise<void> {
 *   await lark.sendGroupMessage("oc_xxx", "通知内容");
 *   const history = await lark.imHistory("oc_xxx", 10);
 *   console.log(history[0].sender, history[0].content);
 * }
 * ```
 */
export interface HookLarkAccess {
  /** 发送群消息 */
  sendGroupMessage: (chatId: string, content: string, opts?: { replyToMessageId?: string }) => Promise<void>;
  /** 发送私聊消息 */
  sendDm: (userId: string, content: string) => Promise<void>;
  /** 读取群聊历史消息 */
  imHistory: (chatId: string, count: number) => Promise<Array<{ sender: string; content: string }>>;
}

/**
 * 通知器操作接口（最小化子集）
 *
 * 提供私聊和群消息发送能力。
 *
 * @example
 * ```typescript
 * import type { HookNotifierAccess } from "@teamsland/hooks";
 *
 * async function alert(notifier: HookNotifierAccess): Promise<void> {
 *   await notifier.sendDm("user_xxx", "你有一个新任务");
 *   await notifier.sendGroupMessage("oc_xxx", "团队通知：新任务已创建");
 * }
 * ```
 */
export interface HookNotifierAccess {
  /** 发送私聊消息 */
  sendDm: (userId: string, content: string) => Promise<void>;
  /** 发送群消息 */
  sendGroupMessage: (chatId: string, content: string) => Promise<void>;
}

/**
 * Agent 注册表访问接口（最小化子集）
 *
 * 提供查询运行中 Agent 的能力。
 *
 * @example
 * ```typescript
 * import type { HookRegistryAccess } from "@teamsland/hooks";
 *
 * function checkRunning(registry: HookRegistryAccess): void {
 *   const all = registry.allRunning();
 *   const matched = registry.findByIssueId("issue_123");
 *   console.log(`共 ${all.length} 个运行中 Agent，其中 ${matched.length} 个处理此工单`);
 * }
 * ```
 */
export interface HookRegistryAccess {
  /** 获取所有运行中的 Agent */
  allRunning: () => Array<{ agentId: string; status: string; issueId: string }>;
  /** 按工单 ID 查找关联的 Agent */
  findByIssueId: (issueId: string) => Array<{ agentId: string; status: string }>;
}

/**
 * Hook 日志接口
 *
 * 提供结构化日志能力，与 `@teamsland/observability` 兼容。
 *
 * @example
 * ```typescript
 * import type { HookLogger } from "@teamsland/hooks";
 *
 * function logExample(log: HookLogger): void {
 *   log.info({ hookId: "my-hook" }, "hook 执行开始");
 *   log.warn({ latencyMs: 5000 }, "hook 执行较慢");
 *   log.error({ err: "timeout" }, "hook 执行超时");
 *   log.debug({ detail: "verbose" }, "调试信息");
 * }
 * ```
 */
export interface HookLogger {
  /** 记录信息级别日志 */
  info: (obj: Record<string, unknown>, msg?: string) => void;
  /** 记录警告级别日志 */
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  /** 记录错误级别日志 */
  error: (obj: Record<string, unknown>, msg?: string) => void;
  /** 记录调试级别日志 */
  debug: (obj: Record<string, unknown>, msg?: string) => void;
}

// ─── Hook 指标收集 ───

/**
 * Hook 指标收集接口
 *
 * 用于记录 hook 命中次数、错误次数和延迟信息。
 *
 * @example
 * ```typescript
 * import type { HookMetrics } from "@teamsland/hooks";
 *
 * function recordMetrics(metrics: HookMetrics): void {
 *   metrics.recordHookHit("my-hook", "issue.created");
 *   metrics.recordMatchDuration("my-hook", 2.5);
 *   metrics.recordHandleDuration("my-hook", 150);
 * }
 * ```
 */
export interface HookMetrics {
  /** 记录 hook 命中 */
  recordHookHit(hookId: string, eventType: string): void;
  /** 记录 hook 错误 */
  recordHookError(hookId: string, eventType: string): void;
  /** 记录 match 阶段耗时（毫秒） */
  recordMatchDuration(hookId: string, durationMs: number): void;
  /** 记录 handle 阶段耗时（毫秒） */
  recordHandleDuration(hookId: string, durationMs: number): void;
}

// ─── 进程派生类型 ───

/**
 * Hook 派生子进程的选项
 *
 * @example
 * ```typescript
 * import type { HookSpawnOptions } from "@teamsland/hooks";
 *
 * const opts: HookSpawnOptions = {
 *   repo: "/repos/frontend",
 *   task: "修复登录页面样式问题",
 *   requester: "user_xxx",
 *   chatId: "oc_xxx",
 * };
 * ```
 */
export interface HookSpawnOptions {
  /** 目标仓库路径 */
  repo: string;
  /** 任务描述 */
  task: string;
  /** 请求者用户 ID */
  requester: string;
  /** 关联群聊 ID（可选） */
  chatId?: string;
  /** worktree 路径（可选，不提供则自动创建） */
  worktreePath?: string;
  /** 派发来源（可选，默认 "coordinator"） */
  source?: "meego" | "lark_mention" | "lark_dm" | "coordinator";
}

/**
 * Hook 派生子进程的结果
 *
 * @example
 * ```typescript
 * import type { HookSpawnResult } from "@teamsland/hooks";
 *
 * const result: HookSpawnResult = {
 *   agentId: "agent_abc123",
 *   pid: 12345,
 *   sessionId: "session_xyz",
 *   worktreePath: "/repos/frontend/.worktrees/fix-login",
 * };
 * ```
 */
export interface HookSpawnResult {
  /** Agent 唯一标识 */
  agentId: string;
  /** 进程 ID */
  pid: number;
  /** 会话 ID */
  sessionId: string;
  /** worktree 路径 */
  worktreePath: string;
}

// ─── 指标快照 ───

/**
 * 指标快照 — 由 HookMetricsCollector.getSnapshot() 返回
 *
 * 包含分层分布、命中/错误计数和延迟百分位数。
 *
 * @example
 * ```typescript
 * import type { MetricsSnapshot } from "@teamsland/hooks";
 *
 * const snapshot: MetricsSnapshot = {
 *   tierDistribution: { hook: 42, queue: 8 },
 *   hookHitCounts: { "notify/on-create": 100 },
 *   hookErrorCounts: { "notify/on-create": 2 },
 *   hookLatencies: { "notify/on-create": { p50: 15, p95: 45, p99: 120 } },
 * };
 * ```
 */
export interface MetricsSnapshot {
  /** 分层处理分布（hook 直接处理 vs queue 延迟处理） */
  tierDistribution: { hook: number; queue: number };
  /** 各 hook 命中次数 */
  hookHitCounts: Record<string, number>;
  /** 各 hook 错误次数 */
  hookErrorCounts: Record<string, number>;
  /** 各 hook 延迟百分位数（毫秒） */
  hookLatencies: Record<string, { p50: number; p95: number; p99: number }>;
}

// ─── Hook 上下文依赖 ───

/**
 * 构建 HookContext 所需的依赖集合
 *
 * 包含飞书客户端、通知器、进程控制器、worktree 管理器、注册表、配置和队列等具体依赖。
 *
 * @example
 * ```typescript
 * import type { HookContextDeps } from "@teamsland/hooks";
 *
 * const deps: HookContextDeps = {
 *   larkCli: myLarkAccess,
 *   notifier: myNotifier,
 *   processController: {
 *     spawn: async (params) => ({ sessionId: "s1", pid: 123 }),
 *   },
 *   worktreeManager: {
 *     create: async (repoPath, suffix) => `/tmp/wt-${suffix}`,
 *   },
 *   registry: { ...myRegistry, register: (record) => {} },
 *   config: { key: "value" },
 *   queue: { enqueue: async (event) => {} },
 * };
 * ```
 */
export interface HookContextDeps {
  /** 飞书客户端 */
  larkCli: HookLarkAccess;
  /** 通知器 */
  notifier: HookNotifierAccess;
  /** 进程控制器 */
  processController: {
    spawn: (params: {
      issueId: string;
      worktreePath: string;
      initialPrompt: string;
    }) => Promise<{ sessionId: string; pid: number }>;
  };
  /** worktree 管理器 */
  worktreeManager: {
    create: (repoPath: string, branchSuffix: string) => Promise<string>;
  };
  /** Agent 注册表（含注册能力） */
  registry: HookRegistryAccess & {
    register: (record: Record<string, unknown>) => void;
  };
  /** 只读配置 */
  config: Readonly<Record<string, unknown>>;
  /** 消息队列 */
  queue: { enqueue: (event: MeegoEvent) => Promise<void> };
  /** Session 数据库（可选，用于注册会话记录） */
  sessionDb?: {
    createSession: (params: {
      sessionId: string;
      teamId: string;
      agentId?: string;
      sessionType?: "coordinator" | "task_worker" | "observer_worker";
      source?: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";
      originData?: OriginData;
      summary?: string;
    }) => Promise<void>;
  };
  /** 团队 ID（可选，与 sessionDb 配合使用） */
  teamId?: string;
}
