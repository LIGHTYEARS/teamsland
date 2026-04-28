// apps/dashboard/src/components/tickets/TicketBoard.tsx
import { useState } from "react";
import type { TicketRecord } from "../../hooks/useTickets.js";
import { CollapsedPhaseStrip } from "./CollapsedPhaseStrip.js";
import { PhaseColumn } from "./PhaseColumn.js";

const PHASE_GROUPS = [
  { label: "收集", accentColor: "blue", states: ["received", "enriching"] },
  { label: "分类", accentColor: "yellow", states: ["triaging", "awaiting_clarification"] },
  { label: "执行", accentColor: "green", states: ["ready", "executing"] },
  { label: "已结束", accentColor: "gray", states: ["completed", "failed", "suspended", "skipped"] },
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
    <div className="flex h-full gap-2 p-2">
      {PHASE_GROUPS.map((group) => {
        const isTerminal = group.label === "已结束";
        const totalCount = group.states.reduce((sum, s) => sum + (byState.get(s)?.length ?? 0), 0);

        if (isTerminal && !terminalExpanded) {
          return (
            <CollapsedPhaseStrip
              key={group.label}
              label={group.label}
              accentColor={group.accentColor}
              totalCount={totalCount}
              onExpand={() => setTerminalExpanded(true)}
            />
          );
        }

        return (
          <PhaseColumn
            key={group.label}
            label={group.label}
            accentColor={group.accentColor}
            states={group.states}
            ticketsByState={byState}
            onTicketClick={onTicketClick}
            onCollapse={isTerminal ? () => setTerminalExpanded(false) : undefined}
          />
        );
      })}
    </div>
  );
}
