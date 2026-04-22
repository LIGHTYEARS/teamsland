# 事件管线

本页面完整追踪一个 Meego 事件从到达系统到 Agent 完成任务的全生命周期。

---

## 1. 事件接收

`MeegoConnector` 支持三种工作模式，通过配置项 `meego.eventMode` 控制。三种模式可以单独启用，也可以组合使用（`both`）。所有模式共享同一个 `AbortSignal`，确保进程退出时可以统一优雅关闭。

### Webhook 模式

当 `meego.eventMode` 为 `webhook` 或 `both` 时启用。

- 使用 `Bun.serve` 在配置的 `host:port` 上启动 HTTP 服务器
- 若配置了 `webhook.secret`，则对每个请求进行 **HMAC-SHA256 签名验证**，使用 `crypto.timingSafeEqual` 防止时序攻击
- POST 请求 body 解析为 `MeegoEvent` 对象
- 同时提供 `GET /health` 健康检查端点

```typescript
// 签名验证示意
const sig = request.headers.get("X-Meego-Signature");
const expected = hmacSha256(secret, rawBody);
if (!timingSafeEqual(sig, expected)) {
  return new Response("Unauthorized", { status: 401 });
}
```

### 轮询模式

当 `meego.eventMode` 为 `poll` 或 `both` 时启用。

- 使用 `setInterval` 按 `poll.intervalSeconds` 配置的间隔定时触发
- 调用 Meego REST API：`POST /{spaceId}/work_item/filter`
- 查询自上次轮询以来更新过的 **story、bug、task**
- 遍历所有已配置的 Space

### SSE 长连接模式

当 `longConnection.enabled` 为 `true` 时启用。

- 基于 `fetch` 的 **Server-Sent Events** 长连接流
- 断线重连时携带 `Last-Event-ID` 请求头，从断点续传
- 指数退避重连策略：`base * 2^min(retryCount, 8)`，上限 300 秒

```
重连等待时间示例（base = 1s）：
第 1 次断线 → 2s
第 2 次断线 → 4s
第 3 次断线 → 8s
...
第 8 次及以上 → 256s（约 4 分钟），不超过 300s 上限
```

---

## 2. 事件去重

`MeegoEventBus` 使用内存中的 **SQLite** 数据库维护一张 `seen_events` 表，确保同一事件不会被重复处理（幂等性保证）。

处理流程如下：

1. 调用 `handle(event)` 时，先检查 `eventId` 是否已存在于 `seen_events`
2. **若已存在**：直接跳过，不触发任何 handler
3. **若不存在**：执行 `INSERT`，然后将事件分发给所有已注册的 handler
4. `sweepSeenEvents()` 每小时运行一次，清理过期记录，防止内存无限增长

```sql
-- seen_events 表结构
CREATE TABLE seen_events (
  event_id TEXT PRIMARY KEY,
  seen_at  INTEGER NOT NULL  -- Unix timestamp
);
```

---

## 3. 意图分类

`IntentClassifier.classify()` 采用**两阶段分类**策略，在速度与准确性之间取得平衡。

### 阶段一：规则快速路径

- 内置 6 条关键词规则，匹配中文业务术语
- 若某条规则的置信度 >= 0.8，直接返回结果，跳过 LLM 调用

### 阶段二：LLM 兜底

- 当规则置信度 < 0.8 时，将事件内容发送给 Claude 进行结构化分类
- 返回结构：`{ type, confidence, entities: { modules, owners, domains } }`
- 若最终置信度 < 0.5，默认归类为 `query` 类型，避免误触发高代价操作

```typescript
// 返回类型示意
interface ClassificationResult {
  type: "implement" | "review" | "query" | "alert" | string;
  confidence: number;
  entities: {
    modules: string[];
    owners: string[];
    domains: string[];
  };
}
```

---

## 4. 仓库映射与工区创建

### 仓库映射

`RepoMapping.resolve(projectKey)` 根据事件携带的项目标识，从配置文件中找出所有匹配的代码仓库路径列表。

