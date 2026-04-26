# Coordinator 重写设计：正确使用 CLI 能力，重写集成层

> 日期：2026-04-27
> 状态：Draft
> 范围：Coordinator + Worker 集成层重构，删除旧 CLI 子进程管理代码

---

## 1. 问题总结

Coordinator 的事件闭环从设计上就没合拢。根因不是 Claude Code CLI 能力不足，而是集成代码只用了 CLI 最原始的能力（spawn + 写 stdin + 关闭 + 猜 stdout），忽略了 CLI 提供的精确控制 flag。

### 验证过的 20 个缺口

#### 断裂的反馈回路（用户发消息 → 永远等不到回复）

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 1 | `AgentRecord.result` 从未被 DataPlane 写入，`worker_completed` 的 `resultSummary` 永远空串 | 严重 | data-plane.ts:198, worker-lifecycle.ts:178 |
| 5 | `processEvent` spawn 进程后立即返回，队列在推理完成前就 ack | 严重 | coordinator.ts:282 |
| 13 | `WorkerCompletedPayload` 不含 `chatId`，Coordinator 无法路由回复 | 高 | worker-lifecycle.ts:172-183, queue/types.ts |
| 15 | 失败只走 `sendCard` 到 teamChannel，不通知发消息的用户 | 高 | worker-handlers.ts |
| 16 | `findAssigneeForIssue` 返回 `teamChannelId`（频道 ID）但被当 userId 传给 `sendDm` | 高 | worker-handlers.ts:242-245 |
| 17 | `lark_dm` 在 legacy 路径的 `registerQueueConsumer` 没有 case 分支，私聊消息被静默丢弃 | 高 | event-handlers.ts:164-193 |

#### 状态机竞态/死锁

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 4 | DataPlane `finally` 里 `unregister` 快于 WorkerLifecycleMonitor 10s 轮询，`worker_completed` 事件可能永远不产生 | 高 | data-plane.ts:167, worker-lifecycle.ts:80 |
| 6 | `processEvent` 无 mutex，两个事件可同时进入 `continueSession` 腐蚀 session | 高 | coordinator.ts:282 |
| 10 | recovery 重试无退避（有 recoveryCount 上限但无退避间隔） | 中 | coordinator.ts:624 |
| 14 | 无 `chatId` 的事件走 `shouldReuseSession` 时 `undefined === undefined` 为 true，复用不相关 session | 低 | coordinator.ts:394-410 |
| 20 | session ID 存在竞态：placeholder ID 在真实 ID 从 stdout 解析出来之前就可能被 `continueSession` 使用 | 高 | coordinator.ts:443-457 |

#### 信号断路

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 3 | 新 spawn 的 Worker 不被 `AnomalyDetector` 监控（只在启动时遍历一次） | 高 | init/coordinator.ts:150-152 |
| 7 | `worker_timeout` 作为 `CoordinatorEventType` 存在但从未被 enqueue | 中 | types, worker-lifecycle.ts:222 |
| 8 | `ObservableMessageBus.on()` 在生产代码中零调用，`task_result`/`task_error` 事件无消费者 | 中 | message-bus.ts, data-plane.ts:199 |
| 11 | 孤儿进程 stdout 无法重新绑定，完成时无事件产生，最终标为 `failed` | 高 | registry.ts:313 |
| 19 | `knownAnomalies` Set 单调增长不清理，AnomalyDetector 逐渐变瞎 | 中 | anomaly-detector.ts:103 |

#### 持久化/恢复缺陷

| # | 问题 | 严重性 | 位置 |
|---|------|--------|------|
| 2 | 处理失败时只告警团队频道，不通知用户 | 高 | worker-handlers.ts |
| 9 | `destroySession` fire-and-forget `persistSession(null)` 可能遗留 stale session | 中 | coordinator.ts:676-678 |
| 12 | `diagnosis_ready` parse 失败时直接扔给 Coordinator LLM | 中 | diagnosis-handler.ts |
| 18 | `loadSession` 是死代码——定义了但从未被调用 | 中 | coordinator.ts:202 |

