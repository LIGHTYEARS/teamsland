import type { TeamslandClient } from "../http-client.js";
import { formatTimeAgo, printJson, printLine } from "../output.js";

/**
 * 获取并展示单个 Worker 的详细状态
 *
 * @example
 * ```typescript
 * import { runStatus } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runStatus(client, ["worker-a1b2c3"], false);
 * ```
 */
export async function runStatus(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = getPositionalArg(args);
  if (!workerId) {
    process.stderr.write("Error: worker ID is required\n");
    process.exit(1);
  }

  const detail = await client.getWorker(workerId);

  if (jsonOutput) {
    printJson(detail);
    return;
  }

  printLine(`Worker:    ${detail.workerId}`);
  printLine(`Status:    ${detail.status}`);
  printLine(`PID:       ${detail.pid}`);
  printLine(`Alive:     ${detail.alive ? "yes" : "no"}`);
  printLine(`Session:   ${detail.sessionId}`);
  printLine(`Worktree:  ${detail.worktreePath}`);
  if (detail.taskBrief) {
    printLine(`Task:      ${detail.taskBrief}`);
  }
  printLine(`Created:   ${formatTimeAgo(detail.createdAt)}`);
  if (detail.completedAt) {
    printLine(`Completed: ${formatTimeAgo(detail.completedAt)}`);
  }
  if (detail.result) {
    printLine(`Result:    ${detail.result}`);
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
