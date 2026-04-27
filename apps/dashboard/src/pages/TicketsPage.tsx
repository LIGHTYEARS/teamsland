import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { TicketBoard } from "../components/tickets/TicketBoard.js";
import { TicketDetailDrawer } from "../components/tickets/TicketDetailDrawer.js";
import { type PhaseFilter, type SortBy, TicketFilters } from "../components/tickets/TicketFilters.js";
import { useTickets } from "../hooks/useTickets.js";

const PHASE_STATES: Record<string, string[]> = {
  intake: ["received", "enriching"],
  triage: ["triaging", "awaiting_clarification"],
  execution: ["ready", "executing"],
  terminal: ["completed", "failed", "suspended", "skipped"],
};

export function TicketsPage({
  issueId: initialIssueId,
  onNavigate,
}: {
  issueId?: string;
  onNavigate: (path: string) => void;
}) {
  const { tickets, loading, error } = useTickets();
  const [selectedId, setSelectedId] = useState<string | null>(initialIssueId ?? null);
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("updatedAt");

  const filtered = useMemo(() => {
    let result = tickets;
    if (phase !== "all") {
      const allowed = PHASE_STATES[phase] ?? [];
      result = result.filter((t) => allowed.includes(t.state));
    }
    return result.slice().sort((a, b) => {
      if (sortBy === "dwell") return Date.now() - a.updatedAt - (Date.now() - b.updatedAt);
      return b[sortBy] - a[sortBy];
    });
  }, [tickets, phase, sortBy]);

  const handleTicketClick = (id: string) => {
    setSelectedId(id);
    onNavigate(`/tickets/${id}`);
  };

  const handleCloseDrawer = () => {
    setSelectedId(null);
    onNavigate("/tickets");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading..." : error ? error : `${tickets.length} tickets`}
          </p>
        </div>
        <TicketFilters phase={phase} onPhaseChange={setPhase} sortBy={sortBy} onSortChange={setSortBy} />
      </header>

      <div className="flex-1 min-h-0">
        {!loading && tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Inbox size={48} strokeWidth={1} />
            <p className="text-sm">No tickets yet</p>
          </div>
        ) : (
          <TicketBoard tickets={filtered} onTicketClick={handleTicketClick} />
        )}
      </div>

      {selectedId && <TicketDetailDrawer issueId={selectedId} onClose={handleCloseDrawer} />}
    </div>
  );
}
