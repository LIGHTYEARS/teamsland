import { useEffect, useState } from "react";

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
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchEvents = () => {
      fetch("/api/queue/recent?limit=20")
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: RecentEvent[]) => {
          if (!cancelled) {
            setEvents(data);
            setError(null);
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    fetchEvents();
    const timer = setInterval(fetchEvents, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return { events, loading, error };
}
