# Teamsland Dashboard UI/UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the Teamsland dashboard UI/UX with consistent loading/empty/error states, visual density normalization, nav improvements, theme auto-detection, and page-specific polish.

**Architecture:** Add shared `PageShell`, `EmptyState`, `MetricCard`, and `ErrorCard` components to `@teamsland/ui`. Wire `react-error-boundary` at page and widget level in `App.tsx`. Add `prefers-color-scheme` auto-detection with a theme toggle in Settings. Normalize spacing/typography across all 7 pages.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4.1 (oklch), @teamsland/ui (Radix + CVA), react-error-boundary ^6.1.1, react-resizable-panels, Rspack

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `packages/ui/components/ui/skeleton.tsx` | Skeleton placeholder component (animated pulse bar) |
| `packages/ui/components/ui/empty-state.tsx` | Generic empty state: icon + title + description + optional action |
| `packages/ui/components/ui/error-card.tsx` | Error display card with message + retry button |
| `packages/ui/components/ui/metric-card.tsx` | Standardized metric card: label, value, icon, optional trend |
| `apps/dashboard/src/components/layout/PageShell.tsx` | Page wrapper handling loading/error/empty/loaded lifecycle |
| `apps/dashboard/src/hooks/useTheme.ts` | Theme state hook (auto/light/dark), localStorage persistence, prefers-color-scheme listener |

### Modified files

| File | Changes |
|------|---------|
| `apps/dashboard/src/index.css` | Add `prefers-color-scheme` media query for auto dark mode |
| `apps/dashboard/src/App.tsx` | Wrap each page in `<ErrorBoundary>`, add theme provider initialization |
| `apps/dashboard/src/components/layout/NavSidebar.tsx` | Active indicator bar, section separator |
| `apps/dashboard/src/pages/OverviewPage.tsx` | Use PageShell, skeleton loaders, standardized MetricCard, last-updated timestamp |
| `apps/dashboard/src/pages/SessionsListPage.tsx` | Use PageShell, skeleton table rows, EmptyState, row hover |
| `apps/dashboard/src/pages/TicketsPage.tsx` | Use PageShell, skeleton cards, EmptyState per column |
| `apps/dashboard/src/pages/CoordinatorPage.tsx` | Use PageShell, widget-level error boundaries, per-panel skeletons |
| `apps/dashboard/src/pages/HooksPage.tsx` | Use PageShell, skeleton loaders, EmptyState per tab, standardized MetricCard |
| `apps/dashboard/src/pages/MemoryPage.tsx` | Tree skeleton, search progress, EmptyState |
| `apps/dashboard/src/pages/SettingsPage.tsx` | Theme toggle (Auto/Light/Dark) |
| `apps/dashboard/src/components/layout/SessionDetailLayout.tsx` | Persist panel sizes to localStorage |
| `apps/dashboard/src/components/tickets/TicketColumn.tsx` | Empty column state |
| `apps/dashboard/src/components/tickets/TicketBoard.tsx` | Column collapse toggle per phase group |

---

## Task 1: Skeleton component in @teamsland/ui

**Files:**
- Create: `packages/ui/components/ui/skeleton.tsx`

- [ ] **Step 1: Create the Skeleton component**

```tsx
// packages/ui/components/ui/skeleton.tsx
import { cn } from "@teamsland/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors (the component follows the same pattern as other ui components)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/components/ui/skeleton.tsx
git commit -m "feat(ui): add Skeleton component"
```

---

## Task 2: EmptyState component in @teamsland/ui

**Files:**
- Create: `packages/ui/components/ui/empty-state.tsx`

- [ ] **Step 1: Create the EmptyState component**

```tsx
// packages/ui/components/ui/empty-state.tsx
import { cn } from "@teamsland/ui/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div data-slot="empty-state" className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/components/ui/empty-state.tsx
git commit -m "feat(ui): add EmptyState component"
```

---

## Task 3: ErrorCard component in @teamsland/ui

**Files:**
- Create: `packages/ui/components/ui/error-card.tsx`

- [ ] **Step 1: Create the ErrorCard component**

