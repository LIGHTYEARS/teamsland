import type { Database } from "bun:sqlite";
import { isValidTransition } from "./transitions.js";
import type { TicketHistoryEntry, TicketRecord, TicketState } from "./types.js";

export class TicketStore {
  constructor(private readonly db: Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ticket_states (
        issue_id    TEXT PRIMARY KEY,
        state       TEXT NOT NULL DEFAULT 'received',
        event_id    TEXT NOT NULL,
        event_type  TEXT NOT NULL DEFAULT 'unknown',
        context     TEXT,
        history     TEXT NOT NULL DEFAULT '[]',
        updated_at  INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ticket_state ON ticket_states(state)`);

    // Migration: add columns if table already exists without them
    try {
      this.db.run("ALTER TABLE ticket_states ADD COLUMN event_type TEXT NOT NULL DEFAULT 'unknown'");
    } catch {
      /* column exists */
    }
    try {
      this.db.run("ALTER TABLE ticket_states ADD COLUMN history TEXT NOT NULL DEFAULT '[]'");
    } catch {
      /* column exists */
    }
  }

  create(issueId: string, eventId: string, eventType = "unknown"): void {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO ticket_states (issue_id, state, event_id, event_type, context, history, updated_at, created_at)
       VALUES (?, 'received', ?, ?, NULL, '[]', ?, ?)`,
      [issueId, eventId, eventType, now, now],
    );
  }

  get(issueId: string): TicketRecord | null {
    const row = this.db
      .query(
        "SELECT issue_id, state, event_id, event_type, context, history, updated_at, created_at FROM ticket_states WHERE issue_id = ?",
      )
      .get(issueId) as Record<string, unknown> | null;
    if (!row) return null;
    return this.mapRow(row);
  }

  private mapRow(row: Record<string, unknown>): TicketRecord {
    return {
      issueId: row.issue_id as string,
      state: row.state as TicketState,
      eventId: row.event_id as string,
      eventType: (row.event_type as string) ?? "unknown",
      context: row.context as string | null,
      history: JSON.parse((row.history as string) ?? "[]") as TicketHistoryEntry[],
      updatedAt: row.updated_at as number,
      createdAt: row.created_at as number,
    };
  }

  transition(issueId: string, to: TicketState): { ok: true } | { ok: false; error: string } {
    const record = this.get(issueId);
    if (!record) {
      return { ok: false, error: `Ticket ${issueId} not found` };
    }
    if (!isValidTransition(record.state, to)) {
      return { ok: false, error: `Invalid transition: ${record.state} → ${to}` };
    }
    const now = Date.now();
    const entry: TicketHistoryEntry = { from: record.state, to, timestamp: now };
    const newHistory = JSON.stringify([...record.history, entry]);
    this.db.run("UPDATE ticket_states SET state = ?, history = ?, updated_at = ? WHERE issue_id = ?", [
      to,
      newHistory,
      now,
      issueId,
    ]);
    return { ok: true };
  }

  updateContext(issueId: string, context: string): void {
    this.db.run("UPDATE ticket_states SET context = ?, updated_at = ? WHERE issue_id = ?", [
      context,
      Date.now(),
      issueId,
    ]);
  }

  listByState(state: TicketState): TicketRecord[] {
    const rows = this.db
      .query(
        "SELECT issue_id, state, event_id, event_type, context, history, updated_at, created_at FROM ticket_states WHERE state = ?",
      )
      .all(state) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapRow(row));
  }
}
