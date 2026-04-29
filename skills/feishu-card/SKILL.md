---
name: feishu-card
description: >
  Use when sending Feishu/Lark messages that need rich formatting —
  tables, colored headers, status badges, structured data.
  Provides card templates, validation checklist, and send commands.
allowed-tools: Bash(lark-cli *), Bash(bytedcli *), Read
---

# 飞书卡片消息

普通 post 消息（--markdown）不支持表格和复杂排版。
需要丰富格式时，使用 **interactive 卡片消息**。

## 发送命令

```bash
# lark-cli
lark-cli im +messages-send --as bot --chat-id "<chat_id>" \
  --msg-type interactive --content '<card_json>'

# bytedcli
bytedcli feishu message send --chat-id "<chat_id>" \
  --msg-type interactive --content-json '<card_json>'

# 私聊
lark-cli im +messages-send --as bot --user-id "<user_id>" \
  --msg-type interactive --content '<card_json>'
```

## 发送前校验清单

发送卡片 JSON 前，逐项检查：

1. **JSON 合法** — 能被 JSON.parse 解析
2. **有 header.title** — 必须包含 `header.title.content`
3. **body.elements 非空** — 至少一个元素
4. **元素 tag 合法** — 见下方合法列表
5. **表格约束** — 表格数 ≤ 5，列 ≤ 10，行 ≤ 50
6. **总大小 ≤ 30KB**
7. **嵌套 ≤ 6 层**

合法元素 tag：`markdown`、`div`、`table`、`hr`、`note`、`img`、
`column_set`、`column`、`collapsible_panel`、`form`、`action`、
`button`、`select_static`、`multi_select_static`、`date_picker`、
`input`、`overflow`、`checker`、`chart`、`progress`、
`person_list`、`icon`

Header template 颜色：`blue`、`wathet`、`turquoise`、`green`、
`yellow`、`orange`、`red`、`carmine`、`violet`、`purple`、
`indigo`、`grey`、`default`

## 卡片 JSON 基本结构

```json
{
  "schema": "2.0",
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "标题" },
    "template": "blue"
  },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "**正文** markdown 内容" }
    ]
  }
}
```

## 模板索引

按需 Read 对应模板文件，替换占位符后发送。

| 模板 | 文件 | 场景 |
|------|------|------|
| 文本回复 | templates/text-reply.json | 日常回复，标题 + markdown 正文 |
| 结构化数据 | templates/structured-data.json | 表格展示：仓库映射、工单列表 |
| 状态通知 | templates/status-notification.json | Worker 启动/完成/失败 |
| 错误告警 | templates/error-alert.json | 系统异常、任务失败 |
| Worker 结果 | templates/worker-result.json | 任务完成详细报告 |

## 何时用卡片 vs 纯文本

- 一句话回复 → 纯文本（--text）
- 带格式的回复但无表格 → post（--markdown）
- 包含表格、彩色标题、结构化数据 → 卡片（--msg-type interactive）
