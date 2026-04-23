// @teamsland/server — Coordinator Session Manager
// 核心状态机：管理 Claude Code Coordinator 会话的生命周期

import { createLogger } from "@teamsland/observability";
import type {
  ActiveSession,
  CoordinatorContext,
  CoordinatorContextLoader,
  CoordinatorEvent,
  CoordinatorSessionManagerConfig,
  CoordinatorState,
} from "@teamsland/types";

const logger = createLogger("server:coordinator");

// ─── Coordinator Prompt Builder 接口 ───

/**
 * Coordinator 提示词构建器接口
 *
 * 由 coordinator-prompt.ts 的 CoordinatorPromptBuilder 类实现。
 * 此处定义接口用于解耦，便于测试时注入 mock。
 *
 * @example
 * ```typescript
 * const builder: CoordinatorPromptBuilderLike = { build: (e, c) => "prompt" };
 * ```
 */
export interface CoordinatorPromptBuilderLike {
  /** 构建提示词 */
  build(event: CoordinatorEvent, context: CoordinatorContext): string;
}

/**
 * stream-json 初始化行结构
 *
 * Claude Code 的 `--output-format stream-json` 在首行输出 init 消息，
 * 包含 session_id 等元信息。
 *
 * @example
 * ```typescript
 * const init: StreamJsonInit = { type: "system", subtype: "init", session_id: "sess-001" };
 * ```
 */
interface StreamJsonInit {
  type: string;
  subtype?: string;
  session_id?: string;
}

/**
 * 子进程生成结果接口
 *
 * 描述 Bun.spawn 的返回结构中 CoordinatorSessionManager 需要的字段。
 *
 * @example
 * ```typescript
 * const result: SpawnedProcess = {
 *   pid: 12345,
 *   stdin: { getWriter: () => writer },
 *   stdout: new ReadableStream(),
 *   stderr: new ReadableStream(),
 *   exited: Promise.resolve(0),
 * };
 * ```
 */
export interface SpawnedProcess {
  /** 进程 ID */
  pid: number;
  /** 标准输入（用于写入提示词） */
  stdin: { getWriter: () => WritableStreamDefaultWriter<Uint8Array> };
  /** 标准输出（用于读取结果） */
  stdout: ReadableStream<Uint8Array>;
  /** 标准错误 */
  stderr: ReadableStream<Uint8Array>;
  /** 退出码 Promise */
  exited: Promise<number>;
}

/**
 * 子进程生成函数类型
 *
 * 可注入的 spawn 函数，默认使用 Bun.spawn。
 * 测试时可替换为 mock 实现。
 *
 * @example
 * ```typescript
 * const spawnFn: SpawnFn = (args, opts) => Bun.spawn(args, opts);
 * ```
 */
export type SpawnFn = (
  args: string[],
  opts: { cwd: string; stdin: "pipe"; stdout: "pipe"; stderr: "pipe" },
) => SpawnedProcess;

/**
 * CoordinatorSessionManager 构造参数
 *
 * @example
 * ```typescript
 * const opts: CoordinatorSessionManagerOpts = {
 *   config: { workspacePath: "/tmp/coord", sessionIdleTimeoutMs: 300_000, sessionMaxLifetimeMs: 1_800_000, sessionReuseWindowMs: 300_000, maxRecoveryRetries: 3, inferenceTimeoutMs: 60_000 },
 *   contextLoader: stubLoader,
 * };
 * ```
 */
export interface CoordinatorSessionManagerOpts {
  /** Session 管理配置 */
  config: CoordinatorSessionManagerConfig;
  /** 上下文加载器 */
  contextLoader: CoordinatorContextLoader;
  /** 提示词构建器（可选，未提供时使用默认占位实现） */
  promptBuilder?: CoordinatorPromptBuilderLike;
  /** 子进程生成函数（可选，默认使用 Bun.spawn） */
  spawnFn?: SpawnFn;
}

