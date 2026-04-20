/**
 * 命令执行结果
 *
 * @example
 * ```typescript
 * import type { CommandResult } from "@teamsland/lark";
 *
 * const result: CommandResult = { exitCode: 0, stdout: "ok", stderr: "" };
 * ```
 */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 命令运行器接口，用于抽象子进程调用
 *
 * 通过依赖注入实现测试时替换为 mock 实现
 *
 * @example
 * ```typescript
 * import type { CommandRunner } from "@teamsland/lark";
 *
 * const mockRunner: CommandRunner = {
 *   run: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
 * };
 * ```
 */
export interface CommandRunner {
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult>;
}

/**
 * 基于 Bun.spawn 的命令运行器实现
 *
 * 生产环境使用，通过 Bun.spawn 执行外部命令
 *
 * @example
 * ```typescript
 * import { BunCommandRunner } from "@teamsland/lark";
 *
 * const runner = new BunCommandRunner();
 * const result = await runner.run(["echo", "hello"]);
 * console.log(result.stdout); // "hello\n"
 * ```
 */
export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult> {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...opts?.env },
    });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
