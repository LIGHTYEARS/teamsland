import { StatusDot } from "@teamsland/ui/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@teamsland/ui/components/ui/tooltip";
import { cn } from "@teamsland/ui/lib/utils";
import { Brain, Cpu, Home, LogOut, Settings, Waypoints } from "lucide-react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import type { PageName } from "../../hooks/useRouter";

/** 导航项配置 */
const NAV_ITEMS: { page: PageName; label: string; icon: typeof Home }[] = [
  { page: "overview", label: "Overview", icon: Home },
  { page: "sessions", label: "Sessions", icon: Cpu },
  { page: "hooks", label: "Hooks", icon: Waypoints },
  { page: "memory", label: "Memory", icon: Brain },
  { page: "settings", label: "Settings", icon: Settings },
];

export interface NavSidebarProps {
  activePage: PageName;
  onNavigate: (page: PageName) => void;
  onLogout?: () => void;
}

/**
 * 全局导航侧边栏（icon-rail 模式）
 *
 * 左侧窄条，显示图标 + 文字标签的导航链接。
 * 底部显示 WebSocket 连接状态和用户操作。
 */
export function NavSidebar({ activePage, onNavigate, onLogout }: NavSidebarProps) {
  const { status } = useWebSocket();

  const wsVariant = status === "connected" ? "success" : status === "connecting" ? "warning" : "error";
  const wsLabel = status === "connected" ? "Connected" : status === "connecting" ? "Connecting…" : "Disconnected";

  return (
    <aside className="flex h-full w-12 flex-col items-center border-r border-border bg-background py-2">
      {/* Logo */}
      <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
        T
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {NAV_ITEMS.map(({ page, label, icon: Icon }) => (
          <Tooltip key={page}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={label}
                onClick={() => onNavigate(page)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                  activePage === page
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon size={18} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* Bottom: status + logout */}
      <div className="flex flex-col items-center gap-2 pt-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex h-6 w-6 items-center justify-center">
              <StatusDot variant={wsVariant} pulse={status === "connecting"} />
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{wsLabel}</TooltipContent>
        </Tooltip>

        {onLogout && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Logout"
                onClick={onLogout}
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <LogOut size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Logout</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
