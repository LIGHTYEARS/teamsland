import { createLogger } from "@teamsland/observability";
import type { MemoryConfig } from "@teamsland/types";
import { hotnessScore } from "./lifecycle.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

const logger = createLogger("memory:reaper");

/**
 * 记忆回收器
 *
 * 定期清理过期和低热度的记忆条目。
 * 由 main.ts 每 24h 调用一次。
 *
 * 回收策略：
 * 1. 跳过 exemptTypes 中的类型
 * 2. 超过 perTypeTtl 的条目 → 归档
 * 3. hotnessScore < 0.1 的条目 → 归档
 *
 * @example
 * ```typescript
 * import { MemoryReaper } from "@teamsland/memory";
 *
 * const reaper = new MemoryReaper(store, memoryConfig);
 * const stats = await reaper.reap();
 * console.log(`归档 ${stats.archived} 条，跳过 ${stats.skipped} 条`);
 * ```
 */
export class MemoryReaper {
  constructor(
    private readonly store: TeamMemoryStore,
    private readonly config: MemoryConfig,
  ) {}

  /**
   * 执行回收
   *
   * @returns 回收统计 { archived, skipped }
   *
   * @example
   * ```typescript
   * const stats = await reaper.reap();
   * console.log(stats);
   * ```
   */
  async reap(): Promise<{ archived: number; skipped: number }> {
    const entries = await this.store.listAll();
    let archived = 0;
    let skipped = 0;

    const exemptSet = new Set(this.config.exemptTypes);

    for (const entry of entries) {
      // 豁免类型跳过
      if (exemptSet.has(entry.memoryType)) {
        skipped++;
        continue;
      }

      // TTL 检查
      const ttl = this.config.perTypeTtl[entry.memoryType];
      if (ttl !== undefined) {
        const ageDays = (Date.now() - entry.updatedAt.getTime()) / 86_400_000;
        if (ageDays > ttl) {
          await this.store.archive(entry.id);
          archived++;
          continue;
        }
      }

      // 热度检查
      const score = hotnessScore(entry.accessCount, entry.updatedAt, this.config.decayHalfLifeDays);
      if (score < 0.1) {
        await this.store.archive(entry.id);
        archived++;
      } else {
        skipped++;
      }
    }

    logger.info({ archived, skipped }, "MemoryReaper 回收完成");
    return { archived, skipped };
  }
}
