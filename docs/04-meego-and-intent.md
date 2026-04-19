# Meego 状态监听与意图识别（Meego Events & Intent Classification）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.4–§2.5.1

> **TL;DR**
> - MeegoEventBus 支持 Webhook / 轮询 / 长连接三种接入方式，按 event_id 做 SQLite 持久化去重（崩溃安全）
> - IntentClassifier 将事件分类为需求理解、方案生成、状态通知、信息查询四类意图
> - ConfirmationWatcher 监听飞书私聊实现人工确认流程，超时自动取消
> - 包含 repo_mapping 配置（Meego 空间→仓库映射）和 worktree manager（自动创建/清理 git worktree）

## Meego 状态监听与扭转

**事件总线设计**：

```typescript
// src/meego/event-bus.ts
import type { MeegoEventType, MeegoEvent, EventHandler } from "../types/core.js";
import { Database } from "bun:sqlite";

const ROUTES: Record<MeegoEventType, EventHandler[]> = {
  "issue.created":        [writeRawCorpus, triggerIntentPipeline],
  "issue.status_changed": [updateProjectContext, maybeAssignAgent],
  "issue.assigned":       [notifyAssignee],
  "sprint.started":       [generateSprintContext],
};

export class MeegoEventBus {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.run("CREATE TABLE IF NOT EXISTS seen_events (event_id TEXT PRIMARY KEY, seen_at INTEGER)");
  }

  async handle(event: MeegoEvent): Promise<void> {
    // 持久化去重：基于 event_id（崩溃安全，替代内存 30s 防抖）
    const seen = this.db.query("SELECT 1 FROM seen_events WHERE event_id = ?").get(event.eventId);
    if (seen) return;
    this.db.run("INSERT INTO seen_events (event_id, seen_at) VALUES (?, ?)", [event.eventId, Date.now()]);

    for (const handler of ROUTES[event.type] ?? []) {
      try {
        await handler.process(event);
      } catch (err) {
        console.error(`[MeegoEventBus] handler failed for ${event.type}:${event.issueId}`, err);
        // 写入 Memory cases 层供后续排查（详见 [核心类型与团队记忆层](02-core-types-and-memory.md)）
      }
    }
  }

  /** 定期清理过期去重记录（默认 1 小时） */
  sweepSeenEvents(maxAgeMs = 3_600_000): void {
    this.db.run("DELETE FROM seen_events WHERE seen_at < ?", [Date.now() - maxAgeMs]);
  }
}
```

**三种接入模式（`meego.event_mode` 配置）**：

```text
webhook   ─── Meego 主动推送 → HTTP Server 接收
poll      ─── 定时轮询 Meego API（间隔可配置）
both      ─── Webhook 优先，轮询作为 fallback 兜底
```

```yaml
# config/meego.yaml
meego:
  spaces:                           # 监听的 Meego space_id 列表，可扩展
    - space_id: "xxx"
      name: "开放平台前端"
    - space_id: "yyy"
      name: "开放平台基础"
  event_mode: "both"                # webhook | poll | both
  webhook:
    host: "0.0.0.0"
    port: 8080
    path: "/meego/webhook"
    # 内网部署，无需鉴权
  poll:
    interval_seconds: 60            # 轮询间隔
    lookback_minutes: 5             # 每次拉取最近 N 分钟的变更
  # 长连接为独立于 event_mode 的补充通道；event_mode 控制 webhook/poll，long_connection 提供实时推送
  long_connection:
    enabled: true                   # 支持长连接（SSE / WebSocket，按 Meego API 能力选）
    reconnect_interval_seconds: 10  # 断线重连间隔
```

**接入模式实现要点**：

```typescript
// src/meego/connector.ts
export class MeegoConnector {
  constructor(
    private registry: SubagentRegistry,
    private memoryStore: TeamMemoryStore,
  ) {}

  start(cfg: MeegoConfig, signal?: AbortSignal): void {
    if (cfg.eventMode === "webhook" || cfg.eventMode === "both") {
      this.startWebhookServer(cfg.webhook);
    }
    if (cfg.eventMode === "poll" || cfg.eventMode === "both") {
      this.startPollLoop(cfg.poll);
    }
    if (cfg.longConnection.enabled) {
      this.startLongConnection(cfg.longConnection);
    }
  }

  /** Webhook 签名验证（HMAC-SHA256） */
  private verifySignature(body: string, signature: string, secret: string): boolean {
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  private async startLongConnection(
    cfg: LongConnectionConfig,
    signal?: AbortSignal,
  ): Promise<void> {
    /** 长连接：断线自动重连 + 指数退避（上限 5 分钟） */
    let backoff = cfg.reconnectIntervalSeconds * 1000;
    const MAX_BACKOFF = 300_000; // 5 minutes
    while (!signal?.aborted) {
      try {
        for await (const event of meegoApi.subscribe(cfg)) {
          if (signal?.aborted) break;
          this.bus.handle(event);
          backoff = cfg.reconnectIntervalSeconds * 1000; // 成功后重置退避
        }
      } catch (err) {
        console.error("[MeegoConnector] long connection error, retrying in %dms", backoff, err);
        await Bun.sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }
  }
}
```

