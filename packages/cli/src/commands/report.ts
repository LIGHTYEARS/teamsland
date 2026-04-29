import type { TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

export async function runReport(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help") {
    printLine(`Usage:
  teamsland report progress <worker-id> --phase <phase> --summary <summary> [--details <details>]
  teamsland report result <worker-id> --status <success|failed|blocked> --summary <summary> [--artifacts <json>]`);
    return;
  }

  switch (subcommand) {
    case "progress":
      await runReportProgress(client, args.slice(1), jsonOutput);
      break;
    case "result":
      await runReportResult(client, args.slice(1), jsonOutput);
      break;
    default:
      printError(`Unknown report subcommand: ${subcommand}`);
      process.exit(1);
  }
}

async function runReportProgress(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = args[0];
  if (!workerId || workerId.startsWith("--")) {
    printError("worker-id is required");
    process.exit(1);
  }

  const phase = getFlagValue(args, "--phase");
  const summary = getFlagValue(args, "--summary");
  const details = getFlagValue(args, "--details");

  if (!phase) {
    printError("--phase is required");
    process.exit(1);
  }
  if (!summary) {
    printError("--summary is required");
    process.exit(1);
  }

  const resp = await client.reportProgress(workerId, { phase, summary, details });

  if (jsonOutput) {
    printJson(resp);
    return;
  }

  printLine(`Progress reported: ${phase}`);
}

async function runReportResult(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const workerId = args[0];
  if (!workerId || workerId.startsWith("--")) {
    printError("worker-id is required");
    process.exit(1);
  }

  const status = getFlagValue(args, "--status");
  const summary = getFlagValue(args, "--summary");
  const artifactsStr = getFlagValue(args, "--artifacts");

  if (!status) {
    printError("--status is required (success | failed | blocked)");
    process.exit(1);
  }
  if (!summary) {
    printError("--summary is required");
    process.exit(1);
  }

  let artifacts: Record<string, unknown> | undefined;
  if (artifactsStr) {
    try {
      artifacts = JSON.parse(artifactsStr) as Record<string, unknown>;
    } catch {
      printError("--artifacts must be valid JSON");
      process.exit(1);
    }
  }

  const resp = await client.reportResult(workerId, {
    status: status as "success" | "failed" | "blocked",
    summary,
    artifacts,
  });

  if (jsonOutput) {
    printJson(resp);
    return;
  }

  printLine(`Result reported: ${status}`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) {
    return undefined;
  }
  return args[idx + 1];
}
