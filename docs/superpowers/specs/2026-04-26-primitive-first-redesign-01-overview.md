# Teamsland Primitive-First 重设计 — 01 总览与事件模型

> 系列 spec：01 总览 | 02 连接器与规则引擎 | 03 Primitives | 04 Prompt 与 Coordinator | 05 Worker 与模块拆分

## 大原则

Agent 作为决策枢纽，Primitives 作为能力单元，Prompt 作为使用指引，Workflow 编排 Agents 形成复杂流程处理能力。

## 设计约束（来自讨论）

| 维度 | 决策 |
|------|------|
| 使命 | 研发执行 + 协作调度对等重要 |
| Agent 结构 | 中心化单 Coordinator，所有决策归 Coordinator |
| Primitives 粒度 | 混合——简单操作原子级，复杂能力域封装 |
| 交付形式 | CLI + Skill 文档 |
| Workflow | 模板 + 即兴混合 |
| 事件源 | 专注 Lark + Meego，架构留扩展点 |
| Agent 运行时 | 全部 Claude Code CLI |
| 快速路径 | 初始全走 Agent，Agent 自演化为 TypeScript 规则 |
| 事件驱动 | 适度——利用现有队列和日志追溯，不搞完整 Event Sourcing |

## 整体架构

```
事件源（Connector，纯传输）
       ↓ TeamEvent
规则引擎（Agent 自演化的 TS 规则，零 LLM）
  命中 → 直接执行
  未命中 ↓
PersistentQueue（SQLite）
       ↓
Coordinator（Claude Code CLI，唯一决策者）
  Prompt 三层：CLAUDE.md / Skills / Workflows
  决策输出 → teamsland CLI Primitives
       ↓
Worker Agents（Claude Code CLI，隔离 Git Worktree）
  完成/失败/异常 → TeamEvent 回流队列 → Coordinator
```

### 关键设计决策

1. **Connector 是纯传输层**——只做协议转换，不做语义判断、不做过滤、不做路由。
2. **规则引擎在 Coordinator 之前**——但规则由 Coordinator 创建和管理，初始为空。系统冷启动时所有事件过 Coordinator。
3. **Coordinator 是唯一决策者**——没有任何基础设施代码做 if/else 路由决策。
4. **Worker 事件回流**——Worker 完成/失败/异常都作为 TeamEvent 入队，由 Coordinator 处理。
5. **所有能力通过 CLI 暴露**——Coordinator 和 Worker 通过 `teamsland` CLI 子命令使用平台能力。

---

## 统一事件模型：TeamEvent

### 结构定义

```typescript
interface TeamEvent {
  // === 身份 ===
  id: string;              // 全局唯一 ID
  timestamp: number;       // Unix ms

  // === 来源 ===
  source: "lark" | "meego" | "worker" | "system";
  sourceEvent: string;     // 原始事件类型，不做映射
                           // lark: "mention" | "dm" | "group_message"
                           // meego: "issue.created" | "issue.updated" | "status.changed" | ...
                           // worker: "completed" | "failed" | "anomaly" | "progress"
                           // system: "rule.created" | "startup" | "scheduled"

  // === 上下文 ===
  context: {
    chatId?: string;       // Lark 会话 ID
    projectKey?: string;   // Meego 项目 key
    issueId?: string;      // Meego 工单 ID
    workerId?: string;     // Worker ID
    senderId?: string;     // 消息发送者
    senderName?: string;
  };

  // === 负载 ===
  payload: Record<string, unknown>;  // 原始负载，不裁剪不变形
}
```

### 设计原则

1. **source + sourceEvent 分离**：`source` 标识来源系统，`sourceEvent` 保留原始事件语义。Lark @mention = `{source: "lark", sourceEvent: "mention"}`，不被变成 "issue.created"。
2. **payload 不变形**：Connector 把原始数据放进 payload，不做字段重命名或裁剪。Coordinator 看到的是原始信息。
3. **context 是公共索引字段**：从 payload 中提取高频查询字段放到 context 层，方便规则引擎匹配和日志检索，但不替代 payload。
4. **Worker 事件也是 TeamEvent**：Worker 完成/失败/异常统一为 `{source: "worker", sourceEvent: "completed|failed|anomaly"}`，Coordinator 像处理其他事件一样处理。
5. **可扩展**：新事件源只需新增 `source` 值，`sourceEvent` 自由定义，不需改核心类型。
