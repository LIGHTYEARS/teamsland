import { Button } from "@teamsland/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@teamsland/ui/components/ui/card";
import { StatusDot } from "@teamsland/ui/components/ui/status-dot";
import { useEffect, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext";

interface HealthData {
  status: string;
  uptime: number;
}

/**
 * Settings 页面
 *
 * 只读系统配置查看，连接状态，基本信息。
 */
export function SettingsPage() {
  const { status: wsStatus } = useWebSocket();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [vikingOk, setVikingOk] = useState<boolean | null>(null);

  useEffect(() => {
    // 检查 server health
    fetch("/health")
      .then(async (r) => {
        if (r.ok) setHealth(await r.json());
      })
      .catch(() => {});

    // 检查 Viking
    fetch("/api/viking/ls?uri=viking://")
      .then((r) => setVikingOk(r.ok))
      .catch(() => setVikingOk(false));
  }, []);

  const handleLogout = () => {
    fetch("/auth/logout", { method: "POST" }).then(() => {
      window.location.reload();
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration and status</p>
      </header>

      <div className="flex-1 p-6 space-y-6 max-w-2xl">
        {/* 连接状态 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Connection Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow
              label="WebSocket"
              variant={wsStatus === "connected" ? "success" : wsStatus === "connecting" ? "warning" : "error"}
              detail={wsStatus}
            />
            <StatusRow
              label="OpenViking"
              variant={vikingOk === null ? "default" : vikingOk ? "success" : "error"}
              detail={vikingOk === null ? "Checking…" : vikingOk ? "Connected" : "Unavailable"}
            />
            <StatusRow
              label="Server"
              variant={health ? "success" : "default"}
              detail={health ? `Up ${formatUptime(health.uptime)}` : "Checking…"}
            />
          </CardContent>
        </Card>

        {/* 服务信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">About</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <DefinitionRow label="Platform" value="Teamsland" />
              <DefinitionRow label="Server Status" value={health?.status ?? "—"} />
              <DefinitionRow label="Uptime" value={health ? formatUptime(health.uptime) : "—"} />
            </dl>
          </CardContent>
        </Card>

        {/* 认证 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  variant,
  detail,
}: {
  label: string;
  variant: "default" | "success" | "warning" | "error";
  detail: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <StatusDot variant={variant} />
        {detail}
      </span>
    </div>
  );
}

function DefinitionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}
