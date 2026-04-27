import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { TicketRecord } from "../../hooks/useTickets.js";
import { TicketColumn } from "./TicketColumn.js";

const PHASE_GROUPS = [
  { label: "Intake", states: ["received", "enriching"] },
  { label: "Triage", states: ["triaging", "awaiting_clarification"] },
  { label: "Execution", states: ["ready", "executing"] },
  { label: "Terminal", states: ["completed", "failed", "suspended", "skipped"] },
] as const;

function groupByState(tickets: TicketRecord[]): Map<string, TicketRecord[]> {
  const map = new Map<string, TicketRecord[]>();
  for (const t of tickets) {
    const list = map.get(t.state) ?? [];
    list.push(t);
    map.set(t.state, list);
  }
  return map;
}

export function TicketBoard({
  tickets,
  onTicketClick,
}: {
  tickets: TicketRecord[];
  onTicketClick: (issueId: string) => void;
}) {
  const byState = groupByState(tickets);
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  return (
    <div className="flex h-full gap-1 overflow-x-auto p-2">
      {PHASE_GROUPS.map((group, gi) => {
        const isTerminal = group.label === "Terminal";
        const totalCount = group.states.reduce((sum, s) => sum + (byState.get(s)?.length ?? 0), 0);

        return (
          <div key={group.label} className="flex gap-1">
            {gi > 0 && <div className="w-px bg-border shrink-0 mx-1" />}

            {isTerminal && !terminalExpanded ? (
              <button
                type="button"
                onClick={() => setTerminalExpanded(true)}
                className="flex flex-col items-center justify-start w-16 shrink-0 pt-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight size={14} />
                <span className="text-xs font-semibold uppercase tracking-wide mt-1 [writing-mode:vertical-lr]">
                  Terminal
                </span>
                <span className="text-xs mt-2 bg-muted rounded-full px-1.5">{totalCount}</span>
              </button>
            ) : (
              <>
                {isTerminal && (
                  <button
                    type="button"
                    onClick={() => setTerminalExpanded(false)}
                    className="flex items-start pt-2 px-1 text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown size={14} />
                  </button>
                )}
                {group.states.map((state) => (
                  <TicketColumn
                    key={state}
                    state={state}
                    tickets={byState.get(state) ?? []}
                    onTicketClick={onTicketClick}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
