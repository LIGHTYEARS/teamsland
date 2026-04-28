/**
 * Coordinator 工作区 Skill 生成器
 *
 * 从 coordinator-init.ts 中提取，包含所有 SKILL.md 内容生成函数。
 */

/**
 * 生成 teamsland-spawn SKILL.md 内容
 */
export function generateTeamslandSpawnSkill(): string {
  return `---
name: teamsland-spawn
description: Spawn and manage teamsland workers. Use when you need to delegate a task to a worker agent, check worker status, get results, or cancel a running worker.
allowed-tools: Bash(teamsland *)
---

# teamsland Worker Management

## Spawning a Worker

\`\`\`bash
teamsland spawn --repo <repo-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
\`\`\`

## Resume in Existing Worktree

\`\`\`bash
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
\`\`\`

## With Metadata

\`\`\`bash
teamsland spawn --repo <repo-path> \\
  --task-brief "简短描述" \\
  --origin-chat "oc_xxx" \\
  --origin-sender "ou_xxx" \\
  --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
\`\`\`

## Injecting Rules via System Prompt

When a worker must strictly follow specific rules (coding standards, output format, constraints), use \`--append-system-prompt\` to inject them as system-level instructions rather than embedding in the task prompt:

\`\`\`bash
teamsland spawn --repo <repo-path> \\
  --append-system-prompt "$(cat <<'EOF'
你必须使用中文回复。
所有代码修改必须附带单元测试。
禁止修改 package.json 的 dependencies。
EOF
)" \\
  --task "$(cat <<'EOF'
修复 AuthService 的 token 过期处理逻辑。
EOF
)"
\`\`\`

System prompt 规则与 task prompt 的区别：
- \`--append-system-prompt\`: 作为系统指令注入，worker 会将其视为硬性约束
- \`--task\`: 作为用户消息发送，worker 视为任务描述

## Checking Status

\`\`\`bash
teamsland list
teamsland status <worker-id>
teamsland result <worker-id>
\`\`\`

## Cancelling

\`\`\`bash
teamsland cancel <worker-id>
teamsland cancel <worker-id> --force
\`\`\`

## CRITICAL: Always use single-quoted EOF

Always use \`'EOF'\` (single-quoted) to prevent shell expansion of \`$variables\` and backticks.
`;
}

/**
 * 生成 meego-query SKILL.md 内容
 */
export function generateMeegoQuerySkill(): string {
  return `---
name: meego-query
description: Query Meego issues and project information. Use when you need to look up issue details, search for issues, or get project status.
allowed-tools: Bash(curl *)
---

# Meego Query Skill

通过 API 查询 Meego 工单和项目信息。

## 查询工单详情

\`\`\`bash
curl -s "http://localhost:3000/api/meego/issues/<issue-id>" | cat
\`\`\`

## 搜索工单

\`\`\`bash
curl -s "http://localhost:3000/api/meego/issues?project=<project-key>&status=open" | cat
\`\`\`

## 获取项目工单统计

\`\`\`bash
curl -s "http://localhost:3000/api/meego/projects/<project-key>/stats" | cat
\`\`\`

## 获取指派给某人的工单

\`\`\`bash
curl -s "http://localhost:3000/api/meego/issues?assignee=<user-id>&status=open" | cat
\`\`\`

## 注意事项

- 所有 API 请求通过本地代理访问
- 响应为 JSON 格式，可结合 jq 处理
- 大量结果会分页返回，注意 pagination 参数
`;
}

/**
 * 生成 self-evolve SKILL.md 内容
 */
