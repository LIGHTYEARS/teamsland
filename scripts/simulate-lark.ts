#!/usr/bin/env bun
/**
 * 模拟飞书 @机器人 消息注入脚本
 *
 * 非侵入式地向运行中的 teamsland server 注入一条 lark_mention 消息，
 * 触发完整的事件处理链路：Queue → Coordinator → Brain → Worker。
 *
 * 用法:
 *   bun scripts/simulate-lark.ts                          — 使用默认消息
 *   bun scripts/simulate-lark.ts "帮我检查测试覆盖率"       — 自定义消息内容
 *   bun scripts/simulate-lark.ts --dry-run                — 仅打印 payload，不写入队列
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PersistentQueue } from "../packages/queue/src/persistent-queue.js";

// ── 配置 ──

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const QUEUE_DB_PATH = resolve(PROJECT_ROOT, "data/queue.sqlite");

// 必须与 config/config.json 中的 repoMapping / chatProjectMapping 一致
const CHAT_ID = "oc_3e8c9a4f5921e271c530644b6946fc34";
const PROJECT_KEY = "project_xxx";
const SENDER_ID = "ou_simulate_test_user";

// ── 参数解析 ──

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const messageText = args.find((a) => !a.startsWith("--")) ?? "请帮我查看当前项目的测试覆盖率情况，并给出优化建议。";

// ── 构造 payload ──

const now = Date.now();
const eventId = `sim-${randomUUID()}`;
const messageId = `om_sim_${randomUUID().slice(0, 8)}`;
const issueId = `SIM-${Date.now()}`;

const payload = {
  event: {
    eventId,
    issueId,
    projectKey: PROJECT_KEY,
    type: "issue.created" as const,
    payload: {
      title: messageText,
      description: `[模拟飞书消息] ${messageText}`,
    },
    timestamp: now,
  },
  chatId: CHAT_ID,
  senderId: SENDER_ID,
  messageId,
};

// ── 打印信息 ──

console.log("\n╔══════════════════════════════════════╗");
console.log("║   Teamsland 飞书消息模拟注入工具     ║");
console.log("╚══════════════════════════════════════╝\n");

console.log("消息内容:", messageText);
console.log("群聊 ID: ", CHAT_ID);
console.log("项目 Key:", PROJECT_KEY);
console.log("事件 ID: ", eventId);
console.log("消息 ID: ", messageId);
console.log("Issue ID:", issueId);

if (dryRun) {
  console.log("\n[DRY RUN] Payload:");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\n[DRY RUN] 未写入队列。去掉 --dry-run 参数以实际注入。");
  process.exit(0);
}

// ── 检查队列数据库 ──

if (!existsSync(QUEUE_DB_PATH)) {
  console.error(`\n❌ 队列数据库不存在: ${QUEUE_DB_PATH}`);
  console.error("   请先启动 server: bash scripts/start.sh server");
  process.exit(1);
}

// ── 注入消息 ──

const queue = new PersistentQueue({
  dbPath: QUEUE_DB_PATH,
  busyTimeoutMs: 5000,
  visibilityTimeoutMs: 60_000,
  maxRetries: 3,
  deadLetterEnabled: true,
  pollIntervalMs: 1000, // 注入脚本不需要快速轮询
});

const msgId = queue.enqueue({
  type: "lark_mention",
  payload,
  priority: "high",
  traceId: `sim-${randomUUID()}`,
});

queue.close();

if (msgId) {
  console.log(`\n✅ 消息已注入队列`);
  console.log(`   消息 ID: ${msgId}`);
  console.log(`   数据库:  ${QUEUE_DB_PATH}`);
  console.log("\n   如果 server 正在运行，消息将在 ~100ms 内被消费。");
  console.log("   使用 server 日志观察处理流程。");
} else {
  console.error("\n❌ 消息注入失败（可能是 traceId 重复）");
  process.exit(1);
}