---

## 2. 设计原则

1. **CLI 是执行引擎，不是黑盒** — 用 `--output-format stream-json` 拿结构化事件流，用 `--session-id` 控制 session 归属，用 `--resume` 恢复 session
2. **processEvent 必须真同步** — `await` stdout 出现 `type:"result"` 事件后才返回，队列在推理完成后才 ack
3. **上下文全程携带** — `chatId`/`senderId` 从入队到 Worker 完成到回复用户，在 `AgentRecord.origin` 中始终存在
4. **不依赖轮询检测状态变更** — Worker 完成信号来自 stdout `result` 事件，不经过 WorkerLifecycleMonitor 轮询
5. **用 CLI flag 替代文件生成** — `--allowedTools` 替代 settings.json，`--append-system-prompt` 替代 CLAUDE.md 生成，`--agents` 替代 SKILL.md 生成
6. **Coordinator 是有完整工具权限的 agent** — 它自己调 `lark-cli` 发消息、自己调 `teamsland spawn` 起 worker、自己查 Meego 状态。不是分类函数。

---

## 3. CLI 能力验证结果

以下能力经过实际 CLI 交互验证（Claude Code 2.1.109）：

### 3.1 双向 stream-json

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --bare \
  --dangerously-skip-permissions
```

- **stdin 写入格式**：`{"type":"user","message":{"role":"user","content":"..."}}\n`
- **stdout 事件流**：每轮收到 `system init` → `assistant` → `result` 三个事件
- **多轮对话**：收到 `result` 后继续写 stdin，进程不退出，开始新一轮
- **完成信号**：`{"type":"result","subtype":"success","result":"...","session_id":"..."}`

### 3.2 --session-id

```bash
claude -p --session-id <uuid> --output-format stream-json --bare "..."
```

- 传入 UUID 原样返回在 `system init` 和 `result` 事件的 `session_id` 字段中
- 不需要从 stdout 解析 session ID

### 3.3 --resume

```bash
# 第一次：创建 session，存了 secret word
claude -p --session-id <uuid> --bare "remember: secret is PINEAPPLE"

# 第二次：恢复 session，能记住
claude -p --resume <uuid> --bare "what is the secret word?"
# → "PINEAPPLE"
```

- session ID 不变，上下文完整保留

### 3.4 其他关键 flag

| Flag | 用途 |
|------|------|
| `--bare` | 跳过 hooks/skills/plugins/MCP/CLAUDE.md 自动发现，快速启动 |
| `--append-system-prompt-file` | 追加系统提示，保留 CLI 内置能力 |
| `--allowedTools` | 命令行级工具白名单，替代 settings.json |
| `--disallowedTools` | 命令行级工具黑名单 |
| `--max-turns` | 限制推理轮数 |
| `--max-budget-usd` | 预算控制 |
| `--worktree` | 内建 worktree 隔离 |
| `--agents` | 动态定义 subagent（JSON 传入） |
| `--replay-user-messages` | stdin 消息回显确认（需配合双向 stream-json） |
| `--no-session-persistence` | 无状态模式 |

---

## 4. Coordinator 集成层设计

### 4.1 Coordinator CLI 进程生命周期

**常驻进程 + 有效期**：

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --session-id <uuid> \
  --bare \
  --append-system-prompt-file ./coordinator-system.md \
  --allowedTools "Bash(teamsland *),Bash(lark-cli *),Bash(bytedcli *),Bash(curl *),Bash(cat *),Bash(echo *),Bash(date *),Read" \
  --dangerously-skip-permissions
```

- stdin 保持打开，每个事件以 stream-json user message 写入
- 等 stdout 的 `type: "result"` 事件 = 本轮处理完毕 → 队列 ack
- **有效期条件**（满足任一则终止 session）：
  - 时间：超过 `sessionMaxLifetimeMs`（默认 30 分钟）
  - 事件数：处理事件超过 `maxEventsPerSession`（默认 20）
  - 上下文：CLI 内部压缩次数超过阈值（通过 `system` 事件的 `compact_boundary` subtype 检测）
