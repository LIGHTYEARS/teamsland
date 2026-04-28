# Ticket Board Phase-Based Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the 10-column flat kanban board into 4 phase-based swimlane columns with collapsible sub-status sections.

**Architecture:** Replace the flat `TicketColumn` per-state rendering with 3 new components: `PhaseColumn` (full-width phase container), `SubStatusSection` (collapsible per-status group using Radix Collapsible), and `CollapsedPhaseStrip` (thin vertical strip for the collapsed 已结束 phase). The existing `TicketBoard` is refactored to orchestrate these. No data-layer changes.

**Tech Stack:** React, Tailwind CSS, Radix UI Collapsible, Lucide icons

**Spec:** `docs/superpowers/specs/2026-04-28-ticket-board-redesign.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/dashboard/src/components/tickets/SubStatusSection.tsx` | Collapsible section for one sub-status within a phase column |
| Create | `apps/dashboard/src/components/tickets/CollapsedPhaseStrip.tsx` | Thin vertical strip for collapsed phases |
| Create | `apps/dashboard/src/components/tickets/PhaseColumn.tsx` | Full-width phase column with header + sub-sections |
| Rewrite | `apps/dashboard/src/components/tickets/TicketBoard.tsx` | Orchestrates 4 phase columns, manages terminal-expanded state |
| Delete | `apps/dashboard/src/components/tickets/TicketColumn.tsx` | Replaced by PhaseColumn + SubStatusSection |
| Modify | `apps/dashboard/src/pages/TicketsPage.tsx` | Update skeleton loading to match new 4-column layout |

---

### Task 1: Create SubStatusSection

The lowest-level new component. A collapsible section for a single sub-status (e.g., "已接收") that shows a header with chevron + count, and expands to reveal ticket cards.

**Files:**
- Create: `apps/dashboard/src/components/tickets/SubStatusSection.tsx`

- [ ] **Step 1: Create SubStatusSection component**

Create the file with the full component. It uses the Radix `Collapsible` primitive for accessible expand/collapse. Empty sections default to collapsed with 50% opacity; non-empty sections default to expanded.

```tsx
// apps/dashboard/src/components/tickets/SubStatusSection.tsx
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck 2>&1 | tail -20`

Expected: No type errors in `SubStatusSection.tsx`. There may be existing errors elsewhere — focus only on the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/tickets/SubStatusSection.tsx
git commit -m "feat(tickets): add SubStatusSection collapsible component"
```

---

### Task 2: Create CollapsedPhaseStrip

A thin vertical strip shown when a phase (specifically 已结束) is collapsed. Displays a vertical label and count badge. Clicking expands the phase.

**Files:**
- Create: `apps/dashboard/src/components/tickets/CollapsedPhaseStrip.tsx`

- [ ] **Step 1: Create CollapsedPhaseStrip component**

```tsx
// apps/dashboard/src/components/tickets/CollapsedPhaseStrip.tsx
import { ChevronRight } from "lucide-react";

