import type { LarkNotifier } from "@teamsland/lark";
import { createLogger } from "@teamsland/observability";
import type { ConfirmationConfig } from "@teamsland/types";

const logger = createLogger("meego:confirmation");

/**
 * 构建提醒消息文本
 *
 * @param taskId - 任务 ID
 * @param reminderNumber - 当前是第几次提醒
 * @returns 格式化的提醒消息
 */
function reminderMessage(taskId: string, reminderNumber: number): string {
  return `[第 ${reminderNumber} 次提醒] 任务 ${taskId} 等待您确认，请尽快处理。`;
}

/**
 * 查询确认状态（占位实现）
 *
 * 当前版本始终返回 `"pending"`，接入真实 Meego API 时替换。
 *
 * @param taskId - 任务 ID
 * @returns 确认状态
 */
async function fetchConfirmationStatusImpl(taskId: string): Promise<"approved" | "rejected" | "pending"> {
  // 占位实现：始终返回 pending，等待真实 API 接入时替换
  void taskId;
  return "pending";
}

/**
 * 人工确认监视器
 *
 * 对指定 taskId 发起确认轮询，并按配置的间隔通过飞书私信提醒责任人。
 * 最多发送 `maxReminders` 次提醒，超过后返回 `"timeout"`。
 *
 * 确认状态通过内部 `fetchConfirmationStatus(taskId)` 查询，
 * 返回 `"approved"` 或 `"rejected"` 时立即返回结果。
 *
 * @example
 * ```typescript
 * import { ConfirmationWatcher } from "@teamsland/meego";
 * import { LarkNotifier } from "@teamsland/lark";
 *
 * declare const notifier: LarkNotifier;
 * const watcher = new ConfirmationWatcher({
 *   notifier,
 *   config: { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 },
 * });
 *
 * const result = await watcher.watch("task-001", "user_abc");
 * // result: "approved" | "rejected" | "timeout"
 * console.log("确认结果:", result);
 * ```
 */
export class ConfirmationWatcher {
  private readonly notifier: LarkNotifier;
  private readonly config: ConfirmationConfig;

  /**
   * @param opts.notifier - LarkNotifier 实例（用于发送飞书私信）
   * @param opts.config - 确认流程配置
   *
   * @example
   * ```typescript
   * const watcher = new ConfirmationWatcher({ notifier, config });
   * ```
   */
  constructor(opts: { notifier: LarkNotifier; config: ConfirmationConfig }) {
    this.notifier = opts.notifier;
    this.config = opts.config;
  }

  /**
   * 监听确认结果
   *
   * 每隔 `pollIntervalMs` 毫秒查询一次确认状态。
   * 每隔 `reminderIntervalMin` 分钟（转换为 poll 轮数）发送一次飞书私信提醒。
   * 提醒次数达到 `maxReminders` 后，下一次 poll 仍未确认则返回 `"timeout"`。
   *
   * @param taskId - 待确认的任务 ID
   * @param userId - 飞书用户 ID，用于发送私信提醒
   * @returns `"approved"` | `"rejected"` | `"timeout"`
   *
   * @example
   * ```typescript
   * const outcome = await watcher.watch("task-999", "user_xyz");
   * if (outcome === "approved") {
   *   console.log("已批准，继续执行");
   * } else if (outcome === "rejected") {
   *   console.log("已拒绝，中止操作");
   * } else {
   *   console.log("超时，升级处理");
   * }
   * ```
   */
  async watch(taskId: string, userId: string): Promise<"approved" | "rejected" | "timeout"> {
    const { reminderIntervalMin, maxReminders, pollIntervalMs } = this.config;
    const pollsPerReminder = Math.ceil((reminderIntervalMin * 60 * 1000) / pollIntervalMs);

    let pollCount = 0;
    let remindersSent = 0;

    logger.info({ taskId, userId, maxReminders, pollsPerReminder }, "watching confirmation");

    while (true) {
      const status = await this.fetchConfirmationStatus(taskId);

      if (status === "approved" || status === "rejected") {
        logger.info({ taskId, status, pollCount, remindersSent }, "confirmation resolved");
        return status;
      }

      pollCount++;

      if (pollCount % pollsPerReminder === 0) {
        if (remindersSent >= maxReminders) {
          logger.warn({ taskId, maxReminders, pollCount }, "confirmation timeout");
          return "timeout";
        }

        const msg = reminderMessage(taskId, remindersSent + 1);
        await this.notifier.sendDm(userId, msg);
        remindersSent++;
        logger.debug({ taskId, userId, remindersSent }, "reminder sent");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * 查询确认状态（可在测试中 mock 此方法）
   *
   * @param taskId - 任务 ID
   * @returns 确认状态
   */
  private async fetchConfirmationStatus(taskId: string): Promise<"approved" | "rejected" | "pending"> {
    return fetchConfirmationStatusImpl(taskId);
  }
}
