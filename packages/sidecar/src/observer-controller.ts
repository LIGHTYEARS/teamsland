// @teamsland/sidecar — Observer Controller
// 生成观察者 Worker 以诊断异常 Worker

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@teamsland/observability";
import type { AgentRecord, OriginData } from "@teamsland/types";
import type { ProcessController } from "./process-controller.js";
import type { SubagentRegistry } from "./registry.js";
import type { TranscriptReader, TranscriptSummary } from "./transcript-reader.js";

/**
 * 观察请求
 *
 * @example
 * ```typescript
 * import type { ObserveRequest } from "@teamsland/sidecar";
 *
 * const req: ObserveRequest = {
 *   targetAgentId: "worker-001",
 *   anomalyType: "timeout",
 *   mode: "diagnosis",
 * };
 * ```
 */
export interface ObserveRequest {
  /** 目标 Worker ID */
  targetAgentId: string;
  /** 触发观察的异常类型 */
  anomalyType: string;
  /** 观察模式 */
  mode: "progress" | "quality" | "diagnosis";
}

/**
 * 观察结果
 *
 * @example
 * ```typescript
 * import type { ObserveResult } from "@teamsland/sidecar";
 *
 * const result: ObserveResult = {
 *   observerAgentId: "observer-abc",
 *   pid: 12345,
 *   sessionId: "sess-001",
 * };
 * ```
 */
export interface ObserveResult {
  /** 观察者 Worker ID */
  observerAgentId: string;
  /** 观察者进程 PID */
  pid: number;
  /** 观察者 Session ID */
  sessionId: string;
}

/**
 * 观察者控制器
 *
 * 生成 Observer Worker 以读取目标 Worker 的 transcript 并输出诊断报告。
 * Observer 运行在临时目录中，不需要 worktree。
 *
 * @example
 * ```typescript
 * import { ObserverController } from "@teamsland/sidecar";
 *
 * const controller = new ObserverController(registry, processCtrl, transcriptReader, logger);
 * const result = await controller.observe({
 *   targetAgentId: "worker-001",
 *   anomalyType: "timeout",
 *   mode: "diagnosis",
 * });
 * console.log(result.observerAgentId);
 * ```
 */
export class ObserverController {
  private readonly sessionDb?: {
    createSession: (params: {
      sessionId: string;
      teamId: string;
      agentId?: string;
      sessionType?: "coordinator" | "task_worker" | "observer_worker";
      source?: "meego" | "lark_mention" | "lark_dm" | "dashboard" | "coordinator";
      originData?: OriginData;
    }) => Promise<void>;
  };
  private readonly teamId: string;

  constructor(
    private readonly registry: SubagentRegistry,
    private readonly processCtrl: ProcessController,
    private readonly transcriptReader: TranscriptReader,
    private readonly logger: Logger,
    opts?: {
      sessionDb?: ObserverController["sessionDb"];
      teamId?: string;
    },
  ) {
    this.sessionDb = opts?.sessionDb;
    this.teamId = opts?.teamId ?? "default";
  }

