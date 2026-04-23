import type { TeamslandClient } from "../http-client.js";
import { printJson, printLine } from "../output.js";

/**
 * 取消一个正在运行的 Worker
 *
 * @example
 * ```typescript
 * import { runCancel } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runCancel(client, ["worker-a1b2c3"], false);
 * ```
 */
export async function runCancel(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = getPositionalArg(args);
  if (!workerId) {
    process.stderr.write("Error: worker ID is required\n");
    process.exit(1);
  }

  const force = args.includes("--force");
  const resp = await client.cancelWorker(workerId, force);

  if (jsonOutput) {
    printJson(resp);
    return;
  }

  printLine(`Worker ${resp.workerId} cancelled (signal: ${resp.signal})`);
}

/**
 * 从参数数组中获取第一个非 flag 位置参数
 *
 * @example
 * ```typescript
 * const id = getPositionalArg(["worker-abc", "--force"]);
 * console.log(id); // "worker-abc"
 * ```
 */
function getPositionalArg(args: string[]): string | undefined {
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      return arg;
    }
  }
  return undefined;
}
