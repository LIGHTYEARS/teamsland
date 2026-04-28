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
export async function initViking(config: AppConfig, logger: ReturnType<typeof createLogger>): Promise<VikingResult> {
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
  await healthMonitor.start();
  logger.info({ baseUrl: config.openViking.baseUrl, healthy: healthMonitor.isHealthy }, "OpenViking 心跳监控已启动");

  return { healthMonitor, nullClient };
}

/**
 * 获取动态 Viking client
 *
 * 返回一个 Proxy 对象，每次方法调用都会根据心跳监控器的当前状态
 * 动态选择 realClient 或 nullClient。这避免了启动时序竞态导致
 * client 被固定为降级版本的问题。
 *
 * @example
 * ```typescript
 * const client = getVikingClient(viking);
 * // 即使启动时 health check 失败，后续恢复后自动使用 realClient
 * await client.find("query");
 * ```
 */
export function getVikingClient(viking: VikingResult): IVikingMemoryClient {
  if (!viking.healthMonitor) {
    return viking.nullClient;
  }
  const monitor = viking.healthMonitor;
  return new Proxy(viking.nullClient as IVikingMemoryClient, {
    get(_target, prop, receiver) {
      const current = monitor.client;
      const value = Reflect.get(current, prop, receiver);
      return typeof value === "function" ? value.bind(current) : value;
    },
  });
}
