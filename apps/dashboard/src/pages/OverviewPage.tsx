import { Badge } from "@teamsland/ui/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@teamsland/ui/components/ui/card";
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
  const { status: wsStatus, subscribe } = useWebSocket();

  // 事件环形缓冲区
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const eventIdRef = useRef(0);

  // 初始加载
  useEffect(() => {
    const fetchAll = async () => {
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
        // 静默处理网络错误
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // 实时更新：WS agents_update
  useEffect(() => {
    const unsub = subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "agents_update") {
        // 重新获取 workers
        fetch("/api/workers")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d) setWorkers(d.workers ?? []);
          })
          .catch(() => {});

        // 追加事件
        setEvents((prev) => {
          const next = [
            ...prev,
            {
              id: String(++eventIdRef.current),
              type: "agents_update",
              message: "Agent topology updated",
              timestamp: Date.now(),
            },
          ];
          return next.slice(-20);
        });
      }
    });
    return unsub;
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
        // 从 worktreePath 推断 project 名，或用 sessionId
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
        <p className="text-sm text-muted-foreground">System health at a glance</p>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* 状态指标卡片 */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="Active Workers"
            value={stats.running}
            icon={<Cpu size={16} />}
            variant={stats.running > 0 ? "success" : "default"}
          />
          <MetricCard label="Task Workers" value={stats.taskWorkers} icon={<Activity size={16} />} />
          <MetricCard label="Observers" value={stats.observers} icon={<Activity size={16} />} />
          <MetricCard
            label="Hooks"
            value={hooksStatus?.enabled ? `${hooksStatus.loadedHooks ?? 0} loaded` : "Disabled"}
            icon={<Waypoints size={16} />}
            variant={hooksStatus?.enabled ? "success" : "warning"}
          />
        </div>

        {/* WebSocket + Viking 状态 */}
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <StatusDot
              variant={wsStatus === "connected" ? "success" : wsStatus === "connecting" ? "warning" : "error"}
            />
            <span className="text-muted-foreground">WebSocket: {wsStatus}</span>
          </span>
        </div>

        {/* Workers 表格 */}
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
                <TableEmpty colSpan={5}>Loading…</TableEmpty>
              ) : workers.length === 0 ? (
                <TableEmpty colSpan={5}>No active workers. The system is idle.</TableEmpty>
              ) : (
                workers.map((w) => (
                  <TableRow key={w.workerId} className="cursor-pointer" onClick={() => handleWorkerClick(w)}>
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

        {/* 最近事件 */}
        <div>
          <h2 className="text-sm font-medium text-foreground mb-3">Recent Events</h2>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet. Events will appear as the system runs.</p>
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
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  variant = "default",
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  variant?: "default" | "success" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {variant !== "default" && <StatusDot variant={variant} size="sm" />}
          <span className="text-2xl font-bold tabular-nums">{value}</span>
        </div>
      </CardContent>
    </Card>
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
