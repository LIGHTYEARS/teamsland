export const TICKET_STATES = [
  "received",
  "enriching",
  "triaging",
  "awaiting_clarification",
  "ready",
  "skipped",
  "executing",
  "completed",
  "failed",
  "suspended",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

export interface TicketRecord {
  issueId: string;
  state: TicketState;
  eventId: string;
  context: string | null; // JSON string
  updatedAt: number; // Unix ms
  createdAt: number; // Unix ms
}

export interface EnrichResult {
  issueId: string;
  basic: {
    title: string;
    status: string | undefined;
    priority: string | undefined;
    assignee: string | undefined;
    creator: string | undefined;
  };
  description: string | null;
  documents: Array<{
    url: string;
    fieldKey: string;
    content: string | null;
    ok: boolean;
    error?: string;
  }>;
  customFields: Array<{
    fieldKey: string;
    fieldName: string;
    value: unknown;
  }>;
}
