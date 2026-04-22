# Server API 参考

`apps/server` 对外暴露两类接口：HTTP REST 接口和 WebSocket 实时推送接口。Dashboard 前端通过这些接口展示 Agent 运行状态、获取历史消息并管理用户会话。

---

## HTTP 接口

### GET /health

健康检查接口。负载均衡器和监控系统可定期调用此接口确认服务存活。

**认证：** 无需认证

**响应：**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "status": "ok",
  "uptime": 12345
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 固定值 `"ok"` |
| `uptime` | number | 进程启动至今的运行秒数 |

---

### GET /auth/lark

发起飞书 OAuth 2.0 登录流程。将用户重定向到飞书授权页面。

**认证：** 无需认证

**查询参数：**

| 参数 | 必需 | 说明 |
|------|------|------|
| `redirect` | 否 | 登录成功后的目标页面路径，默认重定向到 `/` |

**响应：** `302 Found`，重定向到飞书 OAuth 授权 URL。

**注意：** 仅当 `config.dashboard.auth.provider` 为 `"lark_oauth"` 时此接口可用。若 auth 未配置，返回 `404`。

---

### GET /auth/lark/callback

飞书 OAuth 回调接口。飞书完成授权后将用户浏览器重定向至此地址。

**认证：** 无需认证（仅供飞书回调）

**处理流程：**

1. 接收飞书返回的 `code` 参数
2. 使用 `code` 换取用户信息（userId、name、department）
3. 校验用户所属部门是否在 `config.dashboard.auth.allowedDepartments` 列表中
4. 创建服务端会话，设置 `teamsland_session` HttpOnly Cookie（有效期由 `sessionTtlHours` 配置）
5. 重定向到登录前的原始页面

**响应：** `302 Found`，携带 `Set-Cookie: teamsland_session=...` 头部，重定向到目标页面。

**错误响应：**

| 状态码 | 说明 |
|--------|------|
| `403` | 用户部门不在允许列表中 |
| `500` | 飞书 API 调用失败 |

---

### GET /auth/me

获取当前已登录用户的信息。前端可调用此接口判断登录状态并展示用户信息。

**认证：** 需要 `teamsland_session` Cookie

**响应：**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "userId": "ou_xxxxxxxxxxxxxx",
  "name": "张三",
  "department": "前端工程"
}
```

**错误响应：**

| 状态码 | 响应体 | 说明 |
|--------|--------|------|
| `401` | `{ "error": "未登录" }` | Cookie 不存在或会话已过期 |
| `404` | — | `auth.provider` 为 `"none"` 时，此接口不存在 |

---

### POST /auth/logout

登出当前用户，清除会话 Cookie，并重定向到首页。

**认证：** 需要 `teamsland_session` Cookie

**响应：**

```http
HTTP/1.1 302 Found
Set-Cookie: teamsland_session=; Max-Age=0; HttpOnly
Location: /
```

---

### GET /api/agents

获取当前所有运行中的 Agent 列表。由 `SubagentRegistry` 提供数据。

**认证：** 需要已登录会话（`auth.provider` 为 `"none"` 时无需认证）

**响应：**

```http
HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "agentId": "agent_abc123",
    "pid": 12345,
    "sessionId": "sess_xyz789",
    "issueId": "ISSUE-42",
    "worktreePath": "/tmp/worktrees/agent_abc123",
    "status": "running",
    "retryCount": 0,
    "createdAt": 1745280000000
  }
]
```

**AgentRecord 结构：**

```typescript
interface AgentRecord {
  /** Agent 唯一标识符 */
  agentId: string;
  /** 操作系统进程 ID */
  pid: number;
  /** 关联的会话 ID */
  sessionId: string;
  /** 触发本次任务的 Meego Issue ID */
  issueId: string;
  /** Agent 使用的 Git Worktree 路径 */
  worktreePath: string;
  /** 当前状态 */
  status: "running" | "completed" | "failed";
  /** 已重试次数 */
  retryCount: number;
  /** 创建时间（Unix 毫秒时间戳） */
  createdAt: number;
}
```

---

### GET /api/sessions/:id/messages

获取指定会话的历史消息，以 NDJSON 格式流式返回（每行一个 JSON 对象）。

**路径参数：**

| 参数 | 说明 |
|------|------|
| `id` | 会话 ID（对应 `AgentRecord.sessionId`） |

**查询参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | number | `100` | 每次返回的最大消息数 |
| `offset` | number | `0` | 分页偏移量（按 `id` 正序） |

**响应：**

```http
HTTP/1.1 200 OK
Content-Type: application/x-ndjson

