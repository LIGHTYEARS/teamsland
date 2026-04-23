import { randomUUID } from "node:crypto";
import type { Logger } from "@teamsland/observability";
import type { ClaudeMdInjector } from "./claude-md-injector.js";
import type { ProcessController } from "./process-controller.js";
import type { SubagentRegistry } from "./registry.js";
import type { SkillInjector } from "./skill-injector.js";
import type { TranscriptReader, TranscriptSummary } from "./transcript-reader.js";

/**
 * Agent 恢复请求参数
 *
 * @example
 * ```typescript
 * import type { ResumeRequest } from "@teamsland/sidecar";
 *
 * const req: ResumeRequest = {
 *   predecessorId: "agent-001",
 *   correctionInstructions: "请改用 React Server Components 实现",
 *   taskType: "frontend_dev",
 * };
 * ```
 */
export interface ResumeRequest {
  /** 前任 Agent ID（必须处于 interrupted 状态） */
  predecessorId: string;
  /** 纠正指令，指导接力 Worker 调整方向 */
  correctionInstructions: string;
  /** 任务类型，用于 Skill 重注入；省略时复用前任的原始类型 */
  taskType?: string;
}

/**
 * Agent 恢复结果
 *
 * @example
 * ```typescript
 * import type { ResumeResult } from "@teamsland/sidecar";
 *
 * const result: ResumeResult = {
 *   newAgentId: "agent-002",
 *   pid: 23456,
 *   worktreePath: "/repos/frontend/.worktrees/req-42",
 * };
 * ```
 */
export interface ResumeResult {
  /** 新 Agent ID */
  newAgentId: string;
  /** 新进程 PID */
  pid: number;
  /** 复用的 worktree 路径 */
  worktreePath: string;
}

/**
 * 构建接力 Worker 的恢复提示词
 *
 * 基于前任 Worker 的 transcript 摘要、中断原因、纠正指令和原始任务，
 * 生成指导接力 Worker 继续工作的完整提示词。
 *
 * @param summary - 前任 transcript 结构化摘要
 * @param interruptReason - 前任被中断的原因
 * @param correctionInstructions - 纠正指令
 * @param originalTask - 原始任务描述
 * @returns 格式化的恢复提示词
 *
 * @example
 * ```typescript
 * import { buildResumePrompt } from "@teamsland/sidecar";
 *
 * const prompt = buildResumePrompt(
 *   { totalEntries: 50, toolCalls: [], errors: [], lastAssistantMessage: "已完成一半", durationMs: 30000 },
 *   "方向偏离",
 *   "请改用 TypeScript 重写",
 *   "实现登录功能",
 * );
 * ```
 */
export function buildResumePrompt(
  summary: TranscriptSummary,
  interruptReason: string,
  correctionInstructions: string,
  originalTask: string,
): string {
  const toolCallsList = summary.toolCalls.map((tc) => `  - ${tc.name}${tc.isError ? " (失败)" : ""}`).join("\n");

  const errorsList = summary.errors.map((e) => `  - ${e.content}`).join("\n");

  return `你是一个接力 Worker，继续在此 worktree 中完成前任未完成的工作。

## 前任 Worker 的工作摘要
- 总条目数: ${String(summary.totalEntries)}
- 工具调用:
${toolCallsList || "  （无）"}
- 错误:
${errorsList || "  （无）"}
- 最后一条消息: ${summary.lastAssistantMessage || "（无）"}
- 运行时长: ${String(summary.durationMs)}ms

## 前任被打断的原因
${interruptReason}

## 纠正指令
${correctionInstructions}

## 原始任务描述
${originalTask}

## 你需要做的
1. 先用 \`git diff\` 和 \`git status\` 了解当前代码状态
2. 读取前任已修改的文件，理解已完成的工作
3. 基于纠正指令调整方向
4. 继续完成剩余工作
5. 完成后通过 teamsland-report 汇报结果`;
}

/**
 * Agent 恢复控制器
 *
 * 在被中断的 Agent 的同一 worktree 上启动接力 Worker。
 * 读取前任的 transcript 摘要作为上下文，重新注入 Skill 和 CLAUDE.md，
 * 然后 spawn 新进程并注册到 SubagentRegistry。
 *
 * @example
 * ```typescript
 * import { ResumeController } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const controller = new ResumeController(
 *   registry, transcriptReader, skillInjector, claudeMdInjector, processCtrl, logger,
 * );
 *
 * const result = await controller.resume({
 *   predecessorId: "agent-001",
 *   correctionInstructions: "请用 React 而非 Vue 实现",
 * });
 * console.log("新 Agent:", result.newAgentId, "PID:", result.pid);
 * ```
 */
