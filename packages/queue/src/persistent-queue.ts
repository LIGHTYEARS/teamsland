import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { createLogger } from "@teamsland/observability";
import type {
  QueueConfig,
  QueueMessage,
  QueueMessageStatus,
  QueueMessageType,
  QueuePayload,
  QueuePriority,
} from "./types.js";

const logger = createLogger("queue:persistent");

/**
 * SQLite 原始行类型（snake_case 列名）
 */
interface RawMessageRow {
  id: string;
  type: string;
  payload: string;
  priority: string;
  status: string;
  retry_count: number;
  max_retries: number;
  created_at: number;
  updated_at: number;
  scheduled_at: number;
  trace_id: string;
  last_error: string | null;
  processing_at: number | null;
}

/**
 * 入队参数
 *
 * 调用 `PersistentQueue.enqueue()` 时传入的选项。
 *
 * @example
 * ```typescript
 * import type { EnqueueOptions } from "@teamsland/queue";
 *
 * const opts: EnqueueOptions = {
 *   type: "lark_mention",
 *   payload: {
 *     event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *     chatId: "oc_xxx",
 *     senderId: "ou_xxx",
 *     messageId: "msg_xxx",
 *   },
 *   priority: "high",
 * };
 * ```
 */
export interface EnqueueOptions {
  /** 消息类型 */
  type: QueueMessageType;
  /** 消息负载 */
  payload: QueuePayload;
  /** 优先级（默认 "normal"） */
  priority?: QueuePriority;
  /** 延迟投递时间（Unix ms，默认为当前时间 = 立即可消费） */
  scheduledAt?: number;
  /** 最大重试次数（覆盖配置默认值） */
  maxRetries?: number;
  /** 链路追踪 ID（默认自动生成） */
  traceId?: string;
}

/**
 * 基于 SQLite WAL 模式的持久化消息队列
 *
 * 核心特性：
 * - 持久化：消息写入 SQLite WAL，进程崩溃后不丢失
 * - 顺序消费：按 priority（high > normal > low）+ scheduledAt + createdAt 排序
 * - 可见性超时：dequeue 后消息进入 "processing" 状态，超时未 ack 自动恢复为 "pending"
 * - 重试 + 死信：超过 maxRetries 的消息自动进入 dead letter
 * - 消费回调：注册 handler 后自动轮询消费
 *
 * @example
 * ```typescript
 * import { PersistentQueue } from "@teamsland/queue";
 *
 * const queue = new PersistentQueue({
 *   dbPath: "data/queue.sqlite",
 *   busyTimeoutMs: 5000,
 *   visibilityTimeoutMs: 60000,
 *   maxRetries: 3,
 *   deadLetterEnabled: true,
 *   pollIntervalMs: 100,
 * });
 *
 * const msgId = queue.enqueue({
 *   type: "meego_issue_created",
 *   payload: {
 *     event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
 *   },
 * });
 *
 * queue.consume(async (msg) => {
 *   console.log(msg.type, msg.payload);
 * });
 *
 * queue.close();
 * ```
 */
export class PersistentQueue {
  private readonly db: Database;
  private readonly config: QueueConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private handler: ((msg: QueueMessage) => Promise<void>) | null = null;
  private processing = false;
  private closed = false;

  constructor(config: QueueConfig) {
    this.config = config;
    this.db = new Database(config.dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`PRAGMA busy_timeout = ${config.busyTimeoutMs};`);
    this.initSchema();
    logger.info({ dbPath: config.dbPath }, "持久化消息队列已初始化");
  }

