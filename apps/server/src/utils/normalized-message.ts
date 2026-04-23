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
 * 单个 JSONL 条目可能产生多条 NormalizedMessage，
 * 例如一个 assistant 回复中包含 text、tool_use、thinking 等多种 block。
 * 对无法解析的行返回空数组。
 *
 * @param line - 单行 JSONL 文本
 * @param sessionId - 所属 Session ID
 * @returns 解析后的 NormalizedMessage 数组
 *
 * @example
 * ```typescript
 * import { normalizeJsonlEntry } from "./normalized-message.js";
 *
 * const line = '{"role":"user","content":[{"type":"text","text":"你好"}]}';
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

  // system 类型消息
  if (entry.type === "system") {
    return [
      createNormalizedMessage({
        sessionId,
        kind: "status",
        text: typeof entry.message === "string" ? entry.message : "System message",
      }),
    ];
  }

  // summary 元数据消息 — 跳过
  if (entry.type === "summary") {
    return [];
  }

  const role = extractRole(entry);
  const messages: NormalizedMessage[] = [];

  // 处理 content 数组（Claude API 格式）
  if (Array.isArray(entry.content)) {
    const blocks = entry.content as Array<Record<string, unknown>>;
    for (const block of blocks) {
      const normalized = normalizeContentBlock(block, sessionId, role);
      if (normalized) messages.push(normalized);
    }
  }

  // 回退：简单 message 字段
  if (messages.length === 0 && typeof entry.message === "string") {
    messages.push(
      createNormalizedMessage({
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
 * @returns NormalizedMessage 或 null
 *
 * @example
 * ```typescript
 * const msg = normalizeContentBlock({ type: "text", text: "你好" }, "sess_abc", "assistant");
 * ```
 */
function normalizeContentBlock(
  block: Record<string, unknown>,
  sessionId: string,
  role: "user" | "assistant" | undefined,
): NormalizedMessage | null {
  if (block.type === "text" && typeof block.text === "string") {
    return createNormalizedMessage({
      sessionId,
      kind: "text",
      role,
      content: block.text,
    });
  }

  if (block.type === "tool_use") {
    return createNormalizedMessage({
      sessionId,
      kind: "tool_use",
      role: "assistant",
      toolName: typeof block.name === "string" ? block.name : undefined,
      toolInput: block.input,
      toolId: typeof block.id === "string" ? block.id : undefined,
    });
  }

  if (block.type === "tool_result") {
    return createNormalizedMessage({
      sessionId,
      kind: "tool_result",
      toolId: typeof block.tool_use_id === "string" ? block.tool_use_id : undefined,
      toolResult: {
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
        isError: block.is_error === true,
      },
    });
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    return createNormalizedMessage({
      sessionId,
      kind: "thinking",
      content: block.thinking,
    });
  }

  return null;
}
