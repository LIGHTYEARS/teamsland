import { StatusDot } from "@teamsland/ui/components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "@teamsland/ui/components/ui/tooltip";
import { cn } from "@teamsland/ui/lib/utils";
import { Activity, Brain, Cpu, Home, LogOut, Settings, TicketCheck, Waypoints } from "lucide-react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import type { PageName } from "../../hooks/useRouter";

/** 导航项配置 */
const NAV_ITEMS: { page: PageName; label: string; icon: typeof Home; group: "monitor" | "manage" }[] = [
  { page: "overview", label: "总览", icon: Home, group: "monitor" },
  { page: "sessions", label: "会话", icon: Cpu, group: "monitor" },
  { page: "coordinator", label: "协调器", icon: Activity, group: "monitor" },
  { page: "tickets", label: "工单", icon: TicketCheck, group: "manage" },
  { page: "hooks", label: "Hooks", icon: Waypoints, group: "manage" },
  { page: "memory", label: "记忆", icon: Brain, group: "manage" },
  { page: "settings", label: "设置", icon: Settings, group: "manage" },
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
        {NAV_ITEMS.map(({ page, label, icon: Icon, group }, index) => {
          const prevGroup = index > 0 ? NAV_ITEMS[index - 1].group : group;
          return (
            <div key={page} className="w-full flex flex-col items-center">
              {group !== prevGroup && <div className="my-1 h-px w-6 bg-border" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    onClick={() => onNavigate(page)}
                    className={cn(
                      "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                      activePage === page
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    {activePage === page && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                    )}
                    <Icon size={18} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
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
            <TooltipContent side="right">登出</TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  );
}
