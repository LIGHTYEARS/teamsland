# Teamsland Primitive-First 重设计 — 04 Prompt 架构与 Coordinator

## Prompt 三层结构

```
┌─────────────────────────────────────┐
│  ① CLAUDE.md — 角色 + 决策框架      │  始终加载
│     "你是谁、怎么思考"               │
├─────────────────────────────────────┤
│  ② Skills — Primitive 使用指引       │  按需加载
│     "每个工具怎么用"                 │
├─────────────────────────────────────┤
│  ③ Workflows — 流程模板             │  按需加载
│     "常见场景推荐怎么做"              │
└─────────────────────────────────────┘
```

### 第一层：CLAUDE.md（角色 + 决策框架）

始终注入 Coordinator 会话。不超过 2000 字。

```markdown
# Coordinator

你是团队的 AI 管家，是所有事件的唯一决策者。

## 身份
- 你通过 `teamsland` CLI 操控一切能力
- 你管理的 Worker 是独立的 Claude Code 会话，在 Git Worktree 中执行任务
- 你可以创建规则将重复决策自动化

## 决策框架
收到每个事件后，按以下顺序思考：
1. 这个事件在说什么？（理解）
2. 需要做什么？（决策：回复 / spawn worker / 通知 / 更新状态 / 忽略）
3. 用哪些 primitives 完成？（执行）
4. 这是不是重复决策？（自演化：考虑创建规则）

## 约束
- 不要猜测——信息不足时通过 lark 追问
- Worker spawn 前先检查是否有同 issue 的 Worker 已在运行
- 每次决策说明理由（一句话）

## 上下文注入点
{{running_workers}}
{{recent_events}}
{{active_rules}}
```

`{{...}}` 是动态注入的运行时上下文，server 构建 prompt 时填充。

### 第二层：Skills（Primitive 使用指引）

每个 Primitive 域一个 Skill 文件，在 `.claude/skills/` 下，按需加载。

```
skills/
├── worker-manage/SKILL.md      # teamsland worker * 使用指引
├── lark-message/SKILL.md       # teamsland lark * 使用指引
├── meego-operate/SKILL.md      # teamsland meego * 使用指引
├── memory-manage/SKILL.md      # teamsland memory * 使用指引
├── rule-manage/SKILL.md        # teamsland rule * 使用指引
├── queue-inspect/SKILL.md      # teamsland queue * 使用指引
└── git-operate/SKILL.md        # teamsland git * 使用指引
```

Skill 内容示例（meego-operate/SKILL.md）：

```markdown
# Meego 操作

通过 `teamsland meego` 操作 Meego 工单系统。

## 查询工单
teamsland meego get <issue-id>
# 返回 JSON：{id, title, description, status, assignee, fields...}

## 搜索工单
teamsland meego search --project <key> --status open --assignee <user>

## 状态流转
# 先查看可用流转：
teamsland meego workflow <issue-id>
# 再执行流转：
teamsland meego transition <issue-id> --to <target-status>

## 常见用法
- 处理工单前先 `meego get` 了解全貌
- 状态流转前先 `meego workflow` 确认合法路径
- 更新字段用 `meego update <id> --field key=value`

allowed-tools: Bash(teamsland meego *)
```

### 第三层：Workflows（流程模板）

描述常见场景的推荐处理流程。非强制——Coordinator 可根据上下文偏离。

**加载方式**：所有 Workflow 文件全量注入 Coordinator 工作区的 `.claude/workflows/` 目录。Claude Code 按需读取。6 个 Workflow 约 1200 词，在 context window 预算内可控。

```
workflows/
├── handle-meego-issue.md        # 处理新 Meego 工单
├── handle-lark-mention.md       # 处理 Lark @mention
├── handle-lark-dm.md            # 处理 Lark 私聊
├── handle-worker-completed.md   # 处理 Worker 完成
├── handle-worker-anomaly.md     # 处理 Worker 异常
└── self-evolve-pattern.md       # 自演化决策指引
```

Workflow 示例（handle-meego-issue.md）：

```markdown
# 处理新 Meego 工单

当收到 {source: "meego", sourceEvent: "issue.created"} 时的推荐流程。

## 步骤
1. `teamsland meego get <issue-id>` — 获取工单详情
2. 判断工单类型和复杂度：
   - 简单变更（文案、配置）→ spawn worker 直接处理
   - 复杂需求（新功能、重构）→ spawn worker，指令中要求先出方案
   - 信息不足 → 通过 lark 向创建者追问
3. `teamsland worker spawn --repo <repo> --role <role> --prompt <指令>`
4. `teamsland lark send` 通知相关人员已开始处理

## 可以偏离的场景
- 工单已有 assignee 且不是 bot → 可能只需通知，不 spawn
- 工单标题含"紧急"/"P0" → 优先处理，考虑中断低优先级 Worker
- 同一 issue 已有 Worker 在运行 → 不重复 spawn
```

---

## Coordinator 决策流程

### Server 端职责收窄

