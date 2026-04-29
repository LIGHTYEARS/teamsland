---
name: ticket-lifecycle
description: 管理 Meego 工单的处理流程，包括深度采集、智能分诊、异步追问和状态推进。
allowed-tools:
  - Bash(teamsland ticket *)
  - Bash(teamsland ask *)
---

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
- triaging 判定模糊 → `ask` 追问，等待 DM 事件
- ready 后 → `worker spawn`，同时 `ticket status --set executing`
