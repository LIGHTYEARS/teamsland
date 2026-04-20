import type { MemoryType } from "@teamsland/types";

/**
 * LLM 调用结果中的工具调用
 *
 * @example
 * ```typescript
 * import type { LlmToolCall } from "@teamsland/memory";
 *
 * const call: LlmToolCall = { name: "memory_search", args: { query: "团队偏好" } };
 * ```
 */
export interface LlmToolCall {
  /** 工具名称 */
  name: string;
  /** 工具参数 */
  args: Record<string, unknown>;
}

/**
 * LLM 调用返回值
 *
 * @example
 * ```typescript
 * import type { LlmResponse } from "@teamsland/memory";
 *
 * const resp: LlmResponse = {
 *   content: "分析完成",
 *   toolCalls: [{ name: "memory_search", args: { query: "决策记录" } }],
 * };
 * ```
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
  /** 工具调用列表（如有） */
  toolCalls?: LlmToolCall[];
}

/**
 * LLM 消息
 *
 * @example
 * ```typescript
 * import type { LlmMessage } from "@teamsland/memory";
 *
 * const msg: LlmMessage = { role: "user", content: "分析以下文档" };
 * ```
 */
export interface LlmMessage {
  /** 角色 */
  role: "system" | "user" | "assistant" | "tool";
  /** 消息内容 */
  content: string;
  /** 工具调用 ID（role=tool 时） */
  toolCallId?: string;
}

/**
 * LLM 工具定义
 *
 * @example
 * ```typescript
 * import type { LlmToolDef } from "@teamsland/memory";
 *
 * const tool: LlmToolDef = {
 *   name: "memory_search",
 *   description: "搜索记忆",
 *   parameters: { type: "object", properties: { query: { type: "string" } } },
 * };
 * ```
 */
export interface LlmToolDef {
  /** 工具名称 */
  name: string;
  /** 工具描述 */
  description: string;
  /** JSON Schema 参数定义 */
  parameters: Record<string, unknown>;
}

/**
 * LLM 客户端接口
 *
 * 抽象 LLM API 调用，允许测试中注入 FakeLlmClient。
 * 真实实现（包装 Claude API）由应用层在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient, LlmMessage } from "@teamsland/memory";
 *
 * async function ask(client: LlmClient, question: string): Promise<string> {
 *   const messages: LlmMessage[] = [{ role: "user", content: question }];
 *   const response = await client.chat(messages);
 *   return response.content;
 * }
 * ```
 */
export interface LlmClient {
  /** 发送对话并获取回复 */
  chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse>;
}

/**
 * 记忆操作类型
 *
 * @example
 * ```typescript
 * import type { MemoryOperationType } from "@teamsland/memory";
 *
 * const op: MemoryOperationType = "create";
 * ```
 */
export type MemoryOperationType = "create" | "update" | "delete";

/**
 * 单条记忆操作，由 ExtractLoop 提取产生
 *
 * @example
 * ```typescript
 * import type { MemoryOperation } from "@teamsland/memory";
 *
 * const op: MemoryOperation = {
 *   type: "create",
 *   memoryType: "decisions",
 *   content: "团队决定使用 React 替换 Vue",
 * };
 * ```
 */
export interface MemoryOperation {
  /** 操作类型 */
  type: MemoryOperationType;
  /** 记忆类型 */
  memoryType: MemoryType;
  /** 记忆内容 */
  content: string;
  /** 目标记忆 ID（update/delete 时必填） */
  targetId?: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * ExtractLoop 使用的 3 个工具定义
 *
 * @example
 * ```typescript
 * import { EXTRACT_TOOLS } from "@teamsland/memory";
 *
 * console.log(EXTRACT_TOOLS.map((t) => t.name));
 * // ["memory_read", "memory_search", "memory_ls"]
 * ```
 */
export const EXTRACT_TOOLS: LlmToolDef[] = [
  {
    name: "memory_read",
    description: "读取指定 ID 的记忆条目",
    parameters: {
      type: "object",
      properties: { entryId: { type: "string", description: "记忆条目 ID" } },
      required: ["entryId"],
    },
  },
  {
    name: "memory_search",
    description: "按关键词搜索记忆",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回条数上限" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_ls",
    description: "列出团队所有 L0 摘要",
    parameters: {
      type: "object",
      properties: { teamId: { type: "string", description: "团队 ID" } },
      required: ["teamId"],
    },
  },
];