const ACCENT_COLORS: Record<string, { bar: string; badge: string; badgeText: string }> = {
  blue: { bar: "bg-blue-500", badge: "bg-blue-500/10", badgeText: "text-blue-500" },
  yellow: { bar: "bg-yellow-500", badge: "bg-yellow-500/10", badgeText: "text-yellow-500" },
  green: { bar: "bg-green-500", badge: "bg-green-500/10", badgeText: "text-green-500" },
  gray: { bar: "bg-gray-500", badge: "bg-gray-500/10", badgeText: "text-gray-500" },
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
      <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-lr]">
        {label}
      </span>
      <span className={`text-[10px] font-medium mt-2 rounded-full px-1.5 ${colors.badge} ${colors.badgeText}`}>
        {totalCount}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck 2>&1 | tail -20`

Expected: No type errors in `CollapsedPhaseStrip.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/tickets/CollapsedPhaseStrip.tsx
git commit -m "feat(tickets): add CollapsedPhaseStrip component"
```

---

### Task 3: Create PhaseColumn

A full-width phase column with a colored header and scrollable area containing `SubStatusSection` components. Also handles the "collapsible" variant for the 已结束 phase (renders a collapse chevron in the header).

**Files:**
- Create: `apps/dashboard/src/components/tickets/PhaseColumn.tsx`

- [ ] **Step 1: Create PhaseColumn component**

```tsx
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
  blue: { bar: "bg-blue-500", badge: "bg-blue-500/10", badgeText: "text-blue-500" },
  yellow: { bar: "bg-yellow-500", badge: "bg-yellow-500/10", badgeText: "text-yellow-500" },
  green: { bar: "bg-green-500", badge: "bg-green-500/10", badgeText: "text-green-500" },
  gray: { bar: "bg-gray-500", badge: "bg-gray-500/10", badgeText: "text-gray-500" },
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
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck 2>&1 | tail -20`

Expected: No type errors in `PhaseColumn.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/tickets/PhaseColumn.tsx
git commit -m "feat(tickets): add PhaseColumn component with header and sub-sections"
```

---

### Task 4: Rewrite TicketBoard and delete TicketColumn

Replace the flat rendering of 10 `TicketColumn` components with 4 phase columns. The 已结束 phase renders as a `CollapsedPhaseStrip` by default, expanding to a full `PhaseColumn` when clicked.

**Files:**
- Rewrite: `apps/dashboard/src/components/tickets/TicketBoard.tsx`
- Delete: `apps/dashboard/src/components/tickets/TicketColumn.tsx`

- [ ] **Step 1: Rewrite TicketBoard.tsx**

Replace the entire contents of `TicketBoard.tsx` with:

```tsx
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
```

- [ ] **Step 2: Delete TicketColumn.tsx**

```bash
rm apps/dashboard/src/components/tickets/TicketColumn.tsx
```

- [ ] **Step 3: Verify no imports reference the deleted file**

Run: `grep -r "TicketColumn" /Users/bytedance/workspace/teamsland/apps/dashboard/src/ 2>/dev/null`

Expected: No results. The old `TicketBoard.tsx` was the only consumer and it's been rewritten.

- [ ] **Step 4: Verify the project compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck 2>&1 | tail -20`

Expected: No type errors related to ticket components.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/tickets/TicketBoard.tsx
git rm apps/dashboard/src/components/tickets/TicketColumn.tsx
git commit -m "refactor(tickets): replace flat columns with phase-based swimlane board

Restructure TicketBoard from 10 flat TicketColumn components into
4 PhaseColumn components with collapsible SubStatusSection groups.
已结束 phase collapses to a thin vertical strip by default."
```

---

### Task 5: Update TicketsPage skeleton

The loading skeleton currently renders 4 narrow `w-64` columns mimicking the old layout. Update it to show 3 flex-1 phase column skeletons + 1 thin collapsed strip skeleton.

**Files:**
- Modify: `apps/dashboard/src/pages/TicketsPage.tsx:88-104`

- [ ] **Step 1: Replace the skeleton section**

In `TicketsPage.tsx`, replace lines 88–104 (the `loading` branch inside the `flex-1 min-h-0` div) with:

```tsx
          <div className="flex h-full gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton columns
              <div key={i} className="flex flex-1 flex-col bg-card rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-[3px] rounded-full" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-5 w-6 rounded-full" />
                </div>
                <div className="p-2 space-y-2">
                  {Array.from({ length: 2 }).map((_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton sections
                    <div key={j} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1.5 py-1">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3 w-4 rounded-full" />
                      </div>
                      <Skeleton className="h-20 w-full rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col items-center w-12 shrink-0 bg-card rounded-lg pt-3 pb-4">
              <Skeleton className="w-[3px] h-4 rounded-full mb-2" />
              <Skeleton className="h-3 w-3 rounded mb-1" />
              <Skeleton className="h-16 w-3 rounded" />
              <Skeleton className="h-4 w-5 rounded-full mt-2" />
            </div>
          </div>
```

This replaces the old code block:
```tsx
          <div className="flex h-full gap-1 p-2">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton columns, no reordering
              <div key={i} className="flex flex-col w-64 shrink-0">
                <div className="px-2 py-1.5 mb-2">
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="space-y-2 px-1">
                  {Array.from({ length: 2 }).map((_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton cards, no reordering
                    <Skeleton key={j} className="h-24 w-full rounded-lg" />
                  ))}
                </div>
              </div>
            ))}
          </div>
