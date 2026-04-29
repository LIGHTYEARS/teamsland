---
name: lark-reply
description: 向飞书群聊或私聊发送消息。当任务完成、需要汇报进度、或需要向用户反馈结果时使用。
user-invocable: false
allowed-tools:
  - Bash(lark-cli im *)
---

# lark-reply

通过 `lark-cli` 向飞书群聊或私聊发送消息。

## 发送群聊消息

向指定群聊发送文本消息：

```bash
lark-cli im +send-message \
  --chat-id "$LARK_CHAT_ID" \
  --msg-type text \
  --content '{"text": "任务已完成，详见 PR #42"}'
```

发送 Markdown 富文本消息（适用于包含代码或链接的场景）：

```bash
lark-cli im +send-message \
  --chat-id "$LARK_CHAT_ID" \
  --msg-type interactive \
  --content '{"type":"template","data":{"template_id":"","template_variable":{"content":"**构建结果**\n- 分支: main\n- 状态: 成功"}}}'
```

## 回复指定消息

通过 `message-id` 回复某条消息（会产生话题回复效果）：

```bash
lark-cli im +reply-message \
  --message-id "$MESSAGE_ID" \
  --msg-type text \
  --content '{"text": "收到，正在处理中..."}'
```

## 发送私聊消息（DM）

向指定用户发送私聊消息：

```bash
lark-cli im +send-message \
  --receive-id-type user_id \
  --receive-id "$USER_ID" \
  --msg-type text \
  --content '{"text": "你的需求已处理完毕，请查看。"}'
```

## 注意事项

- 结果优先：先发送关键结论，再补充详细信息
- 消息长度超过 4000 字符时，拆分为多条消息发送
- 代码片段使用 Markdown 代码块格式
- `$LARK_CHAT_ID`、`$MESSAGE_ID`、`$USER_ID` 由上游任务上下文提供
