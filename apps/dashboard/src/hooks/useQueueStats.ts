import { useEffect, useState } from "react";

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
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = () => {
      fetch("/api/queue/stats")
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: QueueStats) => {
          if (!cancelled) {
            setStats(data);
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

    fetchStats();
    const timer = setInterval(fetchStats, pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pollIntervalMs]);

  return { stats, loading, error };
}
