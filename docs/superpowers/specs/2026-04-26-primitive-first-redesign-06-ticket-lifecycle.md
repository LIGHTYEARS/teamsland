# Teamsland Primitive-First 重设计 — 06 工单生命周期与深度采集

> 系列 spec：01 总览 | 02 连接器与规则引擎 | 03 Primitives | 04 Prompt 与 Coordinator | 05 Worker 与模块拆分 | **06 工单生命周期**

本 spec 是 primitive-first 系列的增量扩展，聚焦三个主题：

1. **工单生命周期状态机**——从 `received` 到 `completed` 的 8 个显式状态
2. **深度信息采集（enriching）**——主动读取飞书文档，构建完整上下文
3. **新增 Primitive 工具**——`ticket`、`ask`，扩展 spec-03 命令树

---

## 与现有 spec 的关系

| 依赖的 spec | 本 spec 的立场 |
|------------|---------------|
| 01 总览 | 复用 TeamEvent 模型，遵循"Coordinator 是唯一决策者" |
| 02 连接器与规则引擎 | Pipeline bug #2（Hook ID 丢失）和 #3（EventBus 双写）在 spec-02 的 Connector→RuleEngine→Queue 单路径设计下自然消失，不再单独修复 |
| 03 Primitives | 新增 4 个命令（见下文），其余复用 spec-03 已定义的命令 |
| 04 Prompt 与 Coordinator | **替换** spec-04 中的 `handle-meego-issue.md` workflow（本 spec 定义完整版本） |
| 05 Worker 与模块拆分 | worker_completed/failed/anomaly 全部作为 TeamEvent 入队，只由 Coordinator 决策后续，无独立确定性处理器 |

---

## 一、问题诊断

### 现有管道的 7 个问题

**工程 Bug（4 个）：**

| # | 问题 | 严重度 | 新架构处置 |
|---|------|--------|-----------|
| 1 | PersistentQueue 单消费者覆盖——coordinator `queue.consume()` 覆盖 `registerQueueConsumer()` | P0 | spec-06 修复：统一消费者 + 路由（见第三节） |
| 2 | Hook 拦截层丢失 hookId，下游断链 | P1 | spec-02 消解：Rule Engine 替换 Hook，无 hookId 概念 |
| 3 | Connector `dispatchEvent()` 同时写 Queue 和 EventBus，事件重复处理 | P1 | spec-02 消解：Connector→RuleEngine→Queue 单路径，EventBus 删除 |
| 4 | Coordinator `processEvent()` 同步阻塞队列——`extractSessionIdFromStream` 等待 CLI 输出 | P2 | spec-06 修复：async processEvent（见第三节） |

**业务链路缺失（3 个）：**

| # | 问题 | 严重度 | 新架构处置 |
|---|------|--------|-----------|
| 5 | 仓库关联靠静态 config 映射，只取第一个，无法处理多仓库 | P1 | spec-06 解决：Coordinator 读取 `repo-mapping.md` + enriching 上下文自行推理（见第二节） |
| 6 | 需求提取仅拼接 `title + description`，不查 Meego 详情、不读飞书文档 | P0 | spec-06 解决：深度信息采集 enriching 阶段（见第二节） |
| 7 | 需求模糊时无法与人交互确认，盲目 spawn | P0 | spec-06 解决：`ask` 工具 + awaiting_clarification 状态（见第二节） |

---

## 二、工单生命周期状态机

### 状态定义

```
received → enriching → triaging → ready → executing → completed
                          ↓           
                    awaiting_clarification → (回复) → triaging
                          ↓ (超时)
                       suspended
                    
                    triaging → skipped（无需处理）
                    executing → failed（异常）
```

| 状态 | 含义 | 触发条件 |
|------|------|---------|
| `received` | 事件入队，等待处理 | Meego issue.created 事件到达 |
| `enriching` | 深度信息采集：Meego API + 飞书文档读取 | Coordinator 开始处理工单 |
| `triaging` | 基于完整上下文的智能分诊 | enriching 完成 |
| `awaiting_clarification` | 已通过 Lark 追问，等待人类回复 | triaging 判定信息不足 |
| `ready` | 质量门禁通过：需求 + 仓库 + 文档就绪 | triaging 判定清晰 / 追问得到回复后重新评估 |
| `skipped` | 无需自动处理 | triaging 判定不需处理 |
| `executing` | Worker Agent 执行中 | Coordinator spawn Worker |
| `completed` | 执行完成，产出交付 | Worker 汇报完成 |
| `failed` | 执行失败 | Worker 异常 / Coordinator 决定放弃 |
| `suspended` | 超时挂起 | awaiting_clarification 超过 30min 无回复 |

### 合法状态转换

工具层守卫表——`ticket status` 命令执行前校验：

