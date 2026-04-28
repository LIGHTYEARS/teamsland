import { useCallback, useEffect, useReducer, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

interface TicketHistoryEntry {
  from: string;
  to: string;
  timestamp: number;
}

export interface TicketRecord {
  issueId: string;
  state: string;
  eventId: string;
  eventType: string;
  context: string | null;
  history: TicketHistoryEntry[];
  updatedAt: number;
  createdAt: number;
}

interface WsTicketUpdate {
  type: "ticket_update";
  ticketId: string;
  state: string;
  previousState: string;
  updatedAt: number;
}

export function useTickets(): {
  tickets: TicketRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const { subscribe } = useWebSocket();
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const refresh = useCallback(() => bump(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version counter triggers re-fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/tickets?limit=200")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TicketRecord[]) => {
        if (!cancelled) {
          setTickets(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "connected") {
        bump();
      }
      if (msg.type === "ticket_update") {
        const update = msg as unknown as WsTicketUpdate;
        setTickets((prev) => {
          const idx = prev.findIndex((t) => t.issueId === update.ticketId);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              state: update.state,
              updatedAt: update.updatedAt,
            };
            return updated;
          }
          bump();
          return prev;
        });
      }
    });
  }, [subscribe]);

  return { tickets, loading, error, refresh };
}
