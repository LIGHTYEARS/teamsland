/**
 * 写入抖动延迟
 *
 * 在 SQLite WAL 写入前引入随机延迟，减少多 Agent 并发写入时的锁竞争。
 * 延迟范围由 SessionConfig.sqliteJitterRangeMs 配置。
 *
 * @param range - [最小毫秒, 最大毫秒] 的延迟范围
 * @returns 延迟完成后 resolve 的 Promise
 *
 * @example
 * ```typescript
 * import { jitter } from "./jitter.js";
 *
 * await jitter([20, 150]);
 * // 等待 20~150ms 的随机延迟
 * ```
 */
export function jitter(range: [number, number]): Promise<void> {
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