/**
 * Coordinator Session Manager
 *
 * 管理 Claude Code Coordinator 会话的核心状态机。
 * 职责包括：事件处理、会话复用判断、子进程生命周期、错误恢复。
 *
 * 状态流转：idle → spawning → running → (idle | recovery → running | failed)
 *
 * @example
 * ```typescript
 * import { CoordinatorSessionManager } from "./coordinator.js";
 * import { StubContextLoader } from "./coordinator-context.js";
 *
 * const manager = new CoordinatorSessionManager({
 *   config: {
 *     workspacePath: "/tmp/coordinator",
 *     sessionIdleTimeoutMs: 300_000,
 *     sessionMaxLifetimeMs: 1_800_000,
 *     sessionReuseWindowMs: 300_000,
 *     maxRecoveryRetries: 3,
 *     inferenceTimeoutMs: 60_000,
 *   },
 *   contextLoader: new StubContextLoader("http://localhost:3000"),
 * });
 *
 * await manager.processEvent({
 *   type: "lark_mention",
 *   id: "evt-001",
 *   timestamp: Date.now(),
 *   priority: 1,
 *   payload: { chatId: "oc_xxx" },
 * });
 * ```
 */
export class CoordinatorSessionManager {
  private state: CoordinatorState = "idle";
  private activeSession: ActiveSession | null = null;
  private recoveryCount = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly config: CoordinatorSessionManagerConfig;
  private readonly contextLoader: CoordinatorContextLoader;
  private readonly promptBuilder: CoordinatorPromptBuilderLike;
  private readonly spawnFn: SpawnFn;

  constructor(opts: CoordinatorSessionManagerOpts) {
    this.config = opts.config;
    this.contextLoader = opts.contextLoader;
    this.promptBuilder = opts.promptBuilder ?? createDefaultPromptBuilder();
    this.spawnFn = opts.spawnFn ?? defaultSpawnFn;
  }

  /**
   * 处理单个 Coordinator 事件
   *
   * 主流程：加载上下文 → 构建提示词 → 决定复用/新建会话 → 执行推理。
   * 发生异常时进入恢复流程（有限重试）。
   *
   * @param event - 待处理的 Coordinator 事件
   *
   * @example
   * ```typescript
   * await manager.processEvent({
   *   type: "meego_issue_created",
   *   id: "evt-002",
   *   timestamp: Date.now(),
   *   priority: 2,
   *   payload: { issueId: "ISSUE-42" },
   * });
   * ```
   */
  async processEvent(event: CoordinatorEvent): Promise<void> {
    logger.info({ eventId: event.id, type: event.type, priority: event.priority }, "处理 Coordinator 事件");

    try {
      const context = await this.contextLoader.load(event);
      const prompt = this.promptBuilder.build(event, context);

      if (this.shouldReuseSession(event)) {
        await this.continueSession(prompt, event);
      } else {
        await this.spawnNewSession(prompt, event);
      }

      this.recoveryCount = 0;
    } catch (err: unknown) {
      await this.handleProcessError(err, event);
    }
  }

  /**
   * 获取当前状态
   *
   * @returns 当前 Coordinator 状态
   *
   * @example
   * ```typescript
   * const state = manager.getState();
   * console.log(state); // "idle" | "spawning" | "running" | ...
   * ```
   */
  getState(): CoordinatorState {
    return this.state;
  }

  /**
   * 获取当前活跃 session 信息
   *
   * @returns ActiveSession 或 null
   *
   * @example
   * ```typescript
   * const session = manager.getActiveSession();
   * if (session) console.log(session.sessionId);
   * ```
   */
  getActiveSession(): ActiveSession | null {
    return this.activeSession;
  }

  /**
   * 重置 Coordinator 到初始状态
   *
   * 销毁当前 session、清除恢复计数器和空闲定时器。
   * 用于优雅关闭或手动干预。
   *
   * @example
   * ```typescript
   * manager.reset();
   * console.log(manager.getState()); // "idle"
   * ```
   */
  reset(): void {
    this.destroySession();
    this.state = "idle";
    this.recoveryCount = 0;
    logger.info("Coordinator 已重置到初始状态");
  }

  // ─── Private: Session 复用判断 ───

