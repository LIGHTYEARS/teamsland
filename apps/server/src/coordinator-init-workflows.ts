/**
 * 生成 handle-meego-issue workflow 内容
 *
 * @returns handle-meego-issue.md 文件内容
 */
export function generateHandleMeegoIssueWorkflow(): string {
  return `# 处理新 Meego 工单

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
- 仓库能确定吗？对照 \`.claude/rules/repo-mapping.md\` + enriching 提取的模块路径推理
- 这个工单需要自动处理吗？

teamsland ticket status <issue-id> --set triaging

根据评估结果：
- 清晰充分 → \`teamsland ticket status <issue-id> --set ready\`
- 信息不足 → \`teamsland ask --to <creator> --ticket <issue-id> --text "请补充..."\`
- 无需处理 → \`teamsland ticket status <issue-id> --set skipped\`

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
`;
}

/**
 * 生成 ticket-lifecycle SKILL.md 内容
 *
 * @returns SKILL.md 文件内容
 */
export function generateTicketLifecycleSkill(): string {
  return `---
name: ticket-lifecycle
description: 管理 Meego 工单的处理流程，包括深度采集、智能分诊、异步追问和状态推进。
allowed-tools:
  - Bash(teamsland ticket *)
  - Bash(teamsland ask *)
---

# 工单生命周期管理

通过 \`teamsland ticket\` 和 \`teamsland ask\` 管理 Meego 工单的处理流程。

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
不需要专用命令。直接读取 \`.claude/rules/repo-mapping.md\` 对照 projectKey，
结合 enriching 上下文（模块路径、文件路径）自行推理。不确定时用 \`ask\` 追问。

## 状态流转速查
received → enriching → triaging → ready → executing → completed
                          ↓ 信息不足
                    awaiting_clarification → triaging（回复后）
                    awaiting_clarification → suspended（超时）
                    triaging → skipped（无需处理）
                    executing → failed（异常）

## 常见用法
- 收到 meego issue.created → 先 \`ticket enrich\`，再 \`ticket status --set triaging\`
- triaging 判定模糊 → \`ask\` 追问，等待 DM 事件
- ready 后 → \`worker spawn\`，同时 \`ticket status --set executing\`
`;
}
