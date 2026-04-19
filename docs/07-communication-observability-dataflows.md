# 通讯、可观测与关键数据流（Communication, Observability & Data Flows）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.9, §3

> **TL;DR**
> - ObservableMessageBus 作为透明代理，自动注入 W3C TraceContext 并上报 OpenTelemetry Span
> - Alerter 组件监控 Agent 异常（OOM、超时、连续失败），触发飞书告警
> - 定义 4 条关键数据流：Meego→代码实现、Bot @mention 响应、Dashboard WebSocket 实时展示、崩溃恢复
> - Dashboard 鉴权采用飞书 OAuth，前端通过 WebSocket 获取实时 Agent 状态

## Team 通讯 + 可观测性

**复用 Claude Code 的 SendMessage/TeammateTool**，在消息总线层加 Proxy：

```typescript
// src/observability/observable-message-bus.ts
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { randomUUID } from "crypto";

const tracer = trace.getTracer("team-ai");

export class ObservableMessageBus {
  /**
   * 透明 Proxy，不改变消息格式，只在通过时注入 trace_id 并上报 Span
   */
  private lastSeen = new Map<string, number>();

  send(msg: TeamMessage): void {
    // 注入 W3C TraceContext
    if (!msg.traceId) {
      msg.traceId = randomUUID();
    }

    // 上报 OpenTelemetry Span
    const span = tracer.startSpan("agent.message", {
      attributes: {
        from_agent: msg.fromAgent,
        to_agent: msg.toAgent,
        msg_type: msg.type,
        trace_id: msg.traceId,
      },
    });
    try {
      this.underlyingBus.send(msg);
      this.lastSeen.set(msg.fromAgent, Date.now());
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  watchTimeout(agentId: string, timeoutMs = 30_000): void {
    // 超时未响应 → 触发 Sidecar 健康检查
    const lastSeen = this.lastSeen.get(agentId) ?? 0;
    if (Date.now() - lastSeen > timeoutMs) {
      sidecarRegistry.healthCheck(agentId);
    }
  }
}
```

**可观测指标**：

| 指标 | 类型 | 告警阈值 |
|---|---|---|
| `agent.message.latency` | Histogram | p99 > 5s |
| `agent.message.failed` | Counter | 1分钟内 > 5次 |
| `agent.no_response` | Gauge | > 30s |
| `session.compaction.rate` | Counter | 监控即可 |
| `memory.retrieve.latency` | Histogram | p99 > 2s |
| `sidecar.spawn.failed` | Counter | 任意触发告警 |

**告警推送**：当指标超过上述阈值时，告警将推送到团队飞书群（群 ID 配置于 `config/lark.yaml → notification.team_channel_id`）。每条指标设有 5 分钟冷却期，防止告警疲劳。`ObservableMessageBus` 在每次指标更新后调用 `alerter.check()` 进行阈值判定。

```typescript
// src/observability/alerter.ts
import { LarkNotifier } from "../lark/notifier.js";

/**
 * 告警推送：当指标超过阈值时推送到飞书群。
 * 由 ObservableMessageBus 在指标更新时调用。
 */
export class Alerter {
  private readonly lark: LarkNotifier;
  private readonly channelId: string; // config/lark.yaml → notification.team_channel_id
  private cooldowns = new Map<string, number>(); // metric → last alert timestamp
  private readonly cooldownMs: number;

  constructor(lark: LarkNotifier, channelId: string, cooldownMs = 300_000) {
    this.lark = lark;
    this.channelId = channelId;
    this.cooldownMs = cooldownMs;
  }

  async check(metric: string, value: number, threshold: number): Promise<void> {
    if (value <= threshold) return;
    const lastAlert = this.cooldowns.get(metric) ?? 0;
    if (Date.now() - lastAlert < this.cooldownMs) return; // 冷却期内不重复告警
    this.cooldowns.set(metric, Date.now());
    await this.lark.sendGroupMessage(this.channelId, {
      msg_type: "interactive",
      card: {
        header: { title: { content: `⚠️ 告警: ${metric}`, tag: "plain_text" } },
        elements: [
          { tag: "div", text: { content: `当前值: ${value}, 阈值: ${threshold}`, tag: "plain_text" } },
        ],
      },
    });
  }
}
```

