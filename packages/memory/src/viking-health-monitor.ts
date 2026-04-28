import { createLogger } from "@teamsland/observability";
import type { IVikingMemoryClient, NullVikingMemoryClient, VikingMemoryClient } from "./viking-memory-client.js";

const logger = createLogger("memory:viking-health");

/**
 * OpenViking 心跳监控器
 *
 * 定时调用 GET /health 检测 OpenViking server 可用性，
 * 连续失败超过阈值时自动切换到降级 client，恢复后自动切回。
 *
 * @example
 * ```typescript
 * import { VikingHealthMonitor } from "@teamsland/memory";
 *
 * const monitor = new VikingHealthMonitor(realClient, nullClient, {
 *   intervalMs: 30000,
 *   failThreshold: 3,
 * });
 * monitor.start();
 * const client = monitor.client; // 自动选择健康的 client
 * ```
 */
export class VikingHealthMonitor {
  private failCount = 0;
  private healthy = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly realClient: VikingMemoryClient,
    private readonly nullClient: NullVikingMemoryClient,
    private readonly config: { intervalMs: number; failThreshold: number },
  ) {}

  /** 当前应使用的 client */
  get client(): IVikingMemoryClient {
    return this.healthy ? this.realClient : this.nullClient;
  }

  /** 是否健康 */
  get isHealthy(): boolean {
    return this.healthy;
  }

  /** 启动心跳定时器（首次检查会 await，确保启动后 client 状态已确定） */
  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => this.check(), this.config.intervalMs);
  }

  /** 停止心跳 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const ok = await this.realClient.healthCheck();
    if (ok) {
      if (!this.healthy) {
        logger.info("OpenViking 连接已恢复");
      }
      this.failCount = 0;
      this.healthy = true;
    } else {
      this.failCount++;
      if (this.failCount >= this.config.failThreshold && this.healthy) {
        logger.warn({ failCount: this.failCount }, "OpenViking 连续心跳失败，切换到降级模式");
        this.healthy = false;
      }
    }
  }
}
