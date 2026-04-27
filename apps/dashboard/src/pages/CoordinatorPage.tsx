import { Activity } from "lucide-react";
import { useMemo } from "react";
import { CoordinatorStatusBar } from "../components/coordinator/CoordinatorStatusBar";
import { DeadLetterTable } from "../components/coordinator/DeadLetterTable";
import { EventTimeline } from "../components/coordinator/EventTimeline";
import { QueueDashboard } from "../components/coordinator/QueueDashboard";
import { TicketStateMachine } from "../components/coordinator/TicketStateMachine";
import { useCoordinatorStatus } from "../hooks/useCoordinatorStatus";
import { useDeadLetters } from "../hooks/useDeadLetters";
import { useQueueStats } from "../hooks/useQueueStats";
import { useRecentEvents } from "../hooks/useRecentEvents";
import { useTickets } from "../hooks/useTickets";

export function CoordinatorPage() {
  const { status, lastEventId, lastChangeAt, loading: statusLoading } = useCoordinatorStatus();
  const { stats, loading: statsLoading } = useQueueStats();
  const { messages: deadLetters } = useDeadLetters();
  const { events, loading: eventsLoading } = useRecentEvents();
  const { tickets } = useTickets();

  const activeStates = useMemo(() => {
    const set = new Set<string>();
    for (const t of tickets) set.add(t.state);
    return set;
  }, [tickets]);

  if (status && !status.enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-muted-foreground gap-3">
        <Activity size={48} strokeWidth={1} />
        <h2 className="text-lg font-semibold">Coordinator Not Enabled</h2>
        <p className="text-sm max-w-md text-center">
          The coordinator process is not running. Enable it in your server settings and restart.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Coordinator</h1>
        <p className="text-sm text-muted-foreground">System monitoring dashboard</p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {status && !statusLoading && (
          <CoordinatorStatusBar status={status} lastEventId={lastEventId} lastChangeAt={lastChangeAt} />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Queue</h2>
            {stats && !statsLoading && <QueueDashboard stats={stats} />}
            <DeadLetterTable messages={deadLetters} />
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Events</h2>
            <EventTimeline events={events} loading={eventsLoading} />
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Ticket State Machine
          </h2>
          <div className="border border-border rounded-lg p-4 bg-muted/10">
            <TicketStateMachine activeStates={activeStates} />
          </div>
        </div>
      </div>
    </div>
  );
}
