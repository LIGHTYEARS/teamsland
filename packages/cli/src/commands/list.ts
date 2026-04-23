import type { TeamslandClient } from "../http-client.js";
import { formatTimeAgo, padEnd, printJson, printLine, truncate } from "../output.js";

/**
 * 列出所有 Worker 并以表格形式展示
 *
 * @example
 * ```typescript
 * import { runList } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runList(client, [], false);
 * ```
 */
export async function runList(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const statusFilter = getFlagValue(args, "--status");
  const resp = await client.listWorkers();

  let { workers } = resp;
  if (statusFilter) {
    workers = workers.filter((w) => w.status === statusFilter);
  }

  if (jsonOutput) {
    printJson({ workers, total: workers.length });
    return;
  }

  if (workers.length === 0) {
    printLine("No workers found.");
    return;
  }

  const header = `${padEnd("ID", 18)}${padEnd("STATUS", 12)}${padEnd("PID", 8)}${padEnd("TASK", 26)}CREATED`;
  printLine(header);

  for (const w of workers) {
    const id = padEnd(truncate(w.workerId, 16), 18);
    const status = padEnd(w.status, 12);
    const pid = padEnd(String(w.pid), 8);
    const task = padEnd(truncate(w.taskBrief ?? "-", 24), 26);
    const created = formatTimeAgo(w.createdAt);
    printLine(`${id}${status}${pid}${task}${created}`);
  }
}

/**
 * 从参数数组中提取指定 flag 的值
 *
 * @example
 * ```typescript
 * const value = getFlagValue(["--status", "running"], "--status");
 * console.log(value); // "running"
 * ```
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) {
    return undefined;
  }
  return args[idx + 1];
}
