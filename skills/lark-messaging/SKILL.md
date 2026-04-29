---
name: lark-messaging
description: 向飞书群聊或私聊发送消息——纯文本、Markdown、或富格式卡片。包含卡片模板、校验清单和发送命令。
user-invocable: false
allowed-tools:
  - Bash(lark-cli im *)
  - Bash(bytedcli feishu *)
  - Read
---

# 飞书消息发送

## 格式选择

| 场景 | 格式 | 参数 |
|------|------|------|
| 一句话回复 | 纯文本 | `--msg-type text` |
| 带格式但无表格 | Post/Markdown | `--msg-type post` + `--markdown` |
| 表格、彩色标题、结构化数据 | 卡片 | `--msg-type interactive` |

**严禁在 post 消息中使用 `| col1 | col2 |` 表格语法**——会原样显示为纯文本。需要表格时必须使用卡片。

---

## 发送命令

### 群聊

```bash
# 纯文本
lark-cli im +messages-send --as bot --chat-id "<chat_id>" \
  --msg-type text --content '{"text": "消息内容"}'

# 卡片
lark-cli im +messages-send --as bot --chat-id "<chat_id>" \
  --msg-type interactive --content '<card_json>'
```

### 私聊（DM）

```bash
lark-cli im +messages-send --as bot --user-id "<user_id>" \
  --msg-type text --content '{"text": "消息内容"}'
```

### 回复指定消息（话题回复）

```bash
lark-cli im +messages-reply --as bot --message-id "<message_id>" \
  --msg-type text --content '{"text": "回复内容"}'
```

### bytedcli 替代写法

```bash
bytedcli feishu message send --chat-id "<chat_id>" \
  --msg-type interactive --content-json '<card_json>'
```

---

## 卡片消息

### 发送前校验清单

1. **JSON 合法**——能被 JSON.parse 解析
2. **有 header.title**——必须包含 `header.title.content`
3. **body.elements 非空**——至少一个元素
4. **元素 tag 合法**——见下方列表
5. **表格约束**——表格数 ≤ 5，列 ≤ 10，行 ≤ 50
6. **总大小 ≤ 30KB**
7. **嵌套 ≤ 6 层**

合法元素 tag：`markdown` `div` `table` `hr` `note` `img` `column_set` `column` `collapsible_panel` `form` `action` `button` `select_static` `multi_select_static` `date_picker` `input` `overflow` `checker` `chart` `progress` `person_list` `icon`

Header template 颜色：`blue` `wathet` `turquoise` `green` `yellow` `orange` `red` `carmine` `violet` `purple` `indigo` `grey` `default`

### 基本结构

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

### 模板索引

按需 Read 对应模板文件，替换占位符后发送。

| 模板 | 文件 | 场景 |
|------|------|------|
| 文本回复 | templates/text-reply.json | 日常回复，标题 + markdown 正文 |
| 结构化数据 | templates/structured-data.json | 表格展示：仓库映射、工单列表 |
| 状态通知 | templates/status-notification.json | Worker 启动/完成/失败 |
| 错误告警 | templates/error-alert.json | 系统异常、任务失败 |
| Worker 结果 | templates/worker-result.json | 任务完成详细报告 |

---

## 注意事项

- 结果优先：先发送关键结论，再补充详细信息
- 消息长度超过 4000 字符时拆分为多条发送
- 代码片段使用 Markdown 代码块格式
- `$LARK_CHAT_ID`、`$MESSAGE_ID`、`$USER_ID` 由上游任务上下文提供
