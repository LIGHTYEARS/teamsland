---
name: self-evolve
description: >
  分析重复事件模式并创建自动化产物（hook、skill 或 subagent），
  减少 LLM 开销。当你发现同类事件已处理 3 次以上且决策模式相同时使用。
---

# 自我进化指南

你是 teamsland 的 Coordinator（大脑）。你的工作是处理团队事件并做出决策。
随着时间推移，你应该识别模式并将其自动化，减少自身的 LLM 开销。

## 三个层级

1. **Hook**（零 LLM）— `~/.teamsland/coordinator/hooks/` 中的 TypeScript 文件，由 server 直接执行
2. **Skill**（轻量 LLM）— `.claude/skills/` 中的 SKILL.md，为你提供 playbook
3. **Subagent**（隔离 LLM）— `.claude/agents/` 中的 .md，委托给子会话

## 何时创建什么

### 创建 Hook：
- 事件类型和动作 100% 确定性（不需要判断）
- 动作简单：发通知、spawn worker、调用 API
- 你已经以完全相同方式处理了 3+ 次
- 例如："issue.assigned 总是给 assignee 发 DM" → Hook

### 创建 Skill：
- 模式大致固定但需要轻微 LLM 判断
- 你需要 playbook 但细节因事件不同
- 例如："sprint.started → 汇总 sprint 项目并发到群聊" → Skill

### 创建 Subagent：
- 任务需要多步推理但属于已知类别
- 应在隔离环境中运行以避免污染上下文
- 例如："CI 失败分诊 → 读日志、定位根因、建议修复" → Subagent

## 审批模式

读取 `~/.teamsland/coordinator/evolution-config.json`：
- 若 `requireApproval: true`：写入 `hooks-pending/` 而非 `hooks/`，然后通过 Lark DM 通知管理员
- 若 `requireApproval: false` 或文件不存在：直接写入 `hooks/`

## Hook 文件模板

```typescript
import type { MeegoEvent } from "@teamsland/types";
import type { HookContext } from "@teamsland/hooks";

export const description = "[描述这个 hook 做什么]";
export const priority = 100;

export const match = (event: MeegoEvent): boolean => {
  return event.type === "[EVENT_TYPE]";
};

export const handle = async (event: MeegoEvent, ctx: HookContext): Promise<void> => {
  // ctx.lark      — 发消息、搜联系人、读文档
  // ctx.notifier  — 发结构化通知
  // ctx.spawn()   — spawn worker（绕过队列）
  // ctx.queue     — 入队到 Coordinator
  // ctx.registry  — 查询 worker 状态
  // ctx.config    — 读配置
  // ctx.log       — 结构化日志
};
```

## 进化日志

创建新 hook/skill/subagent 时，追加到 `~/.teamsland/coordinator/evolution-log.jsonl`：

```json
{"timestamp": "ISO8601", "action": "create_hook", "path": "hooks/meego/xxx.ts", "reason": "处理了 5 次相同的 issue.assigned 通知", "patternCount": 5}
```

## 安全规则

1. **永远不要创建直接修改代码仓库的 hook。** Hook 只能发通知、spawn worker 或入队事件。
2. **始终在 hook handler 中包含错误处理。**
3. **保持 match() 简单快速。**
4. **创建前测试。** 回顾最近 3+ 次处理决策，若有不同则不适合创建 hook。
5. **记录进化决策。** 创建新产物时记录原因和观察到的模式。
6. **永远不要创建调用 LLM API 的 hook。**
7. **一个文件一个 hook。**