```
received             → enriching
enriching            → triaging
triaging             → ready | awaiting_clarification | skipped
awaiting_clarification → triaging | suspended
ready                → executing
executing            → completed | failed
```

非法转换（如 `received → executing`）由工具层拒绝，返回错误 JSON。Coordinator 不需要记忆这张表，尝试非法转换时会得到明确的错误提示。

### 状态存储

SQLite `ticket_states` 表：

```sql
CREATE TABLE ticket_states (
  issue_id   TEXT PRIMARY KEY,
  state      TEXT NOT NULL DEFAULT 'received',
  event_id   TEXT NOT NULL,            -- 触发事件 ID
  context    TEXT,                      -- JSON: enriched data, repo, etc.
  updated_at INTEGER NOT NULL,         -- Unix ms
  created_at INTEGER NOT NULL          -- Unix ms
);
```

轻量级，不做 Event Sourcing。状态变更通过 `ticket status` 命令写入，同时记录到 observability 日志供追溯。

---

### enriching 阶段：深度信息采集

`ticket enrich` 完成数据采集（步骤①②③），Coordinator 完成理解与判断（步骤④⑤）：

```
webhook payload（仅 title）
       ↓
① teamsland ticket enrich <issue-id>
   内部执行：
   ├─ meego get → 基础信息 + 富文本描述 + 自定义字段
   ├─ 扫描字段 → 提取飞书文档 URL
   └─ lark doc-read × N → 每个文档的 Markdown 原文（失败时返回错误详情）
   → 返回完整原始数据 JSON（不做摘要/裁剪/实体提取）
       ↓
② Coordinator 阅读返回的原始数据
   ├─ 理解工单需求
   ├─ 阅读 PRD / 技术方案 / 测试用例原文
   ├─ 提取关键实体（模块路径、API 端点、验收标准等）
   └─ 判断信息是否充分
       ↓
③ ticket status --set triaging
```

**设计原则：采集与理解分离。**
- `ticket enrich` 是纯 I/O 命令——调 API、取数据、返回原始结果
- 语义理解（"这个 PRD 在说什么"、"需求是否清晰"）完全由 Coordinator LLM 完成
- 异常透明：文档读取失败、字段缺失等异常原样返回，Coordinator 自行决定如何处理（追问？跳过？降级？）

**Coordinator 在 enriching 阶段使用的 Primitive**：`ticket enrich`（快捷方式）或 `meego get` + `lark doc-read`（逐步调用）+ `ticket status`。

---

### triaging 阶段：智能分诊

Coordinator 基于 enriching 产出的完整上下文，判断三个问题：

1. **需求是否清晰充分？** — PRD 是否有明确的验收标准？描述是否足够 Worker 理解和执行？
2. **仓库能否确定？** — 对照 `.claude/rules/repo-mapping.md` 映射表 + enriching 提取的模块路径/文件路径自行推理
3. **是否需要自动处理？** — 工单类型、指派人、项目规则等

分诊结果：
- **清晰** → `ready`，携带完整上下文准备 spawn Worker
- **模糊** → `awaiting_clarification`，通过 `teamsland ask` 向创建者追问
- **无需处理** → `skipped`，记录原因

### awaiting_clarification：异步追问循环

```
Coordinator 判定信息不足
       ↓
teamsland ask --to <creator> --ticket <issue-id> --text "请补充..."
       ↓
工具层：
  ① Lark DM 发送追问消息（记录 message_id）
  ② ticket status → awaiting_clarification
  ③ 启动 30min 超时计时器
       ↓
等待...
       ↓
┌─ 回复到达 → Lark Connector 正常投递为 TeamEvent {source: "lark", sourceEvent: "dm"}
│              Coordinator 收到 DM → 查询 ticket state 发现有 awaiting_clarification 的工单
│              自行判断这条 DM 是追问的回复
│              → ticket status → triaging（重新评估）
│
└─ 30min 超时 → 构造 TeamEvent {source: "system", sourceEvent: "clarification_timeout",
                               context: {issueId}} 入队
                Coordinator 收到 → ticket status → suspended
```

**回复关联机制**：没有独立的回复匹配组件。Lark Connector 保持纯传输，所有 DM 正常投递给 Coordinator。Coordinator 在收到 DM 时查询是否有 `awaiting_clarification` 状态的工单，自行判断 DM 是否是追问的回复——这是语义决策，应归 Coordinator。超时计时器由 `ask` 命令在 server 端注册，到期时产出 `clarification_timeout` 系统事件入队。

---

## 三、新增 Primitive 工具

以下 4 个命令扩展 spec-03 的命令树：

### ticket 子命令组

