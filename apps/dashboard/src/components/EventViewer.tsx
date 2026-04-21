import type { MessageRow } from "@teamsland/types";
import { useSessionMessages } from "../hooks/useSessionMessages";

/** 消息角色对应的样式 */
const ROLE_STYLES: Record<string, string> = {
  user: "bg-blue-100 text-blue-800",
  assistant: "bg-purple-100 text-purple-800",
  system: "bg-yellow-100 text-yellow-800",
  tool: "bg-orange-100 text-orange-800",
};

/** 格式化时间戳 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/** 截断长文本 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

interface EventViewerProps {
  sessionId: string | null;
  onClose: () => void;
}

/**
 * Stream-JSON 事件查看器
 *
 * 展示指定会话的 NDJSON 消息流。点击 Agent 行时打开此面板，
 * 通过 GET /api/sessions/:sessionId/messages 获取数据。
 *
 * @example
 * ```tsx
 * <EventViewer sessionId="sess-001" onClose={() => setSelected(null)} />
 * ```
 */
export function EventViewer({ sessionId, onClose }: EventViewerProps) {
  const { messages, loading, refresh } = useSessionMessages(sessionId);

  if (!sessionId) return null;

  return (
    <div className="bg-white rounded-lg shadow-sm border mt-4">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-gray-900">事件流</h2>
          <span className="text-xs font-mono text-gray-500">{sessionId}</span>
          <span className="text-xs text-gray-400">{messages.length} 条消息</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors disabled:opacity-50"
          >
            {loading ? "加载中..." : "刷新"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
          >
            关闭
          </button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading && messages.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">加载中...</div>}

        {!loading && messages.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">暂无消息记录</div>
        )}

        {messages.length > 0 && (
          <table className="w-full text-xs text-left">
            <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 w-16">ID</th>
                <th className="px-3 py-2 w-20">时间</th>
                <th className="px-3 py-2 w-20">角色</th>
                <th className="px-3 py-2 w-24">工具</th>
                <th className="px-3 py-2">内容</th>
                <th className="px-3 py-2 w-24">Trace ID</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((msg) => (
                <MessageEventRow key={msg.id} message={msg} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MessageEventRow({ message }: { message: MessageRow }) {
  return (
    <tr className="border-b hover:bg-gray-50 transition-colors">
      <td className="px-3 py-2 font-mono text-gray-400">{message.id}</td>
      <td className="px-3 py-2 text-gray-500">{formatTimestamp(message.createdAt)}</td>
      <td className="px-3 py-2">
        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_STYLES[message.role] ?? "bg-gray-100"}`}>
          {message.role}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-gray-500">{message.toolName ?? "—"}</td>
      <td className="px-3 py-2 font-mono text-gray-700 whitespace-pre-wrap break-all">
        {truncate(message.content, 200)}
      </td>
      <td className="px-3 py-2 font-mono text-gray-400">{message.traceId ? truncate(message.traceId, 8) : "—"}</td>
    </tr>
  );
}
