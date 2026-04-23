import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersistentQueue } from "../persistent-queue.js";
import type { QueueConfig, QueuePayload } from "../types.js";

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "queue-test-"));
}

function createConfig(dir: string, overrides?: Partial<QueueConfig>): QueueConfig {
  return {
    dbPath: join(dir, "queue.sqlite"),
    busyTimeoutMs: 5000,
    visibilityTimeoutMs: 60_000,
    maxRetries: 3,
    deadLetterEnabled: true,
    pollIntervalMs: 50,
    ...overrides,
  };
}

function makeMeegoPayload(): QueuePayload {
  return {
    event: {
      eventId: "evt-001",
      issueId: "ISSUE-42",
      projectKey: "FE",
      type: "issue.created",
      payload: { title: "测试工单" },
      timestamp: Date.now(),
    },
  };
}

function makeLarkPayload(): QueuePayload {
  return {
    event: {
      eventId: "evt-002",
      issueId: "ISSUE-43",
      projectKey: "FE",
      type: "issue.created",
      payload: { title: "测试飞书消息" },
      timestamp: Date.now(),
    },
    chatId: "oc_xxx",
    senderId: "ou_xxx",
    messageId: "msg_xxx",
  };
}

describe("PersistentQueue", () => {
  let tempDir: string;
  let queue: PersistentQueue;
  let config: QueueConfig;

  beforeEach(() => {
    tempDir = createTempDir();
    config = createConfig(tempDir);
    queue = new PersistentQueue(config);
  });

  afterEach(() => {
    try {
      queue.close();
    } catch {
      // 已关闭
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── 基本 enqueue + dequeue 流程 ──

  describe("enqueue + dequeue 基本流程", () => {
    it("应成功入队并出队一条消息", () => {
      const id = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
      });

      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);

      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
      expect(msg?.type).toBe("meego_issue_created");
      expect(msg?.status).toBe("processing");
      expect(msg?.retryCount).toBe(0);
      expect(msg?.priority).toBe("normal");
    });

    it("空队列 dequeue 应返回 null", () => {
      const msg = queue.dequeue();
      expect(msg).toBeNull();
    });

    it("入队多条消息应按 FIFO 顺序出队（同优先级）", () => {
      const id1 = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      const id2 = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      const id3 = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.id).toBe(id1);
      expect(msg2?.id).toBe(id2);
      expect(msg3?.id).toBe(id3);
    });
  });

  // ── 优先级排序 ──

  describe("优先级排序", () => {
    it("应按 high > normal > low 排序出队", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload(), priority: "low" });
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload(), priority: "high" });
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload(), priority: "normal" });

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();
      const msg3 = queue.dequeue();

      expect(msg1?.priority).toBe("high");
      expect(msg2?.priority).toBe("normal");
      expect(msg3?.priority).toBe("low");
    });

    it("同优先级消息应按创建时间 ASC 排序", () => {
      const id1 = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload(), priority: "high" });
      const id2 = queue.enqueue({ type: "lark_mention", payload: makeLarkPayload(), priority: "high" });

      const msg1 = queue.dequeue();
      const msg2 = queue.dequeue();

      expect(msg1?.id).toBe(id1);
      expect(msg2?.id).toBe(id2);
    });
  });

  // ── ack ──

  describe("ack", () => {
    it("ack 后消息不再被 dequeue", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      const msg = queue.dequeue();
      expect(msg?.id).toBe(id);

      queue.ack(id);

      const next = queue.dequeue();
      expect(next).toBeNull();
    });

    it("ack 后消息状态应为 completed", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.dequeue();
      queue.ack(id);

      const stats = queue.stats();
      expect(stats.completed).toBe(1);
      expect(stats.processing).toBe(0);
    });
  });

  // ── nack ──

  describe("nack", () => {
    it("nack 后 retryCount 应递增", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      // 第一次
      queue.dequeue();
      queue.nack(id, "错误1");

      const msg1 = queue.dequeue();
      expect(msg1?.retryCount).toBe(1);
      expect(msg1?.lastError).toBe("错误1");

      // 第二次
      queue.nack(id, "错误2");

      const msg2 = queue.dequeue();
      expect(msg2?.retryCount).toBe(2);
      expect(msg2?.lastError).toBe("错误2");
    });

    it("nack 后消息应恢复为 pending 可被再次 dequeue", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      queue.dequeue();
      queue.nack(id, "临时错误");

      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
      expect(msg?.status).toBe("processing");
    });

    it("nack 不存在的消息应安全忽略", () => {
      expect(() => queue.nack("nonexistent-id", "错误")).not.toThrow();
    });
  });

  // ── 死信队列 ──

  describe("dead letter", () => {
    it("超过 maxRetries 应进入死信队列", () => {
      const id = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        maxRetries: 2,
      });

      // 第一次失败
      queue.dequeue();
      queue.nack(id, "错误1");

      // 第二次失败 — 此时 retryCount = 2 >= maxRetries = 2，进入死信
      queue.dequeue();
      queue.nack(id, "错误2");

      // 不应该再 dequeue 到
      const next = queue.dequeue();
      expect(next).toBeNull();

      // 检查死信
      const dead = queue.deadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0].id).toBe(id);
      expect(dead[0].status).toBe("dead");
      expect(dead[0].retryCount).toBe(2);
      expect(dead[0].lastError).toBe("错误2");
    });

    it("禁用死信时超过 maxRetries 的消息应恢复为 pending", () => {
      queue.close();
      const noDlqConfig = createConfig(tempDir, { deadLetterEnabled: false });
      queue = new PersistentQueue(noDlqConfig);

      const id = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        maxRetries: 1,
      });

      queue.dequeue();
      queue.nack(id, "错误1");

      // 即使超过 maxRetries，也应该恢复为 pending
      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
      expect(msg?.retryCount).toBe(1);
    });
  });

  // ── visibility timeout + recoverTimeouts ──

  describe("visibility timeout", () => {
    it("超时的 processing 消息应被恢复为 pending", () => {
      queue.close();
      // 设置非常短的超时
      const shortConfig = createConfig(tempDir, { visibilityTimeoutMs: 1 });
      queue = new PersistentQueue(shortConfig);

      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.dequeue();

      // 等待超时
      const start = Date.now();
      while (Date.now() - start < 10) {
        // 忙等待一小会
      }

      const recovered = queue.recoverTimeouts();
      expect(recovered).toBe(1);

      // 应该可以再次 dequeue
      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
      expect(msg?.retryCount).toBe(1);
      expect(msg?.lastError).toBe("visibility timeout exceeded");
    });

    it("未超时的 processing 消息不应被恢复", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.dequeue();

      const recovered = queue.recoverTimeouts();
      expect(recovered).toBe(0);

      // 该消息仍在 processing，不应被 dequeue
      const next = queue.dequeue();
      expect(next).toBeNull();
    });

    it("超时后超过 maxRetries 的消息应进入死信", () => {
      queue.close();
      const shortConfig = createConfig(tempDir, { visibilityTimeoutMs: 1 });
      queue = new PersistentQueue(shortConfig);

      const id = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        maxRetries: 1,
      });

      // 第一次 dequeue + 超时
      queue.dequeue();
      const start = Date.now();
      while (Date.now() - start < 10) {
        // busy wait
      }
      queue.recoverTimeouts(); // retryCount = 1, maxRetries = 1 → dead

      const dead = queue.deadLetters();
      expect(dead).toHaveLength(1);
      expect(dead[0].id).toBe(id);
      expect(dead[0].status).toBe("dead");
    });
  });

  // ── trace_id 去重 ──

  describe("trace_id 去重", () => {
    it("相同 trace_id 入队两次只应有一条消息", () => {
      const id1 = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        traceId: "unique-trace-001",
      });
      const id2 = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        traceId: "unique-trace-001",
      });

      expect(id1).toBeTruthy();
      expect(id2).toBe(""); // 去重后返回空字符串

      const stats = queue.stats();
      expect(stats.pending).toBe(1);
    });

    it("不同 trace_id 应各自入队", () => {
      queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        traceId: "trace-001",
      });
      queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        traceId: "trace-002",
      });

      const stats = queue.stats();
      expect(stats.pending).toBe(2);
    });

    it("不指定 trace_id 时应自动生成不同的 trace_id", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      const stats = queue.stats();
      expect(stats.pending).toBe(2);
    });
  });

  // ── 数据库持久化 ──

  describe("数据库持久化", () => {
    it("关闭后重新打开应能看到之前的消息", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.close();

      // 重新打开
      queue = new PersistentQueue(config);

      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
      expect(msg?.type).toBe("meego_issue_created");
    });

    it("重新打开后统计应正确", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.enqueue({ type: "lark_mention", payload: makeLarkPayload() });

      const msg = queue.dequeue();
      if (msg) queue.ack(msg.id);

      queue.close();

      // 重新打开
      queue = new PersistentQueue(config);

      const stats = queue.stats();
      expect(stats.pending).toBe(1);
      expect(stats.completed).toBe(1);
    });
  });

  // ── WAL 模式 ──

  describe("WAL 模式", () => {
    it("数据库应使用 WAL 日志模式", () => {
      const db = new Database(config.dbPath, { readonly: true });
      const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(result.journal_mode).toBe("wal");
      db.close();
    });
  });

  // ── peek ──

  describe("peek", () => {
    it("应查看队首消息但不改变状态", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      const peeked = queue.peek();
      expect(peeked).not.toBeNull();
      expect(peeked?.status).toBe("pending");

      // 再次 peek 应返回同一条
      const peeked2 = queue.peek();
      expect(peeked2?.id).toBe(peeked?.id);

      // dequeue 也应返回同一条
      const dequeued = queue.dequeue();
      expect(dequeued?.id).toBe(peeked?.id);
    });

    it("空队列 peek 应返回 null", () => {
      const msg = queue.peek();
      expect(msg).toBeNull();
    });
  });

  // ── stats ──

  describe("stats", () => {
    it("应正确统计各状态的消息数量", () => {
      // 3 pending
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });

      let stats = queue.stats();
      expect(stats.pending).toBe(3);
      expect(stats.processing).toBe(0);

      // dequeue 1 → processing
      const msg1 = queue.dequeue();
      stats = queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);

      // ack 1 → completed
      if (msg1) queue.ack(msg1.id);
      stats = queue.stats();
      expect(stats.pending).toBe(2);
      expect(stats.completed).toBe(1);
    });

    it("空队列所有状态应为 0", () => {
      const stats = queue.stats();
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.dead).toBe(0);
    });
  });

  // ── purgeCompleted ──

  describe("purgeCompleted", () => {
    it("应清理超过保留天数的已完成消息", () => {
      const id = queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      const msg = queue.dequeue();
      if (msg) queue.ack(msg.id);

      // 手动将 updated_at 设置为 10 天前
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const db = new Database(config.dbPath);
      db.prepare("UPDATE messages SET updated_at = ? WHERE id = ?").run(tenDaysAgo, id);
      db.close();

      const purged = queue.purgeCompleted(7);
      expect(purged).toBe(1);

      const stats = queue.stats();
      expect(stats.completed).toBe(0);
    });

    it("不应清理保留期内的已完成消息", () => {
      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      const msg = queue.dequeue();
      if (msg) queue.ack(msg.id);

      const purged = queue.purgeCompleted(7);
      expect(purged).toBe(0);

      const stats = queue.stats();
      expect(stats.completed).toBe(1);
    });
  });

  // ── consume 回调模式 ──

  describe("consume", () => {
    it("应自动消费消息并调用 handler", async () => {
      const consumed: string[] = [];

      queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() });
      queue.enqueue({ type: "lark_mention", payload: makeLarkPayload() });

      queue.consume(async (msg) => {
        consumed.push(msg.id);
      });

      // 等待轮询消费
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(consumed).toHaveLength(2);

      const stats = queue.stats();
      expect(stats.completed).toBe(2);
      expect(stats.pending).toBe(0);
    });

    it("handler 抛异常应自动 nack", async () => {
      queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        maxRetries: 5,
      });

      let callCount = 0;
      queue.consume(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error("处理失败");
        }
      });

      // 等待轮询：3 次轮询（2 次失败 + 1 次成功）
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(callCount).toBe(3);

      const stats = queue.stats();
      expect(stats.completed).toBe(1);
    });
  });

  // ── 延迟投递 ──

  describe("延迟投递", () => {
    it("未到 scheduledAt 的消息不应被 dequeue", () => {
      const futureTime = Date.now() + 60_000;
      queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        scheduledAt: futureTime,
      });

      const msg = queue.dequeue();
      expect(msg).toBeNull();
    });

    it("已过 scheduledAt 的消息应正常 dequeue", () => {
      const pastTime = Date.now() - 1000;
      const id = queue.enqueue({
        type: "meego_issue_created",
        payload: makeMeegoPayload(),
        scheduledAt: pastTime,
      });

      const msg = queue.dequeue();
      expect(msg).not.toBeNull();
      expect(msg?.id).toBe(id);
    });
  });

  // ── 关闭后不可操作 ──

  describe("关闭后行为", () => {
    it("关闭后 enqueue 应抛异常", () => {
      queue.close();
      expect(() => queue.enqueue({ type: "meego_issue_created", payload: makeMeegoPayload() })).toThrow("已关闭");
    });

    it("关闭后 dequeue 应抛异常", () => {
      queue.close();
      expect(() => queue.dequeue()).toThrow("已关闭");
    });

    it("关闭后 stats 应抛异常", () => {
      queue.close();
      expect(() => queue.stats()).toThrow("已关闭");
    });

    it("重复 close 不应抛异常", () => {
      queue.close();
      expect(() => queue.close()).not.toThrow();
    });
  });

  // ── payload 序列化/反序列化 ──

  describe("payload 完整性", () => {
    it("入队的 payload 应在出队后保持完整", () => {
      const payload = makeLarkPayload();
      queue.enqueue({ type: "lark_mention", payload });

      const msg = queue.dequeue();
      expect(msg?.payload).toEqual(payload);
    });

    it("worker_completed 类型 payload 应正确序列化", () => {
      const payload: QueuePayload = {
        workerId: "worker-001",
        sessionId: "sess-001",
        issueId: "ISSUE-42",
        resultSummary: "任务完成",
      };

      queue.enqueue({ type: "worker_completed", payload });

      const msg = queue.dequeue();
      expect(msg?.payload).toEqual(payload);
      expect(msg?.type).toBe("worker_completed");
    });
  });
});