```tsx
// packages/ui/components/ui/error-card.tsx
import { cn } from "@teamsland/ui/lib/utils";
import { AlertCircle } from "lucide-react";
import { Button } from "./button";

interface ErrorCardProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

function ErrorCard({ title = "出错了", message, onRetry, className }: ErrorCardProps) {
  return (
    <div data-slot="error-card" className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="mb-3 text-destructive">
        <AlertCircle size={32} strokeWidth={1.5} />
      </div>
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {message && <p className="mt-1 text-xs text-muted-foreground max-w-sm">{message}</p>}
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          重试
        </Button>
      )}
    </div>
  );
}

export { ErrorCard };
export type { ErrorCardProps };
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/components/ui/error-card.tsx
git commit -m "feat(ui): add ErrorCard component"
```

---

## Task 4: Standardized MetricCard component in @teamsland/ui

**Files:**
- Create: `packages/ui/components/ui/metric-card.tsx`

This replaces the inline `MetricCard` in OverviewPage (lines 252-277) and the one in HooksPage (lines 146-155).

- [ ] **Step 1: Create the MetricCard component**

```tsx
// packages/ui/components/ui/metric-card.tsx
import { cn } from "@teamsland/ui/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { StatusDot } from "./status-dot";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error";
  className?: string;
}

function MetricCard({ label, value, icon, variant = "default", className }: MetricCardProps) {
  return (
    <Card data-slot="metric-card" className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          {variant !== "default" && <StatusDot variant={variant} size="sm" />}
          <span className="text-2xl font-bold tabular-nums">{value}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export { MetricCard };
export type { MetricCardProps };
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/components/ui/metric-card.tsx
git commit -m "feat(ui): add standardized MetricCard component"
```

---

## Task 5: PageShell wrapper component

**Files:**
- Create: `apps/dashboard/src/components/layout/PageShell.tsx`

- [ ] **Step 1: Create the PageShell component**

```tsx
// apps/dashboard/src/components/layout/PageShell.tsx
import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import type { ReactNode } from "react";

interface PageShellProps {
  loading?: boolean;
  error?: string | null;
  skeleton?: ReactNode;
  children: ReactNode;
}

export function PageShell({ loading, error, skeleton, children }: PageShellProps) {
  if (loading && skeleton) return <>{skeleton}</>;
  if (error) return <ErrorCard message={error} />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/PageShell.tsx
git commit -m "feat(dashboard): add PageShell wrapper component"
```

---

## Task 6: Theme hook — useTheme

**Files:**
- Create: `apps/dashboard/src/hooks/useTheme.ts`

- [ ] **Step 1: Create the useTheme hook**

```tsx
// apps/dashboard/src/hooks/useTheme.ts
import { useCallback, useEffect, useSyncExternalStore } from "react";

type Theme = "auto" | "light" | "dark";

const STORAGE_KEY = "teamsland-theme";

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "auto") return v;
  } catch {}
  return "auto";
}

function resolveEffective(theme: Theme): "light" | "dark" {
  if (theme !== "auto") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(effective: "light" | "dark") {
  document.documentElement.classList.toggle("dark", effective === "dark");
}

let currentTheme: Theme = getStoredTheme();
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function setTheme(next: Theme) {
  currentTheme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {}
  applyTheme(resolveEffective(next));
  for (const cb of listeners) cb();
}

// Initialize on module load
applyTheme(resolveEffective(currentTheme));

// Listen for OS theme changes
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (currentTheme === "auto") {
      applyTheme(resolveEffective("auto"));
    }
  });
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot);
  const effective = resolveEffective(theme);
  return { theme, effective, setTheme: useCallback(setTheme, []) };
}
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/hooks/useTheme.ts
git commit -m "feat(dashboard): add useTheme hook with prefers-color-scheme support"
```

---

## Task 7: prefers-color-scheme CSS + remove hardcoded .dark init

**Files:**
- Modify: `apps/dashboard/src/index.css`

The `useTheme` module handles class toggling at runtime. We just need to make sure the initial HTML doesn't have a hardcoded `class="dark"`. The CSS custom-variant stays unchanged since useTheme toggles the `.dark` class.

- [ ] **Step 1: Verify current state**

Check if `index.html` has a hardcoded `class="dark"` on `<html>`:

Run: `grep -n 'class.*dark' apps/dashboard/index.html || echo "No hardcoded dark class"`
Expected: Either "No hardcoded dark class" or a line to modify

