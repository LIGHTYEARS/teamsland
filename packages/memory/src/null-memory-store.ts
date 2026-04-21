import { createLogger } from "@teamsland/observability";
import type { AbstractMemoryStore, MemoryEntry } from "@teamsland/types";

const logger = createLogger("memory:null-store");

/**
 * 空操作记忆存储
 *
 * 当 sqlite-vec 扩展不可用时的降级替代。
 * 所有查询返回空结果，写入操作为空操作。
 *
 * @example
 * ```typescript
 * import { NullMemoryStore } from "@teamsland/memory";
 *
 * const store = new NullMemoryStore();
 * const results = await store.vectorSearch([0.1, 0.2], 10);
 * // results: []
 * ```
 */
export class NullMemoryStore implements AbstractMemoryStore {
  async vectorSearch(_queryVec: number[], _limit?: number): Promise<MemoryEntry[]> {
    return [];
  }

  async writeEntry(_entry: MemoryEntry): Promise<void> {
    // 空操作 — sqlite-vec 不可用时不持久化
  }

  async exists(_teamId: string, _hash: string): Promise<boolean> {
    return false;
  }

  async listAbstracts(_teamId: string): Promise<MemoryEntry[]> {
    return [];
  }

  /**
   * 关闭存储（空操作）
   *
   * 实现与 TeamMemoryStore 相同的关闭接口，以便 main.ts 在关机时无需区分两种实现。
   *
   * @example
   * ```typescript
   * store.close();
   * ```
   */
  close(): void {
    logger.info("NullMemoryStore 已关闭");
  }

  /**
   * 优化 FTS5 索引（空操作）
   *
   * 实现与 TeamMemoryStore 相同的接口，以便调度任务无需区分两种实现。
   *
   * @example
   * ```typescript
   * store.optimizeFts5();
   * ```
   */
  optimizeFts5(): void {
    // 空操作 — 无 FTS5 索引可优化
  }

  /**
   * FTS5 全文搜索（始终返回空结果）
   *
   * 实现与 TeamMemoryStore 相同的接口，以便 retriever.ts 无需区分两种实现。
   *
   * @example
   * ```typescript
   * const results = store.ftsSearch("关键词", 5);
   * // results: []
   * ```
   */
  ftsSearch(_query: string, _limit?: number): MemoryEntry[] {
    return [];
  }
}
