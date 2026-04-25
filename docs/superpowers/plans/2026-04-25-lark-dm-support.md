# Lark DM Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Coordinator (大脑) to receive and respond to Lark private (p2p) messages, with sender identity enrichment for both group and private messages.

**Architecture:** Add a `lark_dm` event type parallel to `lark_mention`. The connector extracts p2p messages without requiring @mention, enriches sender info via `lark-cli contact +get-user`, and enqueues as `lark_dm`. The event mapper, prompt builder, and coordinator CLAUDE.md are updated to handle the new type and instruct the brain to reply via `--user-id` for private messages.

**Tech Stack:** TypeScript, Bun, vitest, lark-cli

**Spec:** `docs/superpowers/specs/2026-04-25-lark-dm-support-design.md`

---

### Task 1: Add `lark_dm` to QueueMessageType and QueuePayload

**Files:**
- Modify: `packages/queue/src/types.ts:44-54` (QueueMessageType union)
- Modify: `packages/queue/src/types.ts:130-137` (QueuePayload union)
- Modify: `packages/queue/src/types.ts` (add LarkDmPayload interface after LarkMentionPayload)

- [ ] **Step 1: Add `lark_dm` to `QueueMessageType` union**

In `packages/queue/src/types.ts`, add `"lark_dm"` after `"lark_mention"`:

```typescript
export type QueueMessageType =
  | "lark_mention"
  | "lark_dm"
  | "meego_issue_created"
  | "meego_issue_status_changed"
  | "meego_issue_assigned"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_interrupted"
  | "worker_resumed"
  | "diagnosis_ready";
```

- [ ] **Step 2: Add `LarkDmPayload` interface**

Add after the `LarkMentionPayload` interface (after line 165):

```typescript
/**
 * 飞书私聊消息事件负载
 *
 * 当用户通过私聊直接向机器人发送消息时产生。
 */
export interface LarkDmPayload {
  /** 桥接后的 MeegoEvent（私聊场景 projectKey 为空） */
  event: MeegoEvent;
  /** p2p 会话 ID */
  chatId: string;
  /** 发送者 open_id */
  senderId: string;
  /** 发送者名字（富化后，查询失败为空字符串） */
  senderName: string;
  /** 发送者部门（富化后，查询失败为空字符串） */
  senderDepartment: string;
  /** 消息 ID */
  messageId: string;
}
```

- [ ] **Step 3: Add `LarkDmPayload` to `QueuePayload` union**

```typescript
export type QueuePayload =
  | LarkMentionPayload
  | LarkDmPayload
  | MeegoEventPayload
  | WorkerCompletedPayload
  | WorkerAnomalyPayload
  | DiagnosisReadyPayload
  | WorkerInterruptedPayload
  | WorkerResumedPayload;
```

- [ ] **Step 4: Add `LarkDmPayload` to the public exports in `packages/queue/src/index.ts`**

Find the existing exports and add `LarkDmPayload`:

```typescript
export type {
  // ... existing exports ...
  LarkDmPayload,
} from "./types.js";
```

- [ ] **Step 5: Run typecheck to verify**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`
Expected: PASS (no new errors — `lark_dm` is added but not yet used)

- [ ] **Step 6: Commit**

```bash
git add packages/queue/src/types.ts packages/queue/src/index.ts
git commit -m "feat(queue): add lark_dm queue message type and payload"
```

---

### Task 2: Add `lark_dm` to `CoordinatorEventType`

**Files:**
- Modify: `packages/types/src/coordinator.ts:13-25`

- [ ] **Step 1: Add `"lark_dm"` to the union**

In `packages/types/src/coordinator.ts`, add `"lark_dm"` after `"lark_mention"`:

```typescript
export type CoordinatorEventType =
  | "lark_mention"
  | "lark_dm"
  | "meego_issue_created"
  | "meego_issue_assigned"
  | "meego_issue_status_changed"
  | "meego_sprint_started"
  | "worker_completed"
  | "worker_anomaly"
  | "worker_timeout"
  | "worker_interrupted"
  | "worker_resumed"
  | "diagnosis_ready"
  | "user_query";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/coordinator.ts
