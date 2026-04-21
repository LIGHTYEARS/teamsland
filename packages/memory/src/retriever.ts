import type { MemoryEntry } from "@teamsland/types";
import type { Embedder } from "./embedder.js";
import { entityMerge } from "./entity-merge.js";
import { hotnessScore } from "./lifecycle.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

/**
 * 记忆检索 Pipeline
 *
 * 融合 L0 全量 + 向量语义搜索 + FTS5 BM25 + 实体合并 + hotnessScore 重排。
 *
 * Pipeline 步骤：
 * 1. L0 全量注入（listAbstracts）
 * 2. 向量语义搜索（embed query → vectorSearch）
 * 3. FTS5 BM25 搜索（ftsSearch）
 * 4. 合并 + entityMerge 去重
 * 5. hotnessScore 重排
 * 6. topK 截断（L0 在前，ranked 补齐）
 *
 * @param store - TeamMemoryStore 实例
 * @param embedder - Embedder 实例（用于生成查询向量）
 * @param query - 检索查询文本
 * @param teamId - 团队 ID
 * @param topK - 返回最多 topK 条结果，默认 10
 * @param mergeThreshold - entityMerge 余弦相似度阈值，默认 0.95
 * @returns 排序后的 MemoryEntry 列表，总数 <= topK
 *
 * @example
 * ```typescript
 * import { retrieve } from "@teamsland/memory";
 *
 * const results = await retrieve(store, embedder, "团队技术决策", "team-alpha");
 * for (const entry of results) {
 *   console.log(`[${entry.memoryType}] ${entry.content}`);
 * }
 * ```
 */
export async function retrieve(
  store: TeamMemoryStore,
  embedder: Embedder,
  query: string,
  teamId: string,
  topK = 10,
  mergeThreshold = 0.95,
): Promise<MemoryEntry[]> {
  // 1. L0 全量
  const l0Context = await store.listAbstracts(teamId);

  // 2. 向量搜索
  const queryVec = await embedder.embed(query);
  const vecResults = await store.vectorSearch(queryVec, 50);

  // 3. FTS5 搜索
  let ftsResults: MemoryEntry[] = [];
  try {
    ftsResults = store.ftsSearch(query, 50);
  } catch {
    // FTS5 MATCH 可能失败（短查询等），静默降级
  }

  // 4. 合并 + 去重
  const l0Ids = new Set(l0Context.map((e) => e.id));
  const merged = new Map<string, MemoryEntry>();
  for (const entry of [...vecResults, ...ftsResults]) {
    if (!l0Ids.has(entry.id) && !merged.has(entry.id)) {
      merged.set(entry.id, entry);
    }
  }

  const candidates = [...merged.values()];

  // 生成去重用的 embeddings
  const embeddings = new Map<string, number[]>();
  const texts = candidates.map((e) => e.content);
  if (texts.length > 0) {
    const vecs = await embedder.embedBatch(texts);
    for (let i = 0; i < candidates.length; i++) {
      embeddings.set(candidates[i].id, vecs[i]);
    }
  }

  const deduped = entityMerge(candidates, embeddings, mergeThreshold);

  // 4.5. 递增检索命中条目的 access_count
  const hitIds = deduped.map((e) => e.id);
  store.incrementAccessCount(hitIds);

  // 5. hotnessScore 重排
  const ranked = deduped.sort(
    (a, b) => hotnessScore(b.accessCount, b.updatedAt) - hotnessScore(a.accessCount, a.updatedAt),
  );

  // 6. topK 截断
  const rankedLimit = Math.max(0, topK - l0Context.length);
  return [...l0Context, ...ranked.slice(0, rankedLimit)];
}