{"id":1,"sessionId":"sess_xyz789","role":"user","content":"帮我修复这个 bug","toolName":null,"traceId":null,"createdAt":1745280001000}
{"id":2,"sessionId":"sess_xyz789","role":"assistant","content":"我来分析一下这个问题...","toolName":null,"traceId":"trace_abc","createdAt":1745280002000}
{"id":3,"sessionId":"sess_xyz789","role":"tool","content":"{\"result\":\"ok\"}","toolName":"read_file","traceId":"trace_abc","createdAt":1745280003000}
```

**MessageRow 结构：**

```typescript
interface MessageRow {
  /** 自增主键 */
  id: number;
  /** 所属会话 ID */
  sessionId: string;
  /** 消息角色：user | assistant | tool | system */
  role: string;
  /** 消息内容（文本或 JSON 字符串） */
  content: string;
  /** 工具调用名称，非工具消息时为 null */
  toolName: string | null;
  /** OpenTelemetry Trace ID，用于关联追踪链路 */
  traceId: string | null;
  /** 消息创建时间（Unix 毫秒时间戳） */
  createdAt: number;
}
```

**错误响应：**

| 状态码 | 说明 |
|--------|------|
| `404` | 会话 ID 不存在 |

---

## WebSocket 接口

### GET /ws

WebSocket 升级端点，供 Dashboard 前端建立实时连接，接收 Agent 状态推送。

**协议升级：** 发送标准 WebSocket 握手请求，服务端返回 `101 Switching Protocols`。

**认证：** 与 HTTP 接口相同（通过 Cookie 验证），握手阶段完成鉴权。

---

#### 连接建立

客户端完成 WebSocket 握手后，服务端立即推送当前所有 Agent 的快照：

```json
{
  "type": "connected",
  "agents": [
    {
      "agentId": "agent_abc123",
      "pid": 12345,
      "sessionId": "sess_xyz789",
      "issueId": "ISSUE-42",
      "worktreePath": "/tmp/worktrees/agent_abc123",
      "status": "running",
      "retryCount": 0,
      "createdAt": 1745280000000
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"connected"` | 消息类型标识 |
| `agents` | `AgentRecord[]` | 当前全量 Agent 列表 |

---

#### Agent 状态变更推送

每当有 Agent 注册（新任务启动）或注销（任务完成/失败）时，服务端主动向所有已连接的 WebSocket 客户端推送最新列表。推送由 `SubagentRegistry.subscribe()` 触发，无需客户端轮询。

```json
{
  "type": "agents_update",
  "agents": [
    {
      "agentId": "agent_abc123",
      "pid": 12345,
      "sessionId": "sess_xyz789",
      "issueId": "ISSUE-42",
      "worktreePath": "/tmp/worktrees/agent_abc123",
      "status": "completed",
      "retryCount": 0,
      "createdAt": 1745280000000
    },
    {
      "agentId": "agent_def456",
      "pid": 12399,
      "sessionId": "sess_uvw321",
      "issueId": "ISSUE-43",
      "worktreePath": "/tmp/worktrees/agent_def456",
      "status": "running",
      "retryCount": 1,
      "createdAt": 1745280060000
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"agents_update"` | 消息类型标识 |
| `agents` | `AgentRecord[]` | 变更后的全量 Agent 列表（非增量） |

**注意：** 每次推送的 `agents` 字段均为**全量**列表，客户端应直接替换本地状态而非做差量合并。

---

## 前端集成示例

```typescript
// 建立 WebSocket 连接
const ws = new WebSocket("ws://localhost:3000/ws");

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "connected") {
    // 初始化 Agent 列表
    setAgents(msg.agents);
  } else if (msg.type === "agents_update") {
    // 更新 Agent 列表（全量替换）
    setAgents(msg.agents);
  }
});

// 获取会话消息（NDJSON 解析）
const response = await fetch("/api/sessions/sess_xyz789/messages?limit=50");
const text = await response.text();
const messages = text
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
```
