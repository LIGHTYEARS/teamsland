import type { DiscoveredSession } from "@teamsland/types";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@teamsland/ui/components/ui/table";
import { Bot, Cpu, Eye, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useProjectStore } from "../stores/useProjectStore";

/** 扁平化的 session + 项目上下文 */
interface FlatSession {
  projectName: string;
  session: DiscoveredSession;
}

const TYPE_ICONS: Record<string, typeof Cpu> = {
  coordinator: Bot,
  task_worker: Cpu,
  observer_worker: Eye,
};

const TYPE_LABELS: Record<string, string> = {
  coordinator: "Coordinator",
  task_worker: "Task Worker",
  observer_worker: "Observer",
};

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "coordinator", label: "Coordinator" },
  { value: "task_worker", label: "Task Worker" },
  { value: "observer_worker", label: "Observer" },
] as const;

/**
 * Sessions 列表页面
 *
 * 全屏 session 浏览器，支持类型过滤和搜索。
 */
export function SessionsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { projects, loading } = useProjectStore();
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  // 扁平化所有 sessions
  const flatSessions = useMemo(() => {
    const flat: FlatSession[] = [];
    for (const project of projects) {
      for (const session of project.sessions) {
        flat.push({ projectName: project.name, session });
      }
    }
    // 按最后活动时间降序排序
    flat.sort((a, b) => {
      const ta = a.session.lastActivity ? new Date(a.session.lastActivity).getTime() : 0;
      const tb = b.session.lastActivity ? new Date(b.session.lastActivity).getTime() : 0;
      return tb - ta;
    });
    return flat;
  }, [projects]);

  // 过滤
  const filtered = useMemo(() => {
    let result = flatSessions;
    if (typeFilter !== "all") {
      result = result.filter((f) => f.session.sessionType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (f) =>
          f.session.id.toLowerCase().includes(q) ||
          f.session.summary?.toLowerCase().includes(q) ||
          f.projectName.toLowerCase().includes(q),
      );
    }
    return result;
  }, [flatSessions, typeFilter, search]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 页面标题 */}
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Sessions</h1>
        <p className="text-sm text-muted-foreground">Browse all agent sessions across projects</p>
      </header>

      {/* 过滤栏 */}
      <div className="shrink-0 flex items-center gap-3 border-b border-border px-6 py-3">
        {/* 类型过滤 */}
        <div className="flex items-center gap-1">
          {FILTER_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
                typeFilter === value
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 搜索 */}
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search sessions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64 rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session ID</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="text-right">Messages</TableHead>
              <TableHead>Last Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableEmpty colSpan={6}>Loading…</TableEmpty>
            ) : filtered.length === 0 ? (
              <TableEmpty colSpan={6}>
                {search || typeFilter !== "all" ? "No sessions match the current filters." : "No sessions found."}
              </TableEmpty>
            ) : (
              filtered.map(({ projectName, session }) => {
                const TypeIcon = TYPE_ICONS[session.sessionType ?? ""] ?? Cpu;
                return (
                  <TableRow
                    key={`${projectName}-${session.id}`}
                    className="cursor-pointer"
                    onClick={() => onNavigate(`/sessions/${projectName}/${session.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{session.id.slice(0, 16)}</TableCell>
                    <TableCell className="text-xs">{projectName}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <TypeIcon size={12} className="text-muted-foreground" />
                        <span className="text-xs">{TYPE_LABELS[session.sessionType ?? ""] ?? "Unknown"}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-sm">{session.summary ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{session.messageCount ?? 0}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {session.lastActivity ? formatRelativeTime(session.lastActivity) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
