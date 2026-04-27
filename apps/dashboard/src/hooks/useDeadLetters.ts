import { useCallback, useEffect, useReducer, useState } from "react";

export interface DeadLetterMessage {
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

export function useDeadLetters(): {
  messages: DeadLetterMessage[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [messages, setMessages] = useState<DeadLetterMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const refresh = useCallback(() => bump(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/queue/dead-letters?limit=50")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: DeadLetterMessage[]) => {
        if (!cancelled) {
          setMessages(data);
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

  return { messages, loading, error, refresh };
}
