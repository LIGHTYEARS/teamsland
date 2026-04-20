/**
 * 告警通知器接口
 *
 * Alerter 使用此接口发送飞书卡片，解耦于 LarkNotifier 的具体实现。
 *
 * @example
 * ```typescript
 * import type { AlertNotifier } from "@teamsland/sidecar";
 * ```
 */
export interface AlertNotifier {
  /**
   * 发送飞书互动卡片
   *
   * @param channelId - 目标频道 ID
   * @param card - 卡片内容
   */
  sendCard(channelId: string, card: { title: string; content: string; timestamp: string }): Promise<void>;
}

/**
 * 飞书告警器
 *
 * 监控数值指标，超过阈值时发送飞书卡片告警。
 * 每个指标独立维护冷却窗口（默认 5 分钟），避免告警风暴。
 *
 * @example
 * ```typescript
 * import { Alerter } from "@teamsland/sidecar";
 *
 * const alerter = new Alerter({
 *   notifier: larkNotifier,
 *   channelId: "oc_team_channel",
 *   cooldownMs: 5 * 60 * 1000, // 5 分钟，默认值
 * });
 *
 * // 在健康检查循环中调用
 * await alerter.check("concurrent_agents", registry.runningCount(), 18);
 * await alerter.check("error_rate_pct", errorRate, 10);
 * ```
 */
export class Alerter {
  private readonly notifier: AlertNotifier;
  private readonly channelId: string;
  private readonly cooldownMs: number;
  /** 指标名 → 最后告警 Unix 毫秒 */
  private readonly cooldownMap = new Map<string, number>();

  constructor(opts: {
    /** 告警通知器（实现 AlertNotifier 接口） */
    notifier: AlertNotifier;
    /** 告警目标频道 ID */
    channelId: string;
    /** 每指标冷却时间（毫秒），默认 300000（5 分钟） */
    cooldownMs?: number;
  }) {
    this.notifier = opts.notifier;
    this.channelId = opts.channelId;
    this.cooldownMs = opts.cooldownMs ?? 300_000;
  }

  /**
   * 检查指标并在必要时发送告警
   *
   * 当 `value > threshold` 且该指标不在冷却窗口内时：
   * 1. 更新指标的最后告警时间戳
   * 2. 通过 AlertNotifier 向 channelId 发送飞书卡片
   * 3. 卡片内容包含：指标名、当前值、阈值、时间戳
   *
   * 若处于冷却期，静默跳过（不发送，不记录 warn）。
   *
   * @param metric - 指标名称（用于冷却 Map 的 key 和卡片标题）
   * @param value - 当前指标值
   * @param threshold - 告警阈值（严格超过则触发）
   *
   * @example
   * ```typescript
   * // 检查并发 Agent 数是否超过容量的 90%
   * await alerter.check(
   *   "concurrent_agents",
   *   registry.runningCount(),
   *   Math.floor(config.maxConcurrentSessions * 0.9),
   * );
   * ```
   */
  async check(metric: string, value: number, threshold: number): Promise<void> {
    if (value <= threshold) return;

    const lastFired = this.cooldownMap.get(metric) ?? 0;
    const now = Date.now();
    if (now - lastFired < this.cooldownMs) return;

    this.cooldownMap.set(metric, now);
    await this.notifier.sendCard(this.channelId, {
      title: `告警：${metric}`,
      content: `当前值 ${value} 超过阈值 ${threshold}`,
      timestamp: new Date(now).toISOString(),
    });
  }
}
