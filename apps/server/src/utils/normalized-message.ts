// @teamsland/server — 归一化消息工厂
// 将 JSONL Session 条目转换为统一的 NormalizedMessage 格式

import { randomUUID } from "node:crypto";
import type { MessageKind, NormalizedMessage } from "@teamsland/types";

/**
 * 创建归一化消息的必填字段
 *
 * @example
 * ```typescript
 * import type { CreateMessageInput } from "./normalized-message.js";
 *
 * const input: CreateMessageInput = {
 *   sessionId: "sess_abc",
 *   kind: "text",
 *   content: "你好",
 * };
 * ```
 */
export type CreateMessageInput = Partial<NormalizedMessage> & {
  sessionId: string;
  kind: MessageKind;
};

/**
 * 创建归一化消息实例
 *
 * 根据提供的部分字段创建完整的 NormalizedMessage 对象，
 * 自动生成 id 和 timestamp（若未提供）。
 *
 * @param partial - 部分消息字段，sessionId 和 kind 为必填
 * @returns 完整的 NormalizedMessage 实例
 *
 * @example
 * ```typescript
 * import { createNormalizedMessage } from "./normalized-message.js";
 *
 * const msg = createNormalizedMessage({
 *   sessionId: "sess_abc",
 *   kind: "text",
 *   role: "user",
 *   content: "帮我重构这个模块",
 * });
 * // => { id: "...", timestamp: "...", provider: "claude", sessionId: "sess_abc", kind: "text", ... }
 * ```
 */
export function createNormalizedMessage(partial: CreateMessageInput): NormalizedMessage {
  return {
    id: partial.id ?? randomUUID(),
    timestamp: partial.timestamp ?? new Date().toISOString(),
    provider: "claude",
    ...partial,
  };
}

/**
 * 从 JSONL Session 行解析为 NormalizedMessage 数组
 *
 * Claude Code 的 JSONL 条目格式为 `{ type, message?, attachment?, ... }`：
 * - `type: "user"` → `message: { role: "user", content: string | ContentBlock[] }`
 * - `type: "assistant"` → `message: { role: "assistant", content: ContentBlock[], model, usage }`
 * - `type: "system"` → 元数据状态行
 * - `type: "summary"` / `"attachment"` / `"permission-mode"` / `"file-history-snapshot"` → 跳过
 *
 * 单个条目可能产生多条 NormalizedMessage（如 assistant 回复包含 text + tool_use + thinking）。
 *
 * @param line - 单行 JSONL 文本
 * @param sessionId - 所属 Session ID
 * @returns 解析后的 NormalizedMessage 数组
 *
 * @example
 * ```typescript
 * import { normalizeJsonlEntry } from "./normalized-message.js";
 *
 * const line = '{"type":"user","message":{"role":"user","content":"你好"},"uuid":"abc"}';
 * const messages = normalizeJsonlEntry(line, "sess_abc");
 * // => [{ id: "...", kind: "text", role: "user", content: "你好", ... }]
 * ```
 */
export function normalizeJsonlEntry(line: string, sessionId: string): NormalizedMessage[] {
  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const entryType = entry.type;
  const uuid = typeof entry.uuid === "string" ? entry.uuid : undefined;
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;

  if (entryType === "system") {
    return normalizeSystemEntry(entry, sessionId, uuid, timestamp);
  }

  if (entryType === "result") {
    return normalizeResultEntry(entry, sessionId, uuid, timestamp);
  }

  if (entryType === "stream_event") {
    return normalizeStreamEvent(entry, sessionId, uuid, timestamp);
  }

  if (isSkippableType(entryType)) {
    return [];
  }

  if (entryType === "user" || entryType === "assistant") {
    return normalizeConversationEntry(entry, sessionId, uuid, timestamp);
  }

  return normalizeLegacyEntry(entry, sessionId, uuid, timestamp);
}

const SKIPPABLE_TYPES = new Set(["summary", "attachment", "permission-mode", "file-history-snapshot"]);

function isSkippableType(entryType: unknown): boolean {
  return typeof entryType === "string" && SKIPPABLE_TYPES.has(entryType);
}

