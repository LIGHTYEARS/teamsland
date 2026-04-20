import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type { MemoryEntry, MemoryType } from "@teamsland/types";
import type { MemoryOperation } from "./llm-client.js";
import type { TeamMemoryStore } from "./team-memory-store.js";

const logger = createLogger("memory:updater");

/**
 * 创建完整的 MemoryEntry 对象
 *
 * @internal
 */
function createMemoryEntry(params: {
  id: string;
  teamId: string;
  agentId: string;
  memoryType: MemoryType;
  content: string;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}): MemoryEntry {
  return {
    id: params.id,
    teamId: params.teamId,
    agentId: params.agentId,
    memoryType: params.memoryType,
    content: params.content,
    accessCount: params.accessCount,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    metadata: params.metadata,
    toDict() {
      return {
        id: params.id,
        teamId: params.teamId,
        agentId: params.agentId,
        memoryType: params.memoryType,
        content: params.content,
        accessCount: params.accessCount,
        createdAt: params.createdAt.getTime(),
        updatedAt: params.updatedAt.getTime(),
        ...(params.metadata ? { metadata: params.metadata } : {}),
      };
    },
    toVectorPoint() {
      return {
        id: params.id,
        vector: [],
        payload: {
          content: params.content,
          memoryType: params.memoryType,
          teamId: params.teamId,
          agentId: params.agentId,
        },
      };
    },
  };
}

/**
 * 记忆更新器
 *
 * 将 ExtractLoop 产生的 MemoryOperation 批量写入 TeamMemoryStore。
 * 支持三种操作类型：create（新建）、update（更新内容）、delete（归档）。
 *
 * @example
 * ```typescript
 * import { MemoryUpdater } from "@teamsland/memory";
 * import type { MemoryOperation } from "@teamsland/memory";
 *
 * const updater = new MemoryUpdater(store);
 * const ops: MemoryOperation[] = [
 *   { type: "create", memoryType: "entities", content: "Alice 是前端工程师" },
 * ];
 * await updater.applyOperations(ops, "agent-1", "team-1");
 * ```
 */
export class MemoryUpdater {
  constructor(private readonly store: TeamMemoryStore) {}

  /**
   * 批量应用记忆操作
   *
   * 按操作数组顺序依次处理每条操作：
   * - `create`：生成 UUID、构造 MemoryEntry 并写入存储
   * - `update`：读取现有条目，替换内容后写回；目标不存在则记录警告并跳过
   * - `delete`：调用 store.archive() 归档；缺少 targetId 则跳过
   *
   * @param operations - 待处理的操作列表（可为空数组）
   * @param agentId - 发起操作的智能体 ID
   * @param teamId - 所属团队 ID
   *
   * @example
   * ```typescript
   * import { MemoryUpdater } from "@teamsland/memory";
   * import type { MemoryOperation } from "@teamsland/memory";
   *
   * const updater = new MemoryUpdater(store);
   *
   * const ops: MemoryOperation[] = [
   *   { type: "create", memoryType: "decisions", content: "采用 monorepo 架构" },
   *   { type: "update", memoryType: "entities", content: "Bob 晋升为 Tech Lead", targetId: "existing-id" },
   *   { type: "delete", memoryType: "events", content: "", targetId: "old-event-id" },
   * ];
   *
   * await updater.applyOperations(ops, "agent-1", "team-1");
   * ```
   */
  async applyOperations(operations: MemoryOperation[], agentId: string, teamId: string): Promise<void> {
    for (const op of operations) {
      switch (op.type) {
        case "create": {
          await this.handleCreate(op, agentId, teamId);
          break;
        }
        case "update": {
          await this.handleUpdate(op);
          break;
        }
        case "delete": {
          await this.handleDelete(op);
          break;
        }
      }
    }
  }

  /** 处理 create 操作 */
  private async handleCreate(op: MemoryOperation, agentId: string, teamId: string): Promise<void> {
    const now = new Date();
    const entry = createMemoryEntry({
      id: randomUUID(),
      teamId,
      agentId,
      memoryType: op.memoryType,
      content: op.content,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      metadata: op.metadata,
    });
    await this.store.writeEntry(entry);
    logger.info({ entryId: entry.id, memoryType: op.memoryType }, "记忆条目已创建");
  }

  /** 处理 update 操作 */
  private async handleUpdate(op: MemoryOperation): Promise<void> {
    if (!op.targetId) {
      logger.warn({ op }, "update 操作缺少 targetId，已跳过");
      return;
    }

    const existing = this.store.getEntry(op.targetId);
    if (!existing) {
      logger.warn({ targetId: op.targetId }, "update 目标条目不存在，已跳过");
      return;
    }

    const updated = createMemoryEntry({
      id: existing.id,
      teamId: existing.teamId,
      agentId: existing.agentId,
      memoryType: op.memoryType,
      content: op.content,
      accessCount: existing.accessCount,
      createdAt: existing.createdAt,
      updatedAt: new Date(),
      metadata: op.metadata ?? existing.metadata,
    });
    await this.store.writeEntry(updated);
    logger.info({ entryId: existing.id, memoryType: op.memoryType }, "记忆条目已更新");
  }

  /** 处理 delete 操作 */
  private async handleDelete(op: MemoryOperation): Promise<void> {
    if (!op.targetId) {
      logger.warn({ op }, "delete 操作缺少 targetId，已跳过");
      return;
    }

    await this.store.archive(op.targetId);
    logger.info({ entryId: op.targetId }, "记忆条目已归档");
  }
}