### Git Worktree 创建

`WorktreeManager.create(repoPath, issueId)` 为每个任务创建隔离的 Git 工作区：

1. 执行命令：
   ```bash
   git worktree add -b feat/req-{issueId} {repoPath}/.worktrees/req-{issueId} HEAD
   ```
2. 更新 `.git/info/exclude`，将以下路径加入忽略列表，避免污染主仓库：
   - `.agent_context`
   - `CLAUDE.md`
   - `.claude`

每个 Issue 对应一个独立的 worktree，Agent 在其中工作，互不干扰。

---

## 5. 记忆摄取（Fire-and-Forget）

记忆摄取流程**异步执行**，不阻塞主事件管线。即使摄取失败，也不影响后续 Agent 的启动。

摄取步骤：

1. **去重**：对文档内容计算 SHA256 哈希值，若已存在则跳过
2. **落盘**：将原始语料保存为 corpus 记录
3. **提取循环（ExtractLoop）**：采用 ReAct 风格的 LLM 工具调用循环，最多迭代 3 次，从语料中提取结构化知识
4. **记忆更新（MemoryUpdater）**：将 create / update / delete 操作应用到 `TeamMemoryStore`

```
文档输入
   │
   ▼
SHA256 去重 ──已存在──▶ 跳过
   │
   ▼ (新文档)
保存 corpus 记录
   │
   ▼
ExtractLoop（ReAct，最多 3 轮）
   │
   ▼
MemoryUpdater（create / update / delete）
   │
   ▼
TeamMemoryStore 更新完成
```

---

## 6. Swarm 分支 vs 单 Agent 分支

意图分类完成后，系统根据任务复杂度决定走 **Swarm 并行分支**还是**单 Agent 分支**。

### 判断条件

```typescript
const useSwarm = taskPlanner !== null && entities.length >= 3;
```

即：需要同时满足"已配置 TaskPlanner"且"识别到的实体数量 >= 3"。

---

### Swarm 分支

适用于需要多个 Agent 协作完成的复杂任务。

1. **任务分解**：`TaskPlanner.decompose()` 调用 LLM，将主任务拆解为 `SubTask[]`
2. **拓扑排序**：按依赖关系将子任务排列成若干执行层（layer）
3. **并行执行**：同一层的子任务并发执行，下一层等待上一层全部完成后启动
4. **每个 Worker**：
   - `buildInitialPrompt` — 构建初始提示词
   - `spawn` — 启动 Agent 进程
   - `processStream` — 处理输出流
5. **Quorum（法定人数）**：当 `fulfilled / total >= 0.5` 时，整体任务视为成功

```
SubTask[] (拓扑排序后)
  Layer 1: [A, B]     ← 并行
      ↓
  Layer 2: [C]        ← 等待 A、B 完成
      ↓
  Layer 3: [D, E]     ← 并行
```

---

### 单 Agent 分支

适用于相对独立、复杂度较低的任务。

1. **构建初始提示词**：`DynamicContextAssembler.buildInitialPrompt()` — 并行组装 5 个上下文片段
2. **启动进程**：`ProcessController.spawn()` — 通过 `Bun.spawn("claude", ...)` 启动 Agent
3. **注册**：`SubagentRegistry.register()` 将该 Agent 记录到注册表
4. **流式处理**：`SidecarDataPlane.processStream()` — NDJSON 解析循环处理 Agent 输出

---

## 7. Agent 进程管理

### ProcessController.spawn()

启动命令：

```bash
claude -p \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --permission-mode bypassPermissions
```

- **CWD** 设置为对应的 `worktreePath`
- 向 `stdin` 写入 `{"prompt": "..."}` 后立即关闭 stdin
- 读取 stdout 的第一行 NDJSON 获取 `session_id`
- **Tee stdout**：同时输出到两个目的地
  - DataPlane（实时处理）
  - `/tmp/req-{issueId}.jsonl`（调试用日志文件）