export function generateSelfEvolveSkill(): string {
  return `---
name: self-evolve
description: >
  分析重复事件模式并创建自动化产物（hook、skill 或 subagent），
  减少 LLM 开销。当你发现同类事件已处理 3 次以上且决策模式相同时使用。
---

# 自我进化指南

你是 teamsland 的 Coordinator（大脑）。你的工作是处理团队事件并做出决策。
随着时间推移，你应该识别模式并将其自动化，减少自身的 LLM 开销。

## 三个层级

1. **Hook**（零 LLM）— \`~/.teamsland/coordinator/hooks/\` 中的 TypeScript 文件，由 server 直接执行
2. **Skill**（轻量 LLM）— \`.claude/skills/\` 中的 SKILL.md，为你提供 playbook
3. **Subagent**（隔离 LLM）— \`.claude/agents/\` 中的 .md，委托给子会话

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

读取 \`~/.teamsland/coordinator/evolution-config.json\`：
- 若 \`requireApproval: true\`：写入 \`hooks-pending/\` 而非 \`hooks/\`，然后通过 Lark DM 通知管理员
- 若 \`requireApproval: false\` 或文件不存在：直接写入 \`hooks/\`

## Hook 文件模板

\`\`\`typescript
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
\`\`\`

## 进化日志

创建新 hook/skill/subagent 时，追加到 \`~/.teamsland/coordinator/evolution-log.jsonl\`：

\`\`\`json
{"timestamp": "ISO8601", "action": "create_hook", "path": "hooks/meego/xxx.ts", "reason": "处理了 5 次相同的 issue.assigned 通知", "patternCount": 5}
\`\`\`

## 安全规则

1. **永远不要创建直接修改代码仓库的 hook。** Hook 只能发通知、spawn worker 或入队事件。
2. **始终在 hook handler 中包含错误处理。**
3. **保持 match() 简单快速。**
4. **创建前测试。** 回顾最近 3+ 次处理决策，若有不同则不适合创建 hook。
5. **记录进化决策。** 创建新产物时记录原因和观察到的模式。
6. **永远不要创建调用 LLM API 的 hook。**
7. **一个文件一个 hook。**
`;
}

/**
 * 生成 memory-management SKILL.md 内容
 */
export function generateMemoryManagementSkill(): string {
  return `---
name: memory-management
description: 管理 OpenViking 长期记忆，与 Claude Code 内置记忆互补，用于存储事实、经历、经验等低频访问的被动记忆
allowed-tools: Bash(teamsland memory *)
---

# 记忆管理

你有两套记忆系统，各有分工：

## 记忆分层

### Claude Code 内置记忆（CLAUDE.md / .claude/memory/）

定位：主动记忆，人格与约束层。

每次对话都会加载，适合存放：
- 身份与角色定义
- 行为约束与决策规则
- 团队背景与组织结构
- 协作偏好

特点：高频访问、小体量、每次对话都需要。

### OpenViking 记忆（teamsland memory 命令）

定位：被动记忆，事实与经验层。

按需语义检索，适合存放：
- 具体事件和经历
- 问题-方案案例
- 用户的具体偏好细节
- 项目事实
- 工作流经验

特点：低频访问、可能大体量、需要时语义检索召回。

## 判断标准

| 问自己 | Claude Code 内置 | OpenViking |
| --- | --- | --- |
| 几乎每次对话都需要？ | 是 | 否 |
| 是身份、约束、大方向？ | 是 | 否 |
| 是具体事件、案例、事实？ | 否 | 是 |
| 内容会随时间积累变多？ | 否，应精简 | 是，正常积累 |
| 需要语义检索才能找到？ | 否，全量加载 | 是 |

灰色地带：如果一条信息现在高频使用但未来会降频，先放 OpenViking，等确认长期有效后再考虑是否提升到 Claude Code 内置记忆。

## 何时主动记忆

- 任务执行中发现的可复用经验，包括踩坑、解法、最佳实践
- 用户明确表达但不属于每次对话都要知道的偏好细节
- 重要的项目事实和技术决策的背景原因
- 不要记忆：可以从代码或 git 历史直接获取的信息
- 不要记忆：临时的、仅当前对话有用的上下文

## 何时主动检索

Agent 记忆不会自动注入你的上下文。当你认为历史经验可能对当前任务有帮助时，主动使用 \`teamsland memory find\` 检索。典型场景：
- 处理一个类似之前解决过的问题
- 用户提到了某个你可能记录过的项目或技术细节
- 需要回忆某个团队约定或流程

## URI 命名空间

| 类型 | URI 前缀 | 何时使用 |
| --- | --- | --- |
| Agent 记忆 | \`viking://agent/teamsland/memories/\` | 团队级知识、工作模式、技术决策 |
| 用户记忆 | \`viking://user/<userId>/memories/\` | 特定用户的偏好和背景 |
| 资源 | \`viking://resources/\` | 文档、任务记录等结构化资源 |

## 常用操作

### 记住新知识

\`\`\`bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \\
  --content "## 热修复部署流程\\n\\n1. 从 main 拉分支 ..." \\
  --mode create
\`\`\`

### 检索相关记忆

\`\`\`bash
teamsland memory find "部署流程" --scope agent --limit 5
\`\`\`

### 更新已有记忆

\`\`\`bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \\
  --content "更新后的内容..." --mode replace
\`\`\`

### 浏览记忆结构

\`\`\`bash
teamsland memory ls viking://agent/teamsland/memories/ --recursive
\`\`\`

### 删除过时记忆

\`\`\`bash
teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md
\`\`\`

### 查看摘要

\`\`\`bash
teamsland memory abstract viking://agent/teamsland/memories/cases/
\`\`\`

## scope 快捷方式

\`--scope agent\` -> \`viking://agent/teamsland/memories/\`
\`--scope user --user <id>\` -> \`viking://user/<id>/memories/\`
\`--scope tasks\` -> \`viking://resources/tasks/\`
\`--scope resources\` -> \`viking://resources/\`

## 记忆文件规范

- 使用 Markdown 格式，文件名语义化，如 \`deploy-hotfix.md\`、\`alice-preferences.md\`
- cases/ 下存问题-方案案例
- patterns/ 下存交互模式和工作流
- preferences/ 下存用户偏好，放在对应用户的 URI 下
- 记忆内容简洁，聚焦为什么和怎么做，避免冗余
`;
}

