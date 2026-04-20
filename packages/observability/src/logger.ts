import pino from "pino";

/**
 * Logger 类型别名，基于 pino.Logger
 *
 * 下游包通过 `import type { Logger }` 声明日志依赖，无需直接依赖 pino 包
 *
 * @example
 * ```typescript
 * import type { Logger } from "@teamsland/observability";
 *
 * function initService(logger: Logger): void {
 *   logger.info("服务启动");
 * }
 * ```
 */
export type Logger = pino.Logger;

/**
 * 创建带名称的结构化 logger 实例
 *
 * 输出 NDJSON 到 stdout。日志级别由 `LOG_LEVEL` 环境变量控制（默认 `info`）。
 * 设置 `LOG_PRETTY=true` 启用开发模式美化输出。
 *
 * @param name - logger 名称，标识日志来源模块
 * @returns pino Logger 实例
 *
 * @example
 * ```typescript
 * import { createLogger } from "@teamsland/observability";
 *
 * const logger = createLogger("config");
 * logger.info({ path: "config.json" }, "配置加载完成");
 * logger.error({ err: new Error("fail") }, "加载失败");
 *
 * const child = logger.child({ requestId: "req-001" });
 * child.info("处理请求");
 * ```
 */
export function createLogger(name: string): Logger {
  const level = process.env.LOG_LEVEL ?? "info";

  if (process.env.LOG_PRETTY === "true") {
    return pino({
      name,
      level,
      transport: { target: "pino-pretty" },
    });
  }

  return pino({ name, level });
}
