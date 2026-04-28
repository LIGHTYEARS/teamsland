# Teamsland Dashboard UI/UX Overhaul

**Date**: 2026-04-28
**Scope**: Full UX overhaul (Approach C), minus drag-and-drop (tickets are read-only), minus i18n/a11y (internal Chinese-primary team tool)

---

## 1. Foundation — State Management Patterns

### PageShell wrapper

Shared component handling loading/loaded/empty/error lifecycle for every page.

- **Loading**: Skeleton/shimmer placeholders (existing `Shimmer` from `@teamsland/ui`)
- **Error**: Error card with message + retry button (via `react-error-boundary`)
- **Empty**: Centered `EmptyState` component
- **Loaded**: Renders children

Each page passes `{ isLoading, error, data }` to `PageShell`.

### EmptyState component (in @teamsland/ui)

Reusable empty state: icon slot, title, description, optional action button. Used by all tables, lists, and boards.

### Error boundaries

`react-error-boundary` at two levels:

- **Page level**: Each page wrapped in `<ErrorBoundary>` in `App.tsx`
- **Widget level**: Individual cards/panels on Overview and Coordinator get their own boundaries

---

## 2. Design Token & Visual Density

### Spacing normalization

| Element | Value |
|---------|-------|
| Page header | `pb-4`, `text-xl font-semibold` |
| Card grid gap | `gap-4` |
| Card padding | `p-4` standard, `p-3` compact metric |
| Table row height | `h-10`, `text-sm` |
| Section spacing | `space-y-4` |

### prefers-color-scheme auto-detection

CSS media query in `index.css` that auto-applies `.dark` on `<html>` when OS is dark. Settings page adds theme toggle: Auto / Light / Dark, persisted to `localStorage`.

### MetricCard standardization

Single `MetricCard` component in `@teamsland/ui`: label, value, optional trend/badge, optional icon. Used by Overview and Hooks pages.

---

## 3. Navigation & Layout

### Nav sidebar

- Active indicator: 2px vertical accent bar on left edge
- Section grouping: visual separator between monitoring (Overview, Sessions, Coordinator) and management (Tickets, Hooks, Memory, Settings)

### PageGrid layout utility

CSS Grid with `auto-fit` / `minmax()` for main content areas:

- Overview: 4-col metric row + 2-col body
- Coordinator: status bar + 2-col body + full-width state machine
- Hooks: metric row + tabbed content

Prevents horizontal overflow on narrow viewports.

### Session detail persistence

Panel size ratios saved to `localStorage`.

---

## 4. Page-Specific Improvements

### Overview
- Skeleton shimmer for metric cards and tables
- Auto-refresh indicator (last-updated timestamp)
- WebSocket connection quality dot

### Sessions
- Skeleton rows in table
- Empty state when no sessions match filters
- Row hover highlighting

### Tickets (read-only)
- Column collapse/expand toggle
- Card skeleton loaders
- Empty column states
- Better card visual hierarchy (priority badge, assignee avatar)

### Coordinator
- Widget-level error boundaries on Queue and Events panels
- Per-panel skeleton loaders
- Live-updating nav badge showing active event count

### Hooks
- Skeleton loaders for metric cards and tab content
- Empty states per tab

### Memory
- Tree skeleton while loading
- Search progress indicator
- Inline content preview on tree node hover

### Settings
- Theme toggle (Auto / Light / Dark)
- Connection status with auto-retry indicator

---

## Acceptance Scenarios

### Scenario 1: Page loading shows skeleton then content
Given any page is navigated to
When data is being fetched
Then skeleton/shimmer placeholders are shown in place of content
And when data arrives, content replaces skeletons without layout shift

### Scenario 2: Page fetch fails, user retries
Given any page is navigated to
When the API request fails
Then an error card is shown with the error message and a retry button
And clicking retry re-fetches and shows skeleton then content

### Scenario 3: Empty data set
Given the sessions page is loaded
When there are no sessions matching the current filters
Then an EmptyState component is shown with an icon, message, and clear-filters action

### Scenario 4: Widget crash doesn't take down the page
Given the Overview page is loaded with 4 metric cards and 2 tables
When one widget throws a runtime error
Then only that widget shows an error boundary fallback
And all other widgets continue to function

### Scenario 5: Dark mode auto-detection
Given the user has not set a theme preference
When the OS is in dark mode
Then the dashboard renders in dark theme
And switching OS to light mode switches the dashboard to light theme

### Scenario 6: Theme manual override
Given the user opens Settings
When they select "Dark" from the theme toggle
Then the dashboard switches to dark mode regardless of OS setting
And the preference persists across page reloads

### Scenario 7: Nav sidebar active indicator
Given the user is on the Coordinator page
Then the Coordinator icon in the nav sidebar has a vertical accent bar
And no other nav icon has the accent bar

### Scenario 8: Panel sizes persist
Given the user resizes panels in the session detail view
When they navigate away and return
Then the panels restore to their previous sizes