/**
 * 生成 feishu-card SKILL.md 内容
 */
export function generateFeishuCardSkill(): string {
  return `---
name: feishu-card
description: >
  Use when sending Feishu/Lark messages that need rich formatting —
  tables, colored headers, status badges, structured data.
  Provides card templates, validation checklist, and send commands.
allowed-tools: Bash(lark-cli *), Bash(bytedcli *), Read
---

# 飞书卡片消息

普通 post 消息（--markdown）不支持表格和复杂排版。
需要丰富格式时，使用 **interactive 卡片消息**。

## 发送命令

\`\`\`bash
# lark-cli
lark-cli im +messages-send --as bot --chat-id "<chat_id>" \\
  --msg-type interactive --content '<card_json>'

# bytedcli
bytedcli feishu message send --chat-id "<chat_id>" \\
  --msg-type interactive --content-json '<card_json>'

# 私聊
lark-cli im +messages-send --as bot --user-id "<user_id>" \\
  --msg-type interactive --content '<card_json>'
\`\`\`

## 发送前校验清单

发送卡片 JSON 前，逐项检查：

1. **JSON 合法** — 能被 JSON.parse 解析
2. **有 header.title** — 必须包含 \`header.title.content\`
3. **body.elements 非空** — 至少一个元素
4. **元素 tag 合法** — 见下方合法列表
5. **表格约束** — 表格数 ≤ 5，列 ≤ 10，行 ≤ 50
6. **总大小 ≤ 30KB**
7. **嵌套 ≤ 6 层**

合法元素 tag：\`markdown\`、\`div\`、\`table\`、\`hr\`、\`note\`、\`img\`、
\`column_set\`、\`column\`、\`collapsible_panel\`、\`form\`、\`action\`、
\`button\`、\`select_static\`、\`multi_select_static\`、\`date_picker\`、
\`input\`、\`overflow\`、\`checker\`、\`chart\`、\`progress\`、
\`person_list\`、\`icon\`

Header template 颜色：\`blue\`、\`wathet\`、\`turquoise\`、\`green\`、
\`yellow\`、\`orange\`、\`red\`、\`carmine\`、\`violet\`、\`purple\`、
\`indigo\`、\`grey\`、\`default\`

## 卡片 JSON 基本结构

\`\`\`json
{
  "schema": "2.0",
  "config": { "wide_screen_mode": true },
  "header": {
    "title": { "tag": "plain_text", "content": "标题" },
    "template": "blue"
  },
  "body": {
    "elements": [
      { "tag": "markdown", "content": "**正文** markdown 内容" }
    ]
  }
}
\`\`\`

## 模板索引

按需 Read 对应模板文件，替换占位符后发送。

| 模板 | 文件 | 场景 |
|------|------|------|
| 文本回复 | templates/text-reply.json | 日常回复，标题 + markdown 正文 |
| 结构化数据 | templates/structured-data.json | 表格展示：仓库映射、工单列表 |
| 状态通知 | templates/status-notification.json | Worker 启动/完成/失败 |
| 错误告警 | templates/error-alert.json | 系统异常、任务失败 |
| Worker 结果 | templates/worker-result.json | 任务完成详细报告 |

## 何时用卡片 vs 纯文本

- 一句话回复 → 纯文本（--text）
- 带格式的回复但无表格 → post（--markdown）
- 包含表格、彩色标题、结构化数据 → 卡片（--msg-type interactive）
`;
}

