import type { IVikingMemoryClient } from "@teamsland/memory";
import { NullVikingMemoryClient, VikingHealthMonitor, VikingMemoryClient } from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/**
 * Viking 初始化结果
 *
 * @example
 * ```typescript
 * import type { VikingResult } from "./init/viking.js";
 *
 * const viking: VikingResult = await initViking(config, logger);
 * const client = viking.healthMonitor?.client ?? viking.nullClient;
 * ```
 */
export interface VikingResult {
  /** 心跳监控器（未配置 OpenViking 时为 null） */
  healthMonitor: VikingHealthMonitor | null;
  /** 降级 client（始终可用） */
  nullClient: NullVikingMemoryClient;
}

/**
 * 初始化 OpenViking 连接和心跳监控
 *
 * 如果 config.openViking 存在，创建真实 client 和心跳监控器。
 * 否则返回 null monitor + NullClient。
 *
 * @example
 * ```typescript
 * import { initViking } from "./init/viking.js";
 *
 * const viking = initViking(config, logger);
 * ```
 */
export function initViking(config: AppConfig, logger: ReturnType<typeof createLogger>): VikingResult {
  const nullClient = new NullVikingMemoryClient();

  if (!config.openViking) {
    logger.info("OpenViking 未配置，使用 NullVikingMemoryClient");
    return { healthMonitor: null, nullClient };
  }

  const realClient = new VikingMemoryClient(config.openViking);
  const healthMonitor = new VikingHealthMonitor(realClient, nullClient, {
    intervalMs: config.openViking.heartbeatIntervalMs,
    failThreshold: config.openViking.heartbeatFailThreshold,
  });
  healthMonitor.start();
  logger.info({ baseUrl: config.openViking.baseUrl }, "OpenViking 心跳监控已启动");

  return { healthMonitor, nullClient };
}

/**
 * 获取当前活跃的 Viking client
 *
 * @example
 * ```typescript
 * const client = getVikingClient(viking);
 * await client.find("query");
 * ```
 */
export function getVikingClient(viking: VikingResult): IVikingMemoryClient {
  return viking.healthMonitor?.client ?? viking.nullClient;
}
