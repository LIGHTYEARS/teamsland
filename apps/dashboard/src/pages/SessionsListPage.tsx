import type { SessionRow } from "@teamsland/types";
import { Button } from "@teamsland/ui/components/ui/button";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@teamsland/ui/components/ui/table";
import { Bot, Cpu, Eye, Inbox, Search } from "lucide-react";
import { useState } from "react";
import { useSessionListStore } from "../stores/useSessionListStore.js";

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

const SOURCE_LABELS: Record<string, string> = {
  meego: "Meego",
  lark_mention: "Lark @",
  lark_dm: "Lark DM",
  dashboard: "Dashboard",
  coordinator: "Coordinator",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  completed: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  compacted: "bg-gray-100 text-gray-500",
  archived: "bg-gray-100 text-gray-400",
};

const STATUS_LABELS: Record<string, string> = {
  active: "运行中",
  completed: "已完成",
  failed: "失败",
  compacted: "已压缩",
  archived: "已归档",
};

const TYPE_FILTER_OPTIONS = [
  { value: "", label: "全部类型" },
  { value: "coordinator", label: "协调器" },
  { value: "task_worker", label: "任务 Worker" },
  { value: "observer_worker", label: "观察者" },
] as const;

const SOURCE_FILTER_OPTIONS = [
  { value: "", label: "全部来源" },
  { value: "meego", label: "Meego" },
  { value: "lark_dm", label: "Lark DM" },
  { value: "lark_mention", label: "Lark @" },
  { value: "dashboard", label: "Dashboard" },
  { value: "coordinator", label: "Coordinator" },
] as const;

function getLinkedEntity(originData: Record<string, unknown> | null): string {
  if (!originData) return "—";
  if (originData.meegoIssueId) return String(originData.meegoIssueId);
  if (originData.senderName) return String(originData.senderName);
  if (originData.observeTargetId) return `观察: ${String(originData.observeTargetId).slice(0, 12)}`;
  return "—";
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function FilterBar({
  typeFilter,
  sourceFilter,
  search,
  onTypeChange,
  onSourceChange,
  onSearchChange,
}: {
  typeFilter: string;
  sourceFilter: string;
  search: string;
  onTypeChange: (v: string) => void;
  onSourceChange: (v: string) => void;
  onSearchChange: (v: string) => void;
}) {
  const pillClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
      active ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
    }`;

  return (
    <div className="shrink-0 flex flex-wrap items-center gap-3 px-6 py-3">
      <div className="flex items-center gap-1">
        {TYPE_FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onTypeChange(value)}
            className={pillClass(typeFilter === value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {SOURCE_FILTER_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => onSourceChange(value)}
            className={pillClass(sourceFilter === value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative ml-auto">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="搜索会话…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 w-64 rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        />
      </div>
    </div>
  );
}

function SessionTableRow({ session, onNavigate }: { session: SessionRow; onNavigate: (path: string) => void }) {
  const TypeIcon = TYPE_ICONS[session.sessionType ?? ""] ?? Cpu;
  const originData = session.originData as Record<string, unknown> | null;
  const linkedEntity = getLinkedEntity(originData);

  return (
    <TableRow
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onNavigate(`/sessions/${session.projectId ?? "unknown"}/${session.sessionId}`)}
    >
      <TableCell className="font-mono text-xs">{session.sessionId.slice(0, 16)}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1">
          <TypeIcon size={12} className="text-muted-foreground" />
          <span className="text-xs">{TYPE_LABELS[session.sessionType ?? ""] ?? "未知"}</span>
        </span>
      </TableCell>
      <TableCell>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
          {SOURCE_LABELS[session.source ?? ""] ?? "—"}
        </span>
      </TableCell>
      <TableCell>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[session.status] ?? ""}`}>
          {STATUS_LABELS[session.status] ?? session.status}
        </span>
      </TableCell>
      <TableCell className="max-w-[300px] truncate text-sm">{session.summary ?? "—"}</TableCell>
      <TableCell className="text-xs">{linkedEntity}</TableCell>
      <TableCell className="text-right tabular-nums text-xs">{session.messageCount ?? 0}</TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {session.updatedAt ? formatRelativeTime(session.updatedAt) : "—"}
      </TableCell>
    </TableRow>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton rows
        <TableRow key={i}>
          {Array.from({ length: 8 }).map((_, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cells
            <TableCell key={j}>
              <Skeleton className="h-4 w-20" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function SessionTableBody({
  loading,
  sessions,
  hasFilters,
  onClearFilters,
  onNavigate,
}: {
  loading: boolean;
  sessions: SessionRow[];
  hasFilters: boolean;
  onClearFilters: () => void;
  onNavigate: (path: string) => void;
}) {
  if (loading) return <SkeletonRows />;
  if (sessions.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={8}>
          <EmptyState
            icon={<Inbox size={40} strokeWidth={1} />}
            title={hasFilters ? "没有匹配当前筛选条件的会话" : "暂无平台会话"}
            description={hasFilters ? "尝试调整筛选条件" : "通过 Dashboard、Meego 或 Lark 发起任务以创建会话"}
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={onClearFilters}>
                  清除筛选
                </Button>
              ) : undefined
            }
          />
        </TableCell>
      </TableRow>
    );
  }
  return sessions.map((session) => (
    <SessionTableRow key={session.sessionId} session={session} onNavigate={onNavigate} />
  ));
}

export function SessionsListPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [typeFilter, setTypeFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [search, setSearch] = useState("");

  const { sessions, total, loading } = useSessionListStore({
    type: typeFilter || undefined,
    source: sourceFilter || undefined,
    search: search || undefined,
  });

  const hasFilters = Boolean(search || typeFilter || sourceFilter);

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("");
    setSourceFilter("");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      <header className="shrink-0 px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">会话</h1>
        <p className="text-sm text-muted-foreground">浏览平台管理的 Agent 会话 ({total})</p>
      </header>

      <FilterBar
        typeFilter={typeFilter}
        sourceFilter={sourceFilter}
        search={search}
        onTypeChange={setTypeFilter}
        onSourceChange={setSourceFilter}
        onSearchChange={setSearch}
      />

      <div className="flex-1 overflow-y-auto px-6 py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Session ID</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>来源</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>摘要</TableHead>
              <TableHead>关联实体</TableHead>
              <TableHead className="text-right">消息数</TableHead>
              <TableHead>最后活跃</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SessionTableBody
              loading={loading}
              sessions={sessions}
              hasFilters={hasFilters}
              onClearFilters={clearFilters}
              onNavigate={onNavigate}
            />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
