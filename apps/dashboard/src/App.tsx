import { useState } from "react";
import { AgentList } from "./components/AgentList";
import { EventViewer } from "./components/EventViewer";
import { useAgents } from "./hooks/useAgents";

const STATUS_DOT: Record<string, string> = {
  connecting: "bg-yellow-400",
  connected: "bg-green-400",
  disconnected: "bg-red-400",
};

export function App() {
  const { agents, status } = useAgents();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Teamsland Dashboard</h1>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? "bg-gray-400"}`} />
            <span>{status === "connected" ? "实时连接" : status === "connecting" ? "连接中..." : "已断开"}</span>
            <span className="ml-4 font-mono">{agents.length} agents</span>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="bg-white rounded-lg shadow-sm border">
          <div className="px-4 py-3 border-b">
            <h2 className="text-lg font-medium text-gray-900">运行中的 Agent</h2>
          </div>
          <AgentList agents={agents} selectedSessionId={selectedSessionId} onSelectSession={setSelectedSessionId} />
        </div>

        <EventViewer sessionId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
      </main>
    </div>
  );
}
