# Phase 7: Dashboard 重建 — 技术方案

> 将 teamsland Dashboard 从简陋的 agent 状态面板升级为完整的 Claude Code Web 工作台，
> 核心组件从 claudecodeui 搬运，并在此基础上扩展 teamsland 特有功能。

---

## 1. 技术栈决策

### 1.1 现状对比

| 维度 | teamsland Dashboard | claudecodeui |
|------|-------------------|--------------|
| 构建工具 | rspack 1.x | Vite 7.x |
| 框架 | React 19 | React 18 |
| 语言 | TypeScript (strict) | 混合 (JS/TS，server 端已迁 TS) |
| CSS | Tailwind 4 + shadcn/ui | Tailwind 3 + tailwind-merge + clsx |
| 运行时 | Bun (Bun.serve) | Node.js (Express + ws) |
| 状态管理 | 自定义 hooks | Zustand-like hooks + Context |

### 1.2 决策

**保持 teamsland 技术栈（rspack + TypeScript + Bun），将 claudecodeui 组件转换过来。**

理由：

1. **TypeScript 是硬约束** -- CLAUDE.md 明确要求 "No `any`"，claudecodeui 的 JS 组件必须转为 TSX。保持 TypeScript 可以在搬运过程中同时完善类型，一步到位。

2. **rspack 已经在用且够用** -- teamsland 的 rspack 配置简洁，SWC 编译 TSX 性能优于 Vite 的 esbuild+Rollup 双模式。Dashboard 不需要 Vite 的 SSR 能力。rspack 的 dev server proxy 已经配好对 `apps/server` 的转发。

3. **Bun.serve 而非 Express** -- teamsland server 使用 Bun.serve，后端 API 新增路由直接写在 `dashboard.ts` 中，无需引入 Express。claudecodeui 的 Express 路由逻辑需要改写为 Bun.serve 的 `fetch()` 处理函数。

4. **Tailwind 版本统一到 4** -- teamsland 已用 Tailwind 4，claudecodeui 的 Tailwind 3 class 大部分兼容，少量破坏性变更（如 `bg-opacity-*` → `bg-*/*`）在搬运时处理。

5. **React 版本保持 19** -- React 19 向后兼容 18 的 API。claudecodeui 的 React 18 组件在 React 19 下直接运行，无需降级。

### 1.3 需要引入的新依赖

```
# 核心渲染
@xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-webgl
@uiw/react-codemirror @codemirror/lang-javascript @codemirror/lang-json @codemirror/merge @codemirror/theme-one-dark
react-markdown remark-gfm rehype-raw react-syntax-highlighter

# 编辑 & 文件
lucide-react fuse.js

# Agent SDK (server 侧)
@anthropic-ai/claude-agent-sdk chokidar

# 可选
react-error-boundary
```

**不引入的依赖：** Express、ws（用 Bun 原生 WebSocket）、node-pty（后续评估是否用 Bun.spawn 替代）、better-sqlite3（teamsland 有 `@teamsland/session`）。

---

## 2. 从 claudecodeui 搬运的文件清单

### 2.1 后端模块

| 源文件 (claudecodeui) | 目标文件 (teamsland) | 说明 |
|---|---|---|
| `server/projects.js` | `apps/server/src/session-discovery.ts` | Session 发现引擎，只保留 Claude provider 部分，去掉 Cursor/Codex/Gemini |
| `server/claude-sdk.js` | `apps/server/src/claude-sdk-integration.ts` | Claude Agent SDK 集成，`query()` + 事件流 + abort + resume |
| `server/shared/types.ts` | `packages/types/src/normalized-message.ts` | NormalizedMessage 类型定义，纳入 `@teamsland/types` |
| `server/shared/utils.ts` | `apps/server/src/utils/normalized-message.ts` | `createNormalizedMessage()` 工厂函数 |
| `server/modules/providers/services/sessions.service.ts` | `apps/server/src/services/sessions-service.ts` | 统一消息归一化服务，只保留 Claude adapter |
| `server/routes/messages.js` | *合并入* `apps/server/src/dashboard.ts` | 统一消息 API endpoint |

### 2.2 前端组件

| 源目录 (claudecodeui) | 目标目录 (teamsland) | 说明 |
|---|---|---|
| `src/components/chat/` | `apps/dashboard/src/components/chat/` | ChatInterface + hooks + utils + tools |
| `src/components/chat/tools/` | `apps/dashboard/src/components/chat/tools/` | ToolRenderer + diff 视图 + 可折叠输出 |
| `src/components/sidebar/` | `apps/dashboard/src/components/sidebar/` | Session 侧边栏 |
| `src/components/shell/` | `apps/dashboard/src/components/shell/` | xterm.js 终端 |
| `src/components/file-tree/` | `apps/dashboard/src/components/file-tree/` | 文件浏览器 |
| `src/components/code-editor/` | `apps/dashboard/src/components/code-editor/` | CodeMirror 编辑器 |
| `src/components/git-panel/` | `apps/dashboard/src/components/git-panel/` | Git 操作面板 |
| `src/stores/useSessionStore.ts` | `apps/dashboard/src/stores/useSessionStore.ts` | Session 消息 store（已经是 TS） |
| `src/contexts/WebSocketContext.tsx` | `apps/dashboard/src/contexts/WebSocketContext.tsx` | WebSocket 状态管理（已经是 TSX） |
| `src/contexts/PermissionContext.tsx` | `apps/dashboard/src/contexts/PermissionContext.tsx` | 工具权限审批上下文 |