```
teamsland
├── ticket                          # 工单生命周期管理（新增）
│   ├── status <issue-id> --set <state>    # 推进状态（含守卫校验）
│   ├── state <issue-id>                   # 查看当前状态 + 上下文
│   └── enrich <issue-id>                  # 执行深度采集，返回富化上下文
```

**`ticket enrich`**：纯数据采集命令，不做语义理解。内部依次执行：
1. `meego get`（含 needMultiText）→ 获取工单详情 + 富文本
2. 扫描字段提取飞书文档 URL（正则匹配）
3. `lark doc-read` 逐个读取文档 → 获取 Markdown 原文

**关键原则：透明度优先，异常不吞。**
- 每个步骤的原始数据完整返回，不做摘要或裁剪
- 文档读取失败（权限不足、URL 无效、超时等）不中断流程，将错误信息作为该文档的 `content` 返回
- 不做实体提取——解析和理解交给 Coordinator 的 LLM 能力
- Coordinator 拿到原始数据后自行阅读、理解、提取实体、判断信息充分度

输出格式：
```json
{
  "issueId": "ISSUE-789",
  "basic": { "title": "...", "status": "...", "priority": "P1", "assignee": "...", "creator": "..." },
  "description": "Markdown 富文本描述（原始 docHtml 转 markdown，不裁剪）...",
  "documents": [
    { "url": "https://...", "fieldKey": "prd_link", "content": "飞书文档完整 Markdown 原文...", "ok": true },
    { "url": "https://...", "fieldKey": "tech_design_link", "content": null, "ok": false, "error": "permission_denied: 无文档读取权限" }
  ],
  "customFields": [
    { "fieldKey": "priority", "fieldName": "优先级", "value": "P1" },
    { "fieldKey": "module", "fieldName": "所属模块", "value": "首页" }
  ]
}
```

**`ticket status --set <state>`**：推进工单状态。执行前校验合法转换表，非法转换返回错误。成功时更新 `ticket_states` 表并记录 observability 日志。

**`ticket state`**：查看工单当前状态和上下文。返回 `ticket_states` 行的 JSON 表示。

### ask 命令

```
teamsland
├── ask --to <user> --ticket <id> --text <msg>  # 异步追问（新增）
```

**`ask`**：发送 Lark DM 追问并管理异步等待。内部执行：
1. `lark send --to <user> --text <msg>`
2. 自动将工单状态推进到 `awaiting_clarification`
3. 启动 30min 超时计时器（到期产出 `clarification_timeout` 系统事件）

回复到达时，Lark Connector 正常投递 DM 事件，Coordinator 自行判断是否是追问的回复。`ask` 不做回复匹配——这是语义决策，归 Coordinator。

与 `lark send` 的区别：`ask` 是有状态的——它关联工单、推进状态、注册超时。`lark send` 是无状态的纯消息发送。

### 仓库推断（无专用工具）

仓库推断不新增 CLI 命令。Coordinator 直接读取 `.claude/rules/repo-mapping.md`（spec-04 已定义），结合 enriching 阶段提取的模块路径、文件路径等上下文信息，自行推理目标仓库。不确定时通过 `teamsland ask` 向人类确认。

---

## 四、Pipeline 修复

本 spec 需要直接修复的 2 个工程问题（#2 和 #3 已被 spec-02 消解）：

### #1 统一消费者 + 路由

**问题**：`PersistentQueue.consume()` 只支持单 handler，coordinator 的 `queue.consume()` 覆盖 `registerQueueConsumer()`。

**修复**：统一为单个消费者，所有事件交给 Coordinator。

```typescript
// main.ts 启动时只注册一次
queue.consume(async (msg: QueueMessage) => {
  const event = toTeamEvent(msg);  // 纯格式转换
  await coordinator.processEvent(event);
});
```

不再有 `registerQueueConsumer` 的 switch 路由——worker_completed、meego_issue_created 等所有事件类型统一入 Coordinator。这与 spec-04 "Server 不判断事件类型走哪个 handler" 的设计完全一致。

### #4 异步 processEvent

**问题**：`CoordinatorSessionManager.processEvent()` 中 `extractSessionIdFromStream` 同步等待 CLI 输出，阻塞队列消费。

**修复**：`processEvent` 异步化——发起 Coordinator 会话后立即返回，通过事件回调（而非阻塞等待）获取 session ID。队列消费者拿到 ack 后继续处理下一条消息。

```typescript
async processEvent(event: TeamEvent): Promise<void> {
  const session = this.getOrCreateSession();
  // 异步发送，不阻塞等待完整输出
  session.send(event);  // 内部 Bun.spawn + stream 监听
  // 队列 ack 在 send 成功后立即完成
}
```

---

## 五、handle-meego-issue.md Workflow（替换 spec-04 版本）

以下内容替换 spec-04 中定义的 `workflows/handle-meego-issue.md`：

