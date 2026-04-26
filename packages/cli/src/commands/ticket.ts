import type { TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

type ParsedArgs =
  | { subcommand: "status"; issueId: string; setState: string }
  | { subcommand: "state"; issueId: string }
  | { subcommand: "enrich"; issueId: string }
  | { error: string };

export function parseTicketArgs(args: string[]): ParsedArgs {
  const subcommand = args[0];
  if (!subcommand) {
    return { error: "Missing subcommand. Usage: teamsland ticket <status|state|enrich> <issue-id>" };
  }

  const issueId = args[1];

  if (subcommand === "status") {
    if (!issueId) return { error: "Missing issue-id. Usage: teamsland ticket status <issue-id> --set <state>" };
    const setIdx = args.indexOf("--set");
    const setState = setIdx >= 0 ? args[setIdx + 1] : undefined;
    if (!setState) return { error: "Missing --set <state>. Usage: teamsland ticket status <issue-id> --set <state>" };
    return { subcommand: "status", issueId, setState };
  }

  if (subcommand === "state") {
    if (!issueId) return { error: "Missing issue-id. Usage: teamsland ticket state <issue-id>" };
    return { subcommand: "state", issueId };
  }

  if (subcommand === "enrich") {
    if (!issueId) return { error: "Missing issue-id. Usage: teamsland ticket enrich <issue-id>" };
    return { subcommand: "enrich", issueId };
  }

  return { error: `Unknown subcommand: ${subcommand}. Available: status, state, enrich` };
}

export async function runTicket(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const parsed = parseTicketArgs(args);
  if ("error" in parsed) {
    printError(parsed.error);
    process.exit(1);
  }

  switch (parsed.subcommand) {
    case "state": {
      const result = await client.getTicketState(parsed.issueId);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(`Ticket ${result.issueId}: ${result.state}`);
      }
      break;
    }
    case "status": {
      const result = await client.transitionTicket(parsed.issueId, parsed.setState);
      if (jsonOutput) {
        printJson(result);
      } else if (result.ok) {
        printLine(`Ticket ${parsed.issueId} → ${parsed.setState}`);
      } else {
        printError(result.error ?? "Transition failed");
        process.exit(1);
      }
      break;
    }
    case "enrich": {
      const result = await client.enrichTicket(parsed.issueId, "", "story");
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(`Enrichment complete for ${parsed.issueId}`);
        printJson(result);
      }
      break;
    }
  }
}
