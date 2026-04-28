#!/usr/bin/env bun

import { runAsk } from "./commands/ask.js";
import { runCancel } from "./commands/cancel.js";
import { runList } from "./commands/list.js";
import { runMemory } from "./commands/memory.js";
import { runResult } from "./commands/result.js";
import { runSpawn } from "./commands/spawn.js";
import { runStatus } from "./commands/status.js";
import { runTicket } from "./commands/ticket.js";
import { runTranscript } from "./commands/transcript.js";
import { TeamslandApiError, TeamslandClient } from "./http-client.js";
import { printError, printLine } from "./output.js";

// ─── Help Text ───

const HELP_TEXT = `teamsland — Worker management CLI for Teamsland Server

Usage:
  teamsland <command> [options]

Commands:
  spawn        Create and start a new Worker
  list         List all Workers
  status <id>  Show detailed status of a Worker
  result <id>  Show the result of a completed Worker
  cancel <id>  Cancel a running Worker
  transcript <id>  Show transcript file path for a Worker
  memory <op>  Manage OpenViking memories (write, read, ls, find, ...)
  ticket status <id> --set <state>  Transition ticket state
  ticket state <id>                 Show ticket state
  ticket enrich <id>                Deep information gathering
  ask --to <user> --ticket <id> --text <msg>  Ask for clarification

Global Options:
  --server <url>  Server URL (default: TEAMSLAND_SERVER env or http://localhost:3001)
  --json          Output in JSON format
  --help          Show this help message

Examples:
  teamsland spawn --task "修复登录页 bug" --repo https://github.com/org/repo
  teamsland list --status running
  teamsland status worker-a1b2c3
  teamsland cancel worker-a1b2c3 --force
  teamsland result worker-a1b2c3 --json
`;

// ─── Arg Parsing ───

/**
 * 解析全局 CLI 参数：--server、--json、命令名和命令参数
 *
 * @example
 * ```typescript
 * const parsed = parseGlobalArgs(["--server", "http://localhost:4000", "--json", "list"]);
 * console.log(parsed.serverUrl);  // "http://localhost:4000"
 * console.log(parsed.jsonOutput); // true
 * console.log(parsed.command);    // "list"
 * ```
 */
function parseGlobalArgs(argv: string[]): {
  serverUrl: string;
  jsonOutput: boolean;
  command: string | undefined;
  commandArgs: string[];
} {
  let serverUrl: string | undefined;
  let jsonOutput = false;
  let command: string | undefined;
  const commandArgs: string[] = [];
  let foundCommand = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (foundCommand) {
      commandArgs.push(arg);
      continue;
    }

    if (arg === "--server" && i + 1 < argv.length) {
      serverUrl = argv[i + 1];
      i++; // skip next
      continue;
    }

    if (arg === "--json") {
      jsonOutput = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printLine(HELP_TEXT);
      process.exit(0);
    }

    // 第一个非 flag 参数即为命令
    command = arg;
    foundCommand = true;
  }

  const resolvedUrl = serverUrl ?? process.env.TEAMSLAND_SERVER ?? "http://localhost:3001";

  return { serverUrl: resolvedUrl, jsonOutput, command, commandArgs };
}

// ─── Main ───

/**
 * CLI 主入口函数
 *
 * 解析命令行参数，分发到对应的命令处理器
 *
 * @example
 * ```typescript
 * // 通常由 bun 直接调用本文件执行
 * // bun run packages/cli/src/index.ts list --json
 * ```
 */
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { serverUrl, jsonOutput, command, commandArgs } = parseGlobalArgs(rawArgs);

  if (!command) {
    printLine(HELP_TEXT);
    process.exit(0);
  }

  const client = new TeamslandClient(serverUrl);

  try {
    switch (command) {
      case "spawn":
        await runSpawn(client, commandArgs, jsonOutput);
        break;
      case "list":
        await runList(client, commandArgs, jsonOutput);
        break;
      case "status":
        await runStatus(client, commandArgs, jsonOutput);
        break;
      case "result":
        await runResult(client, commandArgs, jsonOutput);
        break;
      case "cancel":
        await runCancel(client, commandArgs, jsonOutput);
        break;
      case "transcript":
        await runTranscript(client, commandArgs, jsonOutput);
        break;
      case "memory":
        await runMemory(client, commandArgs, jsonOutput);
        break;
      case "ticket":
        await runTicket(client, commandArgs, jsonOutput);
        break;
      case "ask":
        await runAsk(client, commandArgs, jsonOutput);
        break;
      default:
        printError(`Unknown command: ${command}`);
        printLine(HELP_TEXT);
        process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof TeamslandApiError) {
      if (jsonOutput) {
        process.stdout.write(
          `${JSON.stringify({ error: err.message, status: err.status, body: err.body }, null, 2)}\n`,
        );
      } else {
        printError(err.message);
      }
      process.exit(1);
    }
    throw err;
  }
}

main();
