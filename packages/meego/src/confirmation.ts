import type { LarkNotifier } from "@teamsland/lark";
import { createLogger } from "@teamsland/observability";
import type { ConfirmationConfig } from "@teamsland/types";

const logger = createLogger("meego:confirmation");

/** 从 Meego API 认可的确认状态映射 */
const APPROVED_STATUSES = new Set(["approved", "confirmed", "done", "resolved", "已确认", "已完成"]);
const REJECTED_STATUSES = new Set(["rejected", "denied", "cancelled", "已拒绝", "已取消"]);

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
 * Meego API 配置（用于确认状态查询）
 */
interface MeegoApiOpts {
  /** Meego OpenAPI 基础地址 */
  apiBaseUrl: string;
  /** 插件访问令牌 */
  pluginAccessToken: string;
}

/**
 * 查询 Meego 工作项状态并映射为确认结果
 *
 * 调用 `GET {apiBaseUrl}/{projectKey}/work_item/{issueId}` 获取工作项详情，
 * 根据 `status_key` 字段映射为 `approved` / `rejected` / `pending`。
 *
 * @param apiBaseUrl - Meego OpenAPI 基础地址
 * @param token - 插件访问令牌
 * @param projectKey - Meego 项目/空间 ID
 * @param issueId - 工作项 ID
 * @returns 确认状态
 */
async function fetchStatusFromMeego(
  apiBaseUrl: string,
  token: string,
  projectKey: string,
  issueId: string,
): Promise<"approved" | "rejected" | "pending"> {
  const url = `${apiBaseUrl}/${projectKey}/work_item/${issueId}`;
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "X-Plugin-Token": token, "Content-Type": "application/json" },
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, issueId, projectKey }, "Meego 确认状态查询失败");
      return "pending";
    }

    const body = (await resp.json()) as { data?: { status_key?: string } };
    const statusKey = body.data?.status_key?.toLowerCase() ?? "";

    if (APPROVED_STATUSES.has(statusKey)) return "approved";
    if (REJECTED_STATUSES.has(statusKey)) return "rejected";
    return "pending";
  } catch (err: unknown) {
    logger.warn({ issueId, projectKey, err }, "Meego API 调用异常，视为 pending");
    return "pending";
  }
}

/**
 * 人工确认监视器
 *
 * 对指定 taskId 发起确认轮询，并按配置的间隔通过飞书私信提醒责任人。
 * 最多发送 `maxReminders` 次提醒，超过后返回 `"timeout"`。
 *
 * 确认状态通过 Meego OpenAPI 查询工作项状态，
 * 根据 `status_key` 字段映射为 `"approved"` / `"rejected"` / `"pending"`。
 * 当 Meego API 未配置（`pluginAccessToken` 为空）时回退到始终返回 `"pending"` 的占位实现。
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
 *   meego: { apiBaseUrl: "https://project.feishu.cn/open_api", pluginAccessToken: "token" },
 * });
 *
 * const result = await watcher.watch("ISSUE-42", "user_abc", "FE");
 * // result: "approved" | "rejected" | "timeout"
 * console.log("确认结果:", result);
 * ```
 */
export class ConfirmationWatcher {
  private readonly notifier: LarkNotifier;
  private readonly config: ConfirmationConfig;
  private readonly meego: MeegoApiOpts | null;

  /**
   * @param opts.notifier - LarkNotifier 实例（用于发送飞书私信）
   * @param opts.config - 确认流程配置
   * @param opts.meego - Meego API 配置（未提供时回退到占位实现）
   *
   * @example
   * ```typescript
   * const watcher = new ConfirmationWatcher({ notifier, config, meego: { apiBaseUrl, pluginAccessToken } });
   * ```
   */
  constructor(opts: { notifier: LarkNotifier; config: ConfirmationConfig; meego?: MeegoApiOpts }) {
    this.notifier = opts.notifier;
    this.config = opts.config;
    this.meego = opts.meego?.pluginAccessToken ? opts.meego : null;
    if (!this.meego) {
      logger.warn("Meego API 未配置或 pluginAccessToken 为空 — 确认状态查询将回退为占位实现");
    }
  }

  /**
   * 监听确认结果
   *
   * 每隔 `pollIntervalMs` 毫秒查询一次确认状态。
   * 每隔 `reminderIntervalMin` 分钟（转换为 poll 轮数）发送一次飞书私信提醒。
   * 提醒次数达到 `maxReminders` 后，下一次 poll 仍未确认则返回 `"timeout"`。
   *
   * @param taskId - 待确认的工作项 ID
   * @param userId - 飞书用户 ID，用于发送私信提醒
   * @param projectKey - Meego 项目/空间 ID（用于 API 查询）
   * @returns `"approved"` | `"rejected"` | `"timeout"`
   *
   * @example
   * ```typescript
   * const outcome = await watcher.watch("ISSUE-42", "user_xyz", "FE");
   * if (outcome === "approved") {
   *   console.log("已批准，继续执行");
   * }
   * ```
   */
  async watch(taskId: string, userId: string, projectKey?: string): Promise<"approved" | "rejected" | "timeout"> {
    const { reminderIntervalMin, maxReminders, pollIntervalMs } = this.config;
    const pollsPerReminder = Math.ceil((reminderIntervalMin * 60 * 1000) / pollIntervalMs);

    let pollCount = 0;
    let remindersSent = 0;

    logger.info({ taskId, userId, projectKey, maxReminders, pollsPerReminder }, "watching confirmation");

    while (true) {
      const status = await this.fetchConfirmationStatus(taskId, projectKey);

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
   * 当 Meego API 可用时调用真实接口，否则回退为 pending 占位。
   *
   * @param taskId - 工作项 ID
   * @param projectKey - 项目/空间 ID
   * @returns 确认状态
   */
  private async fetchConfirmationStatus(
    taskId: string,
    projectKey?: string,
  ): Promise<"approved" | "rejected" | "pending"> {
    if (this.meego && projectKey) {
      return fetchStatusFromMeego(this.meego.apiBaseUrl, this.meego.pluginAccessToken, projectKey, taskId);
    }
    return "pending";
  }
}
