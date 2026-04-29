import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { AppConfig, RepoMappingEntry } from "@teamsland/types";
import { generateHandleMeegoIssueWorkflow } from "./coordinator-init-workflows.js";

const logger = createLogger("server:coordinator-init");

/** Coordinator 工作区目录结构常量 */
const WORKSPACE_DIRS = {
  claude: ".claude",
  rules: ".claude/rules",
} as const;

/**
 * 初始化 Coordinator 工作区
 *
 * 在指定路径创建 Coordinator 运行所需的目录结构和配置文件。
 * Skills 不在此处写入——由 `npx skills add` 通过 symlink 安装。
 *
 * @param config - 应用完整配置
 * @returns 工作区绝对路径
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
 * 写入工作区配置文件（不含 skills）
 */
async function writeWorkspaceFiles(basePath: string, config: AppConfig): Promise<void> {
  const files: Array<{ path: string; content: string }> = [
    { path: join(basePath, "CLAUDE.md"), content: generateClaudeMd(config) },
    {
      path: join(basePath, WORKSPACE_DIRS.rules, "handle-meego-issue.md"),
      content: generateHandleMeegoIssueWorkflow(),
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
    if (file.path.endsWith(".md")) {
      await writeFileIfChanged(file.path, file.content);
    } else {
      await writeFileIfNotExists(file.path, file.content);
    }
  }
}

/**
 * 仅在文件不存在时写入内容（幂等写入）
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
 * 找到 YAML frontmatter 闭合 `---` 的位置（返回第二个 `---` 末尾的索引）。
 * 如果内容不以 `---` 开头或没有闭合，返回 -1。
 */
function findFrontmatterEnd(content: string): number {
  if (!content.startsWith("---")) return -1;
  const closeIdx = content.indexOf("\n---", 3);
  if (closeIdx === -1) return -1;
  return closeIdx + 4;
}

/**
 * 仅在内容哈希发生变化时写入文件（版本化写入）
 *
 * 使用 SHA-256 前 8 位作为内容指纹。
 * 对含 YAML frontmatter 的文件，hash 注释插入到 frontmatter 之后，
 * 避免破坏 frontmatter 解析；其他文件仍插入到文件头。
 */
async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  const HASH_PREFIX = "<!-- teamsland-content-hash: ";
  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 8);
  const hashTag = `${HASH_PREFIX}${hash} -->`;

  let taggedContent: string;
  const frontmatterEnd = findFrontmatterEnd(content);
  if (frontmatterEnd !== -1) {
    taggedContent = `${content.slice(0, frontmatterEnd)}\n${hashTag}${content.slice(frontmatterEnd)}`;
  } else {
    taggedContent = `${hashTag}\n${content}`;
  }

  if (existsSync(filePath)) {
    const existing = await Bun.file(filePath).text();
    const match = existing.match(/<!-- teamsland-content-hash: (\w+) -->/);
    if (match?.[1] === hash) {
      logger.debug({ file: filePath }, "文件内容未变更，跳过");
      return;
    }
    const backupDir = join(dirname(filePath), ".backup");
    mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await Bun.write(join(backupDir, `${basename(filePath)}.${ts}`), existing);
    logger.info({ file: filePath }, "旧文件已备份，写入新版本");
  }

  await Bun.write(filePath, taggedContent);
  logger.info({ file: filePath, hash }, "文件已写入（版本化）");
}

/**
 * 生成仓库映射表的 Markdown 格式
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
- **包含表格、彩色标题、结构化数据** → 卡片消息（参见 lark-messaging skill）

**严禁在 post 消息中使用 \`| col1 | col2 |\` 表格语法** — 会原样显示为纯文本。
需要表格时必须使用 lark-messaging skill 的 structured-data 模板。

## Spawn Worker 提示词规范

Spawn Worker 时，task prompt 必须包含以下结构：

1. **任务目标**（必填）— 明确说明需要完成什么
2. **验收标准**（必填）— 怎样算完成，预期产出是什么
3. **已知上下文**（如有）— 相关 issue 信息、之前的讨论、已知约束
4. **产出物要求**（如有）— 输出文件路径、格式要求

示例：

请在 novel-admin-monorepo 中 explore 项目结构，建立 repository profile。

验收标准：
- 生成 REPO_PROFILE.md，包含目录结构、技术栈、构建系统、核心模块说明
- 文件放在仓库根目录

已知上下文：
- 这是一个 monorepo，使用 pnpm workspace
- 主要技术栈是 React + TypeScript

注意：不要在 prompt 中重复 Worker 已通过 CLAUDE.md 获得的信息（如 Worker ID、回报方式等）。

## 记忆管理

你有两套记忆系统，协同工作：

### 内置记忆（本文件 + .claude/memory/）

这就是你正在读的 CLAUDE.md 以及 \`.claude/memory/\` 目录下的文件。它们是**主动记忆**——每次对话启动时自动全量加载。

适合存放：
- 身份、角色、行为约束（即本文件的内容）
- 团队组织结构和项目映射
- 高频需要的协作规则和决策流程

**管理方式**：直接编辑本文件或 \`.claude/memory/\` 下的文件。内容应保持精简，只放每次对话都需要的信息。

### 外挂记忆（OpenViking，通过 memory-management skill 管理）

这是基于 OpenViking 向量数据库的**被动记忆**——不会自动加载，需要你主动检索。

适合存放：
- 具体事件经历和问题-方案案例
- 用户的偏好细节
- 项目事实和技术决策背景
- 工作流经验和踩坑记录

**管理方式**：使用 \`teamsland memory\` 命令（详见 memory-management skill）：
- 写入：\`teamsland memory write <uri> --content "..." --mode create\`
- 检索：\`teamsland memory find "关键词" --scope agent --limit 5\`
- 浏览：\`teamsland memory ls --scope agent --recursive\`
- 删除：\`teamsland memory rm <uri>\`

### 何时用哪个

| 场景 | 内置记忆 | 外挂记忆 |
| --- | --- | --- |
| 几乎每次对话都需要 | ✓ | |
| 身份、约束、决策规则 | ✓ | |
| 具体事件、案例、经验 | | ✓ |
| 内容会持续积累 | | ✓ |
| 需要语义检索才能找到 | | ✓ |

**关键原则**：内置记忆求精不求多；外挂记忆正常积累。遇到有价值的经验时主动记忆，处理任务前主动检索相关记忆。
`;
}

/**
 * 验证 Coordinator 工作目录完整性
 *
 * 检查所有必需文件是否存在。缺失的文件将在下次 initCoordinatorWorkspace 调用时被重新创建。
 */
export async function verifyWorkspaceIntegrity(workspacePath: string): Promise<{ ok: boolean; missing: string[] }> {
  const required = ["CLAUDE.md", join(WORKSPACE_DIRS.rules, "handle-meego-issue.md"), "evolution-config.json"];
  const missing: string[] = [];
  for (const rel of required) {
    const file = Bun.file(join(workspacePath, rel));
    if (!(await file.exists())) missing.push(rel);
  }
  return { ok: missing.length === 0, missing };
}
