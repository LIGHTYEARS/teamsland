import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { AppConfig, RepoMappingEntry } from "@teamsland/types";

const logger = createLogger("server:coordinator-init");

/**
 * Coordinator 工作区目录结构常量
 *
 * @example
 * ```typescript
 * import { WORKSPACE_DIRS } from "./coordinator-init.js";
 * // WORKSPACE_DIRS.skills === ".claude/skills"
 * ```
 */
const WORKSPACE_DIRS = {
  claude: ".claude",
  skills: ".claude/skills",
  teamslandSpawn: ".claude/skills/teamsland-spawn",
  meegoQuery: ".claude/skills/meego-query",
  selfEvolve: ".claude/skills/self-evolve",
  feishuCard: ".claude/skills/feishu-card",
  feishuCardTemplates: ".claude/skills/feishu-card/templates",
} as const;

/**
 * 初始化 Coordinator 工作区
 *
 * 在指定路径创建 Coordinator 运行所需的完整目录结构和配置文件。
 * 已存在的文件不会被覆盖（幂等操作），保护用户自定义修改。
 *
 * @param config - 应用完整配置
 * @returns 工作区绝对路径
 *
 * @example
 * ```typescript
 * import { initCoordinatorWorkspace } from "./coordinator-init.js";
 * import type { AppConfig } from "@teamsland/types";
 *
 * declare const config: AppConfig;
 * const workspacePath = await initCoordinatorWorkspace(config);
 * // workspacePath === "/Users/xxx/.teamsland/coordinator"
 * ```
 */
export async function initCoordinatorWorkspace(config: AppConfig): Promise<string> {
  const rawPath = config.coordinator?.workspacePath ?? "~/.teamsland/coordinator";
  const workspacePath = rawPath.replace("~", homedir());

  logger.info({ workspacePath }, "初始化 Coordinator 工作区");

  createDirectories(workspacePath);
  await writeWorkspaceFiles(workspacePath, config);

  logger.info({ workspacePath }, "Coordinator 工作区初始化完成");
  return workspacePath;
}

/**
 * 创建工作区所需的目录结构
 *
 * @param basePath - 工作区根目录
 *
 * @example
 * ```typescript
 * createDirectories("/home/user/.teamsland/coordinator");
 * ```
 */
function createDirectories(basePath: string): void {
  for (const dir of Object.values(WORKSPACE_DIRS)) {
    const fullPath = join(basePath, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      logger.info({ dir: fullPath }, "目录已创建");
    }
  }
  for (const extraDir of ["hooks", "hooks-pending"]) {
    const fullPath = join(basePath, extraDir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      logger.info({ dir: fullPath }, "目录已创建");
    }
  }
}

/**
 * 写入所有工作区文件
 *
 * @param basePath - 工作区根目录
 * @param config - 应用配置
 *
 * @example
 * ```typescript
 * await writeWorkspaceFiles("/home/user/.teamsland/coordinator", config);
 * ```
 */
async function writeWorkspaceFiles(basePath: string, config: AppConfig): Promise<void> {
  const files: Array<{ path: string; content: string }> = [
    { path: join(basePath, "CLAUDE.md"), content: generateClaudeMd(config) },
    { path: join(basePath, ".claude", "settings.json"), content: generateSettingsJson() },
    {
      path: join(basePath, WORKSPACE_DIRS.teamslandSpawn, "SKILL.md"),
      content: generateTeamslandSpawnSkill(),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.meegoQuery, "SKILL.md"),
      content: generateMeegoQuerySkill(),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.selfEvolve, "SKILL.md"),
      content: generateSelfEvolveSkill(),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCard, "SKILL.md"),
      content: generateFeishuCardSkill(),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCardTemplates, "text-reply.json"),
      content: generateCardTemplate("text-reply"),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCardTemplates, "structured-data.json"),
      content: generateCardTemplate("structured-data"),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCardTemplates, "status-notification.json"),
      content: generateCardTemplate("status-notification"),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCardTemplates, "error-alert.json"),
      content: generateCardTemplate("error-alert"),
    },
    {
      path: join(basePath, WORKSPACE_DIRS.feishuCardTemplates, "worker-result.json"),
      content: generateCardTemplate("worker-result"),
    },
    {
      path: join(basePath, "evolution-config.json"),
      content: JSON.stringify(
        {
          requireApproval: true,
          minPatternCount: 3,
          notifyUserId: null,
          notifyChannelId: null,
        },
        null,
        2,
      ),
    },
  ];

  for (const file of files) {
    await writeFileIfNotExists(file.path, file.content);
  }
}