```

- [ ] **Step 2: Verify the project compiles**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck 2>&1 | tail -20`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/TicketsPage.tsx
git commit -m "style(tickets): update skeleton to match phase-based board layout"
```

---

### Task 6: Visual verification

Start the dev server and verify the redesigned board in a browser.

- [ ] **Step 1: Start the dashboard dev server**

Run: `cd /Users/bytedance/workspace/teamsland && bun run dev:dashboard`

Open `http://localhost:5173` in a browser. Navigate to the tickets page.

- [ ] **Step 2: Verify Scenario 1 — Board renders with 4 phase columns**

Confirm:
- 3 expanded phase columns (收集, 分类, 执行) with equal width
- 1 collapsed vertical strip for 已结束 on the right
- Each phase column has a colored accent bar (blue, yellow, green)
- Each phase header shows the total ticket count

- [ ] **Step 3: Verify Scenario 2 — Sub-sections auto-expand for non-empty states**

Confirm:
- Sub-sections with tickets are expanded by default
- Sub-sections with 0 tickets are collapsed with reduced opacity
- Count badges show correct numbers

- [ ] **Step 4: Verify Scenario 3 & 4 — Collapsing/expanding sub-sections**

Click a non-empty sub-section header — confirm it collapses (chevron changes, cards hidden, count stays).
Click an empty sub-section header — confirm it expands (opacity returns to 100%, empty area shown).

- [ ] **Step 5: Verify Scenario 5 & 6 — 已结束 phase expand/collapse**

Click the collapsed 已结束 strip — confirm it expands to a full column with sub-sections and a collapse chevron.
Click the collapse chevron — confirm it returns to the thin strip.

- [ ] **Step 6: Verify Scenario 7 — Ticket card click**

Click a ticket card — confirm the TicketDetailDrawer opens.

- [ ] **Step 7: Verify Scenario 8 — Phase filter interaction**

Select a phase filter (e.g., 执行) — confirm filtered phases show 0 counts with collapsed sub-sections at 50% opacity.

- [ ] **Step 8: Verify Scenario 10 — Skeleton loading**

Hard-refresh the page and observe the skeleton: 3 phase column skeletons + 1 thin strip skeleton.

---

## Self-Review

1. **Spec coverage:** All 10 acceptance scenarios have corresponding implementation or verification steps. File map matches spec exactly.
2. **Placeholder scan:** No TBD/TODO/placeholders. All code is complete.
3. **Type consistency:** `SubStatusSection` props (`label`, `tickets`, `onTicketClick`) match usage in `PhaseColumn`. `CollapsedPhaseStrip` props (`label`, `accentColor`, `totalCount`, `onExpand`) match usage in `TicketBoard`. `PhaseColumn` props (`onCollapse?`) match conditional passing in `TicketBoard`. `ACCENT_COLORS` is duplicated in `CollapsedPhaseStrip` and `PhaseColumn` — acceptable since they're small lookup tables with no shared mutation, and extracting to a shared file would add coupling for 4 lines.
4. **Acceptance scenario trace:**
   - Scenario 1 (4 phase columns): Task 4 (TicketBoard rewrite) + Task 6 Step 2
   - Scenario 2 (auto-expand): Task 1 (SubStatusSection default state) + Task 6 Step 3
   - Scenario 3 (collapse non-empty): Task 1 (toggle behavior) + Task 6 Step 4
   - Scenario 4 (expand empty): Task 1 (opacity logic) + Task 6 Step 4
   - Scenario 5 (expand 已结束): Task 4 (terminal expand state) + Task 6 Step 5
   - Scenario 6 (collapse 已结束): Task 3 (onCollapse prop) + Task 4 + Task 6 Step 5
   - Scenario 7 (card click): Unchanged TicketCard + Task 6 Step 6
   - Scenario 8 (filter): Unchanged TicketsPage filtering + Task 6 Step 7
   - Scenario 9 (empty board): Unchanged TicketsPage EmptyState guard
   - Scenario 10 (skeleton): Task 5 + Task 6 Step 8
