import { useCallback, useEffect, useReducer, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

export interface RecentEvent {
  id: string;
  type: string;
  payload: unknown;
  priority: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

export function useRecentEvents(pollIntervalMs = 10000): {
  events: RecentEvent[];
  loading: boolean;
  error: string | null;
} {
  const { subscribe } = useWebSocket();
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const fetchEvents = useCallback(() => {
    fetch("/api/queue/recent?limit=20")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: RecentEvent[]) => {
        setEvents(data);
        setError(null);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version counter triggers re-fetch
  useEffect(() => {
    fetchEvents();
    const timer = setInterval(fetchEvents, pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchEvents, pollIntervalMs, version]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "queue_update" || msg.type === "connected") {
        bump();
      }
    });
  }, [subscribe]);

  return { events, loading, error };
}
