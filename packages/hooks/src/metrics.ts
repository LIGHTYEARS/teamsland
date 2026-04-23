import type { HookMetrics, MetricsSnapshot } from "./types.js";

/** 滚动窗口最大条目数 */
const MAX_ROLLING_WINDOW = 1000;

/**
 * 计算已排序数组的百分位数值
 *
 * @param sorted - 已排序的数字数组（升序）
 * @param p - 百分位数（0-100）
 * @returns 对应百分位的数值，空数组返回 0
 *
 * @example
 * ```typescript
 * const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
 * const p50 = percentile(values, 50); // 5
 * const p99 = percentile(values, 99); // 10
 * ```
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Hook 指标收集器 — 实现 HookMetrics 接口，提供命中、错误和延迟的记录与快照能力
 *
 * 内部使用滚动窗口（每个 hook 最多保留 1000 条延迟记录）来控制内存消耗，
 * 并支持通过 `getSnapshot()` 生成包含 p50/p95/p99 百分位数的指标快照。
 *
 * @example
 * ```typescript
 * import { HookMetricsCollector } from "@teamsland/hooks";
 *
 * const collector = new HookMetricsCollector();
 * collector.recordHookHit("notify/on-create", "issue.created");
 * collector.recordHandleDuration("notify/on-create", 42);
 * collector.recordTierQueue();
 *
 * const snapshot = collector.getSnapshot();
 * // snapshot.hookHitCounts["notify/on-create"] === 1
 * // snapshot.tierDistribution.queue === 1
 * ```
 */
export class HookMetricsCollector implements HookMetrics {
  private hits = new Map<string, number>();
  private errors = new Map<string, number>();
  private matchDurations = new Map<string, number[]>();
  private handleDurations = new Map<string, number[]>();
  private tierDistribution = { hook: 0, queue: 0 };

  recordHookHit(hookId: string, _eventType: string): void {
    const current = this.hits.get(hookId) ?? 0;
    this.hits.set(hookId, current + 1);
    this.tierDistribution.hook += 1;
  }

  recordHookError(hookId: string, _eventType: string): void {
    const current = this.errors.get(hookId) ?? 0;
    this.errors.set(hookId, current + 1);
  }

  recordMatchDuration(hookId: string, durationMs: number): void {
    let durations = this.matchDurations.get(hookId);
    if (!durations) {
      durations = [];
      this.matchDurations.set(hookId, durations);
    }
    durations.push(durationMs);
    if (durations.length > MAX_ROLLING_WINDOW) {
      durations.shift();
    }
  }

  recordHandleDuration(hookId: string, durationMs: number): void {
    let durations = this.handleDurations.get(hookId);
    if (!durations) {
      durations = [];
      this.handleDurations.set(hookId, durations);
    }
    durations.push(durationMs);
    if (durations.length > MAX_ROLLING_WINDOW) {
      durations.shift();
    }
  }

  /**
   * 记录事件通过队列处理（非 hook 直接处理）
   *
   * 每次调用将 tierDistribution.queue 计数加 1。
   *
   * @example
   * ```typescript
   * const collector = new HookMetricsCollector();
   * collector.recordTierQueue();
   * const snapshot = collector.getSnapshot();
   * // snapshot.tierDistribution.queue === 1
   * ```
   */
  recordTierQueue(): void {
    this.tierDistribution.queue += 1;
  }

  /**
   * 生成指标快照，包含命中/错误计数、分层分布和延迟百分位数
   *
   * 对每个 hook 的 handle 阶段延迟数据计算 p50、p95 和 p99 百分位数。
   * 快照是当前状态的只读拷贝，生成后不受后续记录影响。
   *
   * @returns 包含分层分布、命中/错误计数和延迟百分位数的快照对象
   *
   * @example
   * ```typescript
   * import { HookMetricsCollector } from "@teamsland/hooks";
   *
   * const collector = new HookMetricsCollector();
   * collector.recordHookHit("my-hook", "issue.created");
   * collector.recordHandleDuration("my-hook", 10);
   * collector.recordHandleDuration("my-hook", 50);
   * collector.recordHandleDuration("my-hook", 200);
   *
   * const snapshot = collector.getSnapshot();
   * // snapshot.hookLatencies["my-hook"] => { p50: 10, p95: 200, p99: 200 }
   * ```
   */
  getSnapshot(): MetricsSnapshot {
    const hookHitCounts: Record<string, number> = {};
    for (const [hookId, count] of this.hits) {
      hookHitCounts[hookId] = count;
    }

    const hookErrorCounts: Record<string, number> = {};
    for (const [hookId, count] of this.errors) {
      hookErrorCounts[hookId] = count;
    }

    const hookLatencies: Record<string, { p50: number; p95: number; p99: number }> = {};
    for (const [hookId, durations] of this.handleDurations) {
      const sorted = [...durations].sort((a, b) => a - b);
      hookLatencies[hookId] = {
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
      };
    }

    return {
      tierDistribution: { ...this.tierDistribution },
      hookHitCounts,
      hookErrorCounts,
      hookLatencies,
    };
  }

  /**
   * 重置所有指标数据（主要用于测试）
   *
   * @example
   * ```typescript
   * const collector = new HookMetricsCollector();
   * collector.recordHookHit("my-hook", "issue.created");
   * collector.reset();
   * const snapshot = collector.getSnapshot();
   * // snapshot.hookHitCounts === {}
   * ```
   */
  reset(): void {
    this.hits.clear();
    this.errors.clear();
    this.matchDurations.clear();
    this.handleDurations.clear();
    this.tierDistribution = { hook: 0, queue: 0 };
  }
}
