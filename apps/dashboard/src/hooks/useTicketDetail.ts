import { useEffect, useState } from "react";

interface TicketHistoryEntry {
  from: string;
  to: string;
  timestamp: number;
}

export interface TicketDetail {
  issueId: string;
  state: string;
  eventId: string;
  eventType: string;
  context: string | null;
  history: TicketHistoryEntry[];
  updatedAt: number;
  createdAt: number;
}

export interface EnrichResult {
  issueId: string;
  basic: {
    title: string;
    status?: string;
    priority?: string;
    assignee?: string;
    creator?: string;
  };
  description: string | null;
  documents: Array<{
    url: string;
    fieldKey: string;
    content: string | null;
    ok: boolean;
    error?: string;
  }>;
  customFields: Array<{
    fieldKey: string;
    fieldName: string;
    value: unknown;
  }>;
}

export function useTicketDetail(issueId: string | null): {
  ticket: TicketDetail | null;
  enrichResult: EnrichResult | null;
  loading: boolean;
  error: string | null;
} {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [enrichResult, setEnrichResult] = useState<EnrichResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issueId) {
      setTicket(null);
      setEnrichResult(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/ticket/${encodeURIComponent(issueId)}`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("Ticket not found");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TicketDetail) => {
        if (cancelled) return;
        setTicket(data);
        if (data.context) {
          try {
            setEnrichResult(JSON.parse(data.context) as EnrichResult);
          } catch {
            setEnrichResult(null);
          }
        } else {
          setEnrichResult(null);
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
  }, [issueId]);

  return { ticket, enrichResult, loading, error };
}
