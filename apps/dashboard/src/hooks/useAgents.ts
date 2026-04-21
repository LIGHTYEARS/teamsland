import type { AgentRecord } from "@teamsland/types";
import { useEffect, useRef, useState } from "react";

/** WebSocket 连接状态 */
type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * 实时 Agent 列表 Hook
 *
 * 通过 WebSocket 连接到 Dashboard 服务端，接收 agent 列表实时更新。
 * 连接断开后 3 秒自动重连。
 *
 * @param wsUrl - WebSocket 地址，默认使用当前页面 host 的 /ws 路径
 * @returns agents 列表和连接状态
 */
export function useAgents(wsUrl?: string): { agents: AgentRecord[]; status: ConnectionStatus } {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const url = wsUrl ?? `ws://${window.location.host}/ws`;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as { type: string; agents?: AgentRecord[] };
          if ((data.type === "connected" || data.type === "agents_update") && data.agents) {
            setAgents(data.agents);
          }
        } catch {
          // 忽略非法 JSON
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [wsUrl]);

  return { agents, status };
}