```
Server 做的事（机械性）：
  1. 从队列取出消息
  2. 将 QueueMessage 包装为 TeamEvent（纯格式转换）
  3. 注入运行时上下文（workers 列表、最近事件、活跃规则）
  4. 交给 Coordinator 会话

Server 不做的事（全交 Coordinator）：
  - 不判断事件类型走哪个 handler
  - 不判断优先级
  - 不解析诊断报告做 if/else
  - 不决定异常升级路径
  - 不决定 agentRole
  - 不决定通知谁、回复到哪个 channel
```

### 会话管理

```
事件到达
    ↓
有活跃 Coordinator 会话？
  ├── 是 → continue（claude --continue <sessionId> -p <prompt>）
  └── 否 → spawn 新会话（claude -p <prompt>）
           注入 CLAUDE.md + Skills + Workflows + 运行时上下文
    ↓
Coordinator 输出（自然语言推理 + CLI 调用）
    ↓
会话保持 idle，等待下一个事件
```

### 会话复用策略

简化判断，但保留防御性安全阈值：

```typescript
function shouldReuseSession(session: CoordinatorSession): boolean {
  return session.state === "idle"
    && Date.now() - session.lastActiveAt < SESSION_TIMEOUT
    && session.processedEvents < MAX_EVENTS_BEFORE_RESET;  // 如 50
}
```

去掉 chatId 匹配和 priority 检查。保留 `processedEvents` 计数作为防御性阈值——长会话即使有 Claude Code compaction 也可能退化，超过阈值强制新建会话。

### 事件传递格式

Server 传给 Coordinator 的每个事件就是结构化 JSON：

```markdown
## 新事件

```json
{
  "id": "evt-abc123",
  "source": "meego",
  "sourceEvent": "issue.created",
  "timestamp": 1714100000000,
  "context": { "projectKey": "FRONTEND", "issueId": "ISSUE-789" },
  "payload": {
    "title": "优化搜索组件性能",
    "description": "当前搜索响应时间 > 3s，目标 < 500ms",
    "creator": "zhang.san",
    "priority": "P1"
  }
}
```

请决策并执行。
```

没有预处理、没有字段提取、没有优先级标注。

### Worker 事件回流

Worker 生命周期事件走完全相同的通道：

- Worker 完成 → `{source: "worker", sourceEvent: "completed"}` 入队 → Coordinator 决定通知/更新 Meego
- Worker 异常 → `{source: "worker", sourceEvent: "anomaly"}` 入队 → Coordinator 决定 interrupt/cancel/等待
- 诊断报告 → `{source: "worker", sourceEvent: "diagnosis_ready"}` 入队 → Coordinator 自行解读并决策

### 被删除的基础设施决策代码

| 文件 | 删除的逻辑 |
|------|-----------|
| `event-handlers.ts` switch 路由 | 整个 switch，统一走 Coordinator |
| `event-handlers.ts` agentRole 硬编码 | Coordinator spawn 时自己指定 role |
| `diagnosis-handler.ts` if/else | 整个文件，诊断变成普通事件 |
| `worker-handlers.ts` 升级瀑布 | 整个瀑布，Worker 事件统一入队 |
| `coordinator-event-mapper.ts` PRIORITY_MAP | Coordinator 自行判断优先级 |
| `coordinator-event-mapper.ts` PAYLOAD_EXTRACTORS | payload 直接透传 |
| `lark/connector.ts` chatProjectMapping | 移到 Coordinator Prompt 上下文 |
| `lark/connector.ts` isLarkMention | Coordinator 从 payload 判断 |
| `meego/connector.ts` work_item_type 过滤 | 全部投递 |

### 动态上下文注入

每次处理事件时注入运行时状态：

```markdown
## 当前状态

### 运行中的 Workers
- worker-abc: 处理 ISSUE-123, running, 已运行 12 分钟
- worker-def: 处理 ISSUE-456, running, 已运行 3 分钟

### 最近事件（最近 5 条）
- [12:01] meego issue.created ISSUE-789 "优化搜索性能"
- [12:03] lark mention "帮我看下这个 bug"
- [12:05] worker completed worker-ghi ISSUE-100

### 活跃规则（3 条）
- meego-assign-notify: 命中 47 次
- lark-greeting: 命中 12 次
- sprint-reminder: 命中 2 次
```

### 动态上下文容量控制

Server 注入运行时上下文时强制 cap：
- **Running Workers**：最多 10 条，超出摘要为 "+ N more workers"
- **Recent Events**：最多 10 条
- **Active Rules**：最多 20 条

定义 `MAX_CONTEXT_TOKENS` 常量（如 2000 tokens），server 在注入前度量并截断。

### 队列优先级

复用现有 `PersistentQueue` 的 `high | normal | low` 优先级枚举，不做 schema 迁移。Connector 在构建 TeamEvent 时设置 `priority` 字段。

| 优先级 | 事件类型 | 说明 |
|--------|---------|------|
| **high** | `worker.anomaly`, `worker.failed`, `system.*` | 需要立即响应的异常 |
| **normal** | `lark.mention`, `lark.dm`, `meego.issue.*`, `worker.completed` | 常规事件 |
| **low** | `meego.status.changed`, `worker.progress` | 低优先级状态更新 |

这是 transport-level 标注，不是语义决策——Coordinator 仍然是所有事件的唯一决策者。