### SubagentRegistry

- 基于内存 `Map` 实现，支持容量上限（`maxConcurrentSessions`，默认 20）
- 当 Agent 数量达到上限时抛出 `CapacityError`
- **原子持久化**：先写临时文件，再 rename 到 `/tmp/teamsland-registry.json`，确保不会读到半写文件
- 提供 `subscribe()` 接口，用于 Dashboard WebSocket 实时推送 Agent 状态变更

---

## 8. 流式数据处理

`SidecarDataPlane.processStream(agentId, stdout)` 逐行读取 Agent 的 NDJSON 输出，并根据事件类型进行路由：

| 事件类型    | 处理方式 |
|------------|---------|
| `assistant` | 写入 SessionDB |
| `tool_use`  | 检查 blocklist（`delegate`、`spawn_agent`、`memory_write` 被拦截）；允许的工具写入 SessionDB |
| `result`    | 写入 SessionDB + 在 MessageBus 上发出 `task_result` + 标记任务完成 |
| `error`     | 写入 SessionDB + 在 MessageBus 上发出 `task_error` + 标记任务失败 |
| `system`    | 仅记录日志 |
| `log`       | 仅 debug 日志 |

流处理结束后（无论成功或失败），`finally` 块会调用 `registry.unregister(agentId)`，确保注册表始终保持准确。

```typescript
// 工具 blocklist 示意
const BLOCKED_TOOLS = new Set(["delegate", "spawn_agent", "memory_write"]);

if (event.type === "tool_use" && BLOCKED_TOOLS.has(event.name)) {
  // 拦截，不写入 SessionDB，不执行
  logger.warn({ tool: event.name }, "工具调用被 blocklist 拦截");
  continue;
}
```

---

## 9. 其他事件处理

除主流程外，事件管线还处理以下业务事件：

### `issue.status_changed`

若事件中 `requiresConfirmation` 为 `true`，启动 `ConfirmationWatcher`：
- 定时轮询 Meego 获取最新状态
- 通过 Lark 向相关人员发送提醒消息，等待确认

### `issue.assigned`

通过 `LarkNotifier` 向被指派人发送 **Lark 私信（DM）**，告知新任务已分配。

### `sprint.started`

占位处理：仅记录日志，暂无业务逻辑。

---

## 10. 通知与告警

### LarkNotifier

负责向团队频道或个人发送 Lark 消息：
- 团队频道消息：用于任务完成、异常告警等全员通知
- 个人私信（DM）：用于任务指派、需要确认等定向通知

### Alerter（容量告警）

- 每 60 秒检查一次当前 Agent 数量
- 当在线 Agent 数量 >= `maxConcurrentSessions × 90%` 时，向配置的告警频道发送 **Lark 消息卡片**，提示系统即将达到容量上限

```
当前 Agent 数 / maxConcurrentSessions >= 0.9
          ↓
发送 Lark 告警卡片
```

---

## 完整流程图

```
Meego 事件到达
       │
       ├── Webhook ──┐
       ├── 轮询     ──┤── MeegoConnector
       └── SSE      ──┘
                │
                ▼
        MeegoEventBus（SQLite 去重）
                │ 新事件
                ▼
        IntentClassifier（规则 + LLM）
                │
                ▼
        RepoMapping + WorktreeManager
                │
       ┌────────┴────────┐
       │ (异步，不阻塞)   │ (主流程)
       ▼                 ▼
  记忆摄取         entities >= 3 ?
(Fire-and-Forget)    │         │
                    是         否
                    ▼          ▼
              Swarm 分支   单 Agent 分支
                    │          │
                    └────┬─────┘
                         ▼
              ProcessController.spawn()
                         │
                         ▼
              SubagentRegistry.register()
                         │
                         ▼
              SidecarDataPlane.processStream()
                         │
                    ┌────┴────┐
                    ▼         ▼
              task_result  task_error
                    │         │
                    └────┬────┘
                         ▼
                  LarkNotifier 通知
```
