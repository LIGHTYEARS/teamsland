import type { CoordinatorStatus } from "../../hooks/useCoordinatorStatus";

const STATE_STYLES: Record<string, { color: string; pulse: boolean }> = {
  idle: { color: "bg-gray-500", pulse: false },
  spawning: { color: "bg-blue-500", pulse: true },
  running: { color: "bg-green-500", pulse: true },
  recovery: { color: "bg-orange-500", pulse: true },
  failed: { color: "bg-red-500", pulse: false },
};

function formatRelative(ts: number | null): string {
  if (!ts) return "\u2014";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function CoordinatorStatusBar({
  status,
  lastEventId,
  lastChangeAt,
}: {
  status: CoordinatorStatus;
  lastEventId: string | null;
  lastChangeAt: number | null;
}) {
  const state = status.state ?? "unknown";
  const style = STATE_STYLES[state] ?? { color: "bg-gray-500", pulse: false };

  return (
    <div className="flex items-center gap-6 rounded-lg border border-border p-4">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className={`w-3 h-3 rounded-full ${style.color}`} />
          {style.pulse && (
            <div className={`absolute inset-0 w-3 h-3 rounded-full ${style.color} animate-ping opacity-50`} />
          )}
        </div>
        <div>
          <span className="text-lg font-semibold capitalize">{state}</span>
          <p className="text-xs text-muted-foreground">Coordinator state</p>
        </div>
      </div>

      <div>
        <span className="text-sm font-mono">{status.activeSession ?? "\u2014"}</span>
        <p className="text-xs text-muted-foreground">Active session</p>
      </div>

      {lastEventId && (
        <div>
          <span className="text-sm font-mono">{lastEventId}</span>
          <p className="text-xs text-muted-foreground">Last event</p>
        </div>
      )}

      <div>
        <span className="text-sm">{formatRelative(lastChangeAt)}</span>
        <p className="text-xs text-muted-foreground">Last state change</p>
      </div>
    </div>
  );
}
