import { describe, expect, it } from "vitest";
import { parseTicketArgs } from "../commands/ticket.js";

describe("parseTicketArgs", () => {
  it("parses 'status ISSUE-1 --set enriching'", () => {
    const result = parseTicketArgs(["status", "ISSUE-1", "--set", "enriching"]);
    expect(result).toEqual({ subcommand: "status", issueId: "ISSUE-1", setState: "enriching" });
  });

  it("parses 'state ISSUE-1'", () => {
    const result = parseTicketArgs(["state", "ISSUE-1"]);
    expect(result).toEqual({ subcommand: "state", issueId: "ISSUE-1" });
  });

  it("parses 'enrich ISSUE-1'", () => {
    const result = parseTicketArgs(["enrich", "ISSUE-1"]);
    expect(result).toEqual({ subcommand: "enrich", issueId: "ISSUE-1" });
  });

  it("returns error for missing subcommand", () => {
    const result = parseTicketArgs([]);
    expect(result).toEqual({ error: "Missing subcommand. Usage: teamsland ticket <status|state|enrich> <issue-id>" });
  });

  it("returns error for missing issue-id", () => {
    const result = parseTicketArgs(["status"]);
    expect(result).toEqual({ error: "Missing issue-id. Usage: teamsland ticket status <issue-id> --set <state>" });
  });
});
