# Session List Redesign

Platform-managed sessions only, backed by SQLite as single source of truth.

## Problem

1. Session list shows all Claude Code JSONL sessions, including ones not created by teamsland, causing noise.
2. `sessionType` is never populated — every session shows as "未知".
3. Session origin (Meego, Lark, dashboard) is not persisted, lost when the agent process ends.
4. Session status only has 3 states (`active`/`compacted`/`archived`), missing `completed`/`failed`.

## Decisions

- **Only platform-initiated sessions appear** in the dashboard. Sessions started manually via `claude` CLI are invisible.
- **SQLite `sessions` table is the single source of truth** for the session list. JSONL scanning (`discoverProjects()`) is retired from the session list flow.
- **New sessions only** — no backfill of existing sessions.
- **JSONL files are still used** for message transcript detail (`GET /api/sessions/:id/normalized-messages`).

## Schema Changes

Three new columns on the `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN session_type TEXT;
ALTER TABLE sessions ADD COLUMN source TEXT;
ALTER TABLE sessions ADD COLUMN origin_data TEXT;
```

Two new columns for dashboard display data:

```sql
ALTER TABLE sessions ADD COLUMN summary TEXT;
ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
```

One new index:

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_type_source ON sessions(session_type, source);
```

### Column Definitions

| Column | Type | Values | Description |
|--------|------|--------|-------------|
| `session_type` | `TEXT` | `"coordinator"`, `"task_worker"`, `"observer_worker"` | Role of the session |
| `source` | `TEXT` | `"meego"`, `"lark_mention"`, `"lark_dm"`, `"dashboard"`, `"coordinator"` | What triggered creation |
| `origin_data` | `TEXT` (JSON) | See below | External entity references |
| `summary` | `TEXT` | Free text | Session description, extracted from first user message or `{ type: "summary" }` JSONL entry |
| `message_count` | `INTEGER` | Counter | Incremented by `appendMessage()` |

### `origin_data` Schema

```typescript
interface OriginData {
  chatId?: string;
  messageId?: string;
  senderId?: string;
  senderName?: string;
  meegoIssueId?: string;
  observeTargetId?: string;
}
```

### `SessionRow` Type Changes

Add the following fields to `SessionRow` in `packages/types/src/session-row.ts`:

```typescript
interface SessionRow {
  // ... existing fields ...
  sessionType: "coordinator" | "task_worker" | "observer_worker" | null;
  source: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator" | null;
  originData: OriginData | null;
  summary: string | null;
  messageCount: number;
}
```

The `mapSessionRow()` private method in `SessionDB` is updated to map these new columns from snake_case to camelCase.

### Migration Strategy

`migrateSchema()` already uses `IF NOT EXISTS` for all DDL. Add `ALTER TABLE ... ADD COLUMN` statements wrapped in try/catch (SQLite throws if column already exists — catch and ignore). This is the standard idempotent migration pattern for SQLite.

## Session Status Lifecycle

Expand `SessionStatus` from 3 to 5 values:

```typescript
type SessionStatus = "active" | "completed" | "failed" | "compacted" | "archived";
```

State transitions:

```
created       → active
active        → completed    (agent finishes successfully)
active        → failed       (agent crashes or errors)
active        → compacted    (context compaction, existing behavior)
active        → archived     (manual or time-based archival)
completed     → archived     (auto-archive after retention period)
failed        → archived     (auto-archive after retention period)
```

`SidecarDataPlane` drives the `active → completed/failed` transitions by observing `AgentRecord` status changes.

## Session Creation Paths

Four platform paths create sessions. Each must call `SessionDB.createSession()` with the new fields:

### 1. Coordinator Startup

- **Where:** `apps/server/src/coordinator-process.ts` via `apps/server/src/init/coordinator.ts`
- **session_type:** `"coordinator"`
- **source:** `"coordinator"`
- **origin_data:** `null`

### 2. Dashboard Chat

- **Where:** `apps/server/src/dashboard-ws.ts` → `handleClaudeCommand`
- **session_type:** `"task_worker"`
- **source:** `"dashboard"`
- **origin_data:** `null`

### 3. Worker Spawn (Meego/Lark)

- **Where:** `packages/hooks/src/context.ts` → `WorkerManager`
- **session_type:** `"task_worker"`
- **source:** from `AgentOrigin.source` — `"meego"` | `"lark_mention"` | `"lark_dm"`
- **origin_data:** serialized `AgentOrigin` (`chatId`, `messageId`, `senderId`, `senderName`, `meegoIssueId`)

### 4. Observer Worker

- **Where:** `packages/sidecar/src/observer-controller.ts`
- **session_type:** `"observer_worker"`
- **source:** `"coordinator"`
- **origin_data:** `{ observeTargetId: "<target agent id>" }`

## `createSession()` Signature Change

```typescript
async createSession(params: {
  sessionId: string;
  teamId: string;
  agentId?: string;
  projectId?: string;
  parentSessionId?: string;
  metadata?: Record<string, unknown>;
  // New fields:
  sessionType?: "coordinator" | "task_worker" | "observer_worker";
  source?: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";
  originData?: OriginData;
  summary?: string;
}): Promise<void>
```

## Summary and Message Count Updates

- **`message_count`:** Incremented atomically by `appendMessage()` via `UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE session_id = ?`.
- **`summary`:** Set when the first user message arrives (truncated to 200 chars) or when a `{ type: "summary" }` entry is processed. `SidecarDataPlane` handles this since it already processes every raw NDJSON event.

## API Changes

### New: `GET /api/sessions`

Query sessions from SQLite. Replaces the JSONL-based `GET /api/projects` for the session list.

```
GET /api/sessions?type=task_worker&source=meego&status=active&limit=50&offset=0&search=keyword
```

Response:

```json
{
  "sessions": [
    {
      "sessionId": "sess-abc",
      "teamId": "team-alpha",
      "projectId": "project-x",
      "agentId": "agent-001",
      "sessionType": "task_worker",
      "source": "meego",
      "status": "active",
      "summary": "实现用户认证模块",
      "messageCount": 42,
      "originData": { "meegoIssueId": "ISSUE-42", "senderId": "ou_user001" },
      "createdAt": 1714300000000,
      "updatedAt": 1714301000000
    }
  ],
  "total": 128,
  "hasMore": true
}
```

Filters:
- `type` — filter by `session_type` (multi-value: `type=task_worker,coordinator`)
- `source` — filter by `source`
- `status` — filter by status (default: exclude `archived`)
- `search` — free-text search on `summary` and `session_id`
- `limit` / `offset` — pagination (max 100, default 50)

### Existing: `GET /api/projects`

Kept for sidebar grouping. Implementation changes to query SQLite and group by `project_id` instead of scanning JSONL files.

### Existing: `GET /api/sessions/:id/normalized-messages`

No changes. Still reads from JSONL files for full message transcripts.

## Dashboard UI Changes

### Session List Page (`SessionsListPage.tsx`)

Data source switches from `useProjectStore` to a new `useSessionListStore` that calls `GET /api/sessions`.

Table columns:

| Column | Content |
|--------|---------|
| Session ID | First 16 chars, monospaced |
| Type | Icon + label (`coordinator`/`task_worker`/`observer_worker`) |
| Source | Badge (`Meego`/`Lark DM`/`Lark @`/`Dashboard`/`Coordinator`) |
| Status | Color-coded badge (green=active, blue=completed, red=failed, grey=compacted/archived) |
| Summary | Truncated text |
| Linked Entity | Meego issue ID (clickable) or Lark chat reference |
| Message Count | Number |
| Last Active | Relative time |

Filter bar:
- **Type** filter pills (existing, now functional)
- **Source** filter pills (new)
- **Status** filter (default: hide archived)
- **Search** text input (existing)

### Sidebar Session List (`SessionList.tsx`)

- Data source switches to SQLite-backed store
- Icons and colors reflect actual session types (no more "unknown")
- Source shown as small secondary text or badge

### New Types

```typescript
type SessionType = "coordinator" | "task_worker" | "observer_worker";
type SessionSource = "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";