export class ResumeController {
  private readonly registry: SubagentRegistry;
  private readonly transcriptReader: TranscriptReader;
  private readonly skillInjector: SkillInjector;
  private readonly claudeMdInjector: ClaudeMdInjector;
  private readonly processCtrl: ProcessController;
  private readonly logger: Logger;

  constructor(
    registry: SubagentRegistry,
    transcriptReader: TranscriptReader,
    skillInjector: SkillInjector,
    claudeMdInjector: ClaudeMdInjector,
    processCtrl: ProcessController,
    logger: Logger,
  ) {
    this.registry = registry;
    this.transcriptReader = transcriptReader;
    this.skillInjector = skillInjector;
    this.claudeMdInjector = claudeMdInjector;
    this.processCtrl = processCtrl;
    this.logger = logger;
  }

  /**
   * 在前任 Agent 的 worktree 上恢复执行
   *
   * 执行流程：
   * 1. 获取前任 AgentRecord，校验状态必须为 interrupted
   * 2. 读取前任 transcript 并生成结构化摘要
   * 3. 基于摘要、中断原因和纠正指令构建恢复提示词
   * 4. 重新注入 Skill 文件到 worktree
   * 5. 重新注入 CLAUDE.md 上下文
   * 6. 在同一 worktree 上 spawn 新进程
   * 7. 注册新 AgentRecord（关联 predecessorId）
   * 8. 返回恢复结果
   *
   * @param req - 恢复请求参数
   * @returns 恢复结果
   * @throws {Error} predecessorId 不存在或状态非 interrupted 时抛出
   *
   * @example
   * ```typescript
   * const result = await controller.resume({
   *   predecessorId: "agent-001",
   *   correctionInstructions: "改用 PostgreSQL 而非 MySQL",
   *   taskType: "backend_dev",
   * });
   * console.log("新 Agent 已启动:", result.newAgentId);
   * ```
   */
  async resume(req: ResumeRequest): Promise<ResumeResult> {
    const predecessor = this.registry.get(req.predecessorId);
    if (!predecessor) {
      throw new Error(`前任 Agent 未找到: ${req.predecessorId}`);
    }
    if (predecessor.status !== "interrupted") {
      throw new Error(`前任 Agent 状态不是 interrupted，当前状态: ${predecessor.status}`);
    }

    // 读取 transcript 并生成摘要
    const transcriptPath = this.transcriptReader.resolveTranscriptPath(predecessor.worktreePath, predecessor.sessionId);
    const readResult = await this.transcriptReader.read(transcriptPath);
    const summary = this.transcriptReader.summarizeStructured(readResult.entries);

    this.logger.info(
      {
        predecessorId: req.predecessorId,
        totalEntries: summary.totalEntries,
        errors: summary.errors.length,
      },
      "前任 transcript 摘要已生成",
    );

    // 构建恢复提示词
    const resumePrompt = buildResumePrompt(
      summary,
      predecessor.interruptReason ?? "未知原因",
      req.correctionInstructions,
      predecessor.taskPrompt ?? predecessor.taskBrief ?? "（未记录原始任务）",
    );

    // 重新注入 Skill
    const taskType = req.taskType ?? predecessor.workerType ?? "default";
    await this.skillInjector.inject({
      worktreePath: predecessor.worktreePath,
      taskType,
    });

    // 重新注入 CLAUDE.md
    await this.claudeMdInjector.inject(predecessor.worktreePath, {
      workerId: `resume-${randomUUID().slice(0, 8)}`,
      taskType,
      requester: predecessor.origin?.senderId ?? "unknown",
      issueId: predecessor.issueId,
      chatId: predecessor.origin?.chatId ?? "",
      messageId: predecessor.origin?.messageId ?? "",
      taskPrompt: resumePrompt,
      meegoApiBase: "",
      meegoPluginToken: "",
    });

    // Spawn 新进程
    const spawnResult = await this.processCtrl.spawn({
      issueId: predecessor.issueId,
      worktreePath: predecessor.worktreePath,
      initialPrompt: resumePrompt,
    });

    // 注册新 AgentRecord
    const newAgentId = `agent-${randomUUID().slice(0, 8)}`;
    this.registry.register({
      agentId: newAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      issueId: predecessor.issueId,
      worktreePath: predecessor.worktreePath,
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
      predecessorId: req.predecessorId,
      origin: predecessor.origin,
      taskBrief: predecessor.taskBrief,
      taskPrompt: predecessor.taskPrompt,
    });

    this.logger.info(
      {
        newAgentId,
        pid: spawnResult.pid,
        predecessorId: req.predecessorId,
        worktreePath: predecessor.worktreePath,
      },
      "接力 Worker 已启动",
    );

    return {
      newAgentId,
      pid: spawnResult.pid,
      worktreePath: predecessor.worktreePath,
    };
  }
}
