# Teamsland Primitive-First 重设计 — 02 连接器与规则引擎

## Connector 层（纯传输）

### 设计原则

Connector 的唯一职责：接收外部信号 → 转换为 TeamEvent → 投递到管道。不做过滤、不做语义判断、不做路由。

### Connector 接口

```typescript
interface Connector {
  name: string;                           // "lark" | "meego" | ...
  start(): Promise<void>;                // 启动监听
  stop(): Promise<void>;                 // 停止监听
  onEvent: (event: TeamEvent) => void;   // 事件回调，由管道注册
}
```

### Lark Connector 变化

| 现在 | 新设计 |
|------|--------|
| 只处理文本消息，非文本静默丢弃 | 所有消息类型都转为 TeamEvent，`payload.messageType` 标识类型 |
| 未映射群聊静默丢弃 | 不查 `chatProjectMapping`，所有消息投递，映射交给 Coordinator |
| 强制 `type: "issue.created"` | `sourceEvent` 如实填写："mention" / "dm" / "group_message" |
| `@_user_1` 硬编码判断 bot 身份 | bot ID 从配置读取，或全部投递由 Coordinator 判断是否被 @ |
| `extractPlainText` 提取纯文本 | payload 保留原始消息结构（含 mentions、图片 key 等） |

### Meego Connector 变化

| 现在 | 新设计 |
|------|--------|
| `work_item_type_keys` 硬编码 story/bug/task | 不过滤，所有 work item type 投递 |
| 轮询结果强制标为 `issue.created` | `sourceEvent` 保留原始 Meego 事件类型 |
| 未知类型映射为 `meego_issue_created` | 未知类型如实透传 |

### 新事件源扩展

加一个新 Connector（如 GitHub）只需：

1. 实现 `Connector` 接口
2. 在启动时注册到事件管道
3. 写一个 Coordinator Skill 告诉它怎么理解 `source: "github"` 的事件

不改核心代码、不加 switch 分支、不加事件类型映射。

### Connector 不做的事

- 不查 chatProjectMapping（Coordinator 做）
- 不判断是否是 bot mention（Coordinator 做）
- 不过滤消息类型（Coordinator 做）
- 不映射事件类型（payload 如实投递）
- 不决定优先级（Coordinator 做）

---

## 规则引擎

### 定位

位于 Connector 和 Queue 之间，零 LLM 快速通道。初始为空，所有规则由 Coordinator 通过 `teamsland rule create` 创建。

### 执行流程

```
TeamEvent 进入
    ↓
遍历规则（按 priority 排序）
    ↓
第一条命中 → 执行 handle 函数
    ↓ (无命中)
事件入队 → Coordinator 消费
```

### 规则文件格式

存放在 `~/.teamsland/coordinator/rules/`，沿用现有 Hook 的 TypeScript 格式：

```typescript
// rules/meego-assign-notify.ts
import type { TeamEvent, RuleContext } from "@teamsland/types";

export const meta = {
  name: "meego-assign-notify",
  description: "Meego 工单分配时自动通知被分配人",
  createdBy: "coordinator",
  createdAt: "2026-04-26",
  priority: 100,              // 越小越优先
};

export function match(event: TeamEvent): boolean {
  return event.source === "meego"
    && event.sourceEvent === "issue.updated"
    && event.payload.changedFields?.includes("assignee");
}

export async function handle(event: TeamEvent, ctx: RuleContext): Promise<void> {
  const assignee = event.payload.assignee as string;
  await ctx.exec("teamsland", ["lark", "send", "--to", assignee,
    "--text", `你被分配了工单 ${event.context.issueId}`]);
}
```

### RuleContext

受限的执行上下文——只能做确定性的动作执行：

```typescript
interface RuleContext {
  exec(cmd: string, args: string[]): Promise<ExecResult>;  // 执行 CLI 命令
  log: Logger;
  event: TeamEvent;
}
```

不提供队列操作、不提供 LLM 调用。需要智能判断的事情不应写成规则。

### 规则管理 Primitives

```
teamsland rule create <name>     # stdin 读 TS 内容，写入 rules/
teamsland rule list              # 列出所有规则及元数据
teamsland rule show <name>       # 查看规则内容
teamsland rule delete <name>     # 删除规则
teamsland rule disable <name>    # 临时禁用
teamsland rule enable <name>     # 重新启用
teamsland rule test <name>       # 用最近事件测试匹配
```

### 自演化流程

```
Coordinator 第 1-2 次处理某类事件 → 手动调用 primitives 处理
Coordinator 第 3 次处理同类事件 → 识别模式 → teamsland rule create
规则引擎热加载新规则
第 4 次同类事件 → 规则拦截，不过 LLM
```

### 安全边界

- 规则只能调用 `teamsland` CLI 子命令，不能执行任意 shell
- 规则文件通过 `fs.watch` 热加载，无需重启
- Coordinator 可随时 `rule delete` 撤销规则
- 每条规则有 `createdBy` 和 `createdAt` 元数据，可追溯
