import type { NormalizedMessage } from "@teamsland/types";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/**
 * Session 消息缓存状态
 *
 * @example
 * ```ts
 * import type { SessionState } from "../stores/useSessionStore.js";
 *
 * const state: SessionState = {
 *   messages: [],
 *   loading: false,
 *   isStreaming: false,
 * };
 * ```
 */
interface SessionState {
  /** 归一化消息列表 */
  messages: NormalizedMessage[];
  /** 是否正在加载历史消息 */
  loading: boolean;
  /** 是否正在接收流式消息 */
  isStreaming: boolean;
}

/**
 * 判断传入的 WebSocket 数据是否为目标 session 的归一化消息
 *
 * @param data - WebSocket 接收的原始数据
 * @param targetSessionId - 当前关注的 session ID
 * @returns 匹配的 NormalizedMessage 或 null
 *
 * @example
 * ```ts
 * const msg = matchSessionMessage(data, "sess_abc");
 * if (msg) console.log(msg.kind);
 * ```
 */
function matchSessionMessage(data: unknown, targetSessionId: string): NormalizedMessage | null {
  const msg = data as Record<string, unknown>;
  if (typeof msg.id !== "string" || typeof msg.sessionId !== "string") return null;
  if (msg.sessionId !== targetSessionId) return null;
  return data as NormalizedMessage;
}

/**
 * 根据消息类型更新流式状态
 *
 * @param kind - 消息类型
 * @param setIsStreaming - 流式状态更新函数
 *
 * @example
 * ```ts
 * updateStreamingStatus("stream_delta", setIsStreaming); // => true
 * updateStreamingStatus("complete", setIsStreaming);     // => false
 * ```
 */
function updateStreamingStatus(kind: string, setIsStreaming: (value: boolean) => void): void {
  if (kind === "complete" || kind === "stream_end") {
    setIsStreaming(false);
  } else if (kind === "stream_delta" || kind === "text" || kind === "tool_use" || kind === "thinking") {
    setIsStreaming(true);
  }
}

/** stream_end 到达时：将最后一条累积 delta 定型为 text */
function finalizeStreamDelta(setMessages: Dispatch<SetStateAction<NormalizedMessage[]>>): void {
  setMessages((prev) => {
    if (prev.length === 0) return prev;
    const last = prev[prev.length - 1];
    if (last.kind !== "stream_delta") return prev;
    const updated = [...prev];
    updated[prev.length - 1] = { ...last, kind: "text" };
    return updated;
  });
}

/** 将 stream_delta 合并到最后一条 assistant 消息 */
function accumulateDelta(
  normalized: NormalizedMessage,
  isAccumulatingRef: MutableRefObject<boolean>,
  setMessages: Dispatch<SetStateAction<NormalizedMessage[]>>,
): void {
  setMessages((prev) => {
    if (isAccumulatingRef.current && prev.length > 0) {
      const last = prev[prev.length - 1];
      if (last.kind === "stream_delta" && last.role === "assistant") {
        const updated = [...prev];
        updated[prev.length - 1] = {
          ...last,
          content: (last.content ?? "") + (normalized.content ?? ""),
        };
        return updated;
      }
    }
    isAccumulatingRef.current = true;
    return [...prev, normalized];
  });
}

/** 处理单条实时 WS 消息 */
function handleRealtimeMessage(
  normalized: NormalizedMessage,
  isAccumulatingRef: MutableRefObject<boolean>,
  seenIdsRef: MutableRefObject<Set<string>>,
  setIsStreaming: (value: boolean) => void,
  setMessages: Dispatch<SetStateAction<NormalizedMessage[]>>,
): void {
  updateStreamingStatus(normalized.kind, setIsStreaming);

  if (normalized.kind === "stream_end" || normalized.kind === "complete") {
    if (isAccumulatingRef.current) {
      isAccumulatingRef.current = false;
      if (normalized.kind === "stream_end") {
        finalizeStreamDelta(setMessages);
        return;
      }
    }
  }

  if (normalized.kind === "stream_delta" && normalized.role === "assistant") {
    accumulateDelta(normalized, isAccumulatingRef, setMessages);
    return;
  }

  if (isAccumulatingRef.current && normalized.kind !== "stream_delta") {
    isAccumulatingRef.current = false;
  }

  if (seenIdsRef.current.has(normalized.id)) return;
  seenIdsRef.current.add(normalized.id);

  setMessages((prev) => [...prev, normalized]);
}

/**
 * Session 消息缓存 Hook — 合并服务端历史与实时 WebSocket 消息
 *
 * 当 `sessionId` 变化时，从 `/api/sessions/{id}/normalized-messages` 拉取历史消息；
 * 同时通过 WebSocket 订阅实时推送的 `NormalizedMessage`，自动追加并去重。
 *
 * @param sessionId - 目标会话 ID，为 null 时重置状态
 * @returns 消息列表、加载/流式状态及手动刷新函数
 *
 * @example
 * ```tsx
 * import { useSessionStore } from "../stores/useSessionStore.js";
 *
 * function MessageList({ sessionId }: { sessionId: string }) {
 *   const { messages, loading, isStreaming, refresh } = useSessionStore(sessionId);
 *   if (loading) return <div>加载中...</div>;
 *   return (
 *     <ul>
 *       {messages.map((msg) => (
 *         <li key={msg.id}>{msg.content}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useSessionStore(sessionId: string | null): SessionState & { refresh: () => void } {
  const [messages, setMessages] = useState<NormalizedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const { subscribe } = useWebSocket();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const fetchVersionRef = useRef(0);
  /** 标记当前是否正在累积流式 delta */
  const isAccumulatingRef = useRef(false);

  const fetchMessages = useCallback((sid: string) => {
    const version = ++fetchVersionRef.current;
    setLoading(true);

    fetch(`/api/sessions/${encodeURIComponent(sid)}/normalized-messages`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<{ messages: NormalizedMessage[] }>;
      })
      .then((data) => {
        if (version !== fetchVersionRef.current) return;
        const fetched = data.messages ?? [];
        const idSet = new Set<string>();
        for (const msg of fetched) {
          idSet.add(msg.id);
        }
        seenIdsRef.current = idSet;
        setMessages(fetched);
      })
      .catch(() => {
        if (version !== fetchVersionRef.current) return;
        setMessages([]);
        seenIdsRef.current = new Set();
      })
      .finally(() => {
        if (version !== fetchVersionRef.current) return;
        setLoading(false);
      });
  }, []);

  // 拉取历史消息
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setIsStreaming(false);
      seenIdsRef.current = new Set();
      isAccumulatingRef.current = false;
      return;
    }
    fetchMessages(sessionId);
  }, [sessionId, fetchMessages]);

  // 订阅实时消息
  useEffect(() => {
    if (!sessionId) return;

    return subscribe((data) => {
      const normalized = matchSessionMessage(data, sessionId);
      if (!normalized) return;
      handleRealtimeMessage(normalized, isAccumulatingRef, seenIdsRef, setIsStreaming, setMessages);
    });
  }, [sessionId, subscribe]);

  const refresh = useCallback(() => {
    if (sessionId) {
      fetchMessages(sessionId);
    }
  }, [sessionId, fetchMessages]);

  return { messages, loading, isStreaming, refresh };
}
