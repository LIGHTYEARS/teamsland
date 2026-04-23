import type { TeamslandClient } from "../http-client.js";
import { printJson, printLine } from "../output.js";

/**
 * 获取 Worker 的执行结果
 *
 * @example
 * ```typescript
 * import { runResult } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runResult(client, ["worker-a1b2c3"], false);
 * ```
 */
export async function runResult(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = getPositionalArg(args);
  if (!workerId) {
    process.stderr.write("Error: worker ID is required\n");
    process.exit(1);
  }

  const detail = await client.getWorker(workerId);

  if (jsonOutput) {
    printJson({ workerId: detail.workerId, result: detail.result ?? null });
    return;
  }

  if (detail.result) {
    printLine(detail.result);
  } else {
    printLine("No result yet");
  }
}

/**
 * 从参数数组中获取第一个非 flag 位置参数
 *
 * @example
 * ```typescript
 * const id = getPositionalArg(["worker-abc"]);
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