git commit -m "feat(types): add lark_dm coordinator event type"
```

---

### Task 3: Add `getUserInfo` to `LarkCli`

**Files:**
- Modify: `packages/lark/src/lark-cli.ts` (add method after `sendDm`)
- Test: `packages/lark/src/__tests__/lark-cli.test.ts`

- [ ] **Step 1: Write failing tests for `getUserInfo`**

Add the following describe block inside the existing `describe("LarkCli", ...)` in `packages/lark/src/__tests__/lark-cli.test.ts`, after the `sendDm` describe block:

```typescript
  describe("getUserInfo", () => {
    it("构造正确的 lark-cli contact +get-user 命令", async () => {
      const userResponse = { ok: true, data: { user: { name: "张三", department_ids: ["dept_001"] } } };
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(userResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.getUserInfo("ou_user001");

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "contact",
        "+get-user",
        "--as",
        "bot",
        "--user-id",
        "ou_user001",
        "--user-id-type",
        "open_id",
        "--format",
        "json",
      ]);
      expect(result).toEqual({ userId: "ou_user001", name: "张三", department: "" });
    });

    it("解析包含 department 的响应", async () => {
      const userResponse = { ok: true, data: { user: { name: "李四", department_ids: ["dept_002"] } }, department_name: "工程部" };
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(userResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.getUserInfo("ou_user002");

      expect(result.name).toBe("李四");
    });

    it("命令失败时抛出 LarkCliError", async () => {
      const runner = createMockRunner({ exitCode: 1, stdout: "", stderr: "not found" });
      const cli = new LarkCli(testConfig, runner);

      await expect(cli.getUserInfo("ou_unknown")).rejects.toThrow(LarkCliError);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- packages/lark/src/__tests__/lark-cli.test.ts`
Expected: FAIL — `cli.getUserInfo is not a function`

- [ ] **Step 3: Implement `getUserInfo` in LarkCli**

Add after the `sendDm` method (after line 103) in `packages/lark/src/lark-cli.ts`:

```typescript
  /**
   * 查询用户信息
   *
   * @param userId - 用户的 open_id
   * @returns 用户联系人信息
   */
  async getUserInfo(userId: string): Promise<LarkContact> {
    const cmd = [
      "lark-cli",
      "contact",
      "+get-user",
      "--as",
      "bot",
      "--user-id",
      userId,
      "--user-id-type",
      "open_id",
      "--format",
      "json",
    ];
    const result = await this.exec(cmd);
    const raw = this.parseJson<{ ok?: boolean; data?: { user?: { name?: string } }; department_name?: string }>(
      result.stdout,
      cmd,
    );
    return {
      userId,
      name: raw.data?.user?.name ?? "",
      department: raw.department_name ?? "",
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- packages/lark/src/__tests__/lark-cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/lark/src/lark-cli.ts packages/lark/src/__tests__/lark-cli.test.ts
git commit -m "feat(lark): add getUserInfo method to LarkCli"
```

---

### Task 4: Add `extractDirectMessage` and sender enrichment to connector

**Files:**
- Modify: `packages/lark/src/connector.ts`

- [ ] **Step 1: Add `chatType` field to `BotMention` interface**

In `packages/lark/src/connector.ts`, update the `BotMention` interface (line 277-285) to include `chatType`:

```typescript
interface BotMention {
  eventId: string;
  chatId: string;
  senderId: string;
  messageId: string;
  content: string | undefined;
  messageType: string | undefined;
  timestamp: number;
  chatType: "group" | "p2p";
}
```

- [ ] **Step 2: Update `extractBotMention` to set `chatType: "group"`**

In the return statement of `extractBotMention` (line 308-316), add `chatType`:

```typescript
  return {
    eventId: raw.header?.event_id ?? msg.message_id ?? `lark-${Date.now()}`,
    chatId: msg.chat_id ?? "",
    senderId: raw.event?.sender?.sender_id?.open_id ?? "",
    messageId: msg.message_id ?? `lark-msg-${Date.now()}`,
    content: msg.content,
    messageType: msg.message_type,
    timestamp: msg.create_time ? Number(msg.create_time) : Date.now(),
    chatType: "group",
  };
```

- [ ] **Step 3: Add `extractDirectMessage` function**

Add after `extractBotMention` (after line 317):

```typescript
/**
 * 从原始飞书事件中提取私聊消息
 *
 * 过滤条件：必须是 im.message.receive_v1、私聊消息（p2p）。
 * 私聊不要求 @mention——发给 bot 的消息天然就是对 bot 说的。
 */
function extractDirectMessage(raw: LarkRawEvent): BotMention | null {
  if (raw.header?.event_type !== "im.message.receive_v1") return null;

  const msg = raw.event?.message;
  if (!msg || msg.chat_type !== "p2p") return null;

  return {
    eventId: raw.header?.event_id ?? msg.message_id ?? `lark-${Date.now()}`,
    chatId: msg.chat_id ?? "",
    senderId: raw.event?.sender?.sender_id?.open_id ?? "",
    messageId: msg.message_id ?? `lark-msg-${Date.now()}`,
    content: msg.content,
    messageType: msg.message_type,
    timestamp: msg.create_time ? Number(msg.create_time) : Date.now(),
    chatType: "p2p",
  };
}
```

- [ ] **Step 4: Update `handleLine` to try both extractors**

Replace the `handleLine` method (line 196-231) with:

```typescript
  private async handleLine(line: string): Promise<void> {
    let raw: LarkRawEvent;
    try {
      raw = JSON.parse(line) as LarkRawEvent;
    } catch {
      logger.warn({ line: line.slice(0, 200) }, "NDJSON 解析失败");
      return;
    }

    const mention = extractBotMention(raw) ?? extractDirectMessage(raw);
    if (!mention) return;

    const logLabel = mention.chatType === "p2p" ? "私聊" : "群聊 @机器人";
    logger.info(
      { eventId: mention.eventId, chatId: mention.chatId, senderId: mention.senderId, messageId: mention.messageId, chatType: mention.chatType },
      `收到${logLabel}消息`,
    );

    const event = await this.buildBridgeEvent(mention);
    if (!event) return;

    const queueType = mention.chatType === "p2p" ? "lark_dm" : "lark_mention";

    try {
      this.enqueue({
        type: queueType,
        payload: {
          event,
          chatId: mention.chatId,
          senderId: mention.senderId,
          senderName: (event.payload as Record<string, unknown>).senderName ?? "",
          senderDepartment: (event.payload as Record<string, unknown>).senderDepartment ?? "",
          messageId: mention.messageId,
        },
        priority: "high",
        traceId: event.eventId,
      });
      logger.info({ eventId: event.eventId, type: queueType }, "Lark 消息已入队到 PersistentQueue");
    } catch (err: unknown) {
      logger.error({ err, eventId: event.eventId }, "消息入队失败");
    }
  }
```

- [ ] **Step 5: Add `enrichSenderInfo` private method to `LarkConnector`**

Add as a private method in `LarkConnector` class, before the closing `}` of the class:

```typescript
  private async enrichSenderInfo(senderId: string): Promise<{ senderName: string; senderDepartment: string }> {
    try {
      const contact = await this.larkCli.getUserInfo(senderId);
      return { senderName: contact.name, senderDepartment: contact.department };
    } catch (err: unknown) {
      logger.warn({ err, senderId }, "查询发送者信息失败，使用裸 ID");
      return { senderName: "", senderDepartment: "" };
    }
  }
```

- [ ] **Step 6: Update `buildBridgeEvent` to handle p2p and enrich sender**

Replace `buildBridgeEvent` (line 234-273):

```typescript
  private async buildBridgeEvent(mention: BotMention): Promise<MeegoEvent | null> {
    const text = extractPlainText(mention.content, mention.messageType);
    if (!text) {
      logger.warn({ eventId: mention.eventId, messageType: mention.messageType }, "无法提取文本内容，跳过");
      return null;
    }

    let projectKey = "";
    if (mention.chatType === "group") {
      const mapped = this.config.chatProjectMapping[mention.chatId];
      if (!mapped) {
        logger.warn(
          { chatId: mention.chatId, eventId: mention.eventId },
          "群聊未配置项目映射（chatProjectMapping），跳过",
        );
        return null;
      }
      projectKey = mapped;
    }
    // p2p: projectKey remains "" — coordinator infers project from context

    const senderInfo = await this.enrichSenderInfo(mention.senderId);

    let historyContext = "";
    try {
      const messages = await this.larkCli.imHistory(mention.chatId, this.historyContextCount);
      historyContext = messages.map((m) => `${m.sender}: ${m.content}`).join("\n");
    } catch (err: unknown) {
      logger.warn({ err, chatId: mention.chatId }, "获取聊天历史失败，将不带历史上下文");
    }

    return {
      eventId: `lark-${mention.eventId}`,
      issueId: mention.messageId,
      projectKey,
      type: "issue.created",
      payload: {
        title: text,
        description: historyContext || text,
        chatId: mention.chatId,
        messageId: mention.messageId,
        senderId: mention.senderId,
        senderName: senderInfo.senderName,
        senderDepartment: senderInfo.senderDepartment,
        source: mention.chatType === "p2p" ? "lark_dm" : "lark_mention",
      },
      timestamp: mention.timestamp,
    };
  }
```

- [ ] **Step 7: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/lark/src/connector.ts
git commit -m "feat(lark): support p2p messages and sender enrichment in connector"
```

---

### Task 5: Add `lark_dm` to coordinator event mapper

**Files:**
- Modify: `apps/server/src/coordinator-event-mapper.ts`
- Test: `apps/server/src/__tests__/coordinator-event-mapper.test.ts`

- [ ] **Step 1: Write failing tests**

Add the following tests inside the existing `describe("coordinator-event-mapper", ...)` in `apps/server/src/__tests__/coordinator-event-mapper.test.ts`.

Inside `describe("类型映射", ...)`:

```typescript
    it("lark_dm 映射为 lark_dm", () => {
      const msg = makeMessage("lark_dm", {
        event: { eventId: "e1", issueId: "msg_dm", projectKey: "", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.type).toBe("lark_dm");
    });
```

Inside `describe("优先级映射", ...)`:

```typescript
    it("lark_dm 优先级为 1", () => {
      const msg = makeMessage("lark_dm", {
        event: { eventId: "e1", issueId: "msg_dm", projectKey: "", type: "issue.created", payload: {}, timestamp: 0 },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      expect(toCoordinatorEvent(msg).priority).toBe(1);
    });
```

Inside `describe("负载扁平化", ...)`:

```typescript
    it("lark_dm 提取 chatId、senderId、senderName、senderDepartment、message、chatType", () => {
      const msg = makeMessage("lark_dm", {
        event: {
          eventId: "e1",
          issueId: "msg_dm",
          projectKey: "",
          type: "issue.created",
          payload: { title: "帮我查个问题" },
          timestamp: 0,
        },
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
      });
      const event = toCoordinatorEvent(msg);
      expect(event.payload).toEqual({
        chatId: "oc_p2p_xxx",
        senderId: "ou_xxx",
        senderName: "张三",
        senderDepartment: "工程部",
        messageId: "msg_dm",
        message: "帮我查个问题",
        chatContext: undefined,
        chatType: "p2p",
      });
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- apps/server/src/__tests__/coordinator-event-mapper.test.ts`
Expected: FAIL — lark_dm falls through to default case

- [ ] **Step 3: Add `lark_dm` to TYPE_MAP and PRIORITY_MAP**

In `apps/server/src/coordinator-event-mapper.ts`, update `TYPE_MAP` (line 14-25):

```typescript
const TYPE_MAP: Record<string, CoordinatorEventType> = {
  lark_mention: "lark_mention",
  lark_dm: "lark_dm",
  meego_issue_created: "meego_issue_created",
  meego_issue_assigned: "meego_issue_assigned",
  meego_issue_status_changed: "meego_issue_status_changed",
  meego_sprint_started: "meego_sprint_started",
  worker_completed: "worker_completed",
  worker_anomaly: "worker_anomaly",
  worker_interrupted: "worker_interrupted",
  worker_resumed: "worker_resumed",
  diagnosis_ready: "diagnosis_ready",
};
```

Update `PRIORITY_MAP` (line 37-48):

```typescript
const PRIORITY_MAP: Record<string, number> = {
  worker_anomaly: 0,
  lark_mention: 1,
  lark_dm: 1,
  worker_interrupted: 1,
  worker_completed: 2,
  worker_resumed: 2,
  diagnosis_ready: 2,
  meego_issue_created: 3,
  meego_issue_assigned: 4,
  meego_issue_status_changed: 4,
  meego_sprint_started: 4,
};
```

- [ ] **Step 4: Add `lark_dm` case to `flattenPayload`**

Add after the `case "lark_mention"` block (after line 103) in `flattenPayload`:

```typescript
    case "lark_dm": {
      const p = payload as {
        chatId: string;
        senderId: string;
        senderName: string;
        senderDepartment: string;
        messageId: string;
        event: {
          issueId: string;
          projectKey: string;
          payload: Record<string, unknown>;
        };
      };
      const eventPayload = p.event.payload;
      const message =
        typeof eventPayload.title === "string"
          ? eventPayload.title
          : typeof eventPayload.description === "string"
            ? eventPayload.description
            : undefined;
      return {
        chatId: p.chatId,
        senderId: p.senderId,
        senderName: p.senderName,
        senderDepartment: p.senderDepartment,
        messageId: p.messageId,
        message,
        chatContext: typeof eventPayload.description === "string" ? eventPayload.description : undefined,
        chatType: "p2p",
      };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- apps/server/src/__tests__/coordinator-event-mapper.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/coordinator-event-mapper.ts apps/server/src/__tests__/coordinator-event-mapper.test.ts
git commit -m "feat(server): add lark_dm to coordinator event mapper"
```

---

### Task 6: Add `buildLarkDm` to coordinator prompt builder

**Files:**
- Modify: `apps/server/src/coordinator-prompt.ts`
- Test: `apps/server/src/__tests__/coordinator-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe("CoordinatorPromptBuilder", ...)` in `apps/server/src/__tests__/coordinator-prompt.test.ts`:

```typescript
  describe("lark_dm 事件", () => {
    it("输出包含私聊标记和 --user-id 回复指引", () => {
      const event = createEvent({
        type: "lark_dm",
        payload: {
          chatId: "oc_p2p_test",
          senderId: "ou_user001",
          senderName: "张三",
          senderDepartment: "工程部",
          message: "帮我看看那个 Bug",
          messageId: "msg-dm-001",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("## 私聊消息");
      expect(prompt).toContain("张三（工程部）");
      expect(prompt).toContain("ou_user001");
      expect(prompt).toContain("帮我看看那个 Bug");
      expect(prompt).toContain('--user-id "ou_user001"');
      expect(prompt).toContain("不要在群聊中回复此消息");
    });

    it("senderName 为空时退化为只显示 ID", () => {
      const event = createEvent({
        type: "lark_dm",
        payload: {
          chatId: "oc_p2p_test",
          senderId: "ou_unknown",
          senderName: "",
          senderDepartment: "",
          message: "你好",
          messageId: "msg-dm-002",
        },
      });
      const context = createContext();
      const prompt = builder.build(event, context);

      expect(prompt).toContain("用户 (ID: ou_unknown)");
      expect(prompt).not.toContain("（）");
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- apps/server/src/__tests__/coordinator-prompt.test.ts`
Expected: FAIL — `promptHandlers[event.type]` is undefined for `lark_dm`

- [ ] **Step 3: Add `buildLarkDm` method and register it**

In `apps/server/src/coordinator-prompt.ts`, add `lark_dm: (e) => this.buildLarkDm(e)` to `promptHandlers` (after line 70):

```typescript
  private readonly promptHandlers: Record<CoordinatorEventType, (event: CoordinatorEvent) => string> = {
    lark_mention: (e) => this.buildLarkMention(e),
    lark_dm: (e) => this.buildLarkDm(e),
    meego_issue_created: (e) => this.buildMeegoIssueCreated(e),
    // ... rest unchanged
  };
```

Add the `buildLarkDm` method after `buildLarkMention` (after line 193):

```typescript
  /**
   * 生成飞书私聊消息事件的提示词
   */
  private buildLarkDm(event: CoordinatorEvent): string {
    const { payload } = event;
    const senderId = extractString(payload, "senderId");
    const senderName = extractString(payload, "senderName", "");
    const senderDepartment = extractString(payload, "senderDepartment", "");
    const message = extractString(payload, "message");
    const messageId = extractString(payload, "messageId");
    const chatContext = extractString(payload, "chatContext", "");

    const senderLabel = senderName
      ? `${senderName}${senderDepartment ? `（${senderDepartment}）` : ""} (ID: ${senderId})`
      : `(ID: ${senderId})`;

    const parts = [
      "## 私聊消息",
      "",
      `用户 ${senderLabel} 通过私聊说：`,
      "",
      `> ${message}`,
      "",
      `消息 ID: ${messageId}`,
      `时间: ${formatTimestamp(event.timestamp)}`,
    ];

    if (chatContext && chatContext !== message) {
      parts.push("", "### 聊天上下文", "", chatContext);
    }

    parts.push(
      "",
      "---",
      "",
      "这是一条私聊消息。回复时使用以下命令发送私聊：",
      `lark-cli im +messages-send --as bot --user-id "${senderId}" --text "回复内容"`,
      "",
      `如果需要 spawn worker，在 --task 中包含 --reply-user "${senderId}" 以便 worker 完成后通过私聊回复。`,
      "不要在群聊中回复此消息。",
    );

    return parts.join("\n");
  }
```

- [ ] **Step 4: Update `buildLarkMention` to include sender name**

Replace the line that builds the sender/group description (line 172) in `buildLarkMention`:

Change:
```typescript
      `群聊 (ID: ${chatId}) 中，用户 (ID: ${senderId}) 说：`,
```

To:
```typescript
    const senderName = extractString(payload, "senderName", "");
    const senderDepartment = extractString(payload, "senderDepartment", "");
    const senderLabel = senderName
      ? `${senderName}${senderDepartment ? `（${senderDepartment}）` : ""} (ID: ${senderId})`
      : `(ID: ${senderId})`;
```

And update the parts array to use `senderLabel`:
```typescript
      `群聊 (ID: ${chatId}) 中，用户 ${senderLabel} 说：`,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run -- apps/server/src/__tests__/coordinator-prompt.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/coordinator-prompt.ts apps/server/src/__tests__/coordinator-prompt.test.ts
git commit -m "feat(server): add lark_dm prompt builder with sender enrichment"
```

---

### Task 7: Update Coordinator CLAUDE.md with reply channel guidance

**Files:**
- Modify: `apps/server/src/coordinator-init.ts` (the `generateClaudeMd` function)

- [ ] **Step 1: Add reply channel section to `generateClaudeMd`**

In `apps/server/src/coordinator-init.ts`, inside `generateClaudeMd` (line 235-291), add a "回复通道" section after the existing "回复规范" section. Replace the `回复规范` section and add the new section after it:

Find (line 275-280):
```
## 回复规范

- 使用中文回复
- 保持简洁、专业
- 涉及代码时使用 Markdown 代码块
- 回复中包含相关的工单 ID 或 Worker ID 方便追溯
```

Replace with:
```
## 回复规范

- 使用中文回复
- 保持简洁、专业
- 涉及代码时使用 Markdown 代码块
- 回复中包含相关的工单 ID 或 Worker ID 方便追溯

## 回复通道

- **群聊消息** → 回复到同一群聊：\`lark-cli im +messages-send --as bot --chat-id "<chatId>" --text "..."\`
- **私聊消息** → 回复到私聊：\`lark-cli im +messages-send --as bot --user-id "<senderId>" --text "..."\`
- 私聊中的敏感信息不要转发到群聊
- Worker 完成后根据消息来源（群聊/私聊）选择对应的回复通道
- 私聊消息不绑定特定项目，根据消息内容和上下文自行判断关联项目
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/coordinator-init.ts
git commit -m "feat(server): add reply channel guidance to coordinator CLAUDE.md"
```

---

### Task 8: Full integration test run

- [ ] **Step 1: Run all tests**

Run: `cd /Users/bytedance/workspace/teamsland && bun run test:run`
Expected: PASS — all existing tests plus the new ones pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bun run typecheck`
Expected: PASS — no type errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bun run lint`
Expected: PASS (or fix any lint issues)

- [ ] **Step 4: Commit any fixes**

If lint or test fixes were needed:
```bash
git add -A
git commit -m "fix: address lint/test issues from lark-dm implementation"
```
