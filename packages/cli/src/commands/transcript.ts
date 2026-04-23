import type { TeamslandClient } from "../http-client.js";
import { printJson, printLine } from "../output.js";

/**
 * 获取 Worker 的转录文件路径信息
 *
 * @example
 * ```typescript
 * import { runTranscript } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runTranscript(client, ["worker-a1b2c3"], false);
 * ```
 */
export async function runTranscript(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = getPositionalArg(args);
  if (!workerId) {
    process.stderr.write("Error: worker ID is required\n");
    process.exit(1);
  }

  const resp = await client.getTranscript(workerId);

  if (jsonOutput) {
    printJson(resp);
    return;
  }

  if (resp.exists) {
    printLine(resp.transcriptPath);
  } else {
    printLine(`Transcript not found (expected: ${resp.transcriptPath})`);
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