- **终止流程**：关闭 stdin → 等待进程退出 → 记录 session ID 到持久化存储
- **恢复**：有效期内重启用 `--resume <session-id>` 恢复上下文
- **过期后**：新 `--session-id <new-uuid>` 冷启动

### 4.2 processEvent 真同步

```typescript
class CoordinatorProcess {
  private proc: ChildProcess | null = null;
  private sessionId: string | null = null;
  private eventCount = 0;
  private startedAt = 0;
  private pendingResult: PromiseWithResolvers<ResultEvent> | null = null;

  async processEvent(event: CoordinatorEvent): Promise<void> {
    const proc = await this.ensureProcess();

    const userMessage = {
      type: "user",
      message: {
        role: "user",
        content: this.promptBuilder.build(event, await this.contextLoader.load(event)),
      },
    };

    proc.stdin.write(JSON.stringify(userMessage) + "\n");

    // 真同步：等 stdout 出现 result 事件
    const result = await this.waitForResult();

    this.eventCount++;
    this.recordEvent(event, result);

    // 检查是否需要终止 session
    if (this.shouldRotateSession()) {
      await this.terminateSession();
    }
    // 返回 → 队列 ack
  }

  private async ensureProcess(): Promise<ChildProcess> {
    if (this.proc && !this.proc.killed) return this.proc;

    const sessionId = this.sessionId && !this.isSessionExpired()
      ? null  // 用 --resume
      : crypto.randomUUID();  // 新 session

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--bare",
      "--append-system-prompt-file", this.config.systemPromptPath,
      "--allowedTools", this.config.allowedTools.join(","),
      "--dangerously-skip-permissions",
    ];

    if (sessionId) {
      args.push("--session-id", sessionId);
      this.sessionId = sessionId;
    } else {
      args.push("--resume", this.sessionId!);
    }

    this.proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.startedAt = Date.now();
    this.eventCount = 0;
    this.setupStdoutParser();
    this.setupProcessCleanup();

    return this.proc;
  }

  private waitForResult(): Promise<ResultEvent> {
    this.pendingResult = Promise.withResolvers<ResultEvent>();
    return this.pendingResult.promise;
  }

  // stdout NDJSON 解析器，收到 result 事件时 resolve pendingResult
  private setupStdoutParser(): void {
    let buffer = "";
    this.proc!.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "result" && this.pendingResult) {
            this.pendingResult.resolve(event);
            this.pendingResult = null;
          }
        } catch { /* skip malformed lines */ }
      }
    });
  }
}
```

**关键**：`waitForResult()` 是一个 Promise，resolve 条件是 stdout 收到 `{"type":"result",...}`。Coordinator CLI 进程在这期间可以执行任意多轮工具调用（spawn worker、发消息、查询状态），直到它认为处理完毕输出 result。

### 4.3 事件串行化

队列 `consume` 回调本身是串行的（PersistentQueue 的 `pollOnce` 在上一条 ack/nack 后才 dequeue 下一条）。但需要确保：

- 如果 `processEvent` 抛异常（CLI 进程崩溃、超时），队列 nack 该消息，触发重试
- 进程崩溃后 `ensureProcess` 自动重新 spawn（恢复或冷启动）
- 无需额外 mutex——串行消费 + 单一 stdin 流天然串行

---

## 5. Worker 集成层设计

### 5.1 Worker CLI 进程

```bash
claude -p \
  --input-format stream-json \
  --output-format stream-json \
  --session-id <worker-uuid> \
  --bare \
  --append-system-prompt-file ./worker-system.md \
  --allowedTools "Bash(git *),Bash(teamsland *),Bash(lark-cli *),Read,Edit,Write" \
  --dangerously-skip-permissions \
  --worktree <name> \
  --max-budget-usd 2.00
```

