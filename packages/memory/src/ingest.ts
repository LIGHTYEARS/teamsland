import { createHash } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { ExtractLoop } from "./extract-loop.js";
import type { MemoryUpdater } from "./memory-updater.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

const logger = createLogger("memory:ingest");

/**
 * 文档摄入入口
 *
 * SHA256 去重 → ExtractLoop 提取 → MemoryUpdater 写入。
 * 失败时静默处理（最终一致性 — 下次摄入时重试）。
 *
 * @param doc - 文档文本内容
 * @param teamId - 团队 ID
 * @param agentId - Agent ID
 * @param store - TeamMemoryStore 实例
 * @param extractLoop - ExtractLoop 实例
 * @param updater - MemoryUpdater 实例
 *
 * @example
 * ```typescript
 * import { ingestDocument } from "@teamsland/memory";
 *
 * await ingestDocument(
 *   "团队会议纪要：决定使用 React 技术栈",
 *   "team-alpha",
 *   "agent-fe",
 *   store,
 *   extractLoop,
 *   updater,
 * );
 * ```
 */
export async function ingestDocument(
  doc: string,
  teamId: string,
  agentId: string,
  store: TeamMemoryStore,
  extractLoop: ExtractLoop,
  updater: MemoryUpdater,
): Promise<void> {
  const hash = createHash("sha256").update(doc).digest("hex");

  // 去重检查
  if (await store.exists(teamId, hash)) {
    logger.info({ teamId, hash }, "文档已存在，跳过摄入");
    return;
  }

  // 记录哈希（在提取前保存，保证幂等性）
  await store.saveRawCorpus(teamId, hash);
  logger.info({ teamId, hash, docLength: doc.length }, "文档摄入开始，raw_corpus 已记录");

  // 提取记忆操作并写入（失败时静默处理）
  try {
    const operations = await extractLoop.extract(doc);

    if (operations.length > 0) {
      await updater.applyOperations(operations, agentId, teamId);
      logger.info({ teamId, agentId, operationCount: operations.length }, "文档摄入完成，操作已应用");
    } else {
      logger.info({ teamId, hash }, "提取操作为空，无写入");
    }
  } catch (err: unknown) {
    logger.warn({ teamId, hash, err }, "摄入提取/写入阶段失败，已静默处理（下次摄入将重试）");
  }
}