interface SessionListItem {
  sessionId: string;
  teamId: string;
  projectId: string | null;
  agentId: string | null;
  sessionType: SessionType;
  source: SessionSource;
  status: SessionStatus;
  summary: string | null;
  messageCount: number;
  originData: OriginData | null;
  createdAt: number;
  updatedAt: number;
}
```

## WebSocket Updates

The existing `agents_update` WebSocket event already pushes agent state changes. Add a new `session_update` event type that pushes session list changes (new session created, status changed) so the dashboard can update in real-time without polling.

```typescript
interface SessionUpdateEvent {
  type: "session_update";
  action: "created" | "status_changed" | "summary_updated" | "message_count_updated";
  session: SessionListItem;
}
```

## What Gets Removed

- `discoverProjects()` / `discoverSessions()` / `parseSessionFile()` in `session-discovery.ts` — no longer used for the session list. The file may be kept for diagnostic/debugging purposes but is disconnected from the dashboard flow.
- `DiscoveredSession` and `DiscoveredProject` types — replaced by `SessionListItem` for the dashboard.
- `useProjectStore` dependency for session listing — replaced by `useSessionListStore`.

## Acceptance Scenarios

### Scenario 1: Meego-triggered worker session appears in list with correct metadata

Given the coordinator is running and connected to Meego
When a Meego issue update triggers the coordinator to spawn a task worker
And the coordinator calls `createSession()` with `sessionType: "task_worker"`, `source: "meego"`, `originData: { meegoIssueId: "ISSUE-42", senderId: "ou_user001" }`
And the worker begins executing and messages flow through `SidecarDataPlane`
And `appendMessage()` increments `message_count` and sets `summary` from the first user message
And a `session_update` WebSocket event fires with `action: "created"`
Then the user sees the new session in the dashboard session list with type "任务 Worker", source "Meego", status "active", the correct summary, and a clickable "ISSUE-42" link in the linked entity column

### Scenario 2: Dashboard chat creates a session visible in the list

Given the user is viewing the dashboard
When the user sends a message in the chat interface
And `handleClaudeCommand` spawns a task worker and calls `createSession()` with `sessionType: "task_worker"`, `source: "dashboard"`
And the `session_update` WebSocket event fires
Then the session appears in the list with type "任务 Worker", source "Dashboard", and status "active"

### Scenario 3: Session completes and status updates in real-time

Given a task worker session is active and visible in the dashboard
When the Claude agent finishes successfully
And `SidecarDataPlane` observes the `AgentRecord` status change to `"completed"`
And `updateSessionStatus()` sets the session status to `"completed"`
And a `session_update` WebSocket event fires with `action: "status_changed"`
Then the user sees the session status badge change from green "active" to blue "completed" without page refresh

### Scenario 4: Session fails and status updates in real-time

Given a task worker session is active and visible in the dashboard
When the Claude agent crashes
And `SidecarDataPlane` observes the `AgentRecord` status change to `"failed"`
And `updateSessionStatus()` sets the session status to `"failed"`
And a `session_update` WebSocket event fires with `action: "status_changed"`
Then the user sees the session status badge change from green "active" to red "failed" without page refresh

### Scenario 5: Manually started Claude session does not appear

Given the user starts a `claude` CLI session from their terminal (not through teamsland)
When the JSONL file is created in `~/.claude/projects/`
Then no `createSession()` call is made to the platform SQLite database
And the session does not appear in the dashboard session list

### Scenario 6: Type and source filters work correctly

Given the session list contains sessions of multiple types and sources
When the user clicks the "任务 Worker" type filter pill
Then only sessions with `session_type = "task_worker"` are shown
When the user additionally selects the "Meego" source filter
Then only task worker sessions triggered by Meego are shown
When the user clicks "全部" to clear filters
Then all platform sessions are shown again

### Scenario 7: Observer worker session appears with observe target link

Given a task worker is running
When the coordinator spawns an observer worker for that task worker
And `createSession()` is called with `sessionType: "observer_worker"`, `source: "coordinator"`, `originData: { observeTargetId: "<task-agent-id>" }`
Then the observer session appears in the list with type "观察者", source "Coordinator", and the linked entity column shows the target agent ID

### Scenario 8: Coordinator session appears on startup

Given the server starts and initializes the coordinator
When `CoordinatorProcess` creates its session with `sessionType: "coordinator"`, `source: "coordinator"`
Then the coordinator session appears in the list with type "协调器", source "Coordinator", status "active"

### Scenario 9: Lark DM-triggered session shows sender info

Given a user sends a Lark DM to the bot
When the coordinator processes the `lark_dm` event and spawns a worker
And `createSession()` is called with `source: "lark_dm"`, `originData: { chatId: "oc_abc", senderId: "ou_user001", senderName: "张三" }`
Then the session appears with source "Lark DM" and the linked entity column shows "张三" as the requester

### Scenario 10: Search filters sessions by summary text

Given multiple sessions exist with different summaries
When the user types "认证" in the search box
Then only sessions whose summary or session ID contains "认证" are shown
And the filter pills remain independently functional