- [ ] **Step 2: If hardcoded dark class exists, remove it**

Edit `apps/dashboard/index.html` to remove `class="dark"` from `<html>` tag (useTheme handles this at runtime now).

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/index.html
git commit -m "fix(dashboard): remove hardcoded dark class, useTheme handles it"
```

---

## Task 8: Wire ErrorBoundary in App.tsx + initialize theme

**Files:**
- Modify: `apps/dashboard/src/App.tsx`

- [ ] **Step 1: Add error boundary imports and wrap each page**

Replace the current `App.tsx` content. Key changes:
- Import `ErrorBoundary` from `react-error-boundary`
- Import `ErrorCard` from `@teamsland/ui/components/ui/error-card`
- Import `useTheme` from `./hooks/useTheme`
- Wrap each page conditional in `<ErrorBoundary fallbackRender={...}>`
- Call `useTheme()` at top of App to initialize theme on mount

The current page rendering section (lines 57-73 of App.tsx):

```tsx
{page === "overview" && <OverviewPage onNavigate={handlePathNav} />}
```

Becomes:

```tsx
{page === "overview" && (
  <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => (
    <ErrorCard title="页面崩溃" message={error.message} onRetry={resetErrorBoundary} />
  )}>
    <OverviewPage onNavigate={handlePathNav} />
  </ErrorBoundary>
)}
```

Apply the same pattern to all 7 page slots (overview, sessions list, sessions detail, hooks, tickets, coordinator, memory, settings).

Add at top of `App` function body:

```tsx
useTheme();
```

New imports to add:

```tsx
import { ErrorBoundary } from "react-error-boundary";
import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import { useTheme } from "./hooks/useTheme";
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/App.tsx
git commit -m "feat(dashboard): wire ErrorBoundary at page level, initialize theme"
```

---

## Task 9: NavSidebar — active indicator + section separator

**Files:**
- Modify: `apps/dashboard/src/components/layout/NavSidebar.tsx`

- [ ] **Step 1: Add section grouping to NAV_ITEMS**

Change the `NAV_ITEMS` definition (lines 9-17) to include a `group` property:

```tsx
const NAV_ITEMS: { page: PageName; label: string; icon: typeof Home; group: "monitor" | "manage" }[] = [
  { page: "overview", label: "总览", icon: Home, group: "monitor" },
  { page: "sessions", label: "会话", icon: Cpu, group: "monitor" },
  { page: "coordinator", label: "协调器", icon: Activity, group: "monitor" },
  { page: "tickets", label: "工单", icon: TicketCheck, group: "manage" },
  { page: "hooks", label: "Hooks", icon: Waypoints, group: "manage" },
  { page: "memory", label: "记忆", icon: Brain, group: "manage" },
  { page: "settings", label: "设置", icon: Settings, group: "manage" },
];
```

- [ ] **Step 2: Add active indicator and separator in the nav rendering**

Replace the nav items loop (lines 45-65) with:

```tsx
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
```

- [ ] **Step 3: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/layout/NavSidebar.tsx
git commit -m "feat(dashboard): add active indicator bar and section separator to NavSidebar"
```

---

## Task 10: OverviewPage — skeleton loaders + standardized MetricCard + last-updated

**Files:**
- Modify: `apps/dashboard/src/pages/OverviewPage.tsx`

- [ ] **Step 1: Replace inline MetricCard with shared component, add skeleton and error state**

Replace imports — add:

```tsx
import { MetricCard } from "@teamsland/ui/components/ui/metric-card";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
```

Add error state alongside loading:

```tsx
const [error, setError] = useState<string | null>(null);
```

Update the `fetchAll` catch block (line 83):

```tsx
} catch {
  setError("无法加载系统状态");
} finally {
```

Add `lastUpdated` state:

```tsx
const [lastUpdated, setLastUpdated] = useState<number | null>(null);
```

Set it after successful fetch:

```tsx
} finally {
  setLoading(false);
  setLastUpdated(Date.now());
}
```

- [ ] **Step 2: Replace the metric cards grid with skeleton-aware rendering**

Replace the metric card grid (lines 153-168):