/**
 * 仅在文件不存在时写入内容（幂等写入）
 *
 * @param filePath - 文件绝对路径
 * @param content - 文件内容
 *
 * @example
 * ```typescript
 * await writeFileIfNotExists("/path/to/file.md", "# Hello");
 * ```
 */
async function writeFileIfNotExists(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) {
    logger.info({ file: filePath }, "文件已存在，跳过写入");
    return;
  }
  await Bun.write(filePath, content);
  logger.info({ file: filePath }, "文件已创建");
}

/**
 * 生成仓库映射表的 Markdown 格式
 *
 * @param entries - 仓库映射配置
 * @returns Markdown 表格字符串
 *
 * @example
 * ```typescript
 * const table = formatRepoMappingTable([
 *   { meegoProjectId: "p1", repos: [{ path: "/repos/fe", name: "前端" }] },
 * ]);
 * ```
 */
function formatRepoMappingTable(entries: ReadonlyArray<RepoMappingEntry>): string {
  const lines: string[] = ["| Meego 项目 ID | 仓库名称 | 本地路径 |", "| --- | --- | --- |"];

  for (const entry of entries) {
    for (const repo of entry.repos) {
      lines.push(`| ${entry.meegoProjectId} | ${repo.name} | ${repo.path} |`);
    }
  }

  return lines.join("\n");
}

/**
 * 生成群聊项目映射表的 Markdown 格式
 *
 * @param mapping - chatId → projectId 映射
 * @returns Markdown 表格字符串
 *
 * @example
 * ```typescript
 * const table = formatChatProjectMappingTable({ "oc_xxx": "project_xxx" });
 * ```
 */
function formatChatProjectMappingTable(mapping: Record<string, string>): string {
  const lines: string[] = ["| 群聊 ID | Meego 项目 ID |", "| --- | --- |"];

  for (const [chatId, projectId] of Object.entries(mapping)) {
    lines.push(`| ${chatId} | ${projectId} |`);
  }

  return lines.join("\n");
}

/**
 * 根据配置动态生成 Coordinator 的 CLAUDE.md
 *
 * @param config - 应用配置
 * @returns CLAUDE.md 文件内容
 *
 * @example
 * ```typescript
 * const content = generateClaudeMd(config);
 * ```
 */
function generateClaudeMd(config: AppConfig): string {
  const repoTable = formatRepoMappingTable(config.repoMapping);
  const chatMapping = config.lark.connector?.chatProjectMapping ?? {};
  const chatTable = formatChatProjectMappingTable(chatMapping);

  return `# Coordinator 大脑

你是团队的 AI 大管家。你的职责是：
1. 理解消息意图
2. 决策：回复 / spawn worker / 更新状态 / 忽略
3. 跟踪 worker 状态
4. 转发 worker 结果给用户

## 决策流程

收到消息后，按以下顺序决策：

1. **是否需要处理？** — 闲聊、重复消息、已处理的事件 → 忽略或简短回复
2. **能直接回答吗？** — 状态查询、简单问题 → 直接回复
3. **需要执行任务？** — 代码修改、文档撰写、Bug 修复 → spawn worker
4. **需要通知他人？** — 工单变更、任务完成 → 通过 bytedcli feishu 或 lark-cli 发消息

## 团队项目

### 仓库映射

${repoTable}

### 群聊 → 项目映射

${chatTable}

## 工作规范

- 永远保持轻量、快速响应
- 所有耗时超过几秒的工作都 spawn worker
- spawn worker 时用 teamsland CLI（参见 teamsland-spawn skill）
- 定期检查 running workers 的状态：\`teamsland list\`
- Worker 完成后获取结果并转发给用户

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

## 飞书消息格式选择

- **一句话回复** → 纯文本（--text）
- **带格式但无表格** → post（--markdown），注意：post 不支持表格语法和 HTML
- **包含表格、彩色标题、结构化数据** → 卡片消息（参见 feishu-card skill）

**严禁在 post 消息中使用 \`| col1 | col2 |\` 表格语法** — 会原样显示为纯文本。
需要表格时必须使用 feishu-card skill 的 structured-data 模板。
`;
}

