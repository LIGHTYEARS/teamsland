import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Sheet } from "@teamsland/ui/components/ui/sheet";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Inbox } from "lucide-react";
import { useMemo, useState } from "react";
import { TicketBoard } from "../components/tickets/TicketBoard.js";
import { TicketDetailDrawer } from "../components/tickets/TicketDetailDrawer.js";
import {
  type PhaseFilter,
  type PriorityFilter,
  type SortBy,
  TicketFilters,
} from "../components/tickets/TicketFilters.js";
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
  const [priority, setPriority] = useState<PriorityFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("updatedAt");

  const filtered = useMemo(() => {
    let result = tickets;
    if (phase !== "all") {
      const allowed = PHASE_STATES[phase] ?? [];
      result = result.filter((t) => allowed.includes(t.state));
    }
    if (priority !== "all") {
      result = result.filter((t) => {
        if (!t.context) return false;
        try {
          const ctx = JSON.parse(t.context) as { basic?: { priority?: string } };
          return ctx.basic?.priority?.toLowerCase() === priority;
        } catch {
          return false;
        }
      });
    }
    return result.slice().sort((a, b) => {
      if (sortBy === "dwell") return Date.now() - a.updatedAt - (Date.now() - b.updatedAt);
      return b[sortBy] - a[sortBy];
    });
  }, [tickets, phase, priority, sortBy]);

  const handleTicketClick = (id: string) => {
    setSelectedId(id);
    onNavigate(`/tickets/${id}`);
  };

  const handleCloseDrawer = () => {
    setSelectedId(null);
    onNavigate("/tickets");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      <header className="shrink-0 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">工单</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "加载中..." : error ? error : `${tickets.length} 个工单`}
          </p>
        </div>
        <TicketFilters
          phase={phase}
          onPhaseChange={setPhase}
          priority={priority}
          onPriorityChange={setPriority}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </header>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex h-full gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton columns
              <div key={i} className="flex flex-1 flex-col bg-card rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-[3px] rounded-full" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-5 w-6 rounded-full" />
                </div>
                <div className="p-2 space-y-2">
                  {Array.from({ length: 2 }).map((_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton sections
                    <div key={j} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1.5 py-1">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-4 rounded-full" />
                      </div>
                      <Skeleton className="h-20 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col items-center w-12 shrink-0 bg-card rounded-lg pt-3 pb-4">
              <Skeleton className="w-[3px] h-4 rounded-full mb-2" />
              <Skeleton className="h-3 w-3 rounded mb-1" />
              <Skeleton className="h-16 w-3 rounded" />
              <Skeleton className="h-4 w-5 rounded-full mt-2" />
            </div>
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<Inbox size={48} strokeWidth={1} />}
            title="暂无工单"
            description="工单将在 Meego 事件触发后自动创建"
            className="h-full"
          />
        ) : (
          <TicketBoard tickets={filtered} onTicketClick={handleTicketClick} />
        )}
      </div>

      <Sheet
        open={!!selectedId}
        onOpenChange={(open) => {
          if (!open) handleCloseDrawer();
        }}
      >
        {selectedId && <TicketDetailDrawer issueId={selectedId} />}
      </Sheet>
    </div>
  );
}
