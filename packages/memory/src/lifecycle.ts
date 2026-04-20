/**
 * 计算记忆条目的热度分数
 *
 * 使用 shifted sigmoid 衰减公式：
 *   score = accessCount / (1 + e^(k * (ageDays - 2 * halfLifeDays)))
 *
 * k = ln(2) / halfLifeDays
 *
 * 衰减曲线特征：
 * - age = 0         → score ≈ 0.80 * accessCount
 * - age = halfLife   → score ≈ 0.67 * accessCount
 * - age = 2*halfLife → score = 0.50 * accessCount（拐点）
 * - age = 3*halfLife → score ≈ 0.33 * accessCount
 *
 * @param accessCount - 访问计数
 * @param updatedAt - 最后更新时间
 * @param halfLifeDays - 半衰期（天），默认 7
 * @returns 热度分数（非负）
 *
 * @example
 * ```typescript
 * import { hotnessScore } from "@teamsland/memory";
 *
 * const score = hotnessScore(10, new Date("2026-04-01"), 7);
 * console.log(score); // 随 age 增长而衰减
 * ```
 */
export function hotnessScore(accessCount: number, updatedAt: Date, halfLifeDays = 7): number {
  const ageDays = (Date.now() - updatedAt.getTime()) / 86_400_000;
  const k = Math.log(2) / halfLifeDays;
  return accessCount / (1 + Math.exp(k * (ageDays - 2 * halfLifeDays)));
}
