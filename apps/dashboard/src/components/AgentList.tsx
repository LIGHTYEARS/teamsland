import type { AgentRecord } from "@teamsland/types";

/** Agent 状态对应的 Tailwind 样式 */
const STATUS_STYLES: Record<string, string> = {
  running: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-600",
  failed: "bg-red-100 text-red-800",
};

/** 格式化时间戳为 HH:mm:ss */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/** 计算运行时长 */
function formatDuration(startTs: number): string {
  const seconds = Math.floor((Date.now() - startTs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

interface AgentListProps {
  agents: AgentRecord[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string | null) => void;
}

export function AgentList({ agents, selectedSessionId, onSelectSession }: AgentListProps) {
  if (agents.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">暂无运行中的 Agent</p>
        <p className="text-sm mt-1">Agent 启动后将在此处实时显示</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
          <tr>
            <th className="px-4 py-3">Agent ID</th>
            <th className="px-4 py-3">Issue</th>
            <th className="px-4 py-3">PID</th>
            <th className="px-4 py-3">状态</th>
            <th className="px-4 py-3">重试</th>
            <th className="px-4 py-3">启动时间</th>
            <th className="px-4 py-3">运行时长</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const isSelected = agent.sessionId === selectedSessionId;
            return (
              <tr
                key={agent.agentId}
                onClick={() => onSelectSession(isSelected ? null : agent.sessionId)}
                className={`border-b cursor-pointer transition-colors ${isSelected ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <td className="px-4 py-3 font-mono text-xs">{agent.agentId}</td>
                <td className="px-4 py-3">{agent.issueId}</td>
                <td className="px-4 py-3 font-mono">{agent.pid}</td>
                <td className="px-4 py-3">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[agent.status] ?? "bg-gray-100"}`}
                  >
                    {agent.status}
                  </span>
                </td>
                <td className="px-4 py-3">{agent.retryCount}</td>
                <td className="px-4 py-3">{formatTime(agent.createdAt)}</td>
                <td className="px-4 py-3">{formatDuration(agent.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
