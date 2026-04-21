/**
 * 记忆类型枚举
 *
 * 团队记忆系统支持的 12 种记忆分类，覆盖从个体偏好到项目上下文的全部语义域。
 *
 * @example
 * ```typescript
 * import type { MemoryType } from "@teamsland/types";
 *
 * const category: MemoryType = "entities";
 * ```
 */
export type MemoryType =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "cases"
  | "patterns"
  | "tools"
  | "skills"
  | "decisions"
  | "project_context"
  | "soul"
  | "identity";

/**
 * 记忆条目
 *
 * 单条记忆的完整数据结构。`toDict()` 和 `toVectorPoint()` 为方法签名，
 * 具体实现由 `@teamsland/memory` 提供。
 *
 * @example
 * ```typescript
 * import type { MemoryEntry } from "@teamsland/types";
 *
 * function logEntry(entry: MemoryEntry): void {
 *   console.log(`[${entry.memoryType}] ${entry.content} (accessed ${entry.accessCount}x)`);
 * }
 * ```
 */
export interface MemoryEntry {
  /** 记忆唯一标识 */
  id: string;
  /** 所属团队 ID */
  teamId: string;
  /** 所属 Agent ID */
  agentId: string;
  /** 记忆分类 */
  memoryType: MemoryType;
  /** 记忆文本内容 */
  content: string;
  /** 访问计数，用于热度衰减计算 */
  accessCount: number;
  /** 创建时间 */
  createdAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
  /** 可选的扩展元数据 */
  metadata?: Record<string, unknown>;
  /** 序列化为普通对象 */
  toDict(): Record<string, unknown>;
  /** 转换为向量存储点 */
  toVectorPoint(): { id: string; vector: number[]; payload: Record<string, unknown> };
}

/**
 * 记忆存储抽象接口
 *
 * 定义记忆读写的核心操作。具体实现（SQLite + Qdrant 混合存储）
 * 由 `@teamsland/memory` 包提供。
 *
 * @example
 * ```typescript
 * import type { AbstractMemoryStore, MemoryEntry } from "@teamsland/types";
 *
 * async function search(store: AbstractMemoryStore, vec: number[]): Promise<MemoryEntry[]> {
 *   return store.vectorSearch(vec, 10);
 * }
 * ```
 */
export interface AbstractMemoryStore {
  /** 向量相似度搜索 */
  vectorSearch(queryVec: number[], limit?: number): Promise<MemoryEntry[]>;
  /** 写入一条记忆 */
  writeEntry(entry: MemoryEntry): Promise<void>;
  /** 检查记忆是否已存在（按团队 + 内容哈希去重） */
  exists(teamId: string, hash: string): Promise<boolean>;
  /** 列出团队下所有记忆的摘要 */
  listAbstracts(teamId: string): Promise<MemoryEntry[]>;
  /** 批量递增检索命中条目的 access_count */
  incrementAccessCount(entryIds: string[]): void;
}
