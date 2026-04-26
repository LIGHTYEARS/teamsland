import { describe, expect, it } from "vitest";
import { isValidTransition, type TicketState } from "../transitions.js";

describe("isValidTransition", () => {
  const valid: Array<[TicketState, TicketState]> = [
    ["received", "enriching"],
    ["enriching", "triaging"],
    ["triaging", "ready"],
    ["triaging", "awaiting_clarification"],
    ["triaging", "skipped"],
    ["awaiting_clarification", "triaging"],
    ["awaiting_clarification", "suspended"],
    ["ready", "executing"],
    ["executing", "completed"],
    ["executing", "failed"],
  ];

  for (const [from, to] of valid) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }

  const invalid: Array<[TicketState, TicketState]> = [
    ["received", "executing"],
    ["received", "completed"],
    ["enriching", "ready"],
    ["triaging", "completed"],
    ["awaiting_clarification", "executing"],
    ["ready", "triaging"],
    ["completed", "received"],
    ["skipped", "enriching"],
    ["suspended", "enriching"],
    ["failed", "received"],
  ];

  for (const [from, to] of invalid) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }
});
