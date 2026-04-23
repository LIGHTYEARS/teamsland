import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/** WebSocket 连接状态 */
type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** WebSocket 消息处理回调 */
type MessageHandler = (data: unknown) => void;

/**
 * WebSocket 上下文值接口
 *
 * 提供全局 WebSocket 连接的状态、发送、订阅及最新消息信息。
 *
 * @example
 * ```tsx
 * import { useWebSocket } from "../contexts/WebSocketContext.js";
 *
 * function MyComponent() {
 *   const { status, send, subscribe, lastMessage } = useWebSocket();
 *   // ...
 * }
 * ```
 */
interface WebSocketContextValue {
  /** 当前连接状态 */
  status: ConnectionStatus;
  /** 向服务端发送数据（自动 JSON 序列化） */
  send: (data: unknown) => void;
  /** 订阅 WebSocket 消息，返回取消订阅函数 */
  subscribe: (handler: MessageHandler) => () => void;
  /** 最新收到的消息 */
  lastMessage: unknown;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

/** 自动重连延迟（毫秒） */
const RECONNECT_DELAY_MS = 3000;

/**
 * 将解析后的数据分发到所有已注册的消息处理器
 *
 * @param handlers - 消息处理器集合
 * @param data - 已解析的 JSON 数据
 *
 * @example
 * ```ts
 * const handlers = new Set<MessageHandler>();
 * dispatchToHandlers(handlers, { type: "connected" });
 * ```
 */
function dispatchToHandlers(handlers: Set<MessageHandler>, data: unknown): void {
  for (const handler of handlers) {
    try {
      handler(data);
    } catch {
      // 忽略单个 handler 的异常，不影响其他订阅者
    }
  }
}

/**
 * WebSocket 全局 Provider
 *
 * 管理单一 WebSocket 连接到 `/api/ws`，支持自动重连和消息分发。
 * 所有子组件通过 `useWebSocket` 获取共享连接。
 *
 * @param children - React 子节点
 * @param url - 自定义 WebSocket 地址，默认基于当前页面 host 拼接 `/api/ws`
 *
 * @example
 * ```tsx
 * import { WebSocketProvider } from "./contexts/WebSocketContext.js";
 *
 * function Root() {
 *   return (
 *     <WebSocketProvider>
 *       <App />
 *     </WebSocketProvider>
 *   );
 * }
 * ```
 */
export function WebSocketProvider({ children, url }: { children: ReactNode; url?: string }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastMessage, setLastMessage] = useState<unknown>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());

  const send = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  const subscribe = useCallback((handler: MessageHandler): (() => void) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = url ?? `${protocol}//${window.location.host}/api/ws`;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      setStatus("connecting");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setStatus("connected");
      };

      ws.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        try {
          const data: unknown = JSON.parse(event.data as string);
          setLastMessage(data);
          dispatchToHandlers(handlersRef.current, data);
        } catch {
          // 忽略非法 JSON
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      wsRef.current?.close();
    };
  }, [url]);

  return <WebSocketContext value={{ status, send, subscribe, lastMessage }}>{children}</WebSocketContext>;
}

/**
 * 获取全局 WebSocket 上下文的 Hook
 *
 * 必须在 `WebSocketProvider` 内部使用，否则抛出异常。
 *
 * @returns WebSocket 上下文值，包含 status / send / subscribe / lastMessage
 *
 * @example
 * ```tsx
 * import { useWebSocket } from "../contexts/WebSocketContext.js";
 *
 * function StatusIndicator() {
 *   const { status } = useWebSocket();
 *   return <span>{status}</span>;
 * }
 * ```
 */
export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket 必须在 WebSocketProvider 内部使用");
  }
  return ctx;
}
