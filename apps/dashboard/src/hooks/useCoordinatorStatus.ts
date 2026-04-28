import { useEffect, useReducer, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

export interface CoordinatorStatus {
  enabled: boolean;
  state?: string;
  activeSession?: string | null;
}

interface WsCoordinatorState {
  type: "coordinator_state";
  state: string;
  eventId?: string;
  timestamp: number;
}

export function useCoordinatorStatus(): {
  status: CoordinatorStatus | null;
  lastEventId: string | null;
  lastChangeAt: number | null;
  loading: boolean;
  error: string | null;
} {
  const { subscribe } = useWebSocket();
  const [status, setStatus] = useState<CoordinatorStatus | null>(null);
  const [lastEventId, setLastEventId] = useState<string | null>(null);
  const [lastChangeAt, setLastChangeAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version counter triggers re-fetch
  useEffect(() => {
    let cancelled = false;
    fetch("/api/coordinator/status")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CoordinatorStatus) => {
        if (!cancelled) {
          setStatus(data);
          setLastChangeAt(Date.now());
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
      if (msg.type === "coordinator_state") {
        const ws = msg as unknown as WsCoordinatorState;
        setStatus((prev) => ({
          enabled: prev?.enabled ?? true,
          state: ws.state,
          activeSession: prev?.activeSession,
        }));
        setLastEventId(ws.eventId ?? null);
        setLastChangeAt(ws.timestamp);
      }
    });
  }, [subscribe]);

  return { status, lastEventId, lastChangeAt, loading, error };
}
