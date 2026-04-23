import type { CreateWorkerRequest, TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

/**
 * 解析 spawn 命令的参数并创建 Worker
 *
 * @example
 * ```typescript
 * import { runSpawn } from "@teamsland/cli";
 * import { TeamslandClient } from "@teamsland/cli";
 *
 * const client = new TeamslandClient("http://localhost:3000");
 * await runSpawn(client, ["--task", "修复 bug", "--repo", "https://github.com/org/repo"], false);
 * ```
 */
export async function runSpawn(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const task = getFlagValue(args, "--task");
  const repo = getFlagValue(args, "--repo");
  const worktree = getFlagValue(args, "--worktree");
  const taskBrief = getFlagValue(args, "--task-brief");
  const parentAgentId = getFlagValue(args, "--parent");
  const originChat = getFlagValue(args, "--origin-chat");
  const originSender = getFlagValue(args, "--origin-sender");

  if (!task) {
    printError("--task is required");
    process.exit(1);
  }

  if (!repo && !worktree) {
    printError("one of --repo or --worktree is required");
    process.exit(1);
  }

  const params: CreateWorkerRequest = { task };

  if (repo) {
    params.repo = repo;
  }
  if (worktree) {
    params.worktree = worktree;
  }
  if (taskBrief) {
    params.taskBrief = taskBrief;
  }
  if (parentAgentId) {
    params.parentAgentId = parentAgentId;
  }
  if (originChat || originSender) {
    params.origin = {
      chatId: originChat ?? undefined,
      senderId: originSender ?? undefined,
      source: "coordinator",
    };
  }

  const resp = await client.spawnWorker(params);

  if (jsonOutput) {
    printJson(resp);
    return;
  }

  printLine(`Worker ${resp.workerId} spawned (PID ${resp.pid})`);
  printLine(`Worktree: ${resp.worktreePath}`);
}

/**
 * 从参数数组中提取指定 flag 的值
 *
 * @example
 * ```typescript
 * const value = getFlagValue(["--task", "hello"], "--task");
 * console.log(value); // "hello"
 * ```
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) {
    return undefined;
  }
  return args[idx + 1];
}
