import type { LarkNotificationConfig } from "@teamsland/types";
import type { LarkCli } from "./lark-cli.js";
import type { LarkCard } from "./types.js";

/**
 * 飞书团队频道通知器
 *
 * 封装 LarkCli 的互动卡片发送能力，绑定到配置中的团队频道，
 * 提供简化的 sendCard API 用于发送不同级别的通知卡片
 *
 * @example
 * ```typescript
 * import { BunCommandRunner, LarkCli, LarkNotifier } from "@teamsland/lark";
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const config: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret_xxx",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "oc_team" },
 * };
 * const cli = new LarkCli(config, new BunCommandRunner());
 * const notifier = new LarkNotifier(cli, config.notification);
 * await notifier.sendCard("部署完成", "v1.0.0 已上线", "info");
 * ```
 */
export class LarkNotifier {
  private readonly channelId: string;

  constructor(
    private readonly cli: LarkCli,
    notificationConfig: LarkNotificationConfig,
  ) {
    this.channelId = notificationConfig.teamChannelId;
  }

  /**
   * 发送互动卡片到团队频道
   *
   * @param title - 卡片标题
   * @param content - 卡片内容
   * @param level - 通知级别，默认 "info"
   *
   * @example
   * ```typescript
   * await notifier.sendCard("构建成功", "main 分支构建通过");
   * await notifier.sendCard("构建失败", "lint 检查未通过", "error");
   * ```
   */
  async sendCard(title: string, content: string, level?: "info" | "warning" | "error"): Promise<void> {
    const card: LarkCard = { title, content, level: level ?? "info" };
    await this.cli.sendInteractiveCard(this.channelId, card);
  }

  /**
   * 向指定用户发送飞书私信
   *
   * @param userId - 接收人的飞书用户 ID
   * @param text - 消息文本内容
   *
   * @example
   * ```typescript
   * await notifier.sendDm("ou_user001", "任务 task-001 等待您确认，请尽快处理。");
   * ```
   */
  async sendDm(userId: string, text: string): Promise<void> {
    await this.cli.sendDm(userId, text);
  }
}
