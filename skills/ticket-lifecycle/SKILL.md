---
name: ticket-lifecycle
description: 管理 Meego 工单的处理流程——深度采集、智能分诊、异步追问、仓库推断、Worker 派发。提供状态机规则和每个阶段的决策指引。
allowed-tools:
  - Bash(teamsland ticket *)
  - Bash(teamsland ask *)
---

# 工单生命周期管理

## 状态机

```
received → enriching → triaging → ready → executing → completed
                          │                    └───→ failed
                          ├─→ skipped
                          └─→ awaiting_clarification
                                  ├─→ triaging（收到回复）
                                  └─→ suspended（30min 超时）
```

终态（不可迁出）：`completed` `failed` `skipped` `suspended`

---

## 命令速查

```bash
teamsland ticket state <id>               # 查看当前状态
teamsland ticket status <id> --set <to>   # 推进状态
teamsland ticket enrich <id>              # 深度采集（Meego + 飞书文档）
teamsland ask --to <user> --ticket <id> --text "..."  # 异步追问
```

---

## 阶段指引

### 1. Enriching：深度采集

```bash
teamsland ticket status <id> --set enriching
teamsland ticket enrich <id>
```

`enrich` 返回 JSON，包含：
- `basic`：标题、状态、优先级、负责人、创建者
- `description`：描述正文（可能为 null）
- `documents[]`：每个飞书文档的读取结果，检查 `ok` 字段
- `customFields[]`：自定义字段

**你需要自己阅读返回内容**——`enrich` 只做数据采集，不做摘要或判断。

文档读取失败（`ok: false`）不会中断采集，但你要评估缺失文档是否影响后续分诊。

### 2. Triaging：智能分诊

```bash
teamsland ticket status <id> --set triaging
```

逐项评估：

**信息充分度**
- 需求描述是否清晰？有没有验收标准？
- PRD 文档是否读取成功？关键文档缺失时能否从描述推断？
- 描述是否足够让 Worker 独立执行？

**仓库推断**
- 读取 `.claude/rules/repo-mapping.md`，对照 projectKey 匹配
- 结合 enriching 上下文中的模块路径、文件路径、技术栈线索
- 多仓库候选时优先选主仓库，不确定时追问

**是否需要处理**
- 已有人类 assignee（非 bot）→ 考虑只通知不执行
- 标题含"紧急"/"P0"→ 提高优先级
- 同一 issue 已有 Worker 在跑 → 不重复 spawn

分诊结果：
- 信息充分 → `teamsland ticket status <id> --set ready`
- 信息不足 → 追问（见下方）
- 无需处理 → `teamsland ticket status <id> --set skipped`

### 3. Awaiting Clarification：异步追问

```bash
teamsland ask --to <creator_id> --ticket <id> --text "需要补充：1. 验收标准 2. 影响范围"
```

`ask` 会：
1. 发送 Lark DM 给指定用户
2. 自动推进状态到 `awaiting_clarification`
3. 注册 30min 超时

**回复到达时**：你收到的是普通 Lark DM 事件。判断是否是追问回复的方法：
- 查询 ticket state，看有没有处于 `awaiting_clarification` 的工单
- 匹配发送者是否是追问对象

收到回复后 → `teamsland ticket status <id> --set triaging`（重新分诊）

30min 超时 → 你会收到 `clarification_timeout` 系统事件 → 工单自动进入 `suspended`

### 4. Ready → Executing：派发 Worker

```bash
teamsland ticket status <id> --set executing
```

然后使用 `teamsland-spawn` skill 派发 Worker。Worker prompt 应包含：
- 工单摘要和 PRD 要点
- 技术方案要点（如果有）
- 明确的验收标准
- 不要重复 Worker 已通过 CLAUDE.md 获得的信息

### 5. 终态

Worker 完成 → `teamsland ticket status <id> --set completed`
Worker 失败 → `teamsland ticket status <id> --set failed`

---

## 追问规范

追问内容要具体，说明：
1. 缺什么信息
2. 为什么需要这些信息
3. 如果用户不方便回答，可接受的替代方案

避免问"还有什么要补充的吗？"这类开放式问题。
