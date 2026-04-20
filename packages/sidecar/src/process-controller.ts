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

/** 从首条 NDJSON 行提取 sessionId 的中间结果 */
interface FirstLineResult {
  sessionId: string;
  bufferedChunks: Uint8Array[];
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
   * 4. 将剩余 stdout 通过管道返回给调用方
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
      { cwd: params.worktreePath, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    );

    const envelope = JSON.stringify({ prompt: params.initialPrompt });
    proc.stdin.write(`${envelope}\n`);
    proc.stdin.end();

    this.logger.info({ pid: proc.pid, issueId: params.issueId }, "Claude CLI 子进程已启动");

    const { sessionId, bufferedChunks } = await this.readFirstLine(proc.stdout);
    const stdout = this.buildCombinedStream(bufferedChunks, proc.stdout);
    const [streamForConsumer, streamForDebug] = stdout.tee();

    this.scheduleDebugWrite(`/tmp/req-${params.issueId}.jsonl`, streamForDebug);

    return { pid: proc.pid, sessionId, stdout: streamForConsumer };
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

  /** 从 stdout 读取首行，提取 sessionId 并收集已读 chunks */
  private async readFirstLine(stream: ReadableStream<Uint8Array>): Promise<FirstLineResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sessionId: string = randomUUID();
    const bufferedChunks: Uint8Array[] = [];
    let done = false;

    while (!done) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      bufferedChunks.push(value);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines[lines.length - 1] ?? "";
      for (let i = 0; i < lines.length - 1; i++) {
        const trimmed = (lines[i] ?? "").trim();
        if (!trimmed) continue;
        sessionId = this.extractSessionId(trimmed) ?? sessionId;
        done = true;
        break;
      }
    }
    reader.releaseLock();
    return { sessionId, bufferedChunks };
  }

  /** 从单行 NDJSON 提取 sessionId */
  private extractSessionId(line: string): string | undefined {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === "system" && typeof parsed.session_id === "string") {
        return parsed.session_id;
      }
    } catch {
      // 解析失败，返回 undefined 使用 fallback
    }
    return undefined;
  }

  /** 将已缓冲 chunks 与剩余流合并为新 ReadableStream */
  private buildCombinedStream(
    buffered: Uint8Array[],
    remaining: ReadableStream<Uint8Array>,
  ): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const chunk of buffered) {
          controller.enqueue(chunk);
        }
        const remainingReader = remaining.getReader();
        try {
          while (true) {
            const { done, value } = await remainingReader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          remainingReader.releaseLock();
          controller.close();
        }
      },
    });
  }

  /** 后台将流内容写入调试文件，不阻塞调用方 */
  private scheduleDebugWrite(debugPath: string, stream: ReadableStream<Uint8Array>): void {
    void (async () => {
      try {
        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        reader.releaseLock();
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
  }
}