```tsx
<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
  {loading ? (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-4 rounded" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
          </CardContent>
        </Card>
      ))}
    </>
  ) : (
    <>
      <MetricCard
        label="活跃 Worker"
        value={stats.running}
        icon={<Cpu size={16} />}
        variant={stats.running > 0 ? "success" : "default"}
      />
      <MetricCard label="任务 Worker" value={stats.taskWorkers} icon={<Activity size={16} />} />
      <MetricCard label="观察者" value={stats.observers} icon={<Activity size={16} />} />
      <MetricCard
        label="Hooks"
        value={hooksStatus?.enabled ? `已加载 ${hooksStatus.loadedHooks ?? 0} 个` : "已禁用"}
        icon={<Waypoints size={16} />}
        variant={hooksStatus?.enabled ? "success" : "warning"}
      />
    </>
  )}
</div>
```

- [ ] **Step 3: Replace workers table loading with skeleton rows**

Replace the loading branch in the table body (line 194-195):

```tsx
{loading ? (
  Array.from({ length: 3 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
    </TableRow>
  ))
) : workers.length === 0 ? (
```

- [ ] **Step 4: Add error state and last-updated indicator**

After the page header `<p>` tag (line 148), add the last-updated timestamp display. Add error state after the loading check for the main content.

Replace the header subtitle:

```tsx
<p className="text-sm text-muted-foreground">
  System health at a glance
  {lastUpdated && (
    <span className="ml-2 text-xs">
      · 更新于 {new Date(lastUpdated).toLocaleTimeString()}
    </span>
  )}
</p>
```

If error, show ErrorCard in the content area:

```tsx
{error ? (
  <ErrorCard message={error} onRetry={() => { setError(null); setLoading(true); /* re-fetch */ }} />
) : (
  /* existing content */
)}
```

- [ ] **Step 5: Delete the inline MetricCard function**

Remove the `MetricCard` function definition at lines 252-277 since we now import from `@teamsland/ui`.