function normalizeSystemEntry(
  entry: Record<string, unknown>,
  sessionId: string,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage[] {
  return [
    createNormalizedMessage({
      id: uuid,
      timestamp,
      sessionId,
      kind: "status",
      text: typeof entry.message === "string" ? entry.message : "System message",
    }),
  ];
}

/**
 * 归一化 Claude Code 的 result 条目（包含 cost/duration/token 统计）
 *
 * @example
 * ```typescript
 * const entry = { type: "result", total_cost_usd: 0.05, duration_ms: 12345, usage: { input_tokens: 5000, output_tokens: 1200 } };
 * const msgs = normalizeResultEntry(entry, "sess_abc", "uuid-1", undefined);
 * // => [{ kind: "complete", cost: 0.05, durationMs: 12345, tokens: 6200, ... }]
 * ```
 */
function normalizeResultEntry(
  entry: Record<string, unknown>,
  sessionId: string,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage[] {
  const cost = typeof entry.total_cost_usd === "number" ? entry.total_cost_usd : undefined;
  const durationMs = typeof entry.duration_ms === "number" ? entry.duration_ms : undefined;

  let tokens: number | undefined;
  const usage = entry.usage;
  if (usage && typeof usage === "object") {
    const u = usage as Record<string, unknown>;
    const inputTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
    const outputTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
    tokens = inputTokens + outputTokens;
  }

  const summary = typeof entry.result === "string" ? entry.result : undefined;

  return [
    createNormalizedMessage({
      id: uuid,
      timestamp,
      sessionId,
      kind: "complete",
      cost,
      durationMs,
      tokens,
      summary,
    }),
  ];
}

/**
 * 归一化 Claude CLI 的 stream_event 条目（增量流式事件）
 *
 * 将 `--include-partial-messages` 产生的 `stream_event` 转换为
 * `stream_delta`（文本增量）或 `stream_end`（流结束）消息。
 *
 * @example
 * ```typescript
 * const entry = { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } } };
 * const msgs = normalizeStreamEvent(entry, "sess_abc", "uuid-1", undefined);
 * // => [{ kind: "stream_delta", role: "assistant", content: "Hello", ... }]
 * ```
 */
function normalizeStreamEvent(
  entry: Record<string, unknown>,
  sessionId: string,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage[] {
  const event = entry.event;
  if (!event || typeof event !== "object") return [];
  const ev = event as Record<string, unknown>;
  const eventType = ev.type;

  if (eventType === "content_block_delta") {
    const delta = ev.delta as Record<string, unknown> | undefined;
    if (!delta) return [];
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      return [
        createNormalizedMessage({
          id: uuid,
          timestamp,
          sessionId,
          kind: "stream_delta",
          role: "assistant",
          content: delta.text,
        }),
      ];
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      return [
        createNormalizedMessage({
          id: uuid,
          timestamp,
          sessionId,
          kind: "stream_delta",
          role: "assistant",
          content: delta.thinking,
        }),
      ];
    }
    return [];
  }

  if (eventType === "message_stop") {
    return [
      createNormalizedMessage({
        id: uuid,
        timestamp,
        sessionId,
        kind: "stream_end",
        isFinal: true,
      }),
    ];
  }

  // content_block_start, content_block_stop, message_start, message_delta — 不需要渲染
  return [];
}

function normalizeLegacyEntry(
  entry: Record<string, unknown>,
  sessionId: string,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage[] {
  const role = extractRole(entry);
  const messages: NormalizedMessage[] = [];

  if (Array.isArray(entry.content)) {
    const blocks = entry.content as Array<Record<string, unknown>>;
    for (const block of blocks) {
      const normalized = normalizeContentBlock(block, sessionId, role, uuid, timestamp);
      if (normalized) messages.push(normalized);
    }
  }

  if (messages.length === 0 && typeof entry.message === "string") {
    messages.push(
      createNormalizedMessage({
        id: uuid,
        timestamp,
        sessionId,
        kind: "text",
        role,
        content: entry.message,
      }),
    );
  }

  return messages;
}

/**
 * 归一化 Claude Code 的 user/assistant 对话条目
 *
 * 解析 `entry.message` 中嵌套的 `{ role, content }` 结构。
 * content 可以是纯字符串（用户纯文本输入）或 ContentBlock 数组。
 *
 * @example
 * ```typescript
 * const entry = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "OK" }] } };
 * const msgs = normalizeConversationEntry(entry, "sess_abc", "uuid-1", "2026-04-23T00:00:00Z");
 * ```
 */
function normalizeConversationEntry(
  entry: Record<string, unknown>,
  sessionId: string,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage[] {
  const msg = entry.message;
  if (!msg || typeof msg !== "object") {
    return [];
  }
  const msgObj = msg as Record<string, unknown>;
  const role = msgObj.role === "user" ? ("user" as const) : ("assistant" as const);
  const content = msgObj.content;

  if (typeof content === "string") {
    return [
      createNormalizedMessage({
        id: uuid,
        timestamp,
        sessionId,
        kind: "text",
        role,
        content,
      }),
    ];
  }

  if (Array.isArray(content)) {
    const messages: NormalizedMessage[] = [];
    const blocks = content as Array<Record<string, unknown>>;
    for (const block of blocks) {
      const normalized = normalizeContentBlock(block, sessionId, role, uuid, timestamp);
      if (normalized) messages.push(normalized);
    }
    return messages;
  }

  return [];
}

/**
 * 从 JSONL 条目中提取角色信息
 *
 * @param entry - 解析后的 JSONL 对象
 * @returns 角色字符串，或 undefined
 *
 * @example
 * ```typescript
 * const role = extractRole({ role: "assistant" });
 * // => "assistant"
 * ```
 */
function extractRole(entry: Record<string, unknown>): "user" | "assistant" | undefined {
  if (entry.role === "user" || entry.role === "assistant") {
    return entry.role;
  }
  return undefined;
}

/**
 * 将单个 content block 转换为 NormalizedMessage
 *
 * 支持 text、tool_use、tool_result、thinking 四种 block 类型。
 * 不支持的 block 类型返回 null。
 *
 * @param block - content block 对象
 * @param sessionId - 所属 Session ID
 * @param role - 消息角色
 * @param uuid - 条目 UUID（可选，用作 ID 前缀）
 * @param timestamp - 条目时间戳（可选）
 * @returns NormalizedMessage 或 null
 *
 * @example
 * ```typescript
 * const msg = normalizeContentBlock({ type: "text", text: "你好" }, "sess_abc", "assistant", "uuid-1", undefined);
 * ```
 */
function normalizeContentBlock(
  block: Record<string, unknown>,
  sessionId: string,
  role: "user" | "assistant" | undefined,
  uuid: string | undefined,
  timestamp: string | undefined,
): NormalizedMessage | null {
  const blockId = typeof block.id === "string" ? block.id : undefined;
  const id = blockId ?? (uuid ? `${uuid}-${block.type}` : undefined);
  const base = { id, timestamp, sessionId };

  switch (block.type) {
    case "text":
      return normalizeTextBlock(block, base, role);
    case "tool_use":
      return normalizeToolUseBlock(block, base, blockId ?? id);
    case "tool_result":
      return normalizeToolResultBlock(block, base, id);
    case "thinking":
      return normalizeThinkingBlock(block, base);
    default:
      return null;
  }
}

function normalizeTextBlock(
  block: Record<string, unknown>,
  base: { id: string | undefined; timestamp: string | undefined; sessionId: string },
  role: "user" | "assistant" | undefined,
): NormalizedMessage | null {
  if (typeof block.text !== "string") return null;
  return createNormalizedMessage({ ...base, kind: "text", role, content: block.text });
}

function normalizeToolUseBlock(
  block: Record<string, unknown>,
  base: { id: string | undefined; timestamp: string | undefined; sessionId: string },
  id: string | undefined,
): NormalizedMessage {
  return createNormalizedMessage({
    ...base,
    id,
    kind: "tool_use",
    role: "assistant",
    toolName: typeof block.name === "string" ? block.name : undefined,
    toolInput: block.input,
    toolId: typeof block.id === "string" ? block.id : undefined,
  });
}

function normalizeToolResultBlock(
  block: Record<string, unknown>,
  base: { id: string | undefined; timestamp: string | undefined; sessionId: string },
  id: string | undefined,
): NormalizedMessage {
  return createNormalizedMessage({
    ...base,
    id,
    kind: "tool_result",
    toolId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
    toolResult: {
      content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
      isError: block.is_error === true,
    },
  });
}

function normalizeThinkingBlock(
  block: Record<string, unknown>,
  base: { id: string | undefined; timestamp: string | undefined; sessionId: string },
): NormalizedMessage | null {
  if (typeof block.thinking !== "string") return null;
  return createNormalizedMessage({ ...base, kind: "thinking", content: block.thinking });
}
