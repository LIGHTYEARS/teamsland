// apps/dashboard/src/components/tickets/CollapsedPhaseStrip.tsx
import { ChevronRight } from "lucide-react";

const ACCENT_COLORS: Record<string, { bar: string; badge: string; badgeText: string }> = {
  blue: { bar: "bg-info", badge: "bg-info/10", badgeText: "text-info" },
  yellow: { bar: "bg-warning", badge: "bg-warning/10", badgeText: "text-warning" },
  green: { bar: "bg-success", badge: "bg-success/10", badgeText: "text-success" },
  gray: { bar: "bg-muted-foreground", badge: "bg-muted-foreground/10", badgeText: "text-muted-foreground" },
};

export function CollapsedPhaseStrip({
  label,
  accentColor,
  totalCount,
  onExpand,
}: {
  label: string;
  accentColor: string;
  totalCount: number;
  onExpand: () => void;
}) {
  const colors = ACCENT_COLORS[accentColor] ?? ACCENT_COLORS.gray;

  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex flex-col items-center w-12 shrink-0 bg-card rounded-lg pt-3 pb-4 text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <div className={`w-[3px] h-4 rounded-full ${colors.bar} mb-2`} />
      <ChevronRight size={12} className="mb-1" />
      <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-lr]">{label}</span>
      <span className={`text-[10px] font-medium mt-2 rounded-full px-1.5 ${colors.badge} ${colors.badgeText}`}>
        {totalCount}
      </span>
    </button>
  );
}
