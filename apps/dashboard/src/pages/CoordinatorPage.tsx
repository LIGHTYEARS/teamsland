import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Activity } from "lucide-react";
import { useMemo } from "react";
import { ErrorBoundary } from "react-error-boundary";
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
        <h2 className="text-lg font-semibold">协调器未启用</h2>
        <p className="text-sm max-w-md text-center">协调器进程未运行，请在服务器配置中启用并重启服务。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-muted/40">
      <header className="shrink-0 px-6 py-4">
        <h1 className="text-xl font-semibold">协调器</h1>
        <p className="text-sm text-muted-foreground">系统监控仪表盘</p>
      </header>

      <div className="flex-1 p-6 space-y-4">
        {statusLoading ? (
          <Skeleton className="h-12 w-full rounded-lg" />
        ) : status ? (
          <CoordinatorStatusBar status={status} lastEventId={lastEventId} lastChangeAt={lastChangeAt} />
        ) : null}

        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">队列</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ErrorBoundary
              fallbackRender={({ error, resetErrorBoundary }) => (
                <ErrorCard title="队列加载失败" message={(error as Error).message} onRetry={resetErrorBoundary} />
              )}
            >
              <div>
                {statsLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-6 w-32" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
                ) : stats ? (
                  <QueueDashboard stats={stats} />
                ) : null}
              </div>
            </ErrorBoundary>
            <ErrorBoundary
              fallbackRender={({ error, resetErrorBoundary }) => (
                <ErrorCard title="失败消息加载失败" message={(error as Error).message} onRetry={resetErrorBoundary} />
              )}
            >
              <DeadLetterTable messages={deadLetters} />
            </ErrorBoundary>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">最近事件</h2>
          <ErrorBoundary
            fallbackRender={({ error, resetErrorBoundary }) => (
              <ErrorCard title="事件加载失败" message={(error as Error).message} onRetry={resetErrorBoundary} />
            )}
          >
            {eventsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders, no reordering
                  <Skeleton key={i} className="h-10 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <EventTimeline events={events} loading={false} />
            )}
          </ErrorBoundary>
        </div>

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">工单状态机</h2>
          <div className="rounded-lg p-4 bg-card">
            <TicketStateMachine activeStates={activeStates} />
          </div>
        </div>
      </div>
    </div>
  );
}
