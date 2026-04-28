import { Button } from "@teamsland/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@teamsland/ui/components/ui/card";
import { StatusDot } from "@teamsland/ui/components/ui/status-dot";
import { useEffect, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext";
import { useTheme } from "../hooks/useTheme";

interface HealthData {
  status: string;
  uptime: number;
}

const THEME_LABELS: Record<string, string> = {
  auto: "自动",
  light: "浅色",
  dark: "深色",
};

const THEME_DESCRIPTIONS: Record<string, string> = {
  auto: "跟随系统设置",
  light: "始终使用浅色主题",
  dark: "始终使用深色主题",
};

/**
 * Settings 页面
 *
 * 只读系统配置查看，连接状态，基本信息。
 */
export function SettingsPage() {
  const { theme, setTheme } = useTheme();
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
    <div className="flex h-full flex-col overflow-y-auto bg-muted/40">
      <header className="shrink-0 px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">设置</h1>
        <p className="text-sm text-muted-foreground">系统配置与状态</p>
      </header>

      <div className="flex-1 p-6 space-y-4 max-w-2xl">
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
              detail={vikingOk === null ? "检查中…" : vikingOk ? "已连接" : "不可用"}
            />
            <StatusRow
              label="服务器"
              variant={health ? "success" : "default"}
              detail={health ? `已运行 ${formatUptime(health.uptime)}` : "检查中…"}
            />
          </CardContent>
        </Card>

        {/* 外观 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">外观</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {(["auto", "light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    theme === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{THEME_DESCRIPTIONS[theme]}</p>
          </CardContent>
        </Card>

        {/* 服务信息 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">关于</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <DefinitionRow label="平台" value="Teamsland" />
              <DefinitionRow label="服务器状态" value={health?.status ?? "—"} />
              <DefinitionRow label="运行时间" value={health ? formatUptime(health.uptime) : "—"} />
            </dl>
          </CardContent>
        </Card>

        {/* 认证 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">认证</CardTitle>
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