### 5.2 Worker 生命周期（不依赖轮询）

```typescript
class WorkerManager {
  async spawnWorker(params: SpawnParams, origin: EventOrigin): Promise<string> {
    const workerId = crypto.randomUUID();

    // 注册 worker，携带 origin（chatId, senderId）
    this.registry.register({
      agentId: workerId,
      sessionId: workerId,
      issueId: params.issueId,
      status: "running",
      origin: {
        source: origin.source,
        chatId: origin.chatId,
        senderId: origin.senderId,
        senderName: origin.senderName,
      },
    });

    const proc = spawn("claude", [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--session-id", workerId,
      "--bare",
      "--append-system-prompt-file", this.config.workerSystemPromptPath,
      "--allowedTools", params.allowedTools.join(","),
      "--dangerously-skip-permissions",
      "--worktree", `worker-${params.issueId}`,
      "--max-budget-usd", String(this.config.maxBudgetPerWorker),
    ], { stdio: ["pipe", "pipe", "pipe"] });

    // 发送初始 prompt
    const message = {
      type: "user",
      message: { role: "user", content: params.prompt },
    };
    proc.stdin.write(JSON.stringify(message) + "\n");

    // 监听完成信号（不依赖轮询！）
    this.monitorWorkerStream(proc, workerId);

    return workerId;
  }

  private monitorWorkerStream(proc: ChildProcess, workerId: string): void {
    let buffer = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "result") {
            this.handleWorkerCompleted(workerId, event);
          }
        } catch { /* skip */ }
      }
    });

    proc.on("exit", (code) => {
      // 如果没有收到 result 事件就退出了，视为失败
      const record = this.registry.get(workerId);
      if (record && record.status === "running") {
        this.handleWorkerFailed(workerId, code);
      }
    });
  }

  private async handleWorkerCompleted(workerId: string, resultEvent: ResultEvent): Promise<void> {
    const record = this.registry.get(workerId);
    if (!record) return;

    // 更新 registry
    record.status = "completed";
    record.result = resultEvent.result;

    // 直接通知——origin 里有 chatId 和 senderId
    if (record.origin?.chatId) {
      await this.notifyUser(record);
    }

    // 入队 worker_completed 事件给 Coordinator
    this.queue.enqueue({
      type: "worker_completed",
      payload: {
        workerId: record.agentId,
        sessionId: record.sessionId,
        issueId: record.issueId,
        resultSummary: resultEvent.result,
        chatId: record.origin?.chatId,      // 不再丢失！
        senderId: record.origin?.senderId,  // 不再丢失！
      },
      priority: "normal",
      traceId: `worker-${workerId}-completed`,
    });

    // 最后 unregister（在 worker_completed 入队之后）
    this.registry.unregister(workerId);
  }

  private async handleWorkerFailed(workerId: string, exitCode: number | null): Promise<void> {
    const record = this.registry.get(workerId);
    if (!record) return;

    record.status = "failed";

    // 通知用户（不只是团队频道）
    if (record.origin?.senderId) {
      await this.notifyUserOfFailure(record);
    }
    // 也通知团队频道
    await this.notifyTeamChannel(record, exitCode);

    this.queue.enqueue({
      type: "worker_anomaly",
      payload: {
        workerId: record.agentId,
        anomalyType: "unexpected_exit",
        details: `exit code: ${exitCode}`,
        chatId: record.origin?.chatId,
        senderId: record.origin?.senderId,
      },
      priority: "high",
      traceId: `worker-${workerId}-failed`,
    });

    this.registry.unregister(workerId);
  }
}
```

### 5.3 Worker 恢复（--resume）

Worker 如果需要追加指令（如 Coordinator 决定给 Worker 补充信息）：

