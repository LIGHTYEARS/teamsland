import type { Logger } from "@teamsland/observability";
import type { ProcessController } from "./process-controller.js";
import type { SubagentRegistry } from "./registry.js";
import type { TranscriptReader } from "./transcript-reader.js";

/** 默认优雅停机等待时间（毫秒） */
const DEFAULT_GRACE_MS = 10_000;

/**
 * Agent 中断请求参数
 *
 * @example
 * ```typescript
 * import type { InterruptRequest } from "@teamsland/sidecar";
 *
 * const req: InterruptRequest = {
 *   agentId: "agent-001",
 *   reason: "用户手动中断",
 *   graceMs: 5000,
 * };
 * ```
 */
export interface InterruptRequest {
  /** 要中断的 Agent ID */
  agentId: string;
  /** 中断原因描述 */
  reason: string;
  /** 优雅停机等待时间（毫秒），默认 10000 */
  graceMs?: number;
}

/**
 * Agent 中断结果
 *
 * @example
 * ```typescript
 * import type { InterruptResult } from "@teamsland/sidecar";
 *
 * const result: InterruptResult = {
 *   terminated: true,
 *   method: "sigint",
 *   worktreePath: "/repos/frontend/.worktrees/req-42",
 *   transcriptPath: "/home/dev/.claude/projects/repos-frontend/sess-abc.jsonl",
 * };
 * ```
 */
export interface InterruptResult {
  /** 进程是否已终止 */
  terminated: boolean;
  /** 终止方式：sigint（优雅）、sigkill（强制）、already_dead（进程已退出） */
  method: "sigint" | "sigkill" | "already_dead";
  /** Agent 的 worktree 路径 */
  worktreePath: string;
  /** Transcript 文件路径 */
  transcriptPath: string;
}

/**
 * Agent 中断控制器
 *
 * 提供优雅中断 Agent 进程的能力。先发送 SIGINT 请求优雅退出，
 * 等待指定宽限期后若进程仍存活则发送 SIGKILL 强制终止。
 * 中断完成后更新注册表状态并返回 transcript 路径。
 *
 * @example
 * ```typescript
 * import { InterruptController, ProcessController, SubagentRegistry, TranscriptReader } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const logger = createLogger("sidecar:interrupt");
 * const controller = new InterruptController(processCtrl, registry, transcriptReader, logger);
 *
 * const result = await controller.interrupt({
 *   agentId: "agent-001",
 *   reason: "用户请求中断",
 *   graceMs: 5000,
 * });
 * console.log(result.method); // "sigint" | "sigkill" | "already_dead"
 * ```
 */
export class InterruptController {
  private readonly processCtrl: ProcessController;
  private readonly registry: SubagentRegistry;
  private readonly transcriptReader: TranscriptReader;
  private readonly logger: Logger;

  constructor(
    processCtrl: ProcessController,
    registry: SubagentRegistry,
    transcriptReader: TranscriptReader,
    logger: Logger,
  ) {
    this.processCtrl = processCtrl;
    this.registry = registry;
    this.transcriptReader = transcriptReader;
    this.logger = logger;
  }

  /**
   * 中断指定 Agent 进程
   *
   * 执行流程：
   * 1. 从注册表获取 AgentRecord，不存在则抛出错误
   * 2. 探测进程存活状态，已退出则直接标记为 interrupted
   * 3. 发送 SIGINT 信号请求优雅退出
   * 4. 等待 graceMs（默认 10 秒）
   * 5. 再次探测，仍存活则发送 SIGKILL 强制终止
   * 6. 更新注册表记录状态和中断原因
   * 7. 返回中断结果（含 transcript 路径）
   *
   * @param req - 中断请求参数
   * @returns 中断结果
   * @throws {Error} agentId 在注册表中不存在时抛出
   *
   * @example
   * ```typescript
   * const result = await controller.interrupt({
   *   agentId: "agent-001",
   *   reason: "任务方向偏离",
   * });
   * if (result.method === "sigkill") {
   *   logger.warn("进程未能优雅退出，已强制终止");
   * }
   * ```
   */
  async interrupt(req: InterruptRequest): Promise<InterruptResult> {
    const record = this.registry.get(req.agentId);
    if (!record) {
      throw new Error(`Agent 未找到: ${req.agentId}`);
    }

    const transcriptPath = this.transcriptReader.resolveTranscriptPath(record.worktreePath, record.sessionId);

    // 进程已退出
    if (!this.processCtrl.isAlive(record.pid)) {
      record.status = "interrupted";
      record.interruptReason = req.reason;
      this.logger.info({ agentId: req.agentId, pid: record.pid }, "进程已退出，直接标记为 interrupted");
      return {
        terminated: true,
        method: "already_dead",
        worktreePath: record.worktreePath,
        transcriptPath,
      };
    }

    // 发送 SIGINT
    this.processCtrl.interrupt(record.pid, false);
    this.logger.info({ agentId: req.agentId, pid: record.pid }, "已发送 SIGINT，等待优雅退出");

    const graceMs = req.graceMs ?? DEFAULT_GRACE_MS;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, graceMs);
    });

    // 检查是否仍存活
    let method: InterruptResult["method"] = "sigint";
    if (this.processCtrl.isAlive(record.pid)) {
      this.processCtrl.interrupt(record.pid, true);
      method = "sigkill";
      this.logger.warn({ agentId: req.agentId, pid: record.pid, graceMs }, "SIGINT 后进程仍存活，已发送 SIGKILL");
    }

    record.status = "interrupted";
    record.interruptReason = req.reason;

    this.logger.info({ agentId: req.agentId, method, transcriptPath }, "Agent 中断完成");

    return {
      terminated: true,
      method,
      worktreePath: record.worktreePath,
      transcriptPath,
    };
  }
}