type CardTemplateType = "text-reply" | "structured-data" | "status-notification" | "error-alert" | "worker-result";

/**
 * 生成卡片模板 JSON
 */
export function generateCardTemplate(type: CardTemplateType): string {
  const templates: Record<CardTemplateType, object> = {
    "text-reply": {
      _comment: "文本回复卡片 — 替换 {{TITLE}}、{{COLOR}}、{{CONTENT}}",
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "{{TITLE}}" },
        template: "{{COLOR}}",
      },
      body: {
        elements: [{ tag: "markdown", content: "{{CONTENT}}" }],
      },
    },
    "structured-data": {
      _comment: "结构化数据卡片 — 替换 {{TITLE}}、{{COLOR}}、{{COLUMNS}}、{{ROWS}}",
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "{{TITLE}}" },
        template: "{{COLOR}}",
      },
      body: {
        elements: [
          {
            tag: "table",
            page_size: 10,
            row_height: "low",
            header_style: { bold: true, background_style: "grey" },
            columns: "{{COLUMNS}}",
            rows: "{{ROWS}}",
          },
        ],
      },
    },
    "status-notification": {
      _comment: "状态通知卡片 — 替换 {{TITLE}}、{{COLOR}}、{{STATUS}}、{{DETAILS}}",
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "{{TITLE}}" },
        template: "{{COLOR}}",
      },
      body: {
        elements: [
          { tag: "markdown", content: "**状态：** {{STATUS}}" },
          { tag: "hr" },
          { tag: "markdown", content: "{{DETAILS}}" },
        ],
      },
    },
    "error-alert": {
      _comment: "错误告警卡片 — 替换 {{TITLE}}、{{ERROR_MESSAGE}}、{{SUGGESTION}}",
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "{{TITLE}}" },
        template: "red",
      },
      body: {
        elements: [
          { tag: "markdown", content: "**错误信息：**\n{{ERROR_MESSAGE}}" },
          { tag: "hr" },
          { tag: "markdown", content: "**建议操作：**\n{{SUGGESTION}}" },
        ],
      },
    },
    "worker-result": {
      _comment: "Worker 结果卡片 — 替换 {{TITLE}}、{{COLOR}}、{{WORKER_ID}}、{{SUMMARY}}、{{DETAILS}}",
      schema: "2.0",
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "{{TITLE}}" },
        template: "{{COLOR}}",
      },
      body: {
        elements: [
          { tag: "markdown", content: "**Worker：** `{{WORKER_ID}}`" },
          { tag: "hr" },
          { tag: "markdown", content: "{{SUMMARY}}" },
          {
            tag: "collapsible_panel",
            expanded: false,
            header: { title: { tag: "plain_text", content: "详细信息" } },
            border: { color: "grey" },
            background_style: "default",
            body: {
              elements: [{ tag: "markdown", content: "{{DETAILS}}" }],
            },
          },
        ],
      },
    },
  };

  return JSON.stringify(templates[type], null, 2);
}
