import { useCallback, useEffect, useReducer, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

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
  const { subscribe } = useWebSocket();
  const [messages, setMessages] = useState<DeadLetterMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const refresh = useCallback(() => bump(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version counter triggers re-fetch
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

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "connected") bump();
    });
  }, [subscribe]);

  return { messages, loading, error, refresh };
}
