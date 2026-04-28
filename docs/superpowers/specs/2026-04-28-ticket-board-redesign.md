# Ticket Board Phase-Based Redesign

**Date:** 2026-04-28
**Status:** Design
**Scope:** `apps/dashboard/src/components/tickets/`

## Problem

The current TicketBoard renders 10 flat kanban columns — one per ticket state. This creates:

1. **Information overload** — 10 columns compete for equal visual weight; the user cannot quickly identify what needs attention
2. **Wasted space** — most columns are empty, showing "暂无" across 80%+ of the screen
3. **No priority differentiation** — active states that require action look identical to terminal states that don't
4. **Horizontal overflow risk** — 10 × 256px columns = 2560px minimum, exceeding most viewports

## Solution

Restructure the board from 10 flat columns into **4 phase columns** with collapsible sub-status sections inside each. The code already groups statuses into 4 phases (`PHASE_GROUPS` in `TicketBoard.tsx`), so this redesign promotes that grouping to the primary visual hierarchy.

## Architecture

### Component Structure

```
TicketsPage (unchanged)
  └─ TicketBoard (refactored)
       ├─ PhaseColumn          ← NEW: replaces direct TicketColumn rendering
       │    ├─ PhaseHeader     ← NEW: color accent + label + count
       │    └─ SubStatusSection[] ← NEW: collapsible section per state
       │         └─ TicketCard (unchanged)
       └─ CollapsedPhaseStrip  ← NEW: thin vertical strip for 已结束
```

**Files changed:**
- `TicketBoard.tsx` — refactored to render `PhaseColumn` / `CollapsedPhaseStrip`. The `PHASE_GROUPS` config is extended with `accentColor` per phase. The `STATE_LABELS` map (currently in `TicketColumn.tsx`) moves here as a module-level constant shared by sub-components via props.
- `TicketColumn.tsx` — **deleted**, replaced by `PhaseColumn.tsx` + `SubStatusSection.tsx`
- `TicketsPage.tsx` — skeleton loading section updated to match new 4-column layout

**Files added:**
- `PhaseColumn.tsx` — full-width phase column with header and sub-sections
- `SubStatusSection.tsx` — collapsible section for a single sub-status
- `CollapsedPhaseStrip.tsx` — thin vertical strip for collapsed phases

**Files unchanged:**
- `TicketCard.tsx` — no changes
- `TicketFilters.tsx` — no changes
- `TicketDetailDrawer.tsx` — no changes

### Phase Configuration

Each phase has a color accent, icon character, and list of sub-statuses:

| Phase | Accent Color | Icon | Sub-statuses |
|-------|-------------|------|-------------|
| 收集 | `blue-500` | (none — use color bar only) | `received`, `enriching` |
| 分类 | `yellow-500` | (none) | `triaging`, `awaiting_clarification` |
| 执行 | `green-500` | (none) | `ready`, `executing` |
| 已结束 | `gray-500` | (none) | `completed`, `failed`, `suspended`, `skipped` |

Note: No emoji icons — per the UI/UX Pro Max guidelines (`no-emoji-icons`), we use a 3px color accent bar on the phase header instead of emoji.

### Data Flow

No changes to data fetching or filtering. The existing `groupByState()` function in `TicketBoard.tsx` already produces a `Map<string, TicketRecord[]>`. Each `PhaseColumn` receives the relevant subset of that map.

```
TicketsPage
  → useTickets() → tickets[]
  → filtering/sorting (useMemo) → filtered[]
  → TicketBoard receives filtered[]
    → groupByState(filtered) → Map<state, TicketRecord[]>
    → each PhaseColumn receives { phase config, Map subset }
```

## Component Specifications

### PhaseColumn

**Props:**
```ts
{
  label: string;              // "收集" | "分类" | "执行" | "已结束"
  accentColor: string;        // Tailwind color key: "blue" | "yellow" | "green" | "gray"
  states: string[];           // sub-status keys for this phase
  ticketsByState: Map<string, TicketRecord[]>;
  onTicketClick: (issueId: string) => void;
}
```

**Layout:**
- `flex-1` width (equal distribution among visible phase columns)
- `bg-card` background with `rounded-lg` corners
- Phase header at top (non-scrollable)
- Scrollable content area with sub-status sections

### PhaseHeader

Rendered inside `PhaseColumn`, not a separate component.

- Left side: 3px × 16px color accent bar + phase label (font-semibold, 13px)
- Right side: total ticket count badge with phase-tinted background
- Separated from content by `border-b border-border/50`

### SubStatusSection

