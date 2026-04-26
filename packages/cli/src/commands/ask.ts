import type { TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

export function parseAskArgs(args: string[]): { to: string; ticketId: string; text: string } | { error: string } {
  let to: string | undefined;
  let ticketId: string | undefined;
  let text: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--to" && i + 1 < args.length) {
      to = args[++i];
    } else if (args[i] === "--ticket" && i + 1 < args.length) {
      ticketId = args[++i];
    } else if (args[i] === "--text" && i + 1 < args.length) {
      text = args[++i];
    }
  }

  if (!to) return { error: "Missing --to <user>. Usage: teamsland ask --to <user> --ticket <id> --text <msg>" };
  if (!ticketId) return { error: "Missing --ticket <id>." };
  if (!text) return { error: "Missing --text <msg>." };

  return { to, ticketId, text };
}

export async function runAsk(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const parsed = parseAskArgs(args);
  if ("error" in parsed) {
    printError(parsed.error);
    process.exit(1);
  }

  const result = await client.ask(parsed.to, parsed.ticketId, parsed.text);
  if (jsonOutput) {
    printJson(result);
  } else {
    printLine(`Asked ${parsed.to} about ${parsed.ticketId} — awaiting clarification`);
  }
}
