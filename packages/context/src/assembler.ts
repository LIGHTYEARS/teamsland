import type { RepoMapping } from "@teamsland/config";
import { createLogger, withSpan } from "@teamsland/observability";
import type { AppConfig, TaskConfig } from "@teamsland/types";

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
 * };
 * ```
 */
export interface AssemblerOptions {
  /** 全局应用配置 */
  config: AppConfig;
  /** Meego 项目到 Git 仓库的映射 */
  repoMapping: RepoMapping;
}

/**
 * 动态初始提示词组装器
 *
 * 在每次 Claude Code 进程启动前调用，将 2 个信息段组装为结构化提示词。
 * 由 Sidecar 在 spawn Agent 进程时注入为初始上下文。
 *
 * 2 段结构：
 * - §A — Issue 上下文（task.meegoEvent + task.description）
 * - §D — 仓库信息（repoMapping.resolve + task.worktreePath）
 *
 * @example
 * ```typescript
 * import { DynamicContextAssembler } from "@teamsland/context";
 *
 * const assembler = new DynamicContextAssembler({
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 * });
 * const prompt = await assembler.buildInitialPrompt(task, "team-001");
 * // 返回包含 §A/§D 两段的完整提示词字符串
 * ```
 */
export class DynamicContextAssembler {
  private readonly config: AppConfig;
  private readonly repoMapping: RepoMapping;

  constructor(opts: AssemblerOptions) {
    this.config = opts.config;
    this.repoMapping = opts.repoMapping;
  }

  /**
   * 组装 Agent 启动时的初始提示词（2 段结构）
   *
   * 并发执行 2 段内容构建（Promise.all），总延迟由最慢的一段决定。
   *
   * - §A — Issue 上下文
   * - §D — 仓库信息
   *
   * @param task - 当前任务配置
   * @param teamId - 团队 ID
   * @returns 组装完成的提示词字符串
   *
   * @example
   * ```typescript
   * const prompt = await assembler.buildInitialPrompt(task, "team-alpha");
   * // prompt 示例：
   * // ## §A — Issue 上下文
   * // Issue ID: ISSUE-123
   * // ...
   * // ## §D — 仓库信息
   * // ...
   * ```
   */
  async buildInitialPrompt(task: TaskConfig, teamId: string): Promise<string> {
    return withSpan("context:assembler", "DynamicContextAssembler.buildInitialPrompt", async (span) => {
      span.setAttribute("issue.id", task.issueId);
      span.setAttribute("team.id", teamId);
      logger.info({ issueId: task.issueId, teamId }, "开始组装初始提示词");

      const [sectionA, sectionD] = await Promise.all([this.buildSectionA(task), this.buildSectionD(task)]);

      const prompt = [sectionA, sectionD].join("\n\n");
      span.setAttribute("prompt.length", prompt.length);
      span.setAttribute("prompt.sections", 2);
      logger.info({ issueId: task.issueId, promptLength: prompt.length }, "初始提示词组装完成");
      return prompt;
    });
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

  /** §D — 仓库信息 */
  private buildSectionD(task: TaskConfig): Promise<string> {
    const repos = this.repoMapping.resolve(task.meegoProjectId);
    logger.debug({ meegoProjectId: task.meegoProjectId, repoCount: repos.length }, "解析仓库路径");
    const repoLines = repos.map((r) => `- ${r.name}: ${r.path}`);
    const lines = ["## §D — 仓库信息", ...repoLines, `工作树路径: ${task.worktreePath}`];
    return Promise.resolve(lines.join("\n"));
  }
}
