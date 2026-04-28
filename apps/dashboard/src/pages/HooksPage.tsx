import { Badge } from "@teamsland/ui/components/ui/badge";
import { Button } from "@teamsland/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@teamsland/ui/components/ui/card";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@teamsland/ui/components/ui/tabs";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface HooksStatusData {
  enabled: boolean;
  loadedHooks?: number;
  hookFiles?: string[];
}

interface HooksMetrics {
  totalTriggers?: number;
  totalMatches?: number;
  totalExecutions?: number;
  matchRate?: number;
  avgLatencyMs?: number;
  errors?: number;
}

interface PendingHook {
  filename: string;
  path: string;
}

interface EvolutionEntry {
  timestamp: string;
  action: string;
  hookPath: string;
  reason?: string;
  rejectedReason?: string;
}

/**
 * Hooks 管理页面
 *
 * 三个选项卡：Status / Pending Review / Evolution Log
 */
export function HooksPage({ activeTab, onTabChange }: { activeTab?: string; onTabChange: (tab: string) => void }) {
  const tab = activeTab || "status";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-muted/40">
      <header className="shrink-0 px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Hooks</h1>
        <p className="text-sm text-muted-foreground">管理三层事件处理系统</p>
      </header>

      <div className="shrink-0 px-6 pt-3">
        <Tabs>
          <TabsList>
            <TabsTrigger active={tab === "status"} onClick={() => onTabChange("status")}>
              状态
            </TabsTrigger>
            <TabsTrigger active={tab === "pending"} onClick={() => onTabChange("pending")}>
              待审核
            </TabsTrigger>
            <TabsTrigger active={tab === "evolution"} onClick={() => onTabChange("evolution")}>
              演化日志
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <TabsContent active={tab === "status"}>
          <HooksStatusTab />
        </TabsContent>
        <TabsContent active={tab === "pending"}>
          <HooksPendingTab />
        </TabsContent>
        <TabsContent active={tab === "evolution"}>
          <HooksEvolutionTab />
        </TabsContent>
      </div>
    </div>
  );
}

function HooksStatusTab() {
  const [status, setStatus] = useState<HooksStatusData | null>(null);
  const [metrics, setMetrics] = useState<HooksMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetch("/api/hooks/status"), fetch("/api/hooks/metrics")])
      .then(async ([sRes, mRes]) => {
        if (sRes.ok) setStatus(await sRes.json());
        if (mRes.ok) setMetrics(await mRes.json());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      {/* Engine Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">引擎状态</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <StatusDot variant={status?.enabled ? "success" : "warning"} size="lg" />
            <span className="text-sm font-medium">{status?.enabled ? "已启用" : "已禁用"}</span>
            {status?.loadedHooks !== undefined && (
              <Badge variant="secondary" className="text-xs">
                已加载 {status.loadedHooks} 个 Hook
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders, no reordering
            <Card key={`skeleton-metric-${i}`}>
              <CardContent className="pt-4">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-7 w-12" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <MetricCard label="总触发数" value={metrics?.totalTriggers ?? 0} />
            <MetricCard label="总匹配数" value={metrics?.totalMatches ?? 0} />
            <MetricCard label="执行次数" value={metrics?.totalExecutions ?? 0} />
            <MetricCard
              label="匹配率"
              value={metrics?.matchRate != null ? `${(metrics.matchRate * 100).toFixed(1)}%` : "—"}
            />
            <MetricCard
              label="平均延迟"
              value={metrics?.avgLatencyMs != null ? `${metrics.avgLatencyMs.toFixed(0)}ms` : "—"}
            />
            <MetricCard label="错误数" value={metrics?.errors ?? 0} />
          </>
        )}
      </div>
    </div>
  );
}

function HooksPendingTab() {
  const [pending, setPending] = useState<PendingHook[]>([]);
  const [loading, setLoading] = useState(true);
  const [_previews, _setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/hooks/pending")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setPending(data.pending ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleApprove = useCallback(async (filename: string) => {
    await fetch(`/api/hooks/${filename}/approve`, { method: "POST" });
    setPending((prev) => prev.filter((p) => p.filename !== filename));
  }, []);

  const handleReject = useCallback(async (filename: string) => {
    await fetch(`/api/hooks/${filename}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Rejected from dashboard" }),
    });
    setPending((prev) => prev.filter((p) => p.filename !== filename));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders, no reordering
          <Card key={`skeleton-pending-${i}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <Skeleton className="h-4 w-40" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16 rounded-md" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-3 w-64" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (pending.length === 0) {
    return <EmptyState title="暂无待审核的 Hook" description="Brain 近期没有提出新的自动化方案。" />;
  }

  return (
    <div className="space-y-4">
      {pending.map((hook) => (
        <Card key={hook.filename}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-mono">{hook.filename}</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handleReject(hook.filename)}>
                <X size={14} />
                拒绝
              </Button>
              <Button size="sm" onClick={() => handleApprove(hook.filename)}>
                <Check size={14} />
                通过
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">{hook.path}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HooksEvolutionTab() {
  const [entries, setEntries] = useState<EvolutionEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/hooks/evolution-log?limit=50")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setEntries(data.entries ?? []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>时间</TableHead>
          <TableHead>操作</TableHead>
          <TableHead>Hook</TableHead>
          <TableHead>原因</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders, no reordering
            <TableRow key={`skeleton-row-${i}`}>
              <TableCell>
                <Skeleton className="h-4 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-16 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
            </TableRow>
          ))
        ) : entries.length === 0 ? (
          <TableEmpty colSpan={4}>
            <EmptyState title="暂无演化事件记录" />
          </TableEmpty>
        ) : (
          entries.map((e) => (
            <TableRow key={`${e.timestamp}-${e.hookPath}-${e.action}`}>
              <TableCell className="text-xs tabular-nums text-muted-foreground">
                {new Date(e.timestamp).toLocaleString()}
              </TableCell>
              <TableCell>
                <Badge
                  variant={e.action === "approve" ? "default" : e.action === "reject" ? "destructive" : "secondary"}
                  className="text-xs"
                >
                  {e.action}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs max-w-[200px] truncate">{e.hookPath}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">
                {e.reason ?? e.rejectedReason ?? "—"}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