```typescript
async sendToWorker(workerId: string, message: string): Promise<void> {
  const proc = this.activeProcesses.get(workerId);
  if (!proc || proc.killed) {
    // 进程已退出，用 --resume 恢复
    const record = this.registry.get(workerId);
    if (!record) throw new Error(`Worker ${workerId} not found`);

    const newProc = spawn("claude", [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--resume", record.sessionId,
      "--bare",
      "--dangerously-skip-permissions",
    ], { stdio: ["pipe", "pipe", "pipe"] });

    this.activeProcesses.set(workerId, newProc);
    this.monitorWorkerStream(newProc, workerId);
  }

  const userMsg = {
    type: "user",
    message: { role: "user", content: message },
  };
  this.activeProcesses.get(workerId)!.stdin.write(JSON.stringify(userMsg) + "\n");
}
```

---

## 6. 要删除的模块

| 模块 | 原因 |
|------|------|
| `ObservableMessageBus` (packages/sidecar/src/message-bus.ts) | 零消费者，`task_result`/`task_error` 事件无人处理。Worker 完成信号改为直接监听 stdout result 事件 |
| `WorkerLifecycleMonitor` (apps/server/src/worker-lifecycle.ts) | 10s 轮询检测状态变更被 stdout result 事件直接替代 |
| `AnomalyDetector` (packages/sidecar/src/anomaly-detector.ts) | PID 探活 + knownAnomalies 泄漏。简化为进程级 exit 事件监控 |
| `SidecarDataPlane` NDJSON 解析逻辑 (packages/sidecar/src/data-plane.ts) | stdout 解析移入 WorkerManager 内部，不再需要独立模块 |
| `ProcessController` (packages/sidecar/src/process-controller.ts) | spawn 逻辑移入 WorkerManager，使用正确的 CLI flag |
| `CoordinatorSessionManager` 旧实现 (apps/server/src/coordinator.ts) | 被 `CoordinatorProcess` 替代 |
| coordinator-init.ts 的 settings.json / SKILL.md 生成 | `--allowedTools` 和 `--append-system-prompt` 替代 |
| 死类型：`worker_interrupted`, `worker_resumed`, `diagnosis_ready` | 定义了但从未被 enqueue |
| `worker_timeout` CoordinatorEventType | 被 `--max-budget-usd` 原生超时 + 进程 exit 事件替代 |
| `StubContextLoader` | 已标记 deprecated |

---

## 7. 要修改的模块

### 7.1 queue/types.ts

- `WorkerCompletedPayload` 增加 `chatId` 和 `senderId` 字段
- `WorkerAnomalyPayload` 增加 `chatId` 和 `senderId` 字段
- 删除死类型 `worker_interrupted`, `worker_resumed`, `diagnosis_ready`
- 考虑删除 `worker_timeout`（被 `worker_anomaly` + `anomalyType: "unexpected_exit"` 覆盖）

### 7.2 coordinator-event-mapper.ts

- 修复 `meego_issue_status_changed` 字段名不匹配（mapper 产出 `status`/`previousStatus`，prompt builder 读 `oldStatus`/`newStatus`）
- 删除死类型的 mapping 和 priority 定义
- 简化：TYPE_MAP 是纯 identity mapping，考虑合并 `QueueMessageType` 和 `CoordinatorEventType`

### 7.3 coordinator-prompt.ts

- 删除 `buildWorkerTimeout`、`buildWorkerInterrupted`、`buildWorkerResumed`、`buildDiagnosisReady`（对应死类型）
- `buildWorkerCompleted` 增加 `chatId` 信息，让 Coordinator 知道回复谁
- 修复 `buildMeegoIssueStatusChanged` 的字段名

### 7.4 coordinator-context.ts

- `extractRequesterId` 增加对 `senderId` 字段的识别（Lark 事件用 `senderId`，不是 `requesterId`/`userId`）
- 删除 `StubContextLoader`

### 7.5 event-handlers.ts

- `registerQueueConsumer` 增加 `case "lark_dm"` 处理（即使 Coordinator 模式下不走这条路，legacy 路径也不应该静默丢弃）
- `registerAgent` 函数：在 spawn worker 时设置 `origin: { chatId, senderId, senderName }`

