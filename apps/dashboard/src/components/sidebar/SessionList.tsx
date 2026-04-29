import type { SessionRow } from "@teamsland/types";
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
  unknown: { icon: MessageSquare, colorClass: "text-muted-foreground" },
};

/**
 * 会话列表组件属性
 */
export interface SessionListProps {
  /** 会话数组 */
  sessions: SessionRow[];
  /** 当前选中的会话 ID */
  selectedSessionId: string | null;
  /** 选择会话回调 */
  onSelectSession: (sessionId: string) => void;
  /** 当前激活的过滤器集合 */
  activeFilters?: Set<string>;
}

/**
 * 格式化最后活动时间为相对时间（Unix 时间戳，毫秒）
 *
 * @example
 * ```ts
 * formatRelativeTime(Date.now() - 300_000); // "5 分钟前"
 * ```
 */
function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;

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
 * 渲染会话条目列表。每个条目显示会话类型图标、摘要文本和最后活动时间。
 * 支持选中高亮和类型过滤。
 */
export function SessionList({ sessions, selectedSessionId, onSelectSession, activeFilters }: SessionListProps) {
  const filteredSessions =
    activeFilters && activeFilters.size > 0
      ? sessions.filter((s) => activeFilters.has(s.sessionType ?? "unknown"))
      : sessions;

  if (filteredSessions.length === 0) {
    return <p className="px-6 py-2 text-xs text-muted-foreground italic">暂无会话</p>;
  }

  return (
    <div className="space-y-0.5 pb-1">
      {filteredSessions.map((session) => {
        const isSelected = session.sessionId === selectedSessionId;
        const typeKey = session.sessionType ?? "unknown";
        const config = SESSION_TYPE_CONFIG[typeKey] ?? SESSION_TYPE_CONFIG.unknown;
        const Icon = config.icon;

        return (
          <button
            key={session.sessionId}
            type="button"
            onClick={() => onSelectSession(session.sessionId)}
            className={`flex w-full items-start gap-2 rounded-md px-6 py-2 text-left transition-colors ${
              isSelected ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent"
            }`}
          >
            <Icon size={14} className={`mt-0.5 shrink-0 ${config.colorClass}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {session.summary || `Session ${session.sessionId.slice(0, 8)}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {session.updatedAt ? formatRelativeTime(session.updatedAt) : "—"}
                {" · "}
                {session.messageCount ?? 0} 条消息
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
