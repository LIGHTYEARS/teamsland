import type { SessionRow } from "@teamsland/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

export interface SessionListFilters {
  type?: string;
  source?: string;
  status?: string;
  search?: string;
}

export function useSessionListStore(filters: SessionListFilters = {}): {
  sessions: SessionRow[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  refresh: () => void;
  loadMore: () => void;
} {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const { subscribe } = useWebSocket();
  const offsetRef = useRef(0);
  const fetchVersionRef = useRef(0);

  const fetchSessions = useCallback(
    (append = false) => {
      const version = ++fetchVersionRef.current;
      if (!append) {
        setLoading(true);
        offsetRef.current = 0;
      }

      const params = new URLSearchParams();
      if (filters.type) params.set("type", filters.type);
      if (filters.source) params.set("source", filters.source);
      if (filters.status) params.set("status", filters.status);
      if (filters.search) params.set("search", filters.search);
      params.set("limit", "50");
      params.set("offset", String(offsetRef.current));

      fetch(`/api/sessions?${params}`)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<{ sessions: SessionRow[]; total: number; hasMore: boolean }>;
        })
        .then((data) => {
          if (version !== fetchVersionRef.current) return;
          setSessions((prev) => (append ? [...prev, ...data.sessions] : data.sessions));
          setTotal(data.total);
          setHasMore(data.hasMore);
          offsetRef.current += data.sessions.length;
        })
        .catch(() => {
          if (version !== fetchVersionRef.current) return;
          if (!append) setSessions([]);
        })
        .finally(() => {
          if (version !== fetchVersionRef.current) return;
          setLoading(false);
        });
    },
    [filters.type, filters.source, filters.status, filters.search],
  );

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "session_update") {
        fetchSessions();
      }
    });
  }, [subscribe, fetchSessions]);

  const loadMore = useCallback(() => {
    if (hasMore && !loading) fetchSessions(true);
  }, [hasMore, loading, fetchSessions]);

  return { sessions, total, loading, hasMore, refresh: () => fetchSessions(), loadMore };
}