---

## 关键数据流

### 核心主流程：Meego 前端开发节点 → 代码实现

```text
Meego: issue.status_changed → 前端开发节点
  │
  ▼
[MeegoEventBus] 事件去重(event_id 持久化) + 幂等校验
  │
  ▼
[IntentClassifier] 识别为"前端需求开发"
  │
  ▼
[Memory 召回] L0全量注入 + BM25+向量混合检索
  → 同类历史方案、仓库映射表、相关人员信息
  │
  ▼
[Orchestrator Agent] 仓库确定
  → 从 Memory repo_mapping 匹配 Meego 项目 → Git 仓库
  → 无匹配 → 飞书私聊 PM 确认
  │
  ▼
[Swarm] 并行生成技术方案
  ├── Worker-A: repo-scan（分析目标仓库结构，输出 JSON 摘要）
  ├── Worker-B: prd-parse（解析 PRD 关键功能点）
  └── Worker-C: api-check（梳理涉及的后端接口）
  │
  ▼
[Architect Agent] 汇聚产出 → 按模板填充
  → lark-cli doc create (写入飞书文档)
  │
  ▼
[飞书私聊] 发给负责人：方案链接 + 确认按钮
  → 等待「方案通过，开始实现」消息
  → 用户回复非"通过" → 恢复 Architect Agent session (--resume session_id)
    → 用户反馈作为新 user message 注入
    → Architect Agent 自行判断是否需要重跑 Worker
    → 修订后重新发给用户确认
  │
  ▼
[用户确认] 飞书消息触发
  → git worktree create (隔离工作区)
  → Sidecar spawn claude code (按方案实现)
  → Meego status → 开发中
  │
  ▼
[Claude Code 运行中]
  → Dashboard 实时显示 (WebSocket)
  → 完成 → 飞书私聊通知 + Meego status → 待 CR
```

### 飞书 Bot @提及决策流程

```text
用户 @Bot + 消息
  │
  ▼
[lark-cli im history] 读取前 N 条上下文（N 可配置）
  │
  ▼
[IntentClassifier] 意图分类
  ├── 查询记忆 → Memory 召回 → 回复
  ├── 同步进展 → 查询活跃任务状态 → 飞书卡片回复
  ├── 手动触发任务 → TaskPlanner → Swarm
  └── 确认方案 → 触发实现流程
  │
  ▼
[lark-cli im send-message] 回复（卡片/文本）
```

### Dashboard 架构

```text
┌─────────────────────────────────────────┐
│  Dashboard Web UI                        │
│                                         │
│  ┌──────────────┐  ┌──────────────────┐ │
│  │ Agent 列表   │  │  事件流面板       │ │
│  │ ─────────── │  │  ─────────────── │ │
│  │ CC#1 repo-A │  │  stream-json 事件 │ │
│  │   需求#123  │  │  结构化渲染       │ │
│  │   状态: 运行 │  │  ├ tool_use 卡片  │ │
│  │             │  │  ├ 代码块高亮     │ │
│  │ CC#2 repo-B │  │  ├ 进度条         │ │
│  │   需求#456  │  │  └ 中断按钮       │ │
│  │   状态: 完成 │  └──────────────────┘ │
│  └──────────────┘                       │
│                                         │
│  OpenTelemetry Traces  Meego 状态同步   │
└─────────────────────────────────────────┘
        ▲                    ▲
  SubagentRegistry      lark-cli / Meego API
  (ProcessController)
```

**WebSocket 集成方式（stream-json 方案）**：
- 每个 Claude Code 实例通过 Bun.spawn 管理，stdout 输出 NDJSON 事件流
- SidecarDataPlane 解析 stream-json 事件 → WebSocket 推送到浏览器
- React 组件渲染结构化事件（tool_use 折叠卡片、代码块语法高亮、进度条）
- **交互输入**：用户通过 WebSocket 发送中断指令 → `ProcessController.interrupt(pid)`
- **打断按钮**：UI 触发 → 后端 `ProcessController.interrupt(pid)` 软打断（SIGINT），长按强制终止（SIGKILL）