**Meego OpenAPI 接口规格**：

```text
Base Domain: https://project.feishu.cn
API Prefix:  /open_api/
Auth Header: plugin_access_token: <token>   (或 user_access_token: <token>)
             X-User-Key: <user_key>          (可选，用于代理用户操作)
Response:    {"err_code": 0, "err_msg": "", "err": {}, "data": ...}
             err_code != 0 表示失败
```

| 操作 | 方法 | 路径 |
|------|------|------|
| 查询 issue 详情 | POST | `/open_api/{project_key}/work_item/issue/query` body: `{"work_item_ids": [...]}` |
| 状态流转（state flow） | POST | `/open_api/{project_key}/workflow/issue/{work_item_id}/node/state_change` |
| 节点操作（node flow） | POST | `/open_api/{project_key}/workflow/issue/{work_item_id}/node/{node_id}/operate` |
| 废弃/中止 issue | PUT | `/open_api/{project_key}/work_item/issue/{work_item_id}/abort` |

> Webhook/SSE 长连接订阅接口在独立的事件订阅文档中，与上表不同文档。

```yaml
# config/meego.yaml（鉴权配置片段）
meego:
  api:
    base_url: "https://project.feishu.cn"
    plugin_access_token: "${MEEGO_PLUGIN_TOKEN}"   # 从环境变量注入
    # user_access_token 按需配置（代理用户操作时）
```

**状态扭转触发条件**：

```text
PRD 进入 IN_REVIEW  →  触发意图识别 pipeline
Agent 完成技术方案  →  飞书私聊负责人 + 等待确认
用户确认方案        →  Meego issue.status → 开发中 → spawn Claude Code
Agent 完成代码实现  →  Meego issue.status → 待 CR + 飞书私聊通知
人工 approve       →  (人工操作，不自动)
```

**私聊未确认超时处理**：

```typescript
// src/meego/confirmation-watcher.ts
export class ConfirmationWatcher {
  /**
   * 监控用户确认状态，支持提醒和超时关单。
   * 使用短轮询（60s）检测确认，避免最长 30 分钟的响应延迟。
   * cfg.reminderIntervalMin: 提醒间隔（分钟），默认 30
   * cfg.maxReminders: 最大提醒次数，默认 3
   */
  async watch(taskId: string, userId: string, cfg: ConfirmConfig): Promise<void> {
    const POLL_INTERVAL = 60_000; // 每 60s 检查一次确认状态
    const reminderInterval = cfg.reminderIntervalMin * 60_000;
    let lastReminder = Date.now();
    let remindersSent = 0;

    while (remindersSent < cfg.maxReminders) {
      await Bun.sleep(POLL_INTERVAL);
      if (await this.isConfirmed(taskId)) return;

      // 到达提醒间隔时发送提醒
      if (Date.now() - lastReminder >= reminderInterval) {
        remindersSent++;
        lastReminder = Date.now();
        await larkCli.sendDm(
          userId,
          `[提醒 ${remindersSent}/${cfg.maxReminders}] 技术方案待确认，请回复「通过」或提出修改意见`,
        );
      }
    }
    // 最终超时
    await larkCli.sendDm(userId, "因未收到确认，任务即将超时关单，如需继续请重新触发需求流程");
    await this.closeTask(taskId, "confirmation_timeout");
    await meego.updateStatus(taskId, "TIMEOUT_CLOSED");
  }

  /**
   * 当用户回复非"通过"的内容时，恢复 Architect Agent session 继续对话。
   * 使用 claude --resume {session_id} 将用户反馈注入，让 Architect Agent 自行决定是否需要重跑 Worker。
   * 修订后重新发给用户确认（多轮对话，直到用户说"通过"）。
   */
}
```

## 意图识别 + 关联人/群发现

**Pipeline 设计**：

```text
输入: 文档(PRD/技术方案/设计稿) 或 Meego Event

Step 1: 文档类型识别
  → 规则匹配（标题关键词 + 结构特征）
  → 输出: {type: "prd"|"tech_spec"|"design"|"meego"}

Step 2: 实体提取
  → LLM 提取: 模块名、负责人姓名、功能域、技术栈
  → 输出: {modules: [...], owners: [...], domains: [...]}

Step 3: 人员查找 (lark-cli)
  lark-cli contact search --query "{owner_name}" --limit 5
  → 输出: [{open_id, name, department, email}, ...]

Step 4: 关联群发现 (lark-cli)
  lark-cli im group search --query "{module_name}" --limit 10
  lark-cli im group list-joined --filter "{domain}"
  → 候选群列表 + 相关性打分

Step 5: 置信度过滤
  → 人员匹配分 ≥ 0.8 → 直接选择
  → 0.5-0.8 → 候选列表供 Agent 确认
  → < 0.5 → 标记为 UNRESOLVED，等人工介入
```

