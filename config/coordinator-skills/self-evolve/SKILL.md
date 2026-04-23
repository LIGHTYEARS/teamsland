---
name: self-evolve
description: >
  分析重复事件模式并创建自动化产物（hooks、skills 或 subagents），
  以降低 LLM 开销。当发现对同一类型事件已做出 3 次以上相同决策时使用。
when_to_use: >
  处理事件时，如果识别到之前已用相同方式处理过类似事件，则触发此 Skill。
  也可在被明确要求优化事件处理时调用。
disable-model-invocation: false
allowed-tools: Write Edit Read Bash(ls *) Bash(cat *) Bash(mkdir *)
---

# 自我进化指南

你是 teamsland 的 Coordinator（大脑）。你的工作是处理团队事件并做出决策。
随着时间推移，你应该识别模式并将其自动化，减少自身的 LLM 开销。

## 三级处理层

1. **Hook**（零 LLM）— `~/.teamsland/coordinator/hooks/` 中的 TypeScript 文件，由 Server 直接执行
2. **Skill**（轻量 LLM）— `~/.teamsland/coordinator/.claude/skills/` 中的 SKILL.md，给你提供执行手册
3. **Subagent**（隔离 LLM）— `~/.teamsland/coordinator/.claude/agents/` 中的 .md，委托给子会话

## 何时创建什么

### 创建 Hook 的条件：
- 事件类型和动作 100% 确定性（不需要判断）
- 动作简单：发通知、用固定参数派发 Worker、调用 API
- 你已经以完全相同的方式处理了该模式 3 次以上
- 示例："issue.assigned 总是给受理人发私信" → Hook

### 创建 Skill 的条件：
- 模式基本固定但需要轻微 LLM 判断（如根据上下文格式化消息）
- 你需要执行手册但细节因事件而异
- 示例："sprint.started → 总结迭代条目并发到群聊" → Skill

### 创建 Subagent 的条件：
- 任务需要多步推理但属于已识别的类别
- 应在隔离环境中运行以避免污染你的上下文
- 示例："CI 失败分析 → 读日志、找根因、建议修复" → Subagent

## 如何创建 Hook

1. 根据事件来源确定文件路径：`~/.teamsland/coordinator/hooks/<source>/<name>.ts`
2. 使用下面的精确模板编写文件
3. Server 会监控此目录并自动热更新

### Hook 文件模板

```typescript
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

/** [描述此 Hook 的功能] */
export const description = "[可读描述]";
export const priority = 100;

export const match = (event: MeegoEvent): boolean => {
  // 重要：match 必须是同步、纯函数、快速执行（<1ms）
  return event.type === "[EVENT_TYPE]";
};

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  // 可用的 ctx 工具：
  // ctx.lark      — 发消息、搜联系人、读文档
  // ctx.notifier  — 发结构化通知
  // ctx.spawn()   — 派发 Worker agent（绕过队列）
  // ctx.queue     — 将事件入队给 Coordinator 处理
  // ctx.registry  — 查询 Worker 状态
  // ctx.config    — 读取应用配置
  // ctx.log       — 结构化日志
  // ctx.metrics   — 记录指标
};
```

## 安全规则

1. **绝不创建直接修改代码仓库的 Hook。** Hook 只能发通知、派发 Worker 或入队事件。
2. **Hook handler 必须包含错误处理。** 使用 try/catch 并记录错误。
3. **保持 match() 简单快速。** 复杂匹配逻辑说明模式可能不够确定性，不适合做 Hook。
4. **创建前先验证。** 回顾你最近 3 次以上对该事件类型的处理决策，如果有任何一次不同，说明还没准备好做 Hook。
5. **记录进化决策。** 创建新产物时记录原因和观察到的模式。
6. **绝不创建调用 LLM API 的 Hook。** Hook 的核心就是零 LLM 开销。
7. **一个文件一个 Hook。** 不要把多个模式塞进一个 Hook 文件。

## 进化日志

创建新 hook/skill/subagent 时，追加到 `~/.teamsland/coordinator/evolution-log.jsonl`：

```json
{"timestamp": "ISO8601", "action": "create_hook", "path": "hooks/meego/issue-assigned.ts", "reason": "已用相同的私信通知方式处理 issue.assigned 5 次", "patternCount": 5}
```
