# 核心概念

本文档介绍 Teamsland 平台的核心概念与架构设计，帮助开发者快速理解系统的工作原理。

---

## Meego 事件

Teamsland 通过监听 Meego（项目管理系统）的 Webhook 事件来触发 AI 工作流。目前支持以下四种事件类型：

| 事件类型 | 说明 |
|----------|------|
| `issue.created` | 新建工单时触发 |
| `issue.status_changed` | 工单状态发生变更时触发 |
| `issue.assigned` | 工单被分配给成员时触发 |
| `sprint.started` | Sprint 开始时触发 |

每个事件对象包含以下公共字段：

```typescript
interface MeegoEvent {
  eventId: string;       // 全局唯一事件 ID
  eventType: string;     // 事件类型，如 "issue.created"
  projectKey: string;    // 项目标识符
  payload: unknown;      // 事件具体数据，结构因类型而异
}
```

### 事件去重

为避免 Webhook 重试导致的重复处理，系统通过 SQLite `seen_events` 表按 `eventId` 进行去重。每个事件在首次处理时写入该表，后续同 ID 事件将被直接丢弃，保证幂等性。

---

## 意图分类 (Intent Classification)

收到 Meego 事件后，系统需要判断该事件对应的工作意图，以便路由到合适的 Agent。意图分类采用两阶段流水线设计：

### 第一阶段：规则匹配（快速路径）

系统内置一张关键词查找表，共 6 条规则，将中文关键词映射到意图类型。每条规则对应一个置信度分值（范围 0.85–0.9）。

规则匹配速度极快，不依赖外部调用。当匹配置信度 `>= 0.8` 时，系统立即返回分类结果，无需进入第二阶段。

### 第二阶段：LLM 回退

当规则匹配未命中（或置信度低于阈值）时，系统将事件描述发送给 Claude，请求返回结构化 JSON 格式的分类结果。若 LLM 返回的置信度 `< 0.5`，则统一回退为 `query` 类型，避免错误路由。

### 意图类型一览

系统共定义 6 种意图类型：

| 类型 | 说明 | Agent 角色 |
|------|------|-----------|
| `frontend_dev` | 前端开发需求 | 前端开发 Agent |
| `tech_spec` | 技术方案设计 | 技术方案 Agent |
| `design` | 设计评审 | 设计评审 Agent |
| `query` | 信息查询 | 查询 Agent |
| `status_sync` | 状态同步 | 状态同步 Agent |
| `confirm` | 人工确认 | 确认 Agent |

---

## Agent 角色

Teamsland 共设计了 6 种 Agent 角色，每种角色对应 `config/templates/{role}.md` 目录下的一个 Markdown 模板文件。每个模板包含两个核心章节：**职责范围**与**工作流程**（5 步标准流程）。

| 角色 | 标识符 | 职责描述 |
|------|--------|----------|
| 前端开发 Agent | `frontend_dev` | 实现页面/组件，编写测试，提交 PR |
| 技术方案 Agent | `tech_spec` | 分析可行性，设计架构，输出技术方案文档 |
| 设计评审 Agent | `design` | 检查设计一致性，编写评审意见 |
| 查询 Agent | `query` | 搜索团队记忆和代码库，合成带引用的回答 |
| 状态同步 Agent | `status_sync` | 聚合 Sprint 工单状态，生成报告，推送飞书 |
| 确认 Agent | `confirm` | 发送确认请求，轮询状态，审批通过后触发下游 |

模板文件路径示例：

```
config/templates/frontend_dev.md
config/templates/tech_spec.md
config/templates/design.md
config/templates/query.md
config/templates/status_sync.md
config/templates/confirm.md
```

---

## 动态上下文组装

在启动 Agent 之前，`DynamicContextAssembler` 会并发（`Promise.all`）组装一个包含五个章节的初始提示词（initial prompt）。各章节内容来源各异，并行拉取以降低延迟。

