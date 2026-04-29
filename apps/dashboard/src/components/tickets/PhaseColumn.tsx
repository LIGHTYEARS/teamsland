// apps/dashboard/src/components/tickets/PhaseColumn.tsx
import { ChevronLeft } from "lucide-react";
import type { TicketRecord } from "../../hooks/useTickets.js";
import { SubStatusSection } from "./SubStatusSection.js";

const STATE_LABELS: Record<string, string> = {
  received: "已接收",
  enriching: "补全信息中",
  triaging: "分类中",
  awaiting_clarification: "待补充信息",
  ready: "就绪",
  executing: "执行中",
  completed: "已完成",
  failed: "失败",
  suspended: "已挂起",
  skipped: "已跳过",
};

const ACCENT_COLORS: Record<string, { bar: string; badge: string; badgeText: string }> = {
  blue: { bar: "bg-info", badge: "bg-info/10", badgeText: "text-info" },
  yellow: { bar: "bg-warning", badge: "bg-warning/10", badgeText: "text-warning" },
  green: { bar: "bg-success", badge: "bg-success/10", badgeText: "text-success" },
  gray: { bar: "bg-muted-foreground", badge: "bg-muted-foreground/10", badgeText: "text-muted-foreground" },
};

export function PhaseColumn({
  label,
  accentColor,
  states,
  ticketsByState,
  onTicketClick,
  onCollapse,
}: {
  label: string;
  accentColor: string;
  states: readonly string[];
  ticketsByState: Map<string, TicketRecord[]>;
  onTicketClick: (issueId: string) => void;
  onCollapse?: () => void;
}) {
  const colors = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.gray;
  const totalCount = states.reduce((sum, s) => sum + (ticketsByState.get(s)?.length ?? 0), 0);

  return (
    <div className="flex flex-1 flex-col min-w-0 bg-card rounded-lg overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-border/50">
        <div className="flex items-center gap-2">
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="text-muted-foreground hover:text-foreground transition-colors -ml-1"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <div className={`w-[3px] h-4 rounded-full ${colors.bar}`} />
          <span className="text-sm font-semibold text-foreground">{label}</span>
        </div>
        <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${colors.badge} ${colors.badgeText}`}>
          {totalCount}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {states.map((state) => (
          <SubStatusSection
            key={state}
            label={STATE_LABELS[state] ?? state.replace(/_/g, " ")}
            tickets={ticketsByState.get(state) ?? []}
            onTicketClick={onTicketClick}
          />
        ))}
      </div>
    </div>
  );
}