### 2.3 不搬运的部分

- Cursor/Codex/Gemini 相关的所有代码 -- teamsland 只需要 Claude
- `server/database/db.js` -- teamsland 用自己的 `@teamsland/session`
- `server/middleware/auth.js` -- teamsland 用自己的 `lark-auth.ts`
- `src/components/auth/` -- teamsland 用飞书 OAuth
- `src/components/plugins/` -- 暂不需要插件系统
- `src/components/task-master/` -- 不需要 TaskMaster 集成
- `src/components/settings/` -- teamsland 有自己的配置体系
- `src/i18n/` -- teamsland 暂不需要多语言

---

## 3. JS -> TypeScript 转换策略

### 3.1 分层转换

**Phase 1 -- 已有 TS 文件直接搬运：**
- `useSessionStore.ts`、`WebSocketContext.tsx`、`PermissionContext.tsx`、`server/shared/types.ts` 等已有 TS 文件可直接使用，仅需调整 import 路径。

**Phase 2 -- JSX -> TSX 批量转换：**
1. 复制文件，扩展名改为 `.tsx`
2. 为每个组件的 props 添加 `interface` 定义（从 PropTypes 或 defaultProps 推导）
3. 消除所有 `any` -- 使用 `unknown` + 类型守卫
4. 为 hooks 的参数和返回值添加显式类型注解
5. 运行 `bun run lint` 确认 Biome 通过

**Phase 3 -- 工具/服务层转换：**
- `projects.js` 的函数签名复杂，用 `@ts-expect-error` 先标记再逐个修复
- `claude-sdk.js` 中大量回调和 SDK 类型，需要 `@anthropic-ai/claude-agent-sdk` 提供的 TS 类型

### 3.2 类型桥接

claudecodeui 的很多类型定义分散在各处。统一到 `@teamsland/types` 中：

```typescript
// packages/types/src/normalized-message.ts
export type { NormalizedMessage, MessageKind, FetchHistoryOptions, FetchHistoryResult };

// packages/types/src/session-discovery.ts
export interface DiscoveredProject { ... }
export interface DiscoveredSession { ... }

// packages/types/src/dashboard.ts
export interface WorkerTopologyNode { ... }
export interface SessionTypeAnnotation { ... }
```

### 3.3 估算工作量

| 类别 | 文件数 | 难度 |
|------|-------|------|
| 直接可用 TS/TSX | ~8 | 低（改 import 路径即可） |
| JSX -> TSX 转换 | ~40 | 中（需补 interface） |
| 纯 JS 工具函数 | ~10 | 低（加类型注解） |
| server JS -> TS | ~3 | 高（SDK 类型复杂） |

---

## 4. 后端 API 设计

### 4.1 新增 Endpoints

在 `apps/server/src/dashboard.ts` 的 `routeRequest()` 中添加：

#### 4.1.1 Session 发现

```
GET /api/projects
Response: DiscoveredProject[]
```

扫描 `~/.claude/projects/` 目录，返回所有项目及其 session 列表。使用 chokidar 监听文件变化，通过 WebSocket 推送 `projects_updated` 事件。

```typescript
interface DiscoveredProject {
  /** 编码后的项目名 (目录名) */
  name: string;
  /** 实际项目路径 */
  path: string;
  /** 显示名 (从 package.json 提取或路径末段) */
  displayName: string;
  /** Session 列表 (最新 N 个) */
  sessions: DiscoveredSession[];
  /** Session 分页元信息 */
  sessionMeta: { hasMore: boolean; total: number };
}

interface DiscoveredSession {
  id: string;
  summary: string;
  messageCount: number;
  lastActivity: string; // ISO 8601
  cwd: string;
  /** teamsland 扩展：session 类型标注 */
  sessionType?: 'coordinator' | 'task_worker' | 'observer_worker' | 'unknown';
  /** teamsland 扩展：关联的 worker ID */
  workerId?: string;
  /** teamsland 扩展：关联的群聊 ID */
  chatId?: string;
}
```

#### 4.1.2 Session 消息 (统一 endpoint)

```
GET /api/sessions/:sessionId/messages?projectName=xxx&limit=50&offset=0
Response: FetchHistoryResult
```

替代当前的 NDJSON 格式 `/api/sessions/:id/messages`。返回 `NormalizedMessage[]`，支持分页。

#### 4.1.3 Session 实时流 (新建 / 恢复)

```
WebSocket /api/ws
```

通过 WebSocket 消息类型路由：

```typescript
// 客户端 -> 服务端
{ type: 'claude-command', command: string, options: { sessionId?, cwd?, ... } }
{ type: 'abort-session', sessionId: string }
{ type: 'check-session-status', sessionId: string }
{ type: 'claude-permission-response', requestId: string, allow: boolean, ... }

// 服务端 -> 客户端  (全部使用 NormalizedMessage 格式)
{ kind: 'text', role: 'assistant', content: '...', sessionId: '...' }
{ kind: 'tool_use', toolName: 'Edit', toolInput: {...}, sessionId: '...' }
{ kind: 'tool_result', toolId: '...', toolResult: {...}, sessionId: '...' }
{ kind: 'stream_delta', content: '...', sessionId: '...' }
{ kind: 'complete', exitCode: 0, sessionId: '...' }
{ kind: 'permission_request', requestId: '...', toolName: '...', sessionId: '...' }
{ kind: 'session_created', newSessionId: '...', sessionId: '...' }
```

