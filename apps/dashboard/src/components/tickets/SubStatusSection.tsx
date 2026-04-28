import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@teamsland/ui/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TicketRecord } from "../../hooks/useTickets.js";
import { TicketCard } from "./TicketCard.js";

export function SubStatusSection({
  label,
  tickets,
  onTicketClick,
}: {
  label: string;
  tickets: TicketRecord[];
  onTicketClick: (issueId: string) => void;
}) {
  const hasTickets = tickets.length > 0;
  const [open, setOpen] = useState(hasTickets);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={`flex w-full items-center justify-between px-1.5 py-1 rounded text-xs hover:bg-accent/50 transition-colors ${
            !hasTickets && !open ? "opacity-50" : ""
          }`}
        >
          <span className="flex items-center gap-1 font-medium text-muted-foreground">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {label}
          </span>
          <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 min-w-[18px] text-center">
            {tickets.length}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1.5 pt-1 pb-2 px-0.5">
          {tickets.map((t) => (
            <TicketCard key={t.issueId} ticket={t} onClick={() => onTicketClick(t.issueId)} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
