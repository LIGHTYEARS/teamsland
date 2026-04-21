import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionConfig } from "@teamsland/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionDB } from "../session-db.js";

const TEST_CONFIG: SessionConfig = {
  compactionTokenThreshold: 100,
  sqliteJitterRangeMs: [0, 1],
  busyTimeoutMs: 5000,
};

describe("SessionDB 并发 WAL 写入", () => {
  let db: SessionDB;
  let dbPath: string;

  beforeAll(() => {
    dbPath = join(tmpdir(), `session-wal-concurrent-${randomUUID()}.sqlite`);
    db = new SessionDB(dbPath, TEST_CONFIG);
  });

  afterAll(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // 文件可能不存在
    }
  });

  it("10 个并发 appendMessage 调用全部成功且无 SQLITE_BUSY 错误", async () => {
    const sessionId = `sess-concurrent-${randomUUID()}`;
    await db.createSession({ sessionId, teamId: "team-concurrent" });

    const concurrency = 10;
    const promises = Array.from({ length: concurrency }, (_, i) =>
      db.appendMessage({
        sessionId,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `并发消息 ${i}`,
        traceId: `trace-${i}`,
      }),
    );

    // 所有 10 个 Promise 同时 fire，WAL 模式下不应出现 SQLITE_BUSY 错误
    const results = await Promise.all(promises);

    // 所有 10 个调用均返回有效的自增 ID
    expect(results).toHaveLength(concurrency);
    for (const id of results) {
      expect(id).toBeGreaterThan(0);
    }

    // 所有 ID 唯一，无覆写
    const uniqueIds = new Set(results);
    expect(uniqueIds.size).toBe(concurrency);

    // 所有 10 条消息均已持久化并可查询
    const messages = db.getMessages(sessionId);
    expect(messages).toHaveLength(concurrency);

    // 验证内容完整性——每条预期消息都能检索到
    const contents = new Set(messages.map((m) => m.content));
    for (let i = 0; i < concurrency; i++) {
      expect(contents.has(`并发消息 ${i}`)).toBe(true);
    }
  });

  it("多个会话的并发写入互不干扰", async () => {
    const sessions = Array.from({ length: 3 }, (_, i) => `sess-multi-${i}-${randomUUID()}`);
    for (const sid of sessions) {
      await db.createSession({ sessionId: sid, teamId: "team-multi" });
    }

    // 每个会话各发起 5 次写入，共 15 个并发写入
    const promises: Promise<number>[] = [];
    for (const sid of sessions) {
      for (let i = 0; i < 5; i++) {
        promises.push(
          db.appendMessage({
            sessionId: sid,
            role: "user",
            content: `跨会话消息 ${sid.slice(-8)}-${i}`,
          }),
        );
      }
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(15);

    // 每个会话恰好有 5 条消息，互不干扰
    for (const sid of sessions) {
      const messages = db.getMessages(sid);
      expect(messages).toHaveLength(5);
    }
  });
});