**Props:**
```ts
{
  state: string;              // e.g. "received"
  label: string;              // e.g. "已接收"
  tickets: TicketRecord[];
  onTicketClick: (issueId: string) => void;
}
```

**Behavior:**
- **Non-empty sections**: expanded by default, showing all ticket cards
- **Empty sections**: collapsed by default, rendered at 50% opacity as a thin row
- **Toggle**: clicking the section header toggles expand/collapse
- **Chevron**: `▾` when expanded, `▸` when collapsed
- **Count badge**: shown next to label, uses `bg-muted` background

Uses the Radix `Collapsible` primitive from `@teamsland/ui/components/ui/collapsible` for accessible expand/collapse with keyboard support.

### CollapsedPhaseStrip

**Props:**
```ts
{
  label: string;
  accentColor: string;
  totalCount: number;
  onExpand: () => void;
}
```

**Layout:**
- Fixed width: `w-12` (48px)
- Vertical text label using `writing-mode: vertical-lr`
- Color accent bar at top
- Count badge below label
- Full-height clickable area
- `cursor-pointer` with hover state

### State Management

The `TicketBoard` component manages:
- `terminalExpanded: boolean` — whether the 已结束 phase is expanded (default: `false`)

Each `SubStatusSection` manages its own:
- `expanded: boolean` — initialized to `tickets.length > 0`

No new hooks, contexts, or global state needed.

## Skeleton Loading

The `TicketsPage` skeleton needs updating to match the new 4-column layout instead of the current 10-column layout. Render 3 full-width skeleton columns + 1 thin collapsed strip skeleton, each with 2 skeleton sub-section headers.

## Acceptance Scenarios

### Scenario 1: Board renders with 4 phase columns
  Given the TicketsPage loads with tickets in various states
  When the board renders
  Then the user sees 3 expanded phase columns (收集, 分类, 执行) with equal width
  And a collapsed vertical strip for 已结束 on the right
  And each phase column has a colored accent bar matching its phase
  And each phase header shows the total ticket count for that phase

### Scenario 2: Sub-sections auto-expand for non-empty states
  Given the 收集 phase has 1 ticket in "received" and 0 in "enriching"
  When the board renders
  Then the 已接收 sub-section is expanded showing the ticket card
  And the 补全信息中 sub-section is collapsed with 50% opacity
  And the 补全信息中 sub-section shows count "0"

### Scenario 3: User collapses a non-empty sub-section
  Given the 分类中 sub-section is expanded with 1 ticket
  When the user clicks the 分类中 section header
  Then the section collapses, hiding the ticket cards
  And the chevron changes from ▾ to ▸
  And the count badge still shows "1"

### Scenario 4: User expands an empty sub-section
  Given the 待补充信息 sub-section is collapsed with 0 tickets
  When the user clicks the section header
  Then the section expands showing an empty area (no "暂无" text — just empty space)
  And the opacity returns to 100%

### Scenario 5: User expands the 已结束 phase
  Given the 已结束 phase is collapsed as a vertical strip showing count "1"
  When the user clicks the strip
  Then the strip expands into a full-width phase column
  And shows sub-sections for 已完成, 失败, 已挂起, 已跳过
  And the 已跳过 sub-section is expanded with 1 ticket card
  And a collapse button (chevron) appears in the phase header

### Scenario 6: User collapses the 已结束 phase
  Given the 已结束 phase is expanded as a full column
  When the user clicks the collapse chevron in the phase header
  Then the column collapses back to the thin vertical strip
  And the 3 active phase columns redistribute to fill the available width

### Scenario 7: User clicks a ticket card
  Given a ticket card is visible in any sub-section
  When the user clicks the card
  Then the TicketDetailDrawer opens for that ticket (existing behavior, unchanged)

### Scenario 8: Phase filter interaction
  Given the user selects the "执行" phase filter in TicketFilters
  When the board re-renders with only execution-phase tickets
  Then the board still shows all 4 phase columns
  And 收集 and 分类 phase columns show 0 counts with all sub-sections collapsed at 50% opacity
  And 执行 shows the filtered tickets in their sub-sections

### Scenario 9: Empty board state
  Given there are 0 tickets total
  When the page renders
  Then the EmptyState component renders (existing behavior, unchanged — TicketsPage handles this before rendering TicketBoard)

### Scenario 10: Skeleton loading state
  Given the ticket data is still loading
  When the page renders
  Then 3 skeleton phase columns + 1 thin skeleton strip are shown
  And each skeleton column has 2 skeleton sub-section headers