  /**
   * 判断是否应该复用当前活跃 session
   *
   * 复用条件（全部满足才复用）：
   * - 存在活跃 session
   * - 事件优先级非 P0（P0 = 异常，需要干净上下文）
   * - session 未超过最大生命周期
   * - 已处理事件数 < 20
   * - 事件 chatId 与 session chatId 匹配（或均无 chatId）
   * - 距最后活动时间未超过复用窗口
   */
  shouldReuseSession(event: CoordinatorEvent): boolean {
    if (!this.activeSession) return false;
    if (event.priority === 0) return false;

    const now = Date.now();
    const session = this.activeSession;

    if (now - session.startedAt > this.config.sessionMaxLifetimeMs) return false;
    if (session.processedEvents.length >= 20) return false;

    const eventChatId = typeof event.payload.chatId === "string" ? event.payload.chatId : undefined;
    if (eventChatId !== session.chatId) return false;

    if (now - session.lastActivityAt > this.config.sessionReuseWindowMs) return false;

    return true;
  }

  // ─── Private: 新建 Session ───

  /**
   * 销毁现有 session 并启动新的 Claude Code 进程
   */
  private async spawnNewSession(prompt: string, event: CoordinatorEvent): Promise<void> {
    this.destroySession();
    this.state = "spawning";

    logger.info({ eventId: event.id }, "正在启动新的 Coordinator session");

    const proc = this.spawnFn(
      ["claude", "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"],
      {
        cwd: this.config.workspacePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // 写入提示词并关闭 stdin
    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(prompt));
    await writer.close();

    // 收集输出（含超时）
    const output = await this.collectOutput(proc);

    // 从 stream-json 输出中提取 session_id
    const sessionId = this.extractSessionId(output);

    const chatId = typeof event.payload.chatId === "string" ? event.payload.chatId : undefined;

    this.activeSession = {
      pid: proc.pid,
      sessionId,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      processedEvents: [event.id],
      chatId,
    };

    this.state = "running";
    this.scheduleIdleTimeout();

    logger.info({ sessionId, pid: proc.pid, eventId: event.id }, "Coordinator session 已启动");
  }

  // ─── Private: 继续现有 Session ───

  /**
   * 在现有 session 上继续处理新事件
   */
  private async continueSession(prompt: string, event: CoordinatorEvent): Promise<void> {
    if (!this.activeSession) {
      throw new Error("无法继续不存在的 session");
    }

    const sessionId = this.activeSession.sessionId;
    logger.info({ sessionId, eventId: event.id }, "继续已有 Coordinator session");

    const proc = this.spawnFn(
      [
        "claude",
        "--continue",
        sessionId,
        "-p",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "bypassPermissions",
      ],
      {
        cwd: this.config.workspacePath,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const writer = proc.stdin.getWriter();
    await writer.write(new TextEncoder().encode(prompt));
    await writer.close();

    await this.collectOutput(proc);

    this.activeSession.lastActivityAt = Date.now();
    this.activeSession.processedEvents.push(event.id);
    this.scheduleIdleTimeout();

    logger.info(
      { sessionId, eventId: event.id, processedCount: this.activeSession.processedEvents.length },
      "Coordinator session 已更新",
    );
  }

  // ─── Private: 输出收集 ───

  /**
   * 读取子进程 stdout，应用推理超时
   */
  private async collectOutput(proc: { stdout: ReadableStream<Uint8Array>; exited: Promise<number> }): Promise<string> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.inferenceTimeoutMs);

    try {
      const reader = proc.stdout.getReader();
      const chunks: Uint8Array[] = [];
      const decoder = new TextDecoder();

      const readAll = async (): Promise<string> => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
        return decoder.decode(Buffer.concat(chunks));
      };

      const abortPromise = new Promise<never>((_resolve, reject) => {
        abortController.signal.addEventListener("abort", () => {
          reject(new Error("Coordinator 推理超时"));
        });
      });

      const result = await Promise.race([readAll(), abortPromise]);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 从 stream-json 输出中提取 session_id
   *
   * 逐行扫描输出，查找 `{"type":"system","subtype":"init",...,"session_id":"..."}` 格式的行。
   */
  private extractSessionId(output: string): string {
    const lines = output.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as StreamJsonInit;
        if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
          return parsed.session_id;
        }
      } catch {
        // 非 JSON 行，跳过
      }
    }
    // 回退：使用时间戳作为 session ID
    const fallbackId = `coord-${Date.now()}`;
    logger.warn({ fallbackId }, "未能从 stream-json 提取 session_id，使用回退 ID");
    return fallbackId;
  }

  // ─── Private: 错误处理 ───

  /**
   * 处理事件处理过程中的异常
   *
   * 如果恢复次数未超过上限则重试，否则进入 failed 状态。
   */
  private async handleProcessError(err: unknown, event: CoordinatorEvent): Promise<void> {
    const errMsg = err instanceof Error ? err.message : String(err);

    if (this.recoveryCount < this.config.maxRecoveryRetries) {
      this.state = "recovery";
      this.recoveryCount++;
      logger.warn(
        { eventId: event.id, recoveryCount: this.recoveryCount, error: errMsg },
        "Coordinator 处理失败，进入恢复重试",
      );
      this.destroySession();
      await this.processEvent(event);
    } else {
      this.state = "failed";
      logger.error(
        { eventId: event.id, recoveryCount: this.recoveryCount, error: errMsg },
        "Coordinator 恢复重试耗尽，进入 failed 状态",
      );
      // 延迟重置，给上层监控时间观察 failed 状态
      setTimeout(() => {
        if (this.state === "failed") {
          this.reset();
          logger.info("Coordinator 从 failed 状态自动重置");
        }
      }, 30_000);
    }
  }

  // ─── Private: Session 销毁 ───

  /**
   * 销毁当前活跃 session
   *
   * 杀死进程、清除空闲定时器、置空 activeSession。
   */
  private destroySession(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.activeSession) {
      try {
        process.kill(this.activeSession.pid, "SIGTERM");
      } catch {
        // 进程可能已退出
      }
      logger.info(
        { sessionId: this.activeSession.sessionId, pid: this.activeSession.pid },
        "Coordinator session 已销毁",
      );
      this.activeSession = null;
    }
  }

  // ─── Private: 空闲超时调度 ───

  /**
   * 调度空闲超时
   *
   * 清除已有定时器，设置新的。超时后自动销毁 session 并回到 idle。
   */
  private scheduleIdleTimeout(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      logger.info("Coordinator session 空闲超时，自动销毁");
      this.destroySession();
      this.state = "idle";
    }, this.config.sessionIdleTimeoutMs);
  }
}

