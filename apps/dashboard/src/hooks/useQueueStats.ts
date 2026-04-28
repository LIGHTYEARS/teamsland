import { useCallback, useEffect, useReducer, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead: number;
}

export function useQueueStats(pollIntervalMs = 10000): {
  stats: QueueStats | null;
  loading: boolean;
  error: string | null;
} {
  const { subscribe } = useWebSocket();
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const fetchStats = useCallback(() => {
    fetch("/api/queue/stats")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: QueueStats) => {
        setStats(data);
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
    fetchStats();
    const timer = setInterval(fetchStats, pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchStats, pollIntervalMs, version]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "queue_update" || msg.type === "connected") {
        bump();
      }
    });
  }, [subscribe]);

  return { stats, loading, error };
}
