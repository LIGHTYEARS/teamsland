import type { TicketState } from "./types.js";

export type { TicketState };

export const VALID_TRANSITIONS: ReadonlyMap<TicketState, ReadonlySet<TicketState>> = new Map([
  ["received", new Set<TicketState>(["enriching"])],
  ["enriching", new Set<TicketState>(["triaging"])],
  ["triaging", new Set<TicketState>(["ready", "awaiting_clarification", "skipped"])],
  ["awaiting_clarification", new Set<TicketState>(["triaging", "suspended"])],
  ["ready", new Set<TicketState>(["executing"])],
  ["executing", new Set<TicketState>(["completed", "failed"])],
]);

export function isValidTransition(from: TicketState, to: TicketState): boolean {
  return VALID_TRANSITIONS.get(from)?.has(to) ?? false;
}
