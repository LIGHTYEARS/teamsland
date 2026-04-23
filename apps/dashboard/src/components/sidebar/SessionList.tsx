import type { DiscoveredSession } from "@teamsland/types";
import { Brain, Eye, Hammer, MessageSquare } from "lucide-react";

/**
 * Session 类型对应的图标和颜色配置
 *
 * @example
 * ```ts
 * const config = SESSION_TYPE_CONFIG["coordinator"];
 * // { icon: Brain, colorClass: "text-blue-500" }
 * ```
 */
const SESSION_TYPE_CONFIG: Record<string, { icon: typeof Brain; colorClass: string }> = {
  coordinator: { icon: Brain, colorClass: "text-blue-500" },
  task_worker: { icon: Hammer, colorClass: "text-green-500" },
  observer_worker: { icon: Eye, colorClass: "text-purple-500" },
  unknown: { icon: MessageSquare, colorClass: "text-gray-400" },
};

/**
 * 会话列表组件属性
 *
 * @example
 * ```tsx
 * <SessionList
 *   sessions={project.sessions}
 *   projectName="teamsland"
 *   selectedSessionId="sess_001"
 *   onSelectSession={(proj, sess) => console.log(proj, sess)}
 * />
 * ```
 */
export interface SessionListProps {
  /** 会话数组 */
  sessions: DiscoveredSession[];
  /** 所属项目名 */
  projectName: string;
  /** 当前选中的会话 ID */
  selectedSessionId: string | null;
  /** 选择会话回调 */
  onSelectSession: (projectName: string, sessionId: string) => void;
  /** 当前激活的过滤器集合 */
  activeFilters?: Set<string>;
}

/**
 * 格式化最后活动时间为相对时间
 *
 * @example
 * ```ts
 * formatRelativeTime("2026-04-23T10:00:00.000Z"); // "5 分钟前"
 * ```
 */
function formatRelativeTime(isoTimestamp: string): string {
  const now = Date.now();
  const then = new Date(isoTimestamp).getTime();
  const diffMs = now - then;

  if (Number.isNaN(diffMs) || diffMs < 0) return "刚刚";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "刚刚";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/**
 * 会话列表组件
 *
 * 渲染某个项目下的所有会话条目。每个条目显示会话类型图标、
 * 摘要文本和最后活动时间。支持选中高亮。
 *
 * @example
 * ```tsx
 * import { SessionList } from "./SessionList";
 * import type { DiscoveredSession } from "@teamsland/types";
 *
 * const sessions: DiscoveredSession[] = [
 *   {
 *     id: "sess_001",
 *     summary: "重构配置模块",
 *     messageCount: 42,
 *     lastActivity: "2026-04-23T10:30:00.000Z",
 *     cwd: "/workspace/teamsland",
 *     sessionType: "coordinator",
 *   },
 * ];
 *
 * <SessionList
 *   sessions={sessions}
 *   projectName="teamsland"
 *   selectedSessionId={null}
 *   onSelectSession={(proj, sess) => console.log(proj, sess)}
 * />
 * ```
 */
export function SessionList({
  sessions,
  projectName,
  selectedSessionId,
  onSelectSession,
  activeFilters,
}: SessionListProps) {
  const filteredSessions =
    activeFilters && activeFilters.size > 0
      ? sessions.filter((s) => activeFilters.has(s.sessionType ?? "unknown"))
      : sessions;

  if (filteredSessions.length === 0) {
    return <p className="px-6 py-2 text-xs text-gray-400 italic">暂无会话</p>;
  }

  return (
    <div className="space-y-0.5 pb-1">
      {filteredSessions.map((session) => {
        const isSelected = session.id === selectedSessionId;
        const typeKey = session.sessionType ?? "unknown";
        const config = SESSION_TYPE_CONFIG[typeKey] ?? SESSION_TYPE_CONFIG.unknown;
        const Icon = config.icon;

        return (
          <button
            key={session.id}
            type="button"
            onClick={() => onSelectSession(projectName, session.id)}
            className={`flex w-full items-start gap-2 rounded-md px-6 py-2 text-left transition-colors ${
              isSelected ? "bg-blue-50 text-blue-900" : "text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Icon size={14} className={`mt-0.5 shrink-0 ${config.colorClass}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{session.summary || `Session ${session.id.slice(0, 8)}`}</p>
              <p className="text-xs text-gray-400">
                {formatRelativeTime(session.lastActivity)}
                {" · "}
                {session.messageCount} 条消息
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
