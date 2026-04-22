# Dashboard 监控面板

## 概述

Dashboard 是基于 React 19 + rspack + TailwindCSS v4 构建的前端界面，提供实时 Agent 监控、会话消息查看以及飞书 OAuth 身份认证功能。

## 组件结构

### App.tsx

根布局组件，包含：

- **顶部 Header**：显示 WebSocket 连接状态指示点与当前活跃 Agent 数量
- **AgentList**：Agent 列表表格
- **EventViewer**：会话事件查看器

### AuthGate

身份认证守卫组件，在渲染主界面前执行鉴权检查：

- 调用 `GET /auth/me` 验证当前用户身份
- 若返回 404，表示未配置认证，自动放行
- 若返回 401，显示"飞书登录"按钮，引导用户完成 OAuth 流程

### AgentList

以表格形式展示所有活跃及历史 Agent，列包括：

| 列名 | 说明 |
|------|------|
| Agent ID | Agent 唯一标识符 |
| Issue | 关联的需求/缺陷编号 |
| PID | 进程 ID |
| Status | 状态徽章（颜色区分不同状态） |
| Retry | 重试次数 |
| Start time | 启动时间 |
| Duration | 已运行时长 |

点击任意行可在 EventViewer 中查看该 Agent 对应会话的完整消息记录。

### EventViewer

NDJSON 格式的消息流查看器，展示字段包括：

| 字段 | 说明 |
|------|------|
| ID | 消息唯一标识符 |
| Time | 消息时间戳 |
| Role | 角色徽章（颜色区分 user / assistant / tool） |
| Tool name | 工具调用名称（如适用） |
| Content | 消息内容（截断至 200 字符） |
| Trace ID | OpenTelemetry Trace ID |

提供**刷新**按钮以手动拉取最新消息。

## 实时更新

`useAgents` Hook 通过 WebSocket 连接到 `ws://{host}/ws`，维持实时 Agent 状态同步：

- **连接成功时**：接收初始快照消息 `{ type: "connected", agents: [...] }`
- **状态变更时**：接收增量更新消息 `{ type: "agents_update", agents: [...] }`
- **连接断开时**：3 秒后自动重连

## 飞书 OAuth 认证

完整的 OAuth 2.0 认证流程如下：

1. 用户点击"飞书登录"按钮，浏览器跳转至 `/auth/lark?redirect=...`
2. 服务端生成飞书 OAuth 授权 URL，将用户重定向至飞书登录页
3. 飞书回调至服务端，服务端用授权码换取访问令牌，并写入 `teamsland_session` Cookie（HttpOnly、SameSite=Lax）
4. 若配置了部门白名单，服务端会过滤非白名单部门的用户
5. 如需关闭认证，将配置项设为 `dashboard.auth.provider: "none"` 即可

## 开发模式

```bash
cd apps/dashboard
bun run dev
```

rspack 开发服务器监听 **8080** 端口，并将以下路径代理转发至 `localhost:3000`：

- `/api`
- `/ws`
- `/health`
- `/auth`

## 生产构建

```bash
bun run --filter @teamsland/dashboard build
```

构建产物输出至 `apps/dashboard/dist/`，由主服务进程（`apps/server`）直接托管静态文件。