```markdown
# 处理新 Meego 工单

当收到 {source: "meego", sourceEvent: "issue.created"} 时的推荐流程。

## 步骤

### 1. 深度采集
teamsland ticket status <issue-id> --set enriching
teamsland ticket enrich <issue-id>
# 或手动逐步执行：
#   teamsland meego get <issue-id>
#   提取飞书文档 URL
#   teamsland lark doc-read <url>（每个文档）

### 2. 智能分诊
仔细阅读 enriching 产出的完整上下文，评估：
- 需求是否清晰？PRD 有验收标准吗？描述够 Worker 执行吗？
- 仓库能确定吗？对照 `.claude/rules/repo-mapping.md` + enriching 提取的模块路径推理
- 这个工单需要自动处理吗？

teamsland ticket status <issue-id> --set triaging

根据评估结果：
- 清晰充分 → `teamsland ticket status <issue-id> --set ready`
- 信息不足 → `teamsland ask --to <creator> --ticket <issue-id> --text "请补充..."`
- 无需处理 → `teamsland ticket status <issue-id> --set skipped`

### 3. 执行
teamsland ticket status <issue-id> --set executing
teamsland worker spawn --repo <repo> --role <role> --prompt <指令>
# 指令中应包含：工单摘要 + PRD 要点 + 技术方案要点 + 验收标准

### 4. 通知
teamsland lark send --to <相关人员/群> --text "已开始处理 <issue-id>: <title>"

## 可以偏离的场景
- 工单已有人类 assignee（非 bot）→ 可能只需通知，不 spawn
- 工单标题含"紧急"/"P0" → 优先处理，考虑中断低优先级 Worker
- 同一 issue 已有 Worker 在运行 → 不重复 spawn
- enriching 阶段没有找到飞书文档 → 仍然可以继续，但 triaging 时应评估信息是否足够
- 追问超时（suspended）→ 通知团队群，记录原因
```

---

## 六、Coordinator Skill 扩展

新增一个 Skill 文件 `skills/ticket-lifecycle/SKILL.md`，指引 Coordinator 使用 ticket 相关命令：

```markdown
# 工单生命周期管理

通过 `teamsland ticket` 和 `teamsland ask` 管理 Meego 工单的处理流程。

## 查看工单状态
teamsland ticket state <issue-id>
# 返回 JSON: {issueId, state, context, updatedAt}

## 推进工单状态
teamsland ticket status <issue-id> --set <state>
# 合法转换由工具层校验，非法转换返回错误

## 深度采集
teamsland ticket enrich <issue-id>
# 纯数据采集：Meego 回查 + 飞书文档 URL 提取 + 文档读取
# 返回原始数据 JSON（不做摘要/实体提取/异常吞没）
# 你需要自己阅读返回内容，理解需求、提取实体、判断信息充分度
# 文档读取失败时 ok=false + error 字段说明原因，由你决定如何处理

## 异步追问
teamsland ask --to <user> --ticket <issue-id> --text <问题>
# 发送 Lark DM + 自动推进状态到 awaiting_clarification + 注册 30min 超时
# 回复到达时你会收到普通的 Lark DM 事件，需要自己判断是否是追问的回复
# 判断方法：查询 ticket state，看是否有 awaiting_clarification 的工单匹配发送者
# 30min 超时后你会收到 clarification_timeout 系统事件

## 仓库推断
不需要专用命令。直接读取 `.claude/rules/repo-mapping.md` 对照 projectKey，
结合 enriching 上下文（模块路径、文件路径）自行推理。不确定时用 `ask` 追问。

## 状态流转速查
received → enriching → triaging → ready → executing → completed
                          ↓ 信息不足
                    awaiting_clarification → triaging（回复后）
                    awaiting_clarification → suspended（超时）
                    triaging → skipped（无需处理）
                    executing → failed（异常）

## 常见用法
- 收到 meego issue.created → 先 `ticket enrich`，再 `ticket status --set triaging`
- triaging 判定模糊 → `ask` 追问，等 clarification_reply 事件
- ready 后 → `worker spawn`，同时 `ticket status --set executing`

allowed-tools: Bash(teamsland ticket *), Bash(teamsland ask *)
```

---

## 附录：已被其他 spec 消解的问题

| 问题 | 消解方 | 说明 |
|------|--------|------|
| #2 Hook 拦截层丢失 hookId | spec-02 | Rule Engine 替换 Hook，返回 consumed/enriched，无 hookId 概念。fail-open 保证事件不丢。 |
| #3 EventBus 双写 | spec-02 | Connector→RuleEngine→Queue 单路径，EventBus 被删除。 |
| worker_completed 双路由 | spec-01 + spec-05 | 所有 Worker 事件作为 TeamEvent 入队，只由 Coordinator 决策，无独立确定性处理器。 |
