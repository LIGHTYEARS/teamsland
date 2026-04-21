import type { RepoMapping } from "@teamsland/config";
import type { Embedder, TeamMemoryStore } from "@teamsland/memory";
import { retrieve } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import type { AbstractMemoryStore, AppConfig, TaskConfig } from "@teamsland/types";
import { loadTemplate } from "./template-loader.js";

const logger = createLogger("context:assembler");

/**
 * DynamicContextAssembler 构造参数
 *
 * @example
 * ```typescript
 * import type { AssemblerOptions } from "@teamsland/context";
 *
 * const opts: AssemblerOptions = {
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 *   memoryStore,
 *   embedder,
 *   templateBasePath: "config/templates",
 * };
 * ```
 */
export interface AssemblerOptions {
  /** 全局应用配置（含技能路由） */
  config: AppConfig;
  /** Meego 项目到 Git 仓库的映射 */
  repoMapping: RepoMapping;
  /** 团队记忆存储（用于记忆检索） */
  memoryStore: AbstractMemoryStore;
  /** Embedding 生成器（用于向量检索） */
  embedder: Embedder;
  /** 角色模板目录路径，默认为 "config/templates" */
  templateBasePath?: string;
}

/**
 * 动态初始提示词组装器
 *
 * 在每次 Claude Code 进程启动前调用，将 5 个信息段组装为结构化提示词。
 * 由 Sidecar 在 spawn Agent 进程时注入为初始上下文。
 *
 * 5 段结构：
 * - §A — Issue 上下文（task.meegoEvent + task.description）
 * - §B — 历史记忆（retrieve 检索结果）
 * - §C — 可用技能（config.skillRouting 路由表）
 * - §D — 仓库信息（repoMapping.resolve + task.worktreePath）
 * - §E — 角色指令（loadTemplate 加载的 Markdown 模板）
 *
 * @example
 * ```typescript
 * import { DynamicContextAssembler } from "@teamsland/context";
 *
 * const assembler = new DynamicContextAssembler({
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 *   memoryStore,
 *   embedder,
 * });
 * const prompt = await assembler.buildInitialPrompt(task, "team-001");
 * // 返回包含 §A–§E 五段的完整提示词字符串
 * ```
 */
export class DynamicContextAssembler {
  private readonly config: AppConfig;
  private readonly repoMapping: RepoMapping;
  private readonly memoryStore: AbstractMemoryStore;
  private readonly embedder: Embedder;
  private readonly templateBasePath: string;

  constructor(opts: AssemblerOptions) {
    this.config = opts.config;
    this.repoMapping = opts.repoMapping;
    this.memoryStore = opts.memoryStore;
    this.embedder = opts.embedder;
    this.templateBasePath = opts.templateBasePath ?? "config/templates";
  }

  /**
   * 组装 Agent 启动时的初始提示词
   *
   * 并发执行 5 段内容构建（Promise.all），总延迟由最慢的一段决定。
   * 通常 §B（向量检索）耗时最长。
   *
   * @param task - 当前任务配置
   * @param teamId - 团队 ID，用于记忆检索作用域隔离
   * @returns 组装完成的提示词字符串
   *
   * @example
   * ```typescript
   * const prompt = await assembler.buildInitialPrompt(task, "team-alpha");
   * // prompt 示例：
   * // ## §A — Issue 上下文
   * // Issue ID: ISSUE-123
   * // ...
   * // ## §E — 角色指令
   * // # 前端开发 Agent 指令
   * // ...
   * ```
   */
  async buildInitialPrompt(task: TaskConfig, teamId: string): Promise<string> {
    logger.info({ issueId: task.issueId, teamId, agentRole: task.agentRole }, "开始组装初始提示词");

    const [sectionA, sectionB, sectionC, sectionD, sectionE] = await Promise.all([
      this.buildSectionA(task),
      this.buildSectionB(task, teamId),
      this.buildSectionC(task),
      this.buildSectionD(task),
      this.buildSectionE(task),
    ]);

    const prompt = [sectionA, sectionB, sectionC, sectionD, sectionE].join("\n\n");
    logger.info({ issueId: task.issueId, promptLength: prompt.length }, "初始提示词组装完成");
    return prompt;
  }

  /** §A — Issue 上下文 */
  private buildSectionA(task: TaskConfig): Promise<string> {
    const event = task.meegoEvent;
    const lines = [
      "## §A — Issue 上下文",
      `Issue ID: ${event.issueId}`,
      `项目 Key: ${event.projectKey}`,
      `事件类型: ${event.type}`,
      `任务描述: ${task.description}`,
    ];
    return Promise.resolve(lines.join("\n"));
  }

  /** §B — 历史记忆 */
  private async buildSectionB(task: TaskConfig, teamId: string): Promise<string> {
    logger.debug({ teamId, query: task.description }, "检索历史记忆");
    const memories = await retrieve(
      this.memoryStore as unknown as TeamMemoryStore,
      this.embedder,
      task.description,
      teamId,
    );
    const memoryLines = memories.map((m) => `- [${m.memoryType}] ${m.content}`);
    return ["## §B — 历史记忆", ...memoryLines].join("\n");
  }

  /** §C — 可用技能 */
  private buildSectionC(task: TaskConfig): Promise<string> {
    const skills = this.config.skillRouting[task.triggerType] ?? [];
    logger.debug({ triggerType: task.triggerType, skillCount: skills.length }, "查询技能路由");
    const skillLines = skills.map((s) => `- ${s}`);
    return Promise.resolve(["## §C — 可用技能", ...skillLines].join("\n"));
  }

  /** §D — 仓库信息 */
  private buildSectionD(task: TaskConfig): Promise<string> {
    const repos = this.repoMapping.resolve(task.meegoProjectId);
    logger.debug({ meegoProjectId: task.meegoProjectId, repoCount: repos.length }, "解析仓库路径");
    const repoLines = repos.map((r) => `- ${r.name}: ${r.path}`);
    const lines = ["## §D — 仓库信息", ...repoLines, `工作树路径: ${task.worktreePath}`];
    return Promise.resolve(lines.join("\n"));
  }

  /** §E — 角色指令 */
  private async buildSectionE(task: TaskConfig): Promise<string> {
    logger.debug({ agentRole: task.agentRole, basePath: this.templateBasePath }, "加载角色模板");
    const template = await loadTemplate(task.agentRole, this.templateBasePath);
    return `## §E — 角色指令\n\n${template}`;
  }
}
