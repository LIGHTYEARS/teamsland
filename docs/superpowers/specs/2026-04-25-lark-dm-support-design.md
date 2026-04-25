# 飞书私聊消息支持

**日期**: 2026-04-25
**状态**: Draft

## 动机

当前 Coordinator（大脑）只接收群聊中 @bot 的消息。但有些对话不适合在群里发——会打扰不需要关注的团队成员。支持私聊让用户可以直接与大脑一对一沟通，大脑能识别对方身份并通过私聊回复。

## 设计决策

| 问题 | 决定 | 理由 |
|------|------|------|
| 项目归属 | 不绑定项目，大脑自行推断 | 私聊没有群聊→项目映射，让大脑根据消息内容和上下文自行判断 |
| 事件类型 | 新增 `lark_dm`，与 `lark_mention` 并列 | 类型系统和处理链路更清晰，prompt 和回复逻辑可分开处理 |
| 回复通道 | 大脑自行判断，prompt 中标明通道 | prompt 模板明确告知大脑使用 `--user-id` 回复私聊 |
| 身份识别 | 入队时调 `lark-cli contact +get-user` 富化发送者信息 | 大脑收到的就是"张三（前端组）"而非裸 open_id |
| 富化范围 | 群聊和私聊统一富化 | 体验一致，群聊消息也能看到发送者名字 |
| Session 复用 | 沿用现有 chatId 逻辑 | p2p 会话 ID 每个用户唯一，自然区分不同用户 |

## 改动范围

### 1. 消息入口改造（`packages/lark/src/connector.ts`）

**当前**: `extractBotMention()` 硬过滤 `chat_type !== "group"`，只接受群聊 @mention。

**改为**: 拆成两个提取函数：

- **`extractBotMention(raw)`** — 群聊路径，保持不变（`chat_type === "group"` + `@_user_1`）
- **`extractDirectMessage(raw)`** — 私聊路径，新增：
  - `chat_type === "p2p"`
  - 不要求 `@mention`（私聊发给 bot 的消息天然就是对 bot 说的）
  - 返回类似结构但标记 `chatType: "p2p"`

**`handleLine()`** 调整为先尝试 `extractBotMention`，miss 了再尝试 `extractDirectMessage`。两者都 miss 则跳过。

**`buildBridgeEvent()`** 调整：

- 群聊路径不变：查 `chatProjectMapping`，无映射则跳过
- 私聊路径：跳过 `chatProjectMapping` 校验，`projectKey` 设为空字符串，由大脑自行推断
- 两条路径都调用 `enrichSenderInfo()` 富化发送者信息，查不到则 fallback 到裸 ID

**入队消息差异**:

- 群聊: `type: "lark_mention"`, payload 含 `chatType: "group"`, `senderName`, `senderDepartment`
- 私聊: `type: "lark_dm"`, payload 含 `chatType: "p2p"`, `senderName`, `senderDepartment`, 无 `projectKey`

### 2. 发送者信息富化（`packages/lark/src/lark-cli.ts`）

新增 `getUserInfo(userId: string): Promise<LarkContact>` 方法：

```
lark-cli contact +get-user --as bot --user-id <userId> --user-id-type open_id --format json
```

响应是一个 JSON 对象（结构待运行时确认），解析出 `name` 和 `department` 字段映射为 `LarkContact`。如果响应结构与预期不符，则视为查询失败走 fallback。

返回 `{ userId, name, department }`。

`LarkConnector` 新增私有方法 `enrichSenderInfo(senderId: string)`，调用 `getUserInfo`，失败时 fallback 到 `{ name: "", department: "" }`（不阻塞消息处理）。

**Prompt 中名字为空时的处理**: 如果 `senderName` 为空（查询失败），prompt 模板退化为只显示 ID：`用户 (ID: ou_xxx) 说：`，省略名字和部门部分。

### 3. 事件映射（`apps/server/src/coordinator-event-mapper.ts`）

- `TYPE_MAP` 新增 `lark_dm: "lark_dm"`
- `PRIORITY_MAP` 新增 `lark_dm: 1`（与 `lark_mention` 同优先级）
- `flattenPayload` 新增 `case "lark_dm"`：提取 `chatId`, `senderId`, `senderName`, `senderDepartment`, `message`, `messageId`, `chatType`
- `case "lark_mention"` 同步增加 `senderName`, `senderDepartment`, `chatType: "group"` 字段

### 4. 类型系统（`packages/types/src/coordinator.ts`）

`CoordinatorEventType` 新增 `"lark_dm"`。`CoordinatorEvent` 接口不变（payload 已经是 `Record<string, unknown>`）。

### 5. Prompt 构建（`apps/server/src/coordinator-prompt.ts`）

新增 `buildLarkDm(event)` 方法，在 `promptHandlers` 中注册 `lark_dm` → `buildLarkDm`。

**私聊 prompt 模板**:

```
## 私聊消息

用户 张三（前端组）(ID: ou_xxx) 通过私聊说：

> 帮我看看昨天那个 PR 的测试怎么跑不过

消息 ID: msg_yyy
时间: 2026-04-25T10:30:00Z

---

这是一条私聊消息。回复时使用以下命令发送私聊：
lark-cli im +messages-send --as bot --user-id "ou_xxx" --text "回复内容"

如果需要 spawn worker，在 --task 中包含 --reply-user "ou_xxx" 以便 worker 完成后通过私聊回复。
不要在群聊中回复此消息。
```

**群聊 `buildLarkMention` 调整**: 加入发送者名字。

```
群聊 (ID: oc_xxx) 中，张三（前端组）(ID: ou_xxx) 说：
```

### 6. 大脑指令（`apps/server/src/coordinator-init.ts`）

CLAUDE.md 的决策流程增加私聊相关指引：

```markdown
## 回复通道

- **群聊消息** → 回复到同一群聊：`lark-cli im +messages-send --as bot --chat-id "<chatId>" --text "..."`
- **私聊消息** → 回复到私聊：`lark-cli im +messages-send --as bot --user-id "<senderId>" --text "..."`
- 私聊中的敏感信息不要转发到群聊
- Worker 完成后根据消息来源选择回复通道
```

## 不涉及的改动

- `coordinator.ts` 的 session 复用逻辑 — chatId 自然区分群聊和私聊
- `event-handlers.ts` 的遗留回复逻辑 — coordinator 模式下不走那条路
- `config.json` — 不需要新增配置项

## 涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `packages/types/src/coordinator.ts` | 修改：新增 `lark_dm` 事件类型 |
| `packages/lark/src/lark-cli.ts` | 新增：`getUserInfo()` 方法 |
| `packages/lark/src/connector.ts` | 修改：新增 `extractDirectMessage()`、富化逻辑、私聊入队 |
| `apps/server/src/coordinator-event-mapper.ts` | 修改：TYPE_MAP / PRIORITY_MAP / flattenPayload 新增 `lark_dm` |
| `apps/server/src/coordinator-prompt.ts` | 修改：新增 `buildLarkDm()`、`buildLarkMention` 增加 senderName |
| `apps/server/src/coordinator-init.ts` | 修改：CLAUDE.md 增加私聊回复通道指引 |

## 测试

- `packages/lark/src/__tests__/lark-cli.test.ts` — 新增 `getUserInfo` 单测
- `apps/server/src/__tests__/coordinator-event-mapper.test.ts` — 新增 `lark_dm` 映射测试
- `apps/server/src/__tests__/coordinator-prompt.test.ts` — 新增 `lark_dm` prompt 构建测试
- connector 层：补充 p2p 消息处理和富化 fallback 的测试
