// @teamsland/server — 存储层初始化模块

import { Database } from "bun:sqlite";
import type { createLogger } from "@teamsland/observability";
import { SessionDB } from "@teamsland/session";
import type { AppConfig } from "@teamsland/types";

/** 默认团队 ID */
const TEAM_ID = "default";

/**
 * 存储层初始化结果
 */
export interface StorageResult {
  /** 会话数据库 */
  sessionDb: SessionDB;
  /** 事件去重数据库（内存 SQLite） */
  eventDb: Database;
}

/**
 * 初始化存储层组件
 *
 * 按顺序初始化以下组件：
 * 1. SessionDB — SQLite 会话持久化
 * 2. 事件去重数据库 — 内存 SQLite
 *
 * @param config - 应用配置
 * @param logger - 日志记录器
 * @returns 存储层所有组件
 */
export async function initStorage(config: AppConfig, logger: ReturnType<typeof createLogger>): Promise<StorageResult> {
  // SessionDB
  const sessionDb = new SessionDB("data/sessions.sqlite", config.session);
  logger.info("SessionDB 已初始化");

  // 事件去重库（内存 SQLite）
  const eventDb = new Database(":memory:");
  logger.info("事件去重数据库已创建");

  return { sessionDb, eventDb };
}

/** 重导出 TEAM_ID 以供其他初始化模块使用 */
export { TEAM_ID };