// ─── 默认 Spawn 函数 ───

/**
 * 默认子进程生成函数，使用 Bun.spawn
 *
 * @example
 * ```typescript
 * const proc = defaultSpawnFn(["claude", "-p"], { cwd: "/tmp", stdin: "pipe", stdout: "pipe", stderr: "pipe" });
 * ```
 */
const defaultSpawnFn: SpawnFn = (args, opts) => Bun.spawn(args, opts) as unknown as SpawnedProcess;

// ─── 默认 Prompt Builder ───

/**
 * 创建默认占位提示词构建器
 *
 * 在 coordinator-prompt.ts 未就绪时使用的简单实现。
 * 将事件和上下文序列化为结构化文本。
 *
 * @example
 * ```typescript
 * const builder = createDefaultPromptBuilder();
 * const prompt = builder.build(event, context);
 * ```
 */
function createDefaultPromptBuilder(): CoordinatorPromptBuilderLike {
  return {
    build(event: CoordinatorEvent, context: CoordinatorContext): string {
      const parts: string[] = [
        `[Coordinator] 收到事件: ${event.type} (ID: ${event.id}, 优先级: ${event.priority})`,
        "",
        "── 事件负载 ──",
        JSON.stringify(event.payload, null, 2),
      ];

      if (context.taskStateSummary) {
        parts.push("", "── 当前任务状态 ──", context.taskStateSummary);
      }

      if (context.recentMessages) {
        parts.push("", "── 近期消息 ──", context.recentMessages);
      }

      if (context.relevantMemories) {
        parts.push("", "── 相关记忆 ──", context.relevantMemories);
      }

      parts.push("", "请根据以上信息决定下一步操作。");
      return parts.join("\n");
    },
  };
}
