/**
 * 命令执行结果
 *
 * 封装子进程退出码、标准输出和标准错误输出。
 *
 * @example
 * ```typescript
 * import type { CommandResult } from "@teamsland/git";
 *
 * const result: CommandResult = { exitCode: 0, stdout: "main\n", stderr: "" };
 * ```
 */
export interface CommandResult {
  /** 进程退出码，0 表示成功 */
  exitCode: number;
  /** 标准输出内容 */
  stdout: string;
  /** 标准错误输出内容 */
  stderr: string;
}

/**
 * 命令执行器接口
 *
 * 抽象子进程调用，允许在测试中注入 mock 实现。
 *
 * @example
 * ```typescript
 * import type { CommandRunner } from "@teamsland/git";
 *
 * const mockRunner: CommandRunner = {
 *   async run(cmd) {
 *     return { exitCode: 0, stdout: "", stderr: "" };
 *   },
 * };
 * ```
 */
export interface CommandRunner {
  /** 执行命令并返回结果 */
  run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult>;
}

/**
 * 基于 Bun.spawn 的命令执行器
 *
 * 生产环境默认实现，通过 `Bun.spawn` 执行 git 子进程。
 *
 * @example
 * ```typescript
 * import { BunCommandRunner } from "@teamsland/git";
 *
 * const runner = new BunCommandRunner();
 * const result = await runner.run(["git", "status"]);
 * console.log(result.stdout);
 * ```
 */
export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    const proc = Bun.spawn(cmd, { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
