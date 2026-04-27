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
  write(data: string | Uint8Array): number | undefined;
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
    const cliArgs = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", ...this.args];

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
    this.proc.stdin.write(`${msg}\n`);
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
    } catch {
      /* stdin may already be closed */
    }
    try {
      await Promise.race([
        this.proc.exited,
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error("terminate timeout")), 5000)),
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
    const proc = this.proc;
    if (!proc) return;
    const reader = proc.stdout.getReader();
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
    const proc = this.proc;
    if (!proc) return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    const read = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const text = decoder.decode(value, { stream: true }).trim();
          if (text) logger.debug({ stderr: text.slice(0, 500), sessionId: this.sessionId }, "CLI stderr");
        }
      } catch {
        /* ignore */
      }
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
