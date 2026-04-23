import { createLogger } from "@teamsland/observability";
import type { DiagnosisReadyPayload, QueueMessage } from "@teamsland/queue";
import { toCoordinatorEvent } from "./coordinator-event-mapper.js";
import type { EventHandlerDeps } from "./event-handlers.js";

const logger = createLogger("server:events");

/**
 * 诊断报告结构
 *
 * Observer Worker 输出的 JSON 诊断结果。
 */
interface DiagnosisReport {
  /** 诊断裁定（retry_loop / persistent_error / stuck / waiting_input / unknown） */
  verdict: string;
  /** 建议操作（interrupt / let_continue / inject_hint） */
  recommendation: string;
  /** 分析说明 */
  analysis: string;
  /** 纠正指令（interrupt 时传递给接力 Worker） */
  correctionInstructions: string;
}

/**
 * 处理诊断就绪消息
 *
 * Observer Worker 完成诊断后的后续动作：
 * - interrupt: 中断目标 Worker 并通过 ResumeController 恢复
 * - let_continue: 不做任何操作
 * - inject_hint: 向 Coordinator 委托处理
 *
 * @param msg - 队列消息
 * @param deps - 事件处理器依赖项
 *
 * @example
 * ```typescript
 * await handleDiagnosisReady(msg, deps);
 * ```
 */
export async function handleDiagnosisReady(msg: QueueMessage, deps: EventHandlerDeps): Promise<void> {
  const payload = msg.payload as DiagnosisReadyPayload;
  const { targetWorkerId, observerWorkerId, report } = payload;

  logger.info({ targetWorkerId, observerWorkerId, msgId: msg.id }, "处理诊断就绪消息");

  let diagnosis: DiagnosisReport;

  try {
    diagnosis = JSON.parse(report) as DiagnosisReport;
  } catch {
    logger.error({ report }, "诊断报告 JSON 解析失败，回退到 Coordinator 处理");
    if (deps.coordinatorManager) {
      const event = toCoordinatorEvent(msg);
      await deps.coordinatorManager.processEvent(event);
    }
    return;
  }

  logger.info({ targetWorkerId, verdict: diagnosis.verdict, recommendation: diagnosis.recommendation }, "诊断结论");

  if (diagnosis.recommendation === "interrupt" && deps.interruptController && deps.resumeController) {
    try {
      await deps.interruptController.interrupt({
        agentId: targetWorkerId,
        reason: diagnosis.analysis,
      });
      logger.info({ targetWorkerId }, "Worker 已根据诊断中断");

      const resumeResult = await deps.resumeController.resume({
        predecessorId: targetWorkerId,
        correctionInstructions: diagnosis.correctionInstructions,
      });
      logger.info({ newAgentId: resumeResult.newAgentId }, "Worker 已恢复");
    } catch (err: unknown) {
      logger.error({ err, targetWorkerId }, "中断/恢复流程失败");
    }
  } else if (diagnosis.recommendation === "let_continue") {
    logger.info({ targetWorkerId }, "诊断建议：继续运行");
  } else {
    if (deps.coordinatorManager) {
      const event = toCoordinatorEvent(msg);
      await deps.coordinatorManager.processEvent(event);
    }
  }
}