  /**
   * 为目标 Worker 生成观察者
   *
   * @param req - 观察请求
   * @returns 观察者信息
   *
   * @example
   * ```typescript
   * const result = await controller.observe({
   *   targetAgentId: "worker-001",
   *   anomalyType: "crash",
   *   mode: "diagnosis",
   * });
   * ```
   */
  async observe(req: ObserveRequest): Promise<ObserveResult> {
    const target = this.registry.get(req.targetAgentId);
    if (!target) {
      throw new Error(`目标 Worker ${req.targetAgentId} 不存在`);
    }

    const transcriptPath = this.transcriptReader.resolveTranscriptPath(target.worktreePath, target.sessionId);
    const readResult = await this.transcriptReader.read(transcriptPath);
    const summary = this.transcriptReader.summarizeStructured(readResult.entries);

    const prompt = buildObserverPrompt(req.mode, target, summary, req.anomalyType);

    const tmpDir = join(tmpdir(), `observer-${randomUUID().slice(0, 8)}`);
    await mkdir(tmpDir, { recursive: true });

    const spawnResult = await this.processCtrl.spawn({
      issueId: `observer-${req.targetAgentId}`,
      worktreePath: tmpDir,
      initialPrompt: prompt,
    });

    const observerAgentId = `observer-${spawnResult.sessionId}`;

    this.registry.register({
      agentId: observerAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      issueId: `observer-${req.targetAgentId}`,
      worktreePath: tmpDir,
      status: "observing",
      workerType: "observer",
      observeTargetId: req.targetAgentId,
      retryCount: 0,
      createdAt: Date.now(),
    });

    if (this.sessionDb) {
      this.sessionDb
        .createSession({
          sessionId: spawnResult.sessionId,
          teamId: this.teamId,
          agentId: observerAgentId,
          sessionType: "observer_worker",
          source: "coordinator",
          originData: { observeTargetId: req.targetAgentId },
        })
        .catch((err: unknown) => {
          this.logger.error({ err, sessionId: spawnResult.sessionId }, "Observer session 注册失败");
        });
    }

    this.logger.info({ observerAgentId, targetAgentId: req.targetAgentId, mode: req.mode }, "Observer Worker 已启动");

    return {
      observerAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
    };
  }
}

/**
 * 构建观察者提示词
 *
 * @param mode - 观察模式
 * @param target - 目标 Worker 记录
 * @param summary - Transcript 结构化摘要
 * @param anomalyType - 异常类型描述
 * @returns 完整的提示词字符串
 *
 * @example
 * ```typescript
 * const prompt = buildObserverPrompt("diagnosis", target, summary, "timeout");
 * ```
 */
export function buildObserverPrompt(
  mode: "progress" | "quality" | "diagnosis",
  target: AgentRecord,
  summary: TranscriptSummary,
  anomalyType: string,
): string {
  const toolCallNames = summary.toolCalls.map((tc) => tc.name).join(", ") || "none";
  const errorMessages = summary.errors.length > 0 ? summary.errors.map((e) => e.content).join("\n  ") : "none";

  const base = [
    "You are an Observer agent. Your job is to diagnose why a worker agent is having trouble.",
    "",
    "## Target Worker",
    `- Agent ID: ${target.agentId}`,
    `- Task: ${target.taskPrompt ?? target.taskBrief ?? "未知任务"}`,
    `- Status: ${target.status}`,
    `- Anomaly: ${anomalyType}`,
    `- Running since: ${new Date(target.createdAt).toISOString()}`,
    "",
    "## Transcript Summary",
    `- Total entries: ${summary.totalEntries}`,
    `- Tool calls: ${toolCallNames}`,
    `- Errors: ${errorMessages}`,
    `- Last assistant message: ${summary.lastAssistantMessage || "none"}`,
    `- Duration: ${Math.round(summary.durationMs / 1000)}s`,
  ];

  if (mode === "diagnosis") {
    base.push(
      "",
      "## Your Task",
      "Analyze the transcript and produce a diagnosis. Output ONLY a JSON object:",
      "",
      "```json",
      "{",
      '  "verdict": "retry_loop" | "persistent_error" | "stuck" | "waiting_input" | "unknown",',
      '  "recommendation": "interrupt" | "let_continue" | "inject_hint",',
      '  "analysis": "Brief explanation of what went wrong",',
      '  "correctionInstructions": "If recommending interrupt+resume, what should the resumed worker do differently"',
      "}",
      "```",
    );
  } else if (mode === "progress") {
    base.push("", "## Your Task", "Summarize what the worker has accomplished so far. Output a brief progress report.");
  } else {
    base.push(
      "",
      "## Your Task",
      "Assess the quality of the worker's work. Output a verdict: good / needs_improvement / problematic.",
    );
  }

  return base.join("\n");
}
