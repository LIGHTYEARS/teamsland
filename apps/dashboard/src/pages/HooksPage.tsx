import { Badge } from "@teamsland/ui/components/ui/badge";
import { Button } from "@teamsland/ui/components/ui/button";
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
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Hooks</h1>
        <p className="text-sm text-muted-foreground">Manage the three-layer event processing system</p>
      </header>

      <div className="shrink-0 px-6 pt-3">
        <Tabs>
          <TabsList>
            <TabsTrigger active={tab === "status"} onClick={() => onTabChange("status")}>
              Status
            </TabsTrigger>
            <TabsTrigger active={tab === "pending"} onClick={() => onTabChange("pending")}>
              Pending Review
            </TabsTrigger>
            <TabsTrigger active={tab === "evolution"} onClick={() => onTabChange("evolution")}>
              Evolution Log
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

  useEffect(() => {
    Promise.all([fetch("/api/hooks/status"), fetch("/api/hooks/metrics")])
      .then(async ([sRes, mRes]) => {
        if (sRes.ok) setStatus(await sRes.json());
        if (mRes.ok) setMetrics(await mRes.json());
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      {/* Engine Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Engine Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <StatusDot variant={status?.enabled ? "success" : "warning"} size="lg" />
            <span className="text-sm font-medium">{status?.enabled ? "Enabled" : "Disabled"}</span>
            {status?.loadedHooks !== undefined && (
              <Badge variant="secondary" className="text-xs">
                {status.loadedHooks} hooks loaded
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard label="Total Triggers" value={metrics.totalTriggers ?? 0} />
          <MetricCard label="Total Matches" value={metrics.totalMatches ?? 0} />
          <MetricCard label="Executions" value={metrics.totalExecutions ?? 0} />
          <MetricCard
            label="Match Rate"
            value={metrics.matchRate != null ? `${(metrics.matchRate * 100).toFixed(1)}%` : "—"}
          />
          <MetricCard
            label="Avg Latency"
            value={metrics.avgLatencyMs != null ? `${metrics.avgLatencyMs.toFixed(0)}ms` : "—"}
          />
          <MetricCard label="Errors" value={metrics.errors ?? 0} />
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums mt-1">{value}</p>
      </CardContent>
    </Card>
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No pending hooks.</p>
        <p className="text-xs mt-1">The brain hasn't proposed any new automation recently.</p>
      </div>
    );
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
                Reject
              </Button>
              <Button size="sm" onClick={() => handleApprove(hook.filename)}>
                <Check size={14} />
                Approve
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
          <TableHead>Timestamp</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Hook</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableEmpty colSpan={4}>Loading…</TableEmpty>
        ) : entries.length === 0 ? (
          <TableEmpty colSpan={4}>No evolution events recorded.</TableEmpty>
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