**关联存储**：每次识别结果写入 Memory 的 `entities` 类型（详见 [核心类型与团队记忆层](02-core-types-and-memory.md)），与 Meego issue_id 关联，避免重复识别。

### 摄入层模块实现（Ingestion Module Stubs）

**IntentClassifier（意图分类器）**：

```typescript
// src/ingestion/intent-classifier.ts
import type { MeegoEvent } from "../types/core.js";

export type IntentType = "frontend_dev" | "tech_spec" | "design" | "query" | "status_sync" | "confirm";

export interface IntentResult {
  type: IntentType;
  confidence: number;
  entities: { modules: string[]; owners: string[]; domains: string[] };
}

export class IntentClassifier {
  /**
   * Step 1: 规则匹配（标题关键词 + 结构特征）
   * Step 2: LLM 实体提取（confidence < 0.8 时 fallback）
   */
  async classify(input: string | MeegoEvent): Promise<IntentResult> {
    const text = typeof input === "string" ? input : JSON.stringify(input.payload);
    // 规则优先：关键词匹配
    if (/技术方案|tech.?spec/i.test(text)) return this.buildResult("tech_spec", 0.9, text);
    if (/设计稿|design/i.test(text)) return this.buildResult("design", 0.9, text);
    // LLM fallback
    return this.llmClassify(text);
  }

  private async llmClassify(text: string): Promise<IntentResult> {
    // 调用 Claude haiku 快速分类 + 实体提取
    const response = await llmClient.classify(text);
    return response;
  }
}
```

**RepoMapping（仓库映射）**：

```typescript
// src/config/repo-mapping.ts
import type { RepoMappingConfig } from "./types.js";

export class RepoMapping {
  private mapping: Map<string, { path: string; name: string }[]>;

  private constructor(mapping: Map<string, { path: string; name: string }[]>) {
    this.mapping = mapping;
  }

  static async load(configPath = "config/repo_mapping.yaml"): Promise<RepoMapping> {
    const raw = await Bun.file(configPath).text();
    const cfg: RepoMappingConfig = yaml.parse(raw);
    const mapping = new Map(cfg.repo_mapping.map((r) => [r.meego_project_id, r.repos]));
    return new RepoMapping(mapping);
  }

  resolve(meegoProjectId: string): { path: string; name: string }[] {
    return this.mapping.get(meegoProjectId) ?? [];
  }
}
```

**WorktreeManager（工作区管理）**：

```typescript
// src/git/worktree-manager.ts
export class WorktreeManager {
  /** 为需求创建隔离 worktree */
  async create(repoPath: string, issueId: string, baseBranch = "main"): Promise<string> {
    const branchName = `feat/req-${issueId}`;
    const worktreePath = `${repoPath}/.worktrees/req-${issueId}`;
    Bun.spawnSync(["git", "-C", repoPath, "worktree", "add", "-b", branchName, worktreePath, baseBranch]);

    // 防止注入的运行时文件被 git 追踪（参考 multica execenv 模式）
    const excludePath = `${worktreePath}/.git/info/exclude`;
    const excludeContent = await Bun.file(excludePath).text().catch(() => "");
    const patterns = [".agent_context", "CLAUDE.md", ".claude"];
    for (const p of patterns) {
      if (!excludeContent.includes(p)) {
        await Bun.write(excludePath, excludeContent + `\n${p}`);
      }
    }

    return worktreePath;
  }

  /** 7 天过期清理（由 main.ts 定时调用，完整 Sidecar 生命周期详见 [Sidecar 控制面](06-sidecar-and-session.md)） */
  async reap(registry: SubagentRegistry, maxAgeDays = 7): Promise<void> {
    for (const agent of registry.getCompletedAgents()) {
      const ageDays = (Date.now() - agent.createdAt) / 86_400_000;
      if (ageDays < maxAgeDays) continue;
      // 检查未提交变更
      const status = Bun.spawnSync(["git", "-C", agent.worktreePath, "status", "--porcelain"]);
      if (status.stdout?.toString().trim()) {
        Bun.spawnSync(["git", "-C", agent.worktreePath, "add", "-A"]);
        Bun.spawnSync(["git", "-C", agent.worktreePath, "commit", "-m", `auto-save before worktree cleanup (req-${agent.issueId})`]);
      }
      Bun.spawnSync(["git", "worktree", "remove", "--force", agent.worktreePath]);
    }
  }
}
```

---
[← 上一篇: 动态上下文组装](03-dynamic-context-assembly.md) | [目录](README.md) | [下一篇: Swarm 方案设计与执行 →](05-swarm-design.md)