#### 4.1.4 Worker 拓扑

```
GET /api/topology
Response: TopologyGraph
```

从 `SubagentRegistry` + Session 发现数据构建拓扑：

```typescript
interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface TopologyNode {
  id: string;
  type: 'coordinator' | 'task_worker' | 'observer_worker';
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'idle';
  label: string;
  /** Worker 的任务描述 */
  taskBrief?: string;
  /** 关联信息 */
  metadata: {
    workerId?: string;
    requester?: string;
    chatId?: string;
    meegoIssueId?: string;
    startedAt?: string;
    completedAt?: string;
  };
}

interface TopologyEdge {
  from: string; // 源 node id
  to: string;   // 目标 node id
  type: 'spawned' | 'observes';
}
```

#### 4.1.5 文件系统操作

```
GET  /api/projects/:projectName/files          -- 文件树
GET  /api/projects/:projectName/file?filePath=  -- 读取文件
PUT  /api/projects/:projectName/file            -- 写入文件
```

从 claudecodeui 的 `getFileTree()` 逻辑搬运，改写为 `Bun.file()` 读写。

#### 4.1.6 Git 操作

```
GET  /api/git/status?path=
GET  /api/git/diff?path=
POST /api/git/stage
POST /api/git/commit
GET  /api/git/branches?path=
POST /api/git/checkout
```

从 claudecodeui 的 `server/routes/git.js` 搬运核心逻辑，改用 `Bun.spawn('git', ...)` 执行 git 命令。

### 4.2 现有 Endpoints 变更

| Endpoint | 变更 |
|----------|------|
| `GET /api/agents` | 保持不变，SubagentRegistry 数据源 |
| `GET /api/sessions/:id/messages` | 格式从 NDJSON 改为 JSON `{ messages, total, hasMore }` |
| `GET /api/ws` (WebSocket) | 扩展消息类型，新增 `claude-command`、`projects_updated` 等 |
| `GET /health` | 保持不变 |
| `/auth/*` | 保持不变 |

---

## 5. 前端组件架构

### 5.1 页面路由

使用 hash-based 路由（无需 react-router-dom，避免 rspack dev server 配置复杂度）：

```
/                    -- 项目列表 + Session 列表（主入口）
/session/:id         -- Session 详情（Chat + 侧面板）
/topology            -- Worker 拓扑视图
```

### 5.2 组件层级

```
<App>
  <AuthGate>                              -- 飞书 OAuth 鉴权（现有）
    <WebSocketProvider>                   -- 全局 WebSocket 连接
      <AppLayout>
        <Sidebar>                         -- 左侧栏
          <ProjectList />                 -- 项目列表
          <SessionList />                 -- Session 列表（按类型标注）
          <SessionFilters />              -- 过滤器（coordinator/worker/observer）
        </Sidebar>
        <MainContent>                     -- 右侧主内容区
          <ChatInterface />               -- 聊天界面
            <MessageList />               -- 消息列表（NormalizedMessage 渲染）
              <ToolRenderer />            -- 工具调用可视化
                <ToolDiffViewer />        -- Edit/Write diff 视图
                <CollapsibleSection />    -- Bash 可折叠输出
                <FileListContent />       -- Glob/Grep 文件列表
              </ToolRenderer>
            </MessageList>
            <MessageInput />              -- 消息输入框
          </ChatInterface>
          -- 或 --
          <TopologyView />                -- Worker 拓扑视图
        </MainContent>
        <DetailPanel>                     -- 右侧详情面板（可收起）
          <TabBar tabs={['文件','终端','Git','上下文']} />
          <FileTree /> + <CodeEditor />   -- 文件浏览 + 编辑
          <Shell />                       -- xterm.js 终端
          <GitPanel />                    -- Git 操作面板
          <ContextPanel />                -- teamsland 特有：飞书对话上下文
        </DetailPanel>
      </AppLayout>
    </WebSocketProvider>
  </AuthGate>
</App>
```

### 5.3 状态管理

| Store / Context | 来源 | 职责 |
|---|---|---|
| `useSessionStore` | 搬运自 claudecodeui | 每个 session 的消息缓存、server/realtime 合并 |
| `WebSocketContext` | 搬运自 claudecodeui | 全局 WebSocket 连接，自动重连 |
| `PermissionContext` | 搬运自 claudecodeui | 工具权限审批队列 |
| `useProjectStore` | 新增 | 项目列表、当前选中项目 |
| `useTopologyStore` | 新增 | Worker 拓扑图数据 |
| `useAuth` | 改造现有 | 飞书 OAuth 状态 |
| `useAgents` | 保留现有 | SubagentRegistry 数据 |

### 5.4 数据流

```
                     ┌─ projects_updated ──┐
                     │                     v
[chokidar]  ───>  [server]  ─── WS ──>  [WebSocketContext]
                     ^                     │
[claude-agent-sdk]───┘                     ├──> useSessionStore.appendRealtime()
                                           ├──> useProjectStore.handleUpdate()
                                           └──> useTopologyStore.handleUpdate()

[用户输入] ──> [MessageInput] ──> ws.sendMessage({type:'claude-command'})
                                       │
                                       v
                                  [server: queryClaudeSDK()]
                                       │
                                       v (async generator)
                                  [NormalizedMessage stream via WS]
```

