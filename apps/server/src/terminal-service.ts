// @teamsland/server — 终端会话管理服务
// 管理通过 WebSocket 连接的交互式 Shell 会话

import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:terminal");

/**
 * 终端会话
 *
 * 封装一个 Bun.spawn 创建的 Shell 子进程，关联 WebSocket 连接以实现双向通信。
 *
 * @example
 * ```typescript
 * import type { TerminalSession } from "./terminal-service.js";
 *
 * const session: TerminalSession = {
 *   id: "term_001",
 *   proc: Bun.spawn(["bash"], { stdout: "pipe", stdin: "pipe" }),
 *   cwd: "/Users/dev/project",
 *   createdAt: Date.now(),
 * };
 * ```
 */
interface TerminalSession {
  /** 终端会话 ID */
  id: string;
  /** Shell 子进程 */
  proc: ReturnType<typeof Bun.spawn>;
  /** 工作目录 */
  cwd: string;
  /** 创建时间戳 */
  createdAt: number;
}

/**
 * 终端服务
 *
 * 管理多个终端会话的生命周期。每个终端会话通过 Bun.spawn 启动一个交互式 Shell 进程，
 * 使用 stdin/stdout pipe 进行双向数据传输。
 *
 * @example
 * ```typescript
 * import { TerminalService } from "./terminal-service.js";
 *
 * const service = new TerminalService();
 * const session = service.create("term_001", "/Users/dev/project");
 * service.write("term_001", "ls -la\n");
 * service.destroy("term_001");
 * ```
 */
export class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  /**
   * 创建终端会话
   *
   * 在指定工作目录启动一个新的交互式 Shell 进程。
   * 返回一个 ReadableStream 供调用方读取 Shell 输出。
   *
   * @param id - 终端会话 ID
   * @param cwd - 工作目录
   * @returns Shell stdout ReadableStream，或 null（ID 已存在时）
   *
   * @example
   * ```typescript
   * const stdout = service.create("term_001", "/Users/dev/project");
   * if (stdout) {
   *   const reader = stdout.getReader();
   *   // 读取输出...
   * }
   * ```
   */
  create(id: string, cwd: string): ReadableStream<Uint8Array> | null {
    if (this.sessions.has(id)) {
      logger.warn({ id }, "终端会话已存在");
      return null;
    }

    const shell = process.env.SHELL ?? "/bin/bash";
    const proc = Bun.spawn([shell, "-i"], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLUMNS: "120",
        LINES: "30",
      },
    });

    const session: TerminalSession = {
      id,
      proc,
      cwd,
      createdAt: Date.now(),
    };

    this.sessions.set(id, session);
    logger.info({ id, cwd, pid: proc.pid }, "终端会话已创建");

    return proc.stdout as ReadableStream<Uint8Array>;
  }

  /**
   * 向终端会话写入数据
   *
   * 将用户输入的文本写入对应 Shell 进程的 stdin。
   *
   * @param id - 终端会话 ID
   * @param data - 要写入的文本数据
   *
   * @example
   * ```typescript
   * service.write("term_001", "ls -la\n");
   * ```
   */
  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      logger.warn({ id }, "终端会话不存在");
      return;
    }

    const writer = session.proc.stdin as unknown as WritableStream<Uint8Array>;
    const encoded = new TextEncoder().encode(data);
    const w = writer.getWriter();
    w.write(encoded).then(
      () => w.releaseLock(),
      () => w.releaseLock(),
    );
  }

  /**
   * 销毁终端会话
   *
   * 终止 Shell 进程并清理资源。
   *
   * @param id - 终端会话 ID
   *
   * @example
   * ```typescript
   * service.destroy("term_001");
   * ```
   */
  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    try {
      session.proc.kill();
    } catch {
      // 进程可能已退出
    }

    this.sessions.delete(id);
    logger.info({ id }, "终端会话已销毁");
  }

  /**
   * 检查终端会话是否存在
   *
   * @param id - 终端会话 ID
   * @returns 会话是否存在
   *
   * @example
   * ```typescript
   * if (service.has("term_001")) { ... }
   * ```
   */
  has(id: string): boolean {
    return this.sessions.has(id);
  }

  /**
   * 销毁所有终端会话
   *
   * 在服务关闭时调用，清理所有活跃的终端会话。
   *
   * @example
   * ```typescript
   * service.destroyAll();
   * ```
   */
  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
    logger.info("所有终端会话已销毁");
  }
}
