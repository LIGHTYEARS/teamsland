// @teamsland/server — 配置加载与日志初始化模块

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "@teamsland/config";
import { createLogger, initTracing } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/**
 * 配置与日志初始化结果
 *
 * @example
 * ```typescript
 * import type { ConfigAndLoggingResult } from "./config-and-logging.js";
 *
 * const result: ConfigAndLoggingResult = await initConfigAndLogging();
 * result.logger.info("配置加载完成");
 * ```
 */
export interface ConfigAndLoggingResult {
  /** 应用配置 */
  config: AppConfig;
  /** 主日志记录器 */
  logger: ReturnType<typeof createLogger>;
  /** 全局 AbortController，用于优雅关闭 */
  controller: AbortController;
}

/**
 * 初始化配置加载、日志和追踪
 *
 * 执行以下步骤：
 * 1. 切换工作目录到项目根目录并确保 `data/` 目录存在
 * 2. 加载应用配置（`loadConfig`）
 * 3. 初始化 OpenTelemetry tracing
 * 4. 创建主日志记录器
 * 5. 创建全局 AbortController
 *
 * @returns 配置、日志记录器和 AbortController
 *
 * @example
 * ```typescript
 * import { initConfigAndLogging } from "./init/config-and-logging.js";
 *
 * const { config, logger, controller } = await initConfigAndLogging();
 * logger.info({ port: config.dashboard.port }, "配置加载完成");
 * ```
 */
export async function initConfigAndLogging(): Promise<ConfigAndLoggingResult> {
  // 确保数据目录存在
  const root = resolve(import.meta.dir, "../../../..");
  process.chdir(root);
  mkdirSync("data", { recursive: true });

  // 加载配置
  const config = await loadConfig();

  // Logger + Tracing
  initTracing("teamsland-server", "0.1.0");
  const logger = createLogger("server:main");

  // AbortController（优雅关闭信号源）
  const controller = new AbortController();

  return { config, logger, controller };
}