---

## 6. NormalizedMessage Schema

以下是纳入 `@teamsland/types` 的完整类型定义：

```typescript
/**
 * 消息类型枚举
 *
 * @example
 * ```typescript
 * import type { MessageKind } from "@teamsland/types";
 * const kind: MessageKind = "tool_use";
 * ```
 */
export type MessageKind =
  | 'text'               // 文本消息（user / assistant）
  | 'tool_use'           // 工具调用开始
  | 'tool_result'        // 工具调用结果
  | 'thinking'           // Claude extended thinking
  | 'stream_delta'       // 流式增量文本
  | 'stream_end'         // 流式结束
  | 'error'              // 错误
  | 'complete'           // Session 完成
  | 'status'             // 状态更新 (token 用量等)
  | 'permission_request' // 工具权限请求
  | 'permission_cancelled'
  | 'session_created'    // 新 session 已创建
  | 'interactive_prompt' // AskUserQuestion 等交互式工具
  | 'task_notification'; // 异步任务通知

/**
 * 归一化消息格式 — Provider 无关的统一消息信封
 *
 * 所有 session 消息（无论来自 JSONL 历史还是实时流）
 * 都归一化为此格式后交给前端渲染。
 *
 * @example
 * ```typescript
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const msg: NormalizedMessage = {
 *   id: "msg_abc123",
 *   sessionId: "sess_xyz",
 *   timestamp: "2026-04-23T10:00:00Z",
 *   provider: "claude",
 *   kind: "text",
 *   role: "assistant",
 *   content: "我来帮你实现这个功能。",
 * };
 * ```
 */
export interface NormalizedMessage {
  /** 唯一消息 ID */
  id: string;
  /** 所属 session ID */
  sessionId: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** LLM provider */
  provider: 'claude';
  /** 消息类型 */
  kind: MessageKind;

  // ── kind='text' / 'stream_delta' ──
  role?: 'user' | 'assistant';
  content?: string;
  images?: string[];

  // ── kind='tool_use' ──
  toolName?: string;
  toolInput?: unknown;
  toolId?: string;

  // ── kind='tool_result' ──
  toolResult?: {
    content?: string;
    isError?: boolean;
    toolUseResult?: unknown;
  };

  // ── kind='error' ──
  isError?: boolean;

  // ── kind='status' ──
  text?: string;
  tokens?: number;
  canInterrupt?: boolean;
  tokenBudget?: { used: number; total: number };

  // ── kind='permission_request' ──
  requestId?: string;
  input?: unknown;
  context?: unknown;

  // ── kind='session_created' ──
  newSessionId?: string;

  // ── kind='complete' ──
  exitCode?: number;
  summary?: string;

  // ── 子 agent 相关 ──
  parentToolUseId?: string;
  subagentTools?: unknown[];

  // ── 流式相关 ──
  isFinal?: boolean;
}
```

### 6.1 tool_use/tool_result 关联逻辑

从 claudecodeui 搬运的关键关联规则：

1. **assistant 消息中的 `tool_use` block** 生成 `kind: 'tool_use'` 消息，携带 `toolId`（API 的 `id` 字段）
2. **user 消息中的 `tool_result` block** 匹配 `tool_use_id` 关联到对应的 `tool_use` 消息
3. **工具状态推导**：
   - `tool_use` 存在但无对应 `tool_result` → `status: 'running'`
   - `tool_result` 存在且 `isError: false` → `status: 'completed'`
   - `tool_result` 存在且 `isError: true` → `status: 'error'`
   - `tool_use` 被 permission 拒绝 → `status: 'denied'`

---

## 7. 实时流集成

### 7.1 Claude Agent SDK 使用方式

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

// 创建 query instance (async generator)
const queryInstance = query({
  prompt: userMessage,
  options: {
    cwd: projectPath,
    resume: sessionId,         // 有值时为 resume，无值为新建
    model: "sonnet",
    permissionMode: "bypassPermissions", // 或通过 canUseTool 回调控制
    systemPrompt: { type: "preset", preset: "claude_code" },
    settingSources: ["project", "user", "local"],
    pathToClaudeCodeExecutable: "claude",
    tools: { type: "preset", preset: "claude_code" },
    env: { ...process.env },
    canUseTool: async (toolName, input, context) => {
      // 通过 WebSocket 推送 permission_request 到前端
      // 等待用户 allow/deny
      return { behavior: "allow" | "deny", updatedInput?, message? };
    },
  },
});

// 消费事件流
for await (const event of queryInstance) {
  // event.type: 'assistant' | 'user' | 'result' | ...
  // event.session_id: 首条消息携带 session ID
  const normalized = normalizeSDKEvent(event, sessionId);
  for (const msg of normalized) {
    ws.send(JSON.stringify(msg));
  }
}
```

### 7.2 session 生命周期管理

```typescript
// server/src/claude-sdk-integration.ts

/** 活跃 session 注册表 */
const activeSessions = new Map<string, {
  instance: AsyncGenerator;   // query() 返回的 async generator
  status: "active" | "aborted";
  startTime: number;
  writer: WebSocketWriter;    // 绑定的 WS 连接
}>();

/** 创建新 session 或 resume 已有 session */
async function startOrResumeSession(
  command: string,
  options: { sessionId?: string; cwd?: string },
  writer: WebSocketWriter,
): Promise<void> { ... }