  /**
   * 入队一条消息
   *
   * 使用 INSERT OR IGNORE 实现 trace_id 去重。
   * 当 trace_id 重复时静默忽略并返回空字符串。
   *
   * @param opts - 入队参数
   * @returns 消息 ID，去重被忽略时返回空字符串
   *
   * @example
   * ```typescript
   * const id = queue.enqueue({
   *   type: "meego_issue_created",
   *   payload: {
   *     event: { eventId: "e1", issueId: "I1", projectKey: "P1", type: "issue.created", payload: {}, timestamp: 0 },
   *   },
   * });
   * ```
   */
  enqueue(opts: EnqueueOptions): string {
    this.assertNotClosed();
    const now = Date.now();
    const id = randomUUID();
    const traceId = opts.traceId ?? randomUUID();
    const priority = opts.priority ?? "normal";
    const scheduledAt = opts.scheduledAt ?? now;
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    const payloadJson = JSON.stringify(opts.payload);

    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO messages (id, type, payload, priority, status, retry_count, max_retries, created_at, updated_at, scheduled_at, trace_id, last_error, processing_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(id, opts.type, payloadJson, priority, maxRetries, now, now, scheduledAt, traceId);

    if (result.changes === 0) {
      logger.info({ traceId, type: opts.type }, "消息去重，trace_id 已存在");
      return "";
    }

    logger.info({ id, type: opts.type, priority, traceId }, "消息已入队");
    return id;
  }

  /**
   * 取出一条待处理消息（原子操作）
   *
   * 使用 SQLite 事务保证并发安全。
   * 消息状态从 "pending" 变为 "processing"，并设置 visibilityTimeout。
   *
   * @returns 消息对象，无可用消息时返回 null
   *
   * @example
   * ```typescript
   * const msg = queue.dequeue();
   * if (msg) {
   *   await processMessage(msg);
   *   queue.ack(msg.id);
   * }
   * ```
   */
  dequeue(): QueueMessage | null {
    this.assertNotClosed();
    const now = Date.now();

    const row = this.db.transaction(() => {
      const found = this.db
        .prepare(
          `SELECT * FROM messages
           WHERE status = 'pending' AND scheduled_at <= ?
           ORDER BY
             CASE priority
               WHEN 'high'   THEN 0
               WHEN 'normal' THEN 1
               WHEN 'low'    THEN 2
             END,
             created_at ASC
           LIMIT 1`,
        )
        .get(now) as RawMessageRow | null;

      if (!found) return null;

      this.db
        .prepare("UPDATE messages SET status = 'processing', processing_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, found.id);

      return { ...found, status: "processing", processing_at: now, updated_at: now };
    })();

    if (!row) return null;

    logger.info({ id: row.id, type: row.type }, "消息已出队");
    return this.mapRow(row);
  }

  /**
   * 查看队首消息但不取出
   *
   * 不改变消息状态，仅查看下一条可消费的消息。
   *
   * @returns 消息对象，无可用消息时返回 null
   *
   * @example
   * ```typescript
   * const next = queue.peek();
   * if (next) console.log("下一条:", next.type);
   * ```
   */
  peek(): QueueMessage | null {
    this.assertNotClosed();
    const now = Date.now();

    const row = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE status = 'pending' AND scheduled_at <= ?
         ORDER BY
           CASE priority
             WHEN 'high'   THEN 0
             WHEN 'normal' THEN 1
             WHEN 'low'    THEN 2
           END,
           created_at ASC
         LIMIT 1`,
      )
      .get(now) as RawMessageRow | null;

    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * 确认消息处理成功
   *
   * 将消息状态设置为 "completed"。
   *
   * @param messageId - 消息 ID
   *
   * @example
   * ```typescript
   * queue.ack(msg.id);
   * ```
   */
  ack(messageId: string): void {
    this.assertNotClosed();
    const now = Date.now();
    this.db
      .prepare("UPDATE messages SET status = 'completed', updated_at = ?, processing_at = NULL WHERE id = ?")
      .run(now, messageId);
    logger.info({ id: messageId }, "消息已确认完成");
  }

  /**
   * 消息处理失败，放回队列
   *
   * retryCount +1，如果超过 maxRetries 且启用死信则移入死信队列。
   * 否则状态恢复为 "pending"，可被再次消费。
   *
   * @param messageId - 消息 ID
   * @param error - 失败原因
   *
   * @example
   * ```typescript
   * queue.nack(msg.id, "LLM 调用超时");
   * ```
   */
  nack(messageId: string, error: string): void {
    this.assertNotClosed();
    const now = Date.now();

    const row = this.db.prepare("SELECT retry_count, max_retries FROM messages WHERE id = ?").get(messageId) as Pick<
      RawMessageRow,
      "retry_count" | "max_retries"
    > | null;

    if (!row) {
      logger.warn({ id: messageId }, "nack: 消息不存在");
      return;
    }

    const newRetryCount = row.retry_count + 1;

    if (this.config.deadLetterEnabled && newRetryCount >= row.max_retries) {
      this.db
        .prepare(
          "UPDATE messages SET status = 'dead', retry_count = ?, last_error = ?, updated_at = ?, processing_at = NULL WHERE id = ?",
        )
        .run(newRetryCount, error, now, messageId);
      logger.warn({ id: messageId, retryCount: newRetryCount }, "消息超过最大重试次数，进入死信队列");
    } else {
      this.db
        .prepare(
          "UPDATE messages SET status = 'pending', retry_count = ?, last_error = ?, updated_at = ?, processing_at = NULL WHERE id = ?",
        )
        .run(newRetryCount, error, now, messageId);
      logger.info({ id: messageId, retryCount: newRetryCount }, "消息处理失败，已放回队列");
    }
  }

  /**
   * 获取死信队列中的消息
   *
   * @param limit - 返回条数（默认 100）
   * @returns 死信消息列表
   *
   * @example
   * ```typescript
   * const deadLetters = queue.deadLetters(50);
   * ```
   */
  deadLetters(limit = 100): QueueMessage[] {
    this.assertNotClosed();
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE status = 'dead' ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as RawMessageRow[];

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * 注册消费回调并启动轮询
   *
   * 注册后队列会以 pollIntervalMs 间隔轮询，取到消息时调用 handler。
   * handler 正常返回视为 ack，抛异常视为 nack。
   *
   * @param handler - 消息处理函数
   *
   * @example
   * ```typescript
   * queue.consume(async (msg) => {
   *   if (msg.type === "lark_mention") {
   *     console.log("处理飞书消息", msg.payload);
   *   }
   * });
   * ```
   */
  consume(handler: (msg: QueueMessage) => Promise<void>): void {
    this.assertNotClosed();

    if (this.pollTimer) {
      logger.warn("已有消费者在运行，先停止旧的轮询");
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    this.handler = handler;

    this.pollTimer = setInterval(() => {
      void this.pollOnce();
    }, this.config.pollIntervalMs);

    // 超时恢复定时器：每 visibilityTimeout 周期检查一次
    this.recoveryTimer = setInterval(() => {
      this.recoverTimeouts();
    }, this.config.visibilityTimeoutMs);

    logger.info({ pollIntervalMs: this.config.pollIntervalMs }, "消费轮询已启动");
  }

  /**
   * 恢复超时的 processing 消息
   *
   * 将超过 visibilityTimeout 的 processing 消息恢复为 pending 或移入死信。
   *
   * @returns 恢复的消息数量
   *
   * @example
   * ```typescript
   * const recovered = queue.recoverTimeouts();
   * console.log(`恢复了 ${recovered} 条超时消息`);
   * ```
   */
  recoverTimeouts(): number {
    this.assertNotClosed();
    const now = Date.now();
    const threshold = now - this.config.visibilityTimeoutMs;

    const rows = this.db
      .prepare("SELECT id, retry_count, max_retries FROM messages WHERE status = 'processing' AND processing_at <= ?")
      .all(threshold) as Pick<RawMessageRow, "id" | "retry_count" | "max_retries">[];

    let recovered = 0;
    for (const row of rows) {
      const newRetryCount = row.retry_count + 1;

      if (this.config.deadLetterEnabled && newRetryCount >= row.max_retries) {
        this.db
          .prepare(
            "UPDATE messages SET status = 'dead', retry_count = ?, last_error = ?, updated_at = ?, processing_at = NULL WHERE id = ?",
          )
          .run(newRetryCount, "visibility timeout exceeded", now, row.id);
        logger.warn({ id: row.id }, "超时消息进入死信队列");
      } else {
        this.db
          .prepare(
            "UPDATE messages SET status = 'pending', retry_count = ?, last_error = ?, updated_at = ?, processing_at = NULL WHERE id = ?",
          )
          .run(newRetryCount, "visibility timeout exceeded", now, row.id);
        logger.info({ id: row.id }, "超时消息已恢复为 pending");
      }
      recovered++;
    }

    if (recovered > 0) {
      logger.info({ recovered }, "超时恢复完成");
    }

    return recovered;
  }

  /**
   * 获取队列统计信息
   *
   * @returns 各状态的消息数量
   *
   * @example
   * ```typescript
   * const stats = queue.stats();
   * console.log(stats);
   * // { pending: 5, processing: 1, completed: 100, failed: 2, dead: 0 }
   * ```
   */
  stats(): Record<QueueMessageStatus, number> {
    this.assertNotClosed();

    const result: Record<QueueMessageStatus, number> = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      dead: 0,
    };

    const rows = this.db.prepare("SELECT status, COUNT(*) as count FROM messages GROUP BY status").all() as Array<{
      status: string;
      count: number;
    }>;

    for (const row of rows) {
      if (row.status in result) {
        result[row.status as QueueMessageStatus] = row.count;
      }
    }

    return result;
  }

  /**
   * 清理已完成的消息（保留最近 N 天）
   *
   * @param retentionDays - 保留天数（默认 7）
   * @returns 清理的消息数量
   *
   * @example
   * ```typescript
   * const purged = queue.purgeCompleted(3);
   * console.log(`清理了 ${purged} 条已完成消息`);
   * ```
   */
  purgeCompleted(retentionDays = 7): number {
    this.assertNotClosed();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    const result = this.db.prepare("DELETE FROM messages WHERE status = 'completed' AND updated_at < ?").run(cutoff);

    const purged = result.changes;
    if (purged > 0) {
      logger.info({ purged, retentionDays }, "已清理过期的已完成消息");
    }

    return purged;
  }

  /**
   * 优雅关闭
   *
   * 停止轮询，关闭数据库连接。
   *
   * @example
   * ```typescript
   * queue.close();
   * ```
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }

    this.handler = null;
    this.db.close();
    logger.info("持久化消息队列已关闭");
  }

  // ─── Private Helpers ───

  /**
   * 初始化数据库 schema
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id            TEXT    PRIMARY KEY,
        type          TEXT    NOT NULL,
        payload       TEXT    NOT NULL,
        priority      TEXT    NOT NULL DEFAULT 'normal',
        status        TEXT    NOT NULL DEFAULT 'pending',
        retry_count   INTEGER NOT NULL DEFAULT 0,
        max_retries   INTEGER NOT NULL DEFAULT 3,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        scheduled_at  INTEGER NOT NULL,
        trace_id      TEXT    NOT NULL DEFAULT '',
        last_error    TEXT,
        processing_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_messages_consume
        ON messages (status, priority, scheduled_at, created_at)
        WHERE status = 'pending';

      CREATE INDEX IF NOT EXISTS idx_messages_processing
        ON messages (status, processing_at)
        WHERE status = 'processing';

      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_trace_id
        ON messages (trace_id)
        WHERE trace_id != '';

      CREATE INDEX IF NOT EXISTS idx_messages_dead
        ON messages (status, updated_at)
        WHERE status = 'dead';
    `);
  }

  /**
   * 将 SQLite 原始行转为 QueueMessage
   */
  private mapRow(row: RawMessageRow): QueueMessage {
    return {
      id: row.id,
      type: row.type as QueueMessageType,
      payload: JSON.parse(row.payload) as QueuePayload,
      priority: row.priority as QueuePriority,
      status: row.status as QueueMessageStatus,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      scheduledAt: row.scheduled_at,
      traceId: row.trace_id,
      lastError: row.last_error ?? undefined,
    };
  }

  /**
   * 单次轮询：取出一条消息并交给 handler 处理
   */
  private async pollOnce(): Promise<void> {
    if (this.processing || this.closed) return;

    this.processing = true;
    try {
      const msg = this.dequeue();
      if (!msg || !this.handler) return;

      try {
        await this.handler(msg);
        this.ack(msg.id);
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.nack(msg.id, errorMsg);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * 检查队列是否已关闭
   */
  private assertNotClosed(): void {
    if (this.closed) {
      throw new Error("PersistentQueue 已关闭，无法执行操作");
    }
  }
}