### 7.6 worker-handlers.ts

- `findAssigneeForIssue` 修复：返回实际用户 ID 而非 teamChannelId
- 失败通知：除了 teamChannel 还要通知 `origin.senderId`

### 7.7 registry.ts

- `allRunning()` 重命名为 `all()` 或修改为真正只返回 running 状态的 agent
- `AgentRecord.origin` 成为必填字段（或至少在 spawn 时始终设置）

### 7.8 main.ts

- 用 `CoordinatorProcess` 替换 `CoordinatorSessionManager`
- 用 `WorkerManager` 替换 `ProcessController` + `DataPlane` 组合
- 清理启动序列中的 AnomalyDetector / WorkerLifecycleMonitor 初始化

### 7.9 coordinator-init.ts

- 删除 settings.json 生成（改用 `--allowedTools`）
- 简化 CLAUDE.md 生成（只保留角色定义和决策框架，不再需要技能描述——用 `--append-system-prompt-file`）
- 考虑是否保留 SKILL.md 生成（如果用 `--bare` 跳过自动发现，需要显式加载）

---

## 8. 缺口对照表

| Gap | 消灭方式 |
|-----|---------|
| 1（空 resultSummary） | result 事件的 `result` 字段就是结果 |
| 2（失败不通知用户） | `handleWorkerFailed` 通过 `origin.senderId` 通知用户 |
| 3（新 Worker 不被 AnomalyDetector 监控） | 删除 AnomalyDetector，改为进程 exit 事件 |
| 4（unregister 快于轮询） | 不再轮询，直接监听 result 事件；unregister 在 worker_completed 入队之后 |
| 5（假同步） | `await waitForResult()` 真同步 |
| 6（continueSession 竞态） | 单一 stdin 流串行写入，队列消费本身串行 |
| 7（worker_timeout 死类型） | 删除，`--max-budget-usd` + 进程 exit 替代 |
| 8（ObservableMessageBus 无消费者） | 删除 |
| 9（stale session 持久化） | 进程终止时同步清理 session 状态 |
| 10（recovery 无退避） | 进程崩溃后 `ensureProcess` 自动恢复，队列 nack 触发退避重试 |
| 11（孤儿进程恢复） | `--resume` 恢复，不需要重新绑定 stdout |
| 12（diagnosis_ready parse 失败） | 删除 diagnosis_ready 死类型 |
| 13（worker_completed 无 chatId） | `WorkerCompletedPayload` 增加 `chatId`/`senderId`，从 `AgentRecord.origin` 获取 |
| 14（无 chatId 复用不相关 session） | 常驻进程模式下的 session 通过有效期管理，不再有 chatId 匹配问题 |
| 15（失败只通知团队频道） | `handleWorkerFailed` 同时通知用户和团队频道 |
| 16（findAssigneeForIssue 返回 channelId） | 修复为返回实际用户 ID |
| 17（lark_dm legacy 路径丢弃） | 增加 `case "lark_dm"` 处理 |
| 18（loadSession 死代码） | 删除旧实现，`--resume` 替代 |
| 19（knownAnomalies 泄漏） | 删除 AnomalyDetector |
| 20（session ID 竞态） | `--session-id` 主动指定，不从 stdout 解析 |

---

## 9. 不变的部分

以下模块/机制保持不动：

- **PersistentQueue** (packages/queue/) — SQLite 队列、ack/nack、dead letter、重试逻辑
- **LarkConnector / MeegoConnector** — 事件入队逻辑
- **CoordinatorPromptBuilder** — prompt 构建逻辑（除修复字段名和删除死类型外）
- **LiveContextLoader** — 上下文加载逻辑（除修复 extractRequesterId 外）
- **SubagentRegistry** — 内存注册表（除修复 allRunning 命名和 origin 必填外）
- **HookEngine** — hooks 系统
- **Viking 集成** — 记忆存储和检索
- **Dashboard** — 监控面板（需要适配新的 Worker 状态推送方式）
