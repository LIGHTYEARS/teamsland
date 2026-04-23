// @teamsland/server — 存储层初始化模块

import { Database } from "bun:sqlite";
import type { Embedder } from "@teamsland/memory";
import {
  checkVec0Available,
  LocalEmbedder,
  MemoryReaper,
  NullEmbedder,
  NullMemoryStore,
  TeamMemoryStore,
} from "@teamsland/memory";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

/** 默认团队 ID */
const TEAM_ID = "default";

import { SessionDB } from "@teamsland/session";

/**
 * 存储层初始化结果
 *
 * @example
 * ```typescript
 * import type { StorageResult } from "./storage.js";
 *
 * const storage: StorageResult = await initStorage(config, logger);
 * storage.sessionDb.getMessages("session-1", { limit: 10, offset: 0 });
 * ```
 */
export interface StorageResult {
  /** 会话数据库 */
  sessionDb: SessionDB;
  /** 事件去重数据库（内存 SQLite） */
  eventDb: Database;
  /** Embedding 模型（优雅降级为 NullEmbedder） */
  embedder: Embedder;
  /** 团队记忆存储（优雅降级为 NullMemoryStore） */
  memoryStore: TeamMemoryStore | NullMemoryStore;
  /** 记忆回收器（仅 TeamMemoryStore 可用时有值） */
  memoryReaper: MemoryReaper | null;
}

/**
 * 初始化存储层组件
 *
 * 按顺序初始化以下组件：
 * 1. SessionDB — SQLite 会话持久化
 * 2. 事件去重数据库 — 内存 SQLite
 * 3. Embedding — LocalEmbedder（5 分钟超时）或 NullEmbedder
 * 4. TeamMemoryStore — 需要 sqlite-vec 扩展，不可用时降级为 NullMemoryStore
 * 5. MemoryReaper — 仅在 TeamMemoryStore 可用时创建
 *
 * @param config - 应用配置
 * @param logger - 日志记录器
 * @returns 存储层所有组件
 *
 * @example
 * ```typescript
 * import { initStorage } from "./init/storage.js";
 *
 * const storage = await initStorage(config, logger);
 * logger.info("存储层初始化完成");
 * ```
 */
export async function initStorage(config: AppConfig, logger: ReturnType<typeof createLogger>): Promise<StorageResult> {
  // SessionDB
  const sessionDb = new SessionDB("data/sessions.sqlite", config.session);
  logger.info("SessionDB 已初始化");

  // 事件去重库（内存 SQLite）
  const eventDb = new Database(":memory:");
  logger.info("事件去重数据库已创建");

  // Embedding（优雅降级）
  let embedder: Embedder;
  try {
    const realEmbedder = new LocalEmbedder(config.storage.embedding);
    const initTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LocalEmbedder 初始化超时（5分钟）— 模型可能尚未下载")), 300_000);
    });
    await Promise.race([realEmbedder.init(), initTimeout]);
    embedder = realEmbedder;
    logger.info("LocalEmbedder 初始化完成");
  } catch (embErr: unknown) {
    logger.warn({ err: embErr }, "LocalEmbedder 初始化失败，使用 NullEmbedder");
    embedder = new NullEmbedder(config.storage.embedding.contextSize);
    await embedder.init();
  }

  // 团队记忆存储（优雅降级）
  let memoryStore: TeamMemoryStore | NullMemoryStore;
  const vec0Check = checkVec0Available();
  if (!vec0Check.ok) {
    logger.warn(
      { error: vec0Check.error },
      "sqlite-vec (vec0) 扩展不可用 — 向量记忆功能将降级为 NullMemoryStore。安装方法: bun add sqlite-vec",
    );
    memoryStore = new NullMemoryStore();
  } else {
    try {
      memoryStore = new TeamMemoryStore(TEAM_ID, config.storage, embedder);
      logger.info("TeamMemoryStore 已初始化（sqlite-vec 可用）");
    } catch (memErr: unknown) {
      logger.warn({ err: memErr }, "TeamMemoryStore 初始化失败，使用 NullMemoryStore");
      memoryStore = new NullMemoryStore();
    }
  }

  // 记忆回收器（仅在 TeamMemoryStore 可用时）
  const memoryReaper = memoryStore instanceof TeamMemoryStore ? new MemoryReaper(memoryStore, config.memory) : null;

  return { sessionDb, eventDb, embedder, memoryStore, memoryReaper };
}

/** 重导出 TEAM_ID 以供其他初始化模块使用 */
export { TEAM_ID };