/** 中止 session */
async function abortSession(sessionId: string): Promise<boolean> {
  const session = activeSessions.get(sessionId);
  if (!session) return false;
  await session.instance.interrupt();
  activeSessions.delete(sessionId);
  return true;
}

/** 检查 session 是否活跃 */
function isSessionActive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

/** WS 重连时更新 writer */
function reconnectWriter(sessionId: string, newWs: unknown): boolean {
  const session = activeSessions.get(sessionId);
  if (!session?.writer) return false;
  session.writer.updateWebSocket(newWs);
  return true;
}
```

### 7.3 WebSocket 消息路由扩展

在 `dashboard.ts` 的 `websocket.message` handler 中新增：

```typescript
websocket: {
  message(ws, rawMessage) {
    const data = JSON.parse(String(rawMessage));

    switch (data.type) {
      // 现有：agent 状态广播
      case "ping": { ... }

      // 新增：Claude SDK 交互
      case "claude-command":
        startOrResumeSession(data.command, data.options, writerFor(ws));
        break;
      case "abort-session":
        abortSession(data.sessionId);
        break;
      case "check-session-status":
        ws.send(JSON.stringify({
          type: "session-status",
          sessionId: data.sessionId,
          isProcessing: isSessionActive(data.sessionId),
        }));
        break;
      case "claude-permission-response":
        resolveToolApproval(data.requestId, {
          allow: data.allow,
          updatedInput: data.updatedInput,
        });
        break;
    }
  },
}
```

---

## 8. Session Resume / 接管流程

### 8.1 完整时序图

```
用户                  前端 Dashboard          teamsland Server           Claude Agent SDK
 │                       │                       │                          │
 │  浏览 Session 列表     │                       │                          │
 │ ──────────────────>   │                       │                          │
 │                       │  GET /api/projects     │                          │
 │                       │ ─────────────────────> │                          │
 │                       │  <── project + session  │                          │
 │                       │      列表 (JSON)        │                          │
 │                       │                       │                          │
 │  点击 Session X       │                       │                          │
 │ ──────────────────>   │                       │                          │
 │                       │  GET /api/sessions/X/  │                          │
 │                       │  messages              │                          │
 │                       │ ─────────────────────> │                          │
 │                       │  <── 历史 messages      │                          │
 │                       │      (NormalizedMsg[])  │                          │
 │                       │                       │                          │
 │  [渲染历史消息,        │                       │                          │
 │   只读模式]            │                       │                          │
 │                       │                       │                          │
 │                       │  WS: check-session-   │                          │
 │                       │  status {sessionId: X} │                          │
 │                       │ ─────────────────────> │                          │
 │                       │  <── isProcessing:     │                          │
 │                       │      true/false         │                          │
 │                       │                       │                          │
 │  [如果 isProcessing:  │                       │                          │
 │   显示实时输出流]      │                       │                          │
 │                       │                       │                          │
 │  点击 "接管" 按钮     │                       │                          │
 │ ──────────────────>   │                       │                          │
 │                       │  [切换到交互模式,      │                          │
 │                       │   启用 MessageInput]   │                          │
 │                       │                       │                          │
 │  输入消息 "改用       │                       │                          │
 │  ImageCropper"        │                       │                          │
 │ ──────────────────>   │                       │                          │
 │                       │  WS: claude-command    │                          │
 │                       │  { command: "改用...", │                          │
 │                       │    options: {          │                          │
 │                       │      sessionId: X,     │                          │
 │                       │      cwd: "/path/..."  │                          │
 │                       │    }                   │                          │
 │                       │  }                     │                          │
 │                       │ ─────────────────────> │                          │
 │                       │                       │  query({ prompt, options: │
 │                       │                       │    { resume: X } })       │
 │                       │                       │ ───────────────────────>  │
 │                       │                       │                          │
 │                       │                       │  <── event stream         │
 │                       │                       │      (async generator)    │
 │                       │  <── NormalizedMessage │                          │
 │                       │      stream via WS     │                          │
 │                       │                       │                          │
 │  [实时显示 Claude      │                       │                          │
 │   的思考和操作]        │                       │                          │
 │                       │                       │                          │
 │                       │  WS: permission_request│                          │
 │  [弹出权限审批框]      │  <──────────────────── │                          │
 │                       │                       │                          │
 │  点击 "Allow"         │                       │                          │
 │ ──────────────────>   │                       │                          │
 │                       │  WS: claude-permission │                          │
 │                       │  -response { allow:    │                          │
 │                       │  true }                │                          │
 │                       │ ─────────────────────> │                          │
 │                       │                       │  resolveToolApproval()    │
 │                       │                       │ ───────────────────────>  │
 │                       │                       │                          │
 │                       │                       │  <── 继续执行             │
 │                       │  <── 后续 messages     │                          │
 │                       │                       │                          │
 │                       │  kind: 'complete'      │                          │
 │  [显示完成状态]        │  <──────────────────── │                          │
