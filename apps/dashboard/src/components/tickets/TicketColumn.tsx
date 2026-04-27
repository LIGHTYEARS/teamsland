import type { TicketRecord } from "../../hooks/useTickets.js";
import { TicketCard } from "./TicketCard.js";

export function TicketColumn({
  state,
  tickets,
  onTicketClick,
}: {
  state: string;
  tickets: TicketRecord[];
  onTicketClick: (issueId: string) => void;
}) {
  return (
    <div className="flex flex-col w-64 shrink-0">
      <div className="flex items-center justify-between px-2 py-1.5 mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {state.replace(/_/g, " ")}
        </h3>
        <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 min-w-[20px] text-center">
          {tickets.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 px-1">
        {tickets.map((t) => (
          <TicketCard key={t.issueId} ticket={t} onClick={() => onTicketClick(t.issueId)} />
        ))}
      </div>
    </div>
  );
}
