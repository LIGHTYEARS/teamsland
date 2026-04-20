import type { MemoryEntry } from "@teamsland/types";

/**
 * 计算两个向量的余弦相似度
 *
 * @param a - 向量 A
 * @param b - 向量 B
 * @returns 余弦相似度值，范围 [-1, 1]
 *
 * @example
 * ```typescript
 * import { cosineSimilarity } from "@teamsland/memory";
 *
 * const sim = cosineSimilarity([1, 0], [0, 1]);
 * console.log(sim); // 0
 * ```
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

/**
 * 实体合并去重（移植自 mem0）
 *
 * 对候选记忆条目按 embedding 余弦相似度去重。
 * 当两个条目的 cosine similarity >= threshold 时视为同一实体，
 * 保留 accessCount 更高的条目。
 *
 * 使用标记数组实现（条目数量 < 100，O(n²) 可接受）。
 *
 * @param entries - 候选记忆条目
 * @param embeddings - 条目 ID 到 embedding 向量的映射
 * @param threshold - 余弦相似度阈值，默认 0.95
 * @returns 去重后的条目列表
 *
 * @example
 * ```typescript
 * import { entityMerge } from "@teamsland/memory";
 *
 * const deduped = entityMerge(entries, embeddingMap, 0.95);
 * console.log(`去重后剩余 ${deduped.length} 条`);
 * ```
 */
/**
 * 将条目 i 与后续所有条目比较，标记应移除的索引。
 * 若条目 i 自身被标记移除则提前返回 true，让调用方跳过后续处理。
 */
function markDuplicates(
  i: number,
  entries: MemoryEntry[],
  embeddings: Map<string, number[]>,
  threshold: number,
  removed: Set<number>,
): boolean {
  const vecI = embeddings.get(entries[i].id);
  if (!vecI) return false;

  for (let j = i + 1; j < entries.length; j++) {
    if (removed.has(j)) continue;
    const vecJ = embeddings.get(entries[j].id);
    if (!vecJ) continue;

    const sim = cosineSimilarity(vecI, vecJ);
    if (sim < threshold) continue;

    if (entries[i].accessCount >= entries[j].accessCount) {
      removed.add(j);
    } else {
      removed.add(i);
      return true;
    }
  }
  return false;
}

export function entityMerge(
  entries: MemoryEntry[],
  embeddings: Map<string, number[]>,
  threshold = 0.95,
): MemoryEntry[] {
  if (entries.length <= 1) return [...entries];

  const removed = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (removed.has(i)) continue;
    markDuplicates(i, entries, embeddings, threshold, removed);
  }

  return entries.filter((_, idx) => !removed.has(idx));
}