```

### 8.2 三种观察模式

| 模式 | 触发 | 行为 |
|------|------|------|
| **浏览历史** | 点击已完成的 session | 加载 JSONL 历史，只读渲染 |
| **观察实时** | 点击运行中的 session | 加载历史 + 订阅 WS 实时流，只读 |
| **接管交互** | 在观察模式中点击 "接管" | 启用 MessageInput，用 `resume` 模式发送消息 |

### 8.3 Session 类型标注

teamsland 通过 `SubagentRegistry` 中的元数据区分 session 类型：

```typescript
function annotateSessionType(session: DiscoveredSession): SessionTypeAnnotation {
  // 1. 查询 SubagentRegistry
  const agent = registry.findBySessionId(session.id);
  if (agent) {
    return {
      type: agent.role === 'observer' ? 'observer_worker' : 'task_worker',
      workerId: agent.id,
      taskBrief: agent.taskBrief,
      requester: agent.requester,
      chatId: agent.chatId,
    };
  }

  // 2. 检查是否为 Coordinator session
  if (isCoordinatorSession(session)) {
    return { type: 'coordinator' };
  }

  // 3. 默认未知
  return { type: 'unknown' };
}
```

前端侧边栏通过类型标注显示不同图标和颜色：
- Coordinator: 蓝色 brain 图标
- Task Worker: 绿色 hammer 图标
- Observer Worker: 紫色 eye 图标

---

## 9. Worker 拓扑可视化设计

### 9.1 数据模型

后端在 `GET /api/topology` 中构建：

```typescript
function buildTopology(): TopologyGraph {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // 1. Coordinator 节点
  const coordinatorSessions = findCoordinatorSessions();
  for (const session of coordinatorSessions) {
    nodes.push({
      id: `coord_${session.id}`,
      type: 'coordinator',
      sessionId: session.id,
      status: isSessionActive(session.id) ? 'running' : 'idle',
      label: 'Coordinator',
      metadata: {},
    });
  }

  // 2. Worker 节点 (from SubagentRegistry)
  for (const agent of registry.allRunning()) {
    const nodeId = `worker_${agent.id}`;
    nodes.push({
      id: nodeId,
      type: agent.role === 'observer' ? 'observer_worker' : 'task_worker',
      sessionId: agent.sessionId,
      status: agent.status,
      label: agent.taskBrief ?? agent.id,
      taskBrief: agent.taskBrief,
      metadata: {
        workerId: agent.id,
        requester: agent.requester,
        chatId: agent.chatId,
        meegoIssueId: agent.meegoIssueId,
        startedAt: agent.startedAt,
      },
    });

    // 3. Coordinator -> Worker 边
    edges.push({
      from: `coord_${agent.spawnedBy}`,
      to: nodeId,
      type: 'spawned',
    });

    // 4. Observer -> 被观察 Worker 边
    if (agent.role === 'observer' && agent.observeTarget) {
      edges.push({
        from: nodeId,
        to: `worker_${agent.observeTarget}`,
        type: 'observes',
      });
    }
  }

  return { nodes, edges };
}
```

### 9.2 前端渲染方式

**不引入重型图库（如 D3、Cytoscape）。** 使用 CSS Grid + SVG 的轻量级方案：

```
┌───────────────────────────────────────────────────┐
│                    Coordinator                     │
│               [Brain Session #abc]                 │
│                   status: idle                     │
└───────────┬──────────────┬───────────┬────────────┘
            │              │           │
     ┌──────▼─────┐ ┌──────▼─────┐ ┌──▼──────────────┐
     │ Worker #1  │ │ Worker #2  │ │ Worker #3        │
     │ 实现头像上传│ │ 整理 OKR    │ │ 修复登录 bug     │
     │ [running]  │ │ [completed]│ │ [running]         │
     └──────┬─────┘ └────────────┘ └──────────────────┘
            │
     ┌──────▼──────┐
     │ Observer    │
     │ 进度检查     │
     │ [completed] │
     └─────────────┘
```

**实现方案：**

1. **TopologyView 组件** — 使用 CSS flexbox 布局三层（Coordinator / Workers / Observers）
2. **连线** — SVG `<path>` 元素，使用贝塞尔曲线连接节点
3. **节点组件** — 可点击，点击后跳转到对应 session 的 ChatInterface
4. **实时更新** — 通过 WebSocket 的 `agents_update` 事件触发重新渲染
5. **颜色编码** — running: green pulse, completed: gray, failed: red, idle: blue

```tsx
// apps/dashboard/src/components/topology/TopologyView.tsx
interface TopologyViewProps {
  graph: TopologyGraph;
  onNodeClick: (node: TopologyNode) => void;
}

function TopologyView({ graph, onNodeClick }: TopologyViewProps) {
  const layers = useMemo(() => groupByLayer(graph), [graph]);
  // layers = { coordinators: [...], workers: [...], observers: [...] }

  return (
    <div className="relative">
      <svg className="absolute inset-0 pointer-events-none">
        {graph.edges.map(edge => <EdgePath key={`${edge.from}-${edge.to}`} ... />)}
      </svg>
      <div className="flex flex-col items-center gap-8">
        <NodeRow nodes={layers.coordinators} onClick={onNodeClick} />
        <NodeRow nodes={layers.workers} onClick={onNodeClick} />
        <NodeRow nodes={layers.observers} onClick={onNodeClick} />
      </div>
    </div>
  );
}
```

---

## 10. 与现有 WebSocket API 的整合

### 10.1 设计原则

**扩展而非替换。** 现有的 `agents_update` / `connected` 消息类型继续使用，新增消息类型并行推送。

### 10.2 WebSocket 消息类型全集

```typescript
// 现有 (保持不变)
type WsConnected       = { type: 'connected'; agents: AgentRecord[] };
type WsAgentsUpdate    = { type: 'agents_update'; agents: AgentRecord[] };

// 新增：Session 发现
type WsProjectsUpdated = { type: 'projects_updated'; projects: DiscoveredProject[] };

// 新增：Claude SDK 实时流 (使用 NormalizedMessage，kind 字段区分)
type WsNormalizedMsg   = NormalizedMessage; // 直接发送 NormalizedMessage

// 新增：Session 状态查询响应
type WsSessionStatus   = { type: 'session-status'; sessionId: string; isProcessing: boolean };

// 新增：活跃 session 列表
type WsActiveSessions  = { type: 'active-sessions'; sessions: string[] };
```

### 10.3 客户端连接管理

现有的 `useAgents` hook 使用 `/api/ws` WebSocket，`WebSocketContext` 也使用同一个 endpoint。
整合方案：

1. **单一 WebSocket 连接** — 前端只维持一个到 `/api/ws` 的 WebSocket
2. **消息分发** — `WebSocketContext` 的 `latestMessage` 由各个 store/hook 按 `type` / `kind` 过滤消费
3. **向后兼容** — `useAgents` 继续监听 `agents_update`，新增的 `useSessionStore` 监听 `NormalizedMessage`

```typescript
// 在 WebSocketContext 中消费消息时的路由逻辑
function handleMessage(data: unknown) {
  const msg = data as Record<string, unknown>;

  // 旧协议 — agent 状态
  if (msg.type === 'agents_update' || msg.type === 'connected') {
    agentsStore.handleUpdate(msg);
  }

  // 新协议 — 项目更新
  if (msg.type === 'projects_updated') {
    projectStore.handleUpdate(msg);
  }

  // 新协议 — NormalizedMessage (有 kind 字段)
  if (msg.kind && msg.sessionId) {
    sessionStore.appendRealtime(msg.sessionId as string, msg as NormalizedMessage);
  }

  // 新协议 — session 状态
  if (msg.type === 'session-status') {
    sessionStatusStore.handleUpdate(msg);
  }
}
```

### 10.4 服务端推送整合

在 `startDashboard()` 中扩展：

```typescript
// 现有：agent 变更推送
registry.subscribe((agents) => broadcast(clients, { type: 'agents_update', agents }));

// 新增：Session 文件变化推送 (chokidar 监听)
const sessionWatcher = setupSessionWatcher();
sessionWatcher.on('change', async () => {
  const projects = await discoverProjects();
  broadcast(clients, { type: 'projects_updated', projects });
});

// 新增：Claude SDK 实时流由 WebSocketWriter 直接推送给绑定的客户端
// (不通过 broadcast，而是点对点)
```

---

## 11. 验证方式

### 11.1 单元测试

| 模块 | 测试目标 | 工具 |
|------|---------|------|
| `session-discovery.ts` | JSONL 解析、项目路径提取、session 列表排序 | Vitest + fixture JSONL 文件 |
| `normalized-message.ts` | `createNormalizedMessage()` 各 kind 的序列化 | Vitest |
| `claude-sdk-integration.ts` | SDK options 映射、session 注册/注销 | Vitest + SDK mock |
| `useSessionStore.ts` | server/realtime 合并、dedup 逻辑 | Vitest + React Testing Library |
| `ToolRenderer` | 各工具类型渲染（diff、bash、file list） | Vitest + React Testing Library |

### 11.2 集成测试

| 场景 | 测试方法 |
|------|---------|
| Session 发现端到端 | 在 `~/.claude/projects/` 下创建 fixture 目录和 JSONL，启动 server，验证 `GET /api/projects` 返回正确数据 |
| 消息加载 | 创建 fixture JSONL，验证 `GET /api/sessions/:id/messages` 返回 NormalizedMessage[] |
| WebSocket 实时推送 | 启动 server，连接 WS，模拟 JSONL 文件变化，验证收到 `projects_updated` |
| 完整接管流程 | 启动 server + mock Claude CLI，连接 WS，发送 `claude-command`，验证收到 NormalizedMessage 流 |

### 11.3 E2E 测试

| 场景 | 方法 |
|------|------|
| 加载项目列表 | 浏览器访问 Dashboard，验证侧边栏显示项目 |
| 查看历史 session | 点击 session，验证消息列表正确渲染 |
| 工具调用可视化 | 点击包含 Edit 工具的 session，验证 diff 视图渲染 |
| 接管 session | 在运行中 session 点击接管，输入消息，验证 Claude 响应 |

### 11.4 验收标准 (Phase 7 完成的定义)

- [ ] `GET /api/projects` 返回 `~/.claude/projects/` 下的所有项目和 session
- [ ] Session 列表正确标注类型（coordinator / task_worker / observer_worker）
- [ ] 历史 session 消息正确渲染，包括 tool_use/tool_result 关联
- [ ] Edit/Write 工具显示 diff 视图
- [ ] Bash 工具显示可折叠输出
- [ ] 运行中 session 显示实时输出流
- [ ] 用户可以接管 session 并与 Claude 交互
- [ ] Worker 拓扑视图显示 Coordinator -> Worker -> Observer 层级
- [ ] 文件浏览器可以浏览和编辑项目文件
- [ ] xterm.js 终端可以执行命令
- [ ] Git 面板可以查看 diff、stage、commit
- [ ] 所有新代码通过 `bun run lint` (Biome)
- [ ] 核心模块有 Vitest 单元测试覆盖

---

## 12. 风险点

### 12.1 高风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **node-pty 在 Bun 下不可用** | Shell 终端无法工作。node-pty 依赖 C++ addon，Bun 的 N-API 兼容性可能有问题 | **方案 A:** 用 `Bun.spawn()` 创建 PTY（Bun 原生支持 `stdin: 'pipe'`）。**方案 B:** 降级为非交互式命令执行。**方案 C:** 终端功能在独立 Node.js 子进程中运行 |
| **Claude Agent SDK 版本兼容性** | claudecodeui 锁定 `^0.2.116`，teamsland 可能需要不同版本 | 在 `apps/server/package.json` 中明确锁定版本，CI 中定期检查 SDK 更新 |
| **React 19 与 claudecodeui 组件兼容性** | 某些 React 18 特有的行为在 19 中可能不同（如 batching、strict mode） | 搬运每个组件后跑一遍功能验证；React 19 的 breaking changes 主要影响 class components，claudecodeui 全是 function components，风险较低 |

### 12.2 中等风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **Tailwind 3 -> 4 的 class 不兼容** | 部分样式错乱。Tailwind 4 移除了 `bg-opacity-*`、`text-opacity-*` 等工具类 | 编写 codemod 脚本批量替换已知的破坏性变更；搬运时逐组件视觉验证 |
| **better-sqlite3 依赖** | claudecodeui 的 Cursor session 读取依赖 SQLite。teamsland 不需要 Cursor 支持，但如果漏删了引用会导致构建失败 | 搬运时彻底移除所有 Cursor/Codex/Gemini 相关代码，grep 确认无残留 import |
| **Express 中间件转换** | claudecodeui 大量使用 Express middleware（multer、cors、auth），转换为 Bun.serve 需要逐个改写 | 按功能分批转换：先搬运核心 API（projects、sessions、messages），file upload / multer 最后处理 |
| **chokidar 在 Bun 下的行为** | chokidar 依赖 fsevents（macOS native addon），Bun 的兼容性需要验证 | **方案 A:** 直接用 Bun 的 `Bun.watch()` 替代。**方案 B:** 保留 chokidar，在 Bun 下测试确认 |

### 12.3 低风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| **CodeMirror 包体积大** | Dashboard bundle size 增加 ~300KB (gzip) | 使用动态 import + code splitting，按需加载语言包 |
| **xterm.js WebGL addon 兼容性** | 部分浏览器不支持 WebGL2 | 自动降级到 canvas renderer，claudecodeui 已有相关处理逻辑 |
| **JS -> TS 转换的类型不完整** | 部分 `unknown` 可能过于宽泛 | 先用 `unknown` 通过编译，后续逐步细化类型。优先确保运行时正确 |

### 12.4 搬运检查清单

每个组件搬运后需要确认：

1. [ ] 文件扩展名改为 `.tsx` / `.ts`
2. [ ] 所有 import 路径调整为 teamsland 的目录结构
3. [ ] 移除 Cursor/Codex/Gemini 相关代码
4. [ ] 移除 i18n 相关代码（`useTranslation()`、`t()` 调用）
5. [ ] Props 类型 interface 定义完整
6. [ ] 无 `any` 类型
7. [ ] 无 `console.log`（改用 `@teamsland/observability` logger）
8. [ ] Biome lint 通过
9. [ ] Tailwind class 兼容性检查（3 -> 4）
10. [ ] 导出函数有 JSDoc 注释（中文 + `@example`）

---

## 附录 A: 实施顺序建议

```
7A: 技术栈准备 (1-2 天)
  ├── 安装新依赖 (xterm, codemirror, react-markdown, etc.)
  ├── rspack 配置调整 (code splitting, CSS 处理)
  └── 创建类型文件 (NormalizedMessage, DiscoveredProject, etc.)

7B: 后端 API (3-5 天)
  ├── Session 发现 (session-discovery.ts)
  ├── Claude SDK 集成 (claude-sdk-integration.ts)
  ├── NormalizedMessage 工厂 (normalized-message.ts)
  ├── Dashboard API 扩展 (projects, messages, topology)
  ├── WebSocket 消息路由扩展
  └── chokidar / Bun.watch 文件监听

7C: 前端核心组件 (5-8 天)
  ├── WebSocketContext + useSessionStore 搬运
  ├── ChatInterface + MessageList 搬运并转 TSX
  ├── ToolRenderer + 所有工具可视化组件
  ├── Sidebar (Session 列表 + 类型标注)
  ├── MessageInput (输入框 + 接管模式)
  └── 路由 + AppLayout 重构

7D: 辅助面板 (3-5 天)
  ├── Shell (xterm.js 终端)
  ├── FileTree + CodeEditor
  ├── GitPanel
  └── TopologyView

7E: teamsland 特有扩展 (3-5 天)
  ├── Session 类型标注（与 SubagentRegistry 联动）
  ├── 任务关联视图（群聊消息、Meego 工单）
  ├── 飞书上下文面板
  └── Worker 拓扑视图数据源整合

验证 & 收尾 (2-3 天)
  ├── 单元测试覆盖
  ├── 集成测试
  ├── 视觉验证 & 样式微调
  └── 文档更新
```

估计总工作量: **17-28 人天**
