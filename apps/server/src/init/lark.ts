// @teamsland/server — 飞书组件初始化模块

import { BunCommandRunner as LarkBunCommandRunner, LarkCli, LarkNotifier } from "@teamsland/lark";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/**
 * 飞书组件初始化结果
 *
 * @example
 * ```typescript
 * import type { LarkResult } from "./lark.js";
 *
 * const lark: LarkResult = initLark(config, logger);
 * await lark.larkCli.contactSearch("张三", 5);
 * ```
 */
export interface LarkResult {
  /** 飞书 CLI 客户端 */
  larkCli: LarkCli;
  /** 飞书通知器 */
  notifier: LarkNotifier;
}

/**
 * 初始化飞书相关组件
 *
 * 创建 LarkBunCommandRunner、LarkCli 和 LarkNotifier。
 * 这些组件用于飞书消息发送、联系人搜索等功能。
 *
 * @param config - 应用配置
 * @param logger - 日志记录器
 * @returns 飞书 CLI 和通知器
 *
 * @example
 * ```typescript
 * import { initLark } from "./init/lark.js";
 *
 * const lark = initLark(config, logger);
 * await lark.notifier.sendDm("user_id", "通知内容");
 * ```
 */
export function initLark(config: AppConfig, logger: ReturnType<typeof createLogger>): LarkResult {
  const larkCmdRunner = new LarkBunCommandRunner();
  const larkCli = new LarkCli(config.lark, larkCmdRunner);
  const notifier = new LarkNotifier(larkCli, config.lark.notification);

  logger.info("飞书组件初始化完成");

  return { larkCli, notifier };
}
