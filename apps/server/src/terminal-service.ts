// @teamsland/server — 终端会话管理服务（基于 Bun 原生 PTY）
// 管理通过 WebSocket 连接的交互式 Shell 会话

import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:terminal");

/**
 * PTY 终端会话创建选项
 *
 * @example
 * ```typescript
 * const options: TerminalCreateOptions = {
 *   cols: 120,
 *   rows: 30,
 *   onData: (data) => ws.send(data),
 *   onExit: () => console.log("终端已退出"),
 * };
 * ```
 */
interface TerminalCreateOptions {
  /** 终端列数 */
  cols?: number;
  /** 终端行数 */
  rows?: number;
  /** PTY 输出数据回调 */
  onData: (data: Uint8Array) => void;
  /** PTY 退出回调 */
  onExit?: () => void;
}

/**
 * 终端会话
 *
 * 封装一个通过 Bun PTY 创建的交互式 Shell 子进程。
 *
 * @example
 * ```typescript
 * import type { TerminalSession } from "./terminal-service.js";
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
 * 终端服务（Bun 原生 PTY）
 *
 * 管理多个终端会话的生命周期。每个终端会话通过 Bun.spawn 的 `terminal` 选项
 * 启动一个真正的 PTY 交互式 Shell 进程，支持完整的终端语义：颜色、readline、
 * tab 补全、交互式程序（vim、less 等）。
 *
 * @example
 * ```typescript
 * import { TerminalService } from "./terminal-service.js";
 *
 * const service = new TerminalService();
 * service.create("term_001", "/Users/dev/project", {
 *   onData: (data) => ws.send(data),
 *   onExit: () => console.log("退出"),
 * });
 * service.write("term_001", "ls -la\n");
 * service.resize("term_001", 100, 40);
 * service.destroy("term_001");
 * ```
 */
export class TerminalService {
  private sessions = new Map<string, TerminalSession>();

  /**
   * 创建终端会话（PTY 模式）
   *
   * 在指定工作目录启动一个新的交互式 Shell 进程。通过 Bun 原生 PTY 支持
   * 提供完整的终端体验，输出通过回调异步推送。
   *
   * @param id - 终端会话 ID
   * @param cwd - 工作目录
   * @param options - PTY 创建选项（列/行数、数据回调）
   * @returns 是否创建成功
   *
   * @example
   * ```typescript
   * const ok = service.create("term_001", "/Users/dev/project", {
   *   cols: 120,
   *   rows: 30,
   *   onData: (data) => console.log(new TextDecoder().decode(data)),
   * });
   * ```
   */
  create(id: string, cwd: string, options: TerminalCreateOptions): boolean {
    if (this.sessions.has(id)) {
      logger.warn({ id }, "终端会话已存在");
      return false;
    }

    const shell = process.env.SHELL ?? "/bin/bash";
    const proc = Bun.spawn([shell], {
      cwd,
      terminal: {
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
        name: "xterm-256color",
        data: (_terminal, data) => {
          options.onData(data);
        },
        exit: () => {
          options.onExit?.();
        },
      },
      env: {
        ...process.env,
      },
    });

    const session: TerminalSession = {
      id,
      proc,
      cwd,
      createdAt: Date.now(),
    };

    this.sessions.set(id, session);
    logger.info({ id, cwd, pid: proc.pid }, "终端会话已创建（PTY 模式）");

    return true;
  }

  /**
   * 向终端会话写入数据
   *
   * 将用户输入的文本通过 PTY 写入对应 Shell 进程。
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

    const terminal = session.proc.terminal;
    if (!terminal) {
      logger.warn({ id }, "终端 PTY 不可用");
      return;
    }
    terminal.write(data);
  }

  /**
   * 调整终端尺寸
   *
   * 通知 PTY 更新终端窗口大小。前端在浏览器窗口 resize 时调用此方法，
   * 确保终端程序（vim、htop 等）正确感知窗口变化。
   *
   * @param id - 终端会话 ID
   * @param cols - 列数
   * @param rows - 行数
   *
   * @example
   * ```typescript
   * service.resize("term_001", 100, 40);
   * ```
   */
  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;

    const terminal = session.proc.terminal;
    if (!terminal) return;

    terminal.resize(cols, rows);
    logger.debug({ id, cols, rows }, "终端尺寸已调整");
  }

  /**
   * 销毁终端会话
   *
   * 关闭 PTY 并终止 Shell 进程，清理资源。
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
      session.proc.terminal?.close();
    } catch {
      // PTY 可能已关闭
    }
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
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      this.destroy(id);
    }
    logger.info("所有终端会话已销毁");
  }
}
