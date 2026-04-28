import { Badge } from "@teamsland/ui/components/ui/badge";
import { Card, CardContent, CardHeader } from "@teamsland/ui/components/ui/card";
import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import { MetricCard } from "@teamsland/ui/components/ui/metric-card";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { StatusDot } from "@teamsland/ui/components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@teamsland/ui/components/ui/table";
import { Activity, Cpu, Waypoints } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext";

interface WorkerSummary {
  workerId: string;
  pid: number;
  sessionId: string;
  issueId?: string;
  worktreePath?: string;
  status: string;
  taskBrief?: string;
  createdAt: number;
  origin?: { source?: string; requester?: string };
}

interface HooksStatus {
  enabled: boolean;
  loadedHooks?: number;
  totalTriggers?: number;
  totalMatches?: number;
}

interface TopologyGraph {
  nodes: { id: string; type: string; status: string; label?: string; taskBrief?: string }[];
  edges: { from: string; to: string; type: string }[];
}

interface SystemEvent {
  id: string;
  type: string;
  message: string;
  timestamp: number;
}

interface OverviewStats {
  running: number;
  taskWorkers: number;
  observers: number;
}

function MetricCardsGrid({
  loading,
  stats,
  hooksStatus,
}: {
  loading: boolean;
  stats: OverviewStats;
  hooksStatus: HooksStatus | null;
}) {
  const hooksDisplay = hooksStatus?.enabled ? `已加载 ${hooksStatus.loadedHooks ?? 0} 个` : "已禁用";
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
          <Card key={`skeleton-metric-${i}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))
      ) : (
        <>
          <MetricCard
            label="活跃 Worker"
            value={stats.running}
            icon={<Cpu size={16} />}
            variant={stats.running > 0 ? "success" : "default"}
          />
          <MetricCard label="任务 Worker" value={stats.taskWorkers} icon={<Activity size={16} />} />
          <MetricCard label="观察者" value={stats.observers} icon={<Activity size={16} />} />
          <MetricCard
            label="Hooks"
            value={hooksDisplay}
            icon={<Waypoints size={16} />}
            variant={hooksStatus?.enabled ? "success" : "warning"}
          />
        </>
      )}
    </div>
  );
}

function WorkersTable({
  loading,
  workers,
  onWorkerClick,
}: {
  loading: boolean;
  workers: WorkerSummary[];
  onWorkerClick: (w: WorkerSummary) => void;
}) {
  return (
    <div>
      <h2 className="text-sm font-medium text-foreground mb-3">Active Workers</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Task Brief</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="font-variant-numeric: tabular-nums">Duration</TableHead>
            <TableHead>Meego</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders
              <TableRow key={`skeleton-row-${i}`}>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-12" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </TableCell>
              </TableRow>
            ))
          ) : workers.length === 0 ? (
            <TableEmpty colSpan={5}>暂无活跃 Worker，系统空闲中。</TableEmpty>
          ) : (
            workers.map((w) => (
              <TableRow key={w.workerId} className="cursor-pointer" onClick={() => onWorkerClick(w)}>
                <TableCell className="font-mono text-xs">{w.workerId.slice(0, 12)}</TableCell>
                <TableCell className="max-w-[300px] truncate">{w.taskBrief ?? "—"}</TableCell>
                <TableCell>
                  <WorkerStatusBadge status={w.status} />
                </TableCell>
                <TableCell className="tabular-nums text-xs text-muted-foreground">
                  {formatDuration(w.createdAt)}
                </TableCell>
                <TableCell className="text-xs">
                  {w.issueId ? (
                    <Badge variant="outline" className="text-xs">
                      {w.issueId}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Overview 页面
 *
 * 系统运行概览，显示状态指标、活跃 worker 列表、最近事件。
 */
export function OverviewPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [workers, setWorkers] = useState<WorkerSummary[]>([]);
  const [hooksStatus, setHooksStatus] = useState<HooksStatus | null>(null);
  const [topology, setTopology] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const { status: wsStatus, subscribe } = useWebSocket();

  // 事件环形缓冲区
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const eventIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workersRes, hooksRes, topoRes] = await Promise.all([
        fetch("/api/workers"),
        fetch("/api/hooks/status"),
        fetch("/api/topology"),
      ]);
      if (workersRes.ok) {
        const data = await workersRes.json();
        setWorkers(data.workers ?? []);
      }
      if (hooksRes.ok) {
        setHooksStatus(await hooksRes.json());
      }
      if (topoRes.ok) {
        setTopology(await topoRes.json());
      }
    } catch {
      setError("无法加载系统状态");
    } finally {
      setLoading(false);
      setLastUpdated(Date.now());
    }
  }, []);

  // 初始加载
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 实时更新：WS agents_update
  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type !== "agents_update") return;
      fetch("/api/workers")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d) setWorkers(d.workers ?? []);
        })
        .catch(() => {});
      setEvents((prev) => {
        const next = [
          ...prev,
          {
            id: String(++eventIdRef.current),
            type: "agents_update",
            message: "Agent 拓扑已更新",
            timestamp: Date.now(),
          },
        ];
        return next.slice(-20);
      });
    });
  }, [subscribe]);

  // 统计
  const stats = useMemo(() => {
    const nodes = topology?.nodes ?? [];
    const running = workers.filter((w) => w.status === "running").length;
    const coordinators = nodes.filter((n) => n.type === "coordinator").length;
    const taskWorkers = nodes.filter((n) => n.type === "task_worker").length;
    const observers = nodes.filter((n) => n.type === "observer_worker").length;
    return { running, coordinators, taskWorkers, observers, total: workers.length };
  }, [workers, topology]);

  const handleWorkerClick = useCallback(
    (w: WorkerSummary) => {
      if (w.sessionId) {
        onNavigate(`/sessions/_/${w.sessionId}`);
      }
    },
    [onNavigate],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* 页面标题 */}
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Overview</h1>
        <p className="text-sm text-muted-foreground">
          System health at a glance
          {lastUpdated && <span className="ml-2 text-xs">· 更新于 {new Date(lastUpdated).toLocaleTimeString()}</span>}
        </p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {error ? (
          <ErrorCard message={error} onRetry={fetchData} />
        ) : (
          <>
            <MetricCardsGrid loading={loading} stats={stats} hooksStatus={hooksStatus} />

            {/* WebSocket 状态 */}
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5">
                <StatusDot
                  variant={wsStatus === "connected" ? "success" : wsStatus === "connecting" ? "warning" : "error"}
                />
                <span className="text-muted-foreground">WebSocket: {wsStatus}</span>
              </span>
            </div>

            <WorkersTable loading={loading} workers={workers} onWorkerClick={handleWorkerClick} />

            {/* 最近事件 */}
            <div>
              <h2 className="text-sm font-medium text-foreground mb-3">最近事件</h2>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无事件。系统运行后将在此显示。</p>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {events
                    .slice()
                    .reverse()
                    .map((e) => (
                      <div key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          {e.type}
                        </Badge>
                        <span className="truncate">{e.message}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WorkerStatusBadge({ status }: { status: string }) {
  const variant =
    status === "running"
      ? "default"
      : status === "completed"
        ? "secondary"
        : status === "failed"
          ? "destructive"
          : "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {status}
    </Badge>
  );
}

function formatDuration(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
