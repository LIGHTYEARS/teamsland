import type { MessageRow } from "@teamsland/types";
import { useCallback, useEffect, useReducer, useState } from "react";

/**
 * 获取指定 session 的消息列表 Hook
 *
 * 通过 GET /api/sessions/:sessionId/messages (NDJSON) 获取消息数据。
 * 支持手动刷新。
 *
 * @param sessionId - 会话 ID，为 null 时不发请求
 * @returns messages 列表、加载状态和刷新函数
 *
 * @example
 * ```tsx
 * const { messages, loading, refresh } = useSessionMessages("sess-001");
 * ```
 */
export function useSessionMessages(sessionId: string | null): {
  messages: MessageRow[];
  loading: boolean;
  refresh: () => void;
} {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const refresh = useCallback(() => bump(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version counter triggers re-fetch
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)
      .then((res) => res.text())
      .then((text) => {
        if (cancelled) return;
        const lines = text.trim().split("\n").filter(Boolean);
        const parsed: MessageRow[] = [];
        for (const line of lines) {
          try {
            parsed.push(JSON.parse(line) as MessageRow);
          } catch {
            // 忽略非法 NDJSON 行
          }
        }
        setMessages(parsed);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, version]);

  return { messages, loading, refresh };
}
