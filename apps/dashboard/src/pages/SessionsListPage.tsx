import type { DiscoveredSession } from "@teamsland/types";
import { Button } from "@teamsland/ui/components/ui/button";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@teamsland/ui/components/ui/table";
import { Bot, Cpu, Eye, Inbox, Search } from "lucide-react";
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
  coordinator: "协调器",
  task_worker: "任务 Worker",
  observer_worker: "观察者",
};

const FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "coordinator", label: "协调器" },
  { value: "task_worker", label: "任务 Worker" },
  { value: "observer_worker", label: "观察者" },
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
        <h1 className="text-xl font-semibold text-foreground">会话</h1>
        <p className="text-sm text-muted-foreground">浏览所有项目的 Agent 会话</p>
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
            placeholder="搜索会话…"
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
              <TableHead>项目</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead className="text-right">消息数</TableHead>
              <TableHead>最后活跃</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows have no meaningful key
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-48" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-4 w-8 ml-auto" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyState
                    icon={<Inbox size={40} strokeWidth={1} />}
                    title={search || typeFilter !== "all" ? "没有匹配当前筛选条件的会话" : "暂无会话"}
                    description={search || typeFilter !== "all" ? "尝试调整筛选条件" : undefined}
                    action={
                      search || typeFilter !== "all" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearch("");
                            setTypeFilter("all");
                          }}
                        >
                          清除筛选
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(({ projectName, session }) => {
                const TypeIcon = TYPE_ICONS[session.sessionType ?? ""] ?? Cpu;
                return (
                  <TableRow
                    key={`${projectName}-${session.id}`}
                    className="cursor-pointer hover:bg-accent/50 transition-colors"
                    onClick={() => onNavigate(`/sessions/${projectName}/${session.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{session.id.slice(0, 16)}</TableCell>
                    <TableCell className="text-xs">{projectName}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <TypeIcon size={12} className="text-muted-foreground" />
                        <span className="text-xs">{TYPE_LABELS[session.sessionType ?? ""] ?? "未知"}</span>
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
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}
