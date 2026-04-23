import type { AgentRecord } from "@teamsland/types";
import { useEffect, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/** WebSocket 连接状态 */
type ConnectionStatus = "connecting" | "connected" | "disconnected";

/**
 * 实时 Agent 列表 Hook
 *
 * 通过共享 WebSocket 上下文订阅 agent 列表的实时更新。
 * 当收到 `connected` 或 `agents_update` 类型的消息时，更新 agent 列表。
 *
 * @returns agents 列表和连接状态
 *
 * @example
 * ```tsx
 * import { useAgents } from "../hooks/useAgents.js";
 *
 * function AgentPanel() {
 *   const { agents, status } = useAgents();
 *   return (
 *     <div>
 *       <span>状态: {status}</span>
 *       <ul>
 *         {agents.map((a) => (
 *           <li key={a.agentId}>{a.taskBrief ?? a.agentId}</li>
 *         ))}
 *       </ul>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAgents(): { agents: AgentRecord[]; status: ConnectionStatus } {
  const { status, subscribe } = useWebSocket();
  const [agents, setAgents] = useState<AgentRecord[]>([]);

  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if ((msg.type === "connected" || msg.type === "agents_update") && Array.isArray(msg.agents)) {
        setAgents(msg.agents as AgentRecord[]);
      }
    });
  }, [subscribe]);

  return { agents, status };
}