| 章节 | 标识 | 内容来源 |
|------|------|----------|
| 工单上下文 | §A | `issueId`、`projectKey`、`eventType`、工单描述 |
| 历史记忆 | §B | 向量检索 + FTS5 全文搜索，从 `TeamMemoryStore` 中取 Top 10 相关记忆 |
| 可用技能 | §C | 来自 `skillRouting` 配置（例如 `figma-reader`、`lark-docs`、`git-tools`） |
| 仓库信息 | §D | 来自 `repoMapping` 配置 + `worktreePath` 路径 |
| 角色指令 | §E | 加载对应角色的 Markdown 模板文件 |

组装完成后，五个章节按顺序拼接为完整的系统提示词，交由 Agent 使用。

---

## 技能路由 (Skill Routing)

技能路由配置将意图类型映射到该意图可用的工具/技能名称列表。Agent 在组装上下文时会读取该配置，从而知晓自己可以调用哪些工具。

配置示例（JSON 格式）：

```json
{
  "frontend_dev": ["figma-reader", "lark-docs", "git-tools", "architect-template"],
  "code_review": ["git-diff", "lark-comment"],
  "query": ["lark-docs", "lark-base"]
}
```

每个技能名称对应一个实际的 MCP 工具或内置函数，Agent 在运行时可通过工具调用接口使用这些技能。

---

## Swarm 模式

当任务复杂度较高时（实体数量 `>= 3` 且 `TaskPlanner` 可用），系统会自动切换至 Swarm 模式，将任务分解并行处理。

Swarm 模式的执行流程如下：

1. **任务分解** — `TaskPlanner.decompose()` 调用 LLM，生成包含依赖关系的 `SubTask[]` 列表
2. **拓扑排序** — 使用 Kahn 算法（BFS）对子任务进行拓扑排序，得到按依赖层次划分的执行层
3. **并行执行** — 对每一执行层使用 `Promise.all` 并发启动 Worker
4. **仲裁检查** — 计算 `fulfilled / total`，若达到 `minSwarmSuccessRatio`（默认 `0.5`），则视为整体成功

每个 Worker 的执行步骤：

```
组装提示词 → 启动 Claude 子进程 → 流式处理输出 → 返回结果
```

Swarm 模式允许部分 Worker 失败而不影响整体结果，通过仲裁比例灵活控制容错边界。

---

## 会话管理 (Session)

`SessionDB` 使用 SQLite WAL 模式持久化存储会话、消息和任务数据。

### 会话生命周期

- 每次 Agent 运行都会创建一个新会话，包含 `sessionId`、`teamId`、`agentId` 三个核心字段
- Agent 的 stdout 流式输出会被解析后作为消息存储，字段包括 `role`、`content`、`toolName`、`traceId`

### 上下文压缩

当会话的 token 数量超过 `compactionTokenThreshold`（默认 `80000`）时，系统会自动触发会话压缩：

1. 对历史消息生成摘要（summary）
2. 以摘要为起点创建新会话
3. 原会话标记为已归档

### 全文检索

`SessionDB` 为消息表建立了 FTS5 虚拟表，支持对所有消息内容进行全文检索，便于快速定位历史对话记录。

---

## 人工确认 (Confirmation)

部分工作流需要人工介入才能继续推进。`ConfirmationWatcher` 实现了完整的人工确认（Human-in-the-Loop）机制：

1. **轮询状态** — 定期调用 Meego API，检测目标工单的状态变更
2. **发送提醒** — 按可配置的时间间隔向相关人员发送飞书私信提醒
3. **返回结果** — 达到最大提醒次数后，根据工单状态返回以下三种结果之一：

| 结果 | 说明 |
|------|------|
| `approved` | 人工已审批通过，触发下游任务 |
| `rejected` | 人工已拒绝，终止当前工作流 |
| `timeout` | 超时未响应，升级处理或终止 |

确认流程对下游工作流完全透明——只要未收到 `approved`，后续 Agent 不会被启动。

---

## 下一步

- 深入了解事件流水线的完整处理链路：[事件流水线](./event-pipeline.md)
- 了解团队记忆系统的存储与检索机制：[记忆系统](./memory-system.md)
