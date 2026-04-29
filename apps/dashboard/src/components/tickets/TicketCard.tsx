import { Badge } from "@teamsland/ui/components/ui/badge";
import { Card } from "@teamsland/ui/components/ui/card";
import { AlertCircle, Clock, User } from "lucide-react";
import type { TicketRecord } from "../../hooks/useTickets.js";

const STATE_COLORS: Record<string, string> = {
  received: "bg-info/10 text-info border-info/20",
  enriching: "bg-info/10 text-info border-info/20",
  triaging: "bg-warning/10 text-warning border-warning/20",
  awaiting_clarification: "bg-warning/10 text-warning border-warning/20",
  ready: "bg-info/10 text-info border-info/20",
  executing: "bg-success/10 text-success border-success/20",
  completed: "bg-success/10 text-success border-success/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
  suspended: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
  skipped: "bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20",
};

function formatDwell(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function parseTitle(ticket: TicketRecord): string {
  if (!ticket.context) return ticket.issueId;
  try {
    const ctx = JSON.parse(ticket.context) as { basic?: { title?: string } };
    return ctx.basic?.title ?? ticket.issueId;
  } catch {
    return ticket.issueId;
  }
}

function parsePriority(ticket: TicketRecord): string | undefined {
  if (!ticket.context) return undefined;
  try {
    return (JSON.parse(ticket.context) as { basic?: { priority?: string } }).basic?.priority;
  } catch {
    return undefined;
  }
}

function parseAssignee(ticket: TicketRecord): string | undefined {
  if (!ticket.context) return undefined;
  try {
    return (JSON.parse(ticket.context) as { basic?: { assignee?: string } }).basic?.assignee;
  } catch {
    return undefined;
  }
}

export function TicketCard({ ticket, onClick }: { ticket: TicketRecord; onClick: () => void }) {
  const title = parseTitle(ticket);
  const priority = parsePriority(ticket);
  const assignee = parseAssignee(ticket);
  const dwellMs = Date.now() - ticket.updatedAt;
  const isStale = ticket.state === "awaiting_clarification" && dwellMs > 30 * 60 * 1000;

  return (
    <Card className="cursor-pointer p-3 hover:bg-accent/50 transition-colors space-y-2" onClick={onClick}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug line-clamp-2">{title}</p>
        <Badge variant="outline" className={`shrink-0 text-[10px] ${STATE_COLORS[ticket.state] ?? ""}`}>
          {ticket.state}
        </Badge>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {priority && <span className="capitalize">{priority}</span>}
        {assignee && (
          <span className="flex items-center gap-1">
            <User size={12} />
            {assignee}
          </span>
        )}
        <span className={`flex items-center gap-1 ${isStale ? "text-destructive font-medium" : ""}`}>
          {isStale ? <AlertCircle size={12} /> : <Clock size={12} />}
          {formatDwell(dwellMs)}
        </span>
      </div>

      <div className="text-[10px] text-muted-foreground">
        {ticket.eventType !== "unknown" && (
          <Badge variant="secondary" className="text-[10px] h-4 px-1">
            {ticket.eventType.replace(/_/g, " ")}
          </Badge>
        )}
      </div>
    </Card>
  );
}