**Dashboard 认证**：

> 虽然 [§0.3 已确认的产品决策](00-background-and-goals.md) 决定"所有团队成员均可查看和操作，无权限区分"，但 Dashboard 仍需基础认证防止未授权访问。

```typescript
// src/dashboard/auth-middleware.ts
import { randomUUID } from "crypto";

const SESSION_TTL = 8 * 3600_000; // 8 小时
const sessions = new Map<string, { userId: string; expiresAt: number }>();

/**
 * 轻量级 Session Token 认证：
 * 1. 首次访问 → 跳转飞书 OAuth 登录（复用已有 app_id）
 * 2. OAuth 回调 → 验证 user 属于团队 → 生成 session token（HttpOnly cookie）
 * 3. 后续请求 → 校验 cookie 中的 session token
 * 4. WebSocket 升级 → 从 cookie 或 query param 中取 token 校验
 */
export function authMiddleware(req: Request): Response | null {
  const cookie = req.headers.get("cookie") ?? "";
  const token = cookie.match(/session=([a-f0-9-]+)/)?.[1];
  if (!token || !sessions.has(token)) {
    return Response.redirect("/auth/lark-oauth", 302);
  }
  const session = sessions.get(token)!;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return Response.redirect("/auth/lark-oauth", 302);
  }
  return null; // 认证通过，继续处理
}

export function createSession(userId: string): string {
  const token = randomUUID();
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL });
  return token;
}
```

```yaml
# config/dashboard.yaml
dashboard:
  port: 3000
  auth:
    provider: "lark_oauth"          # 飞书 OAuth 2.0
    session_ttl_hours: 8            # Session 过期时间
    allowed_departments: []          # 空 = 不限部门，全员可访问
    # WebSocket 认证：cookie 优先，fallback 到 query param ?token=xxx
```

### Session 持久化与崩溃恢复

```text
Agent 运行中:
  每条消息写 SQLite WAL (随机 jitter 20-150ms 防写争用)
  每次状态变化 → SubagentRegistry.persist() → registry.json

Sidecar 崩溃重启:
  restore_on_startup()
    → 读 registry.json
    → 进程仍活着 (kill(pid,0)) → 重新监听 stdout
    → 进程已退出   → 尝试 claude --resume {session_id}
    → Resume 失败（session 已过期/损坏）
        → 从 SQLite 读取完整对话历史
        → 启动独立 Claude Code session（非 Orchestrator 直接调 API）执行压缩
          （MUST PRESERVE: issue_id / 方案要点 / 决策点）
        → 将压缩摘要作为首条 user message 注入新 Claude Code session
        → 继续执行剩余任务
    → 3次均失败   → 标记 FAILED，写 Memory cases，飞书通知

worktree 生命周期:
  任务完成/关闭后 → worktree 保留 7 天（供 hotfix 场景直接 cd 到 worktree 手动执行 claude）
  7天到期 → 清理流程：
    1. git status 检查 worktree（有未提交变更 → git commit 先保存）
    2. git worktree remove --force {worktree_path}

Session compaction (token > 阈值):
  → 启动独立 Claude Code session 执行压缩
  → MUST PRESERVE: issue_id / worktree 路径 / 方案要点 / 关键决策
  → 生成摘要 → 新 session (parent_session_id → 旧 session)
  → 旧 session 标记 compacted
```

> **相关文档**：Sidecar 控制面与 Session 持久化的详细设计见 [06-Sidecar 与 Session](06-sidecar-and-session.md)；Swarm 并发执行见 [05-Swarm 方案设计](05-swarm-design.md)；Meego 与意图识别见 [04-Meego 与意图识别](04-meego-and-intent.md)。

---
[← 上一篇: Sidecar 控制面与 Session 持久化](06-sidecar-and-session.md) | [目录](README.md) | [下一篇: 技术选型与参考代码 →](08-tech-stack-and-references.md)