/**
 * 生成 Coordinator 的 Claude settings.json
 *
 * @returns settings.json 文件内容
 *
 * @example
 * ```typescript
 * const content = generateSettingsJson();
 * ```
 */
function generateSettingsJson(): string {
  const settings = {
    permissions: {
      allow: [
        "Bash(teamsland *)",
        "Bash(bytedcli *)",
        "Bash(npx -y @bytedance-dev/bytedcli*)",
        "Bash(lark-cli *)",
        "Bash(curl *)",
        "Bash(cat *)",
        "Bash(echo *)",
        "Bash(date *)",
        "Read",
        "Write",
      ],
      deny: ["Bash(rm *)", "Bash(sudo *)", "Bash(git push *)", "Bash(npm *)", "Bash(bun *)"],
    },
  };

  return JSON.stringify(settings, null, 2);
}

/**
 * 生成 teamsland-spawn SKILL.md 内容
 *
 * @returns SKILL.md 文件内容
 *
 * @example
 * ```typescript
 * const content = generateTeamslandSpawnSkill();
 * ```
 */
function generateTeamslandSpawnSkill(): string {
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
 *
 * @returns SKILL.md 文件内容
 *
 * @example
 * ```typescript
 * const content = generateMeegoQuerySkill();
 * ```
 */
function generateMeegoQuerySkill(): string {
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
 *
 * @returns SKILL.md 文件内容
 *
 * @example
 * ```typescript
 * const content = generateSelfEvolveSkill();
 * ```
 */
function generateSelfEvolveSkill(): string {
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
 * 生成 feishu-card SKILL.md 内容
 *
 * 轻量入口文件：校验规则 + 发送命令 + 模板索引。
 * 模板 JSON 单独存放在 templates/ 目录，大脑按需 Read。
 */
function generateFeishuCardSkill(): string {
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
 *
 * 每个模板包含占位符（{{placeholder}}），大脑 Read 后替换并发送。
 */
function generateCardTemplate(type: CardTemplateType): string {
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

/**
 * 验证 Coordinator 工作目录完整性
 *
 * 检查所有必需文件是否存在。缺失的文件将在下次 initCoordinatorWorkspace 调用时被重新创建。
 *
 * @example
 * ```typescript
 * const { ok, missing } = await verifyWorkspaceIntegrity("~/.teamsland/coordinator");
 * if (!ok) logger.warn({ missing }, "Workspace 完整性检查失败");
 * ```
 */
export async function verifyWorkspaceIntegrity(workspacePath: string): Promise<{ ok: boolean; missing: string[] }> {
  const required = [
    "CLAUDE.md",
    ".claude/settings.json",
    join(WORKSPACE_DIRS.teamslandSpawn, "SKILL.md"),
    join(WORKSPACE_DIRS.meegoQuery, "SKILL.md"),
    join(WORKSPACE_DIRS.selfEvolve, "SKILL.md"),
    join(WORKSPACE_DIRS.feishuCard, "SKILL.md"),
  ];
  const missing: string[] = [];
  for (const rel of required) {
    const file = Bun.file(join(workspacePath, rel));
    if (!(await file.exists())) missing.push(rel);
  }
  return { ok: missing.length === 0, missing };
}
