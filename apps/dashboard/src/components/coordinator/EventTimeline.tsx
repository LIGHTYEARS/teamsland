import { Badge } from "@teamsland/ui/components/ui/badge";
import { Card } from "@teamsland/ui/components/ui/card";
import { CheckCircle, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useState } from "react";
import type { RecentEvent } from "../../hooks/useRecentEvents";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function EventTimeline({ events, loading }: { events: RecentEvent[]; loading: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading && events.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading events...</p>;
  }

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No recent events</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((evt) => {
        const isExpanded = expandedId === evt.id;
        const isSuccess = evt.status === "completed";
        return (
          <Card key={evt.id} className="p-0">
            <button
              type="button"
              onClick={() => setExpandedId(isExpanded ? null : evt.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/30 transition-colors"
            >
              <span className="flex-1 text-sm font-mono">{evt.type}</span>
              <Badge variant="outline" className="text-[10px]">
                {evt.priority}
              </Badge>
              {isSuccess ? (
                <CheckCircle size={14} className="text-green-500" />
              ) : (
                <XCircle size={14} className="text-red-500" />
              )}
              <span className="text-xs text-muted-foreground w-16 text-right">{formatRelative(evt.updatedAt)}</span>
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {isExpanded && (
              <div className="border-t border-border px-3 py-2 bg-muted/30">
                <pre className="text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
                  {JSON.stringify(evt.payload, null, 2)}
                </pre>
                {evt.lastError && <p className="text-xs text-red-500 mt-2">Error: {evt.lastError}</p>}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