- [ ] **Step 6: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/pages/OverviewPage.tsx
git commit -m "feat(dashboard): add skeleton loaders and error state to OverviewPage"
```

---

## Task 11: SessionsListPage — skeleton rows + EmptyState + hover

**Files:**
- Modify: `apps/dashboard/src/pages/SessionsListPage.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Inbox } from "lucide-react";
```

(`Inbox` is for the empty state icon.)

- [ ] **Step 2: Replace loading state in table body**

Replace line 141 (`<TableEmpty colSpan={6}>加载中…</TableEmpty>`) with skeleton rows:

```tsx
{loading ? (
  Array.from({ length: 5 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
      <TableCell className="text-right"><Skeleton className="h-4 w-8 ml-auto" /></TableCell>
      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
    </TableRow>
  ))
) : filtered.length === 0 ? (
```

- [ ] **Step 3: Replace empty state with EmptyState component**

Replace lines 142-145 with:

```tsx
) : filtered.length === 0 ? (
  <TableRow>
    <TableCell colSpan={6}>
      <EmptyState
        icon={<Inbox size={40} strokeWidth={1} />}
        title={search || typeFilter !== "all" ? "没有匹配当前筛选条件的会话" : "暂无会话"}
        description={search || typeFilter !== "all" ? "尝试调整筛选条件" : undefined}
        action={
          (search || typeFilter !== "all") ? (
            <Button variant="outline" size="sm" onClick={() => { setSearch(""); setTypeFilter("all"); }}>
              清除筛选
            </Button>
          ) : undefined
        }
      />
    </TableCell>
  </TableRow>
) : (
```

Add `Button` import:

```tsx
import { Button } from "@teamsland/ui/components/ui/button";
```

- [ ] **Step 4: Add row hover highlighting**

Add `hover:bg-accent/50` to the existing `TableRow` for each session (line 151). It already has `className="cursor-pointer"`, change to:

```tsx
className="cursor-pointer hover:bg-accent/50 transition-colors"
```

- [ ] **Step 5: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/pages/SessionsListPage.tsx
git commit -m "feat(dashboard): add skeleton loaders and EmptyState to SessionsListPage"
```

---

## Task 12: TicketsPage — skeleton + empty column states

**Files:**
- Modify: `apps/dashboard/src/pages/TicketsPage.tsx`
- Modify: `apps/dashboard/src/components/tickets/TicketColumn.tsx`

- [ ] **Step 1: Add skeleton loading to TicketsPage**

Add imports:

```tsx
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
```

Replace the board content area (lines 85-93). When loading, show a skeleton board:

```tsx
<div className="flex-1 min-h-0">
  {loading ? (
    <div className="flex h-full gap-1 p-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col w-64 shrink-0">
          <div className="px-2 py-1.5 mb-2">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="space-y-2 px-1">
            {Array.from({ length: 2 }).map((_, j) => (
              <Skeleton key={j} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : tickets.length === 0 ? (
    <EmptyState
      icon={<Inbox size={48} strokeWidth={1} />}
      title="暂无工单"
      description="工单将在 Meego 事件触发后自动创建"
      className="h-full"
    />
  ) : (
    <TicketBoard tickets={filtered} onTicketClick={handleTicketClick} />
  )}
</div>
```

- [ ] **Step 2: Add empty column state to TicketColumn**

In `apps/dashboard/src/components/tickets/TicketColumn.tsx`, add import:

```tsx
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
```

After the column header div, in the scrollable area, add an empty state when `tickets.length === 0`:

```tsx
<div className="flex-1 overflow-y-auto space-y-2 px-1">
  {tickets.length === 0 ? (
    <p className="text-xs text-muted-foreground text-center py-6">暂无</p>
  ) : (
    tickets.map((t) => (
      <TicketCard key={t.issueId} ticket={t} onClick={() => onTicketClick(t.issueId)} />
    ))
  )}
</div>
```

- [ ] **Step 3: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/TicketsPage.tsx apps/dashboard/src/components/tickets/TicketColumn.tsx
git commit -m "feat(dashboard): add skeleton loading and empty states to tickets"
```

---

## Task 13: CoordinatorPage — widget error boundaries + per-panel skeletons

**Files:**
- Modify: `apps/dashboard/src/pages/CoordinatorPage.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { ErrorBoundary } from "react-error-boundary";
import { ErrorCard } from "@teamsland/ui/components/ui/error-card";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
```

- [ ] **Step 2: Wrap Queue and Events sections in ErrorBoundary**

Replace the Queue section (lines 51-57):

```tsx
<div className="space-y-4">
  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Queue</h2>
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
    <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => (
      <ErrorCard title="Queue 加载失败" message={error.message} onRetry={resetErrorBoundary} />
    )}>
      <div>
        {statsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : stats ? (
          <QueueDashboard stats={stats} />
        ) : null}
      </div>
    </ErrorBoundary>
    <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => (
      <ErrorCard title="Dead Letter 加载失败" message={error.message} onRetry={resetErrorBoundary} />
    )}>
      <DeadLetterTable messages={deadLetters} />
    </ErrorBoundary>
  </div>
</div>
```

Replace the Events section (lines 59-61):

```tsx
<div className="space-y-4">
  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent Events</h2>
  <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => (
    <ErrorCard title="Events 加载失败" message={error.message} onRetry={resetErrorBoundary} />
  )}>
    {eventsLoading ? (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    ) : (
      <EventTimeline events={events} loading={false} />
    )}
  </ErrorBoundary>
</div>
```

Similarly add skeleton for StatusBar:

```tsx
{statusLoading ? (
  <Skeleton className="h-12 w-full rounded-lg" />
) : status ? (
  <CoordinatorStatusBar status={status} lastEventId={lastEventId} lastChangeAt={lastChangeAt} />
) : null}
```

- [ ] **Step 3: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/CoordinatorPage.tsx
git commit -m "feat(dashboard): add widget error boundaries and skeletons to CoordinatorPage"
```

---

## Task 14: HooksPage — skeleton loaders + EmptyState + standardized MetricCard

**Files:**
- Modify: `apps/dashboard/src/pages/HooksPage.tsx`

- [ ] **Step 1: Add imports and replace inline MetricCard**

Add imports:

```tsx
import { MetricCard } from "@teamsland/ui/components/ui/metric-card";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
```

- [ ] **Step 2: Update HooksStatusTab to show skeletons while loading**

Add a `loading` state to `HooksStatusTab`:

```tsx
function HooksStatusTab() {
  const [status, setStatus] = useState<HooksStatusData | null>(null);
  const [metrics, setMetrics] = useState<HooksMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetch("/api/hooks/status"), fetch("/api/hooks/metrics")])
      .then(async ([sRes, mRes]) => {
        if (sRes.ok) setStatus(await sRes.json());
        if (mRes.ok) setMetrics(await mRes.json());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
```

Replace the metrics grid with skeleton-aware rendering:

```tsx
{loading ? (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
    {Array.from({ length: 6 }).map((_, i) => (
      <Card key={i}>
        <CardContent className="pt-4">
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-7 w-12" />
        </CardContent>
      </Card>
    ))}
  </div>
) : metrics ? (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
    <MetricCard label="总触发数" value={metrics.totalTriggers ?? 0} />
    <MetricCard label="总匹配数" value={metrics.totalMatches ?? 0} />
    <MetricCard label="执行次数" value={metrics.totalExecutions ?? 0} />
    <MetricCard label="匹配率" value={metrics.matchRate != null ? `${(metrics.matchRate * 100).toFixed(1)}%` : "—"} />
    <MetricCard label="平均延迟" value={metrics.avgLatencyMs != null ? `${metrics.avgLatencyMs.toFixed(0)}ms` : "—"} />
    <MetricCard label="错误数" value={metrics.errors ?? 0} />
  </div>
) : null}
```

- [ ] **Step 3: Update HooksPendingTab loading and empty states**

Replace the early-return loading (line 188) with skeleton cards:

```tsx
if (loading) {
  return (
    <div className="space-y-4">
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-64" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

Replace the empty state (lines 190-196) with EmptyState component:

```tsx
if (pending.length === 0) {
  return (
    <EmptyState
      title="暂无待审核的 Hook"
      description="Brain 近期没有提出新的自动化方案。"
    />
  );
}
```

- [ ] **Step 4: Update HooksEvolutionTab loading with skeleton rows**

Replace line 253 (`<TableEmpty colSpan={4}>加载中…</TableEmpty>`) with:

```tsx
{loading ? (
  Array.from({ length: 4 }).map((_, i) => (
    <TableRow key={i}>
      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
    </TableRow>
  ))
) : entries.length === 0 ? (
  <TableEmpty colSpan={4}>
    <EmptyState title="暂无演化事件记录" />
  </TableEmpty>
) : (
```

- [ ] **Step 5: Delete the inline MetricCard function**

Remove the `MetricCard` function at lines 146-155 since we now import from `@teamsland/ui`.

- [ ] **Step 6: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/pages/HooksPage.tsx
git commit -m "feat(dashboard): add skeleton loaders, EmptyState, and shared MetricCard to HooksPage"
```

---

## Task 15: MemoryPage — tree skeleton + search progress + EmptyState

**Files:**
- Modify: `apps/dashboard/src/pages/MemoryPage.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Spinner } from "@teamsland/ui/components/ui/spinner";
```

- [ ] **Step 2: Replace VikingTree loading/error/empty states**

Replace lines 212-214 in `VikingTree`:

```tsx
if (loading) {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}
if (error) return <EmptyState title="Viking 服务不可用" className="py-6" />;
if (rootEntries.length === 0) return <EmptyState title="命名空间为空" className="py-6" />;
```

- [ ] **Step 3: Replace ContentViewer loading state**

Replace line 344:

```tsx
if (loading) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}
```

Replace line 345:

```tsx
if (content === null) return <EmptyState title="加载内容失败" description="请检查 URI 是否有效" />;
```

- [ ] **Step 4: Add search progress indicator**

Replace the search button (line 137-139). When `searching` is true, show a spinner:

```tsx
<Button size="sm" variant="outline" onClick={handleSearch} disabled={searching}>
  {searching ? <><Spinner size="sm" className="mr-1.5" />搜索中</> : "搜索"}
</Button>
```

- [ ] **Step 5: Replace search empty state**

Replace line 362-363 in `SearchResultsView`:

```tsx
if (results.length === 0) {
  return <EmptyState icon={<Search size={32} strokeWidth={1} />} title="未找到结果" description="尝试其他关键词" />;
}
```

- [ ] **Step 6: Replace right-area placeholder**

Replace lines 167-169:

```tsx
<EmptyState
  icon={<FileText size={32} strokeWidth={1} />}
  title="从文件树中选择文件"
  description="或使用搜索查找记忆"
  className="h-full"
/>
```

- [ ] **Step 7: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/src/pages/MemoryPage.tsx
git commit -m "feat(dashboard): add skeleton loaders and EmptyState to MemoryPage"
```

---

## Task 16: SettingsPage — theme toggle

**Files:**
- Modify: `apps/dashboard/src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add theme toggle card**

Add import:

```tsx
import { useTheme } from "../hooks/useTheme";
```

Add at top of SettingsPage function:

```tsx
const { theme, setTheme } = useTheme();
```

Add a new Card after the "Connection Status" card (after line 72):

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-sm">外观</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="flex items-center gap-2">
      {(["auto", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setTheme(t)}
          className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
            theme === t
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          {t === "auto" ? "自动" : t === "light" ? "浅色" : "深色"}
        </button>
      ))}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">
      {theme === "auto" ? "跟随系统设置" : theme === "light" ? "始终使用浅色主题" : "始终使用深色主题"}
    </p>
  </CardContent>
</Card>
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/pages/SettingsPage.tsx
git commit -m "feat(dashboard): add theme toggle to SettingsPage"
```

---

## Task 17: SessionDetailLayout — persist panel sizes

**Files:**
- Modify: `apps/dashboard/src/components/layout/SessionDetailLayout.tsx`

- [ ] **Step 1: Add localStorage persistence for panel sizes**

The `react-resizable-panels` library supports an `autoSaveId` prop on `ResizablePanelGroup` to auto-persist panel sizes to localStorage.

Replace the `ResizablePanelGroup` opening tag (line 84):

```tsx
<ResizablePanelGroup direction="horizontal" autoSaveId="session-detail-panels">
```

This is a single prop addition — the library handles the rest.

- [ ] **Step 2: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/components/layout/SessionDetailLayout.tsx
git commit -m "feat(dashboard): persist panel sizes in SessionDetailLayout"
```

---

## Task 18: Visual density normalization pass

**Files:**
- Modify: `apps/dashboard/src/pages/OverviewPage.tsx`
- Modify: `apps/dashboard/src/pages/HooksPage.tsx`
- Modify: `apps/dashboard/src/pages/CoordinatorPage.tsx`

- [ ] **Step 1: Normalize page headers**

Ensure all page headers follow the same pattern: `text-xl font-semibold` for title (currently some use `text-lg`). For all pages, update the `<h1>` to:

```tsx
<h1 className="text-xl font-semibold text-foreground">...</h1>
```

The pages that currently use `text-lg font-semibold`: OverviewPage (line 147), SessionsListPage (line 89), TicketsPage (line 70), HooksPage (line 57), MemoryPage (line 115), CoordinatorPage (line 42), SettingsPage (line 45).

Change all to `text-xl font-semibold`.

- [ ] **Step 2: Normalize section spacing**

Ensure all pages use `space-y-4` between major sections (Overview and Coordinator currently use `space-y-6`). Update:

- OverviewPage line 151: `p-6 space-y-6` → `p-6 space-y-4`
- CoordinatorPage line 46: `p-6 space-y-6` → `p-6 space-y-4`
- SettingsPage line 49: `p-6 space-y-6` → `p-6 space-y-4`

- [ ] **Step 3: Verify it builds**

Run: `cd apps/dashboard && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/pages/OverviewPage.tsx apps/dashboard/src/pages/HooksPage.tsx apps/dashboard/src/pages/CoordinatorPage.tsx apps/dashboard/src/pages/SettingsPage.tsx apps/dashboard/src/pages/SessionsListPage.tsx apps/dashboard/src/pages/TicketsPage.tsx apps/dashboard/src/pages/MemoryPage.tsx
git commit -m "style(dashboard): normalize page header and section spacing across all pages"
```

---

## Task 19: Final build + typecheck verification

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: All packages pass

- [ ] **Step 2: Run lint**

Run: `bun run lint`
Expected: No new errors

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 4: Visual verification**

Start the dev server (`bun run dev:dashboard`) and manually verify:
- Each page shows skeleton loaders during initial load
- Empty states render correctly
- Error boundaries catch errors (can test by temporarily throwing in a component)
- Theme toggle works (Auto/Light/Dark)
- Nav sidebar has active indicator and section separator
- Panel sizes persist in session detail view
