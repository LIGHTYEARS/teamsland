import type { Database } from "bun:sqlite";
import { createLogger } from "@teamsland/observability";
import type { EventHandler, MeegoEvent, MeegoEventType } from "@teamsland/types";

const logger = createLogger("meego:event-bus");

/**
 * @deprecated 使用 PersistentQueue 替代。此类在双写过渡期保留，后续版本将移除。
 *
 * Meego 事件总线
 *
 * 基于 bun:sqlite 实现崩溃安全的事件幂等去重，并将事件调度给已注册的处理器。
 * 使用 `seen_events` 表存储已处理的 event_id，重启后不会重复处理同一事件。
 *
 * @example
 * ```typescript
 * import { Database } from "bun:sqlite";
 * import { MeegoEventBus } from "@teamsland/meego";
 * import type { MeegoEvent } from "@teamsland/types";
 *
 * const db = new Database(":memory:");
 * const bus = new MeegoEventBus(db);
 *
 * bus.on("issue.created", {
 *   async process(event: MeegoEvent) {
 *     console.log("新 Issue:", event.issueId);
 *   },
 * });
 *
 * await bus.handle({
 *   eventId: "evt-001",
 *   issueId: "ISSUE-42",
 *   projectKey: "FE",
 *   type: "issue.created",
 *   payload: { title: "新增登录页面" },
 *   timestamp: Date.now(),
 * });
 * ```
 */
export class MeegoEventBus {
  private readonly db: Database;
  private readonly handlers: Map<MeegoEventType, EventHandler[]>;

  /**
   * 构造函数
   *
   * 接受外部传入的 `Database` 实例（便于测试注入内存库），
   * 并创建 `seen_events` 表（如不存在）。
   *
   * @param db - bun:sqlite Database 实例
   *
   * @example
   * ```typescript
   * import { Database } from "bun:sqlite";
   * const bus = new MeegoEventBus(new Database(":memory:"));
   * ```
   */
  constructor(db: Database) {
    this.db = db;
    this.handlers = new Map();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS seen_events (
        event_id   TEXT    PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);
    logger.debug("MeegoEventBus initialized");
  }

  /**
   * 注册事件处理器
   *
   * 同一事件类型可注册多个处理器，按注册顺序串行调用。
   *
   * @param eventType - 监听的事件类型
   * @param handler - 实现 EventHandler 接口的处理器
   *
   * @example
   * ```typescript
   * bus.on("issue.status_changed", {
   *   async process(event) {
   *     console.log(`Issue ${event.issueId} 状态变更`);
   *   },
   * });
   * ```
   */
  on(eventType: MeegoEventType, handler: EventHandler): void {
    const existing = this.handlers.get(eventType);
    if (existing) {
      existing.push(handler);
    } else {
      this.handlers.set(eventType, [handler]);
    }
  }

  /**
   * 处理单个事件
   *
   * 流程：查询 seen_events → 若已存在则跳过 → 写入 seen_events → 调度给 handlers。
   * 若该 eventType 无注册处理器，记录 warn 日志并返回。
   *
   * @param event - 待处理的 Meego 事件
   *
   * @example
   * ```typescript
   * await bus.handle({
   *   eventId: "evt-002",
   *   issueId: "ISSUE-43",
   *   projectKey: "FE",
   *   type: "issue.assigned",
   *   payload: { assignee: "user_001" },
   *   timestamp: Date.now(),
   * });
   * ```
   */
  async handle(event: MeegoEvent): Promise<void> {
    // 幂等检查
    const row = this.db.query("SELECT 1 FROM seen_events WHERE event_id = ?").get(event.eventId);
    if (row !== null) {
      logger.debug({ eventId: event.eventId }, "duplicate event, skipping");
      return;
    }

    // 写入已见记录
    this.db.run("INSERT INTO seen_events (event_id, created_at) VALUES (?, ?)", [event.eventId, Date.now()]);

    // 查找处理器
    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers || eventHandlers.length === 0) {
      logger.warn({ type: event.type }, "no handlers for event type");
      return;
    }

    logger.debug({ eventId: event.eventId, type: event.type, handlerCount: eventHandlers.length }, "dispatching event");

    // 串行调用所有处理器，单个失败不中断后续
    for (const handler of eventHandlers) {
      try {
        await handler.process(event);
      } catch (err) {
        logger.error({ eventId: event.eventId, type: event.type, error: err }, "handler error");
      }
    }
  }

  /**
   * 清理旧的已见事件记录
   *
   * 删除 `seen_events` 中 `created_at` 早于 `(Date.now() - maxAgeMs)` 的行。
   * 建议由应用层定期调用（例如每小时一次）。
   *
   * @param maxAgeMs - 保留时间窗口（毫秒），默认 3_600_000（1 小时）
   *
   * @example
   * ```typescript
   * // 清理 2 小时前的旧记录
   * bus.sweepSeenEvents(2 * 60 * 60 * 1000);
   * ```
   */
  sweepSeenEvents(maxAgeMs = 3_600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.run("DELETE FROM seen_events WHERE created_at <= ?", [cutoff]);
    logger.debug({ deleted: result.changes, cutoffMs: cutoff }, "swept seen_events");
  }
}
