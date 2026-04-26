import { createLogger } from "@teamsland/observability";
import type { LlmConfig } from "@teamsland/types";

/** LLM 消息 */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

/** LLM 工具定义 */
export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** LLM 工具调用 */
interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** LLM 响应 */
export interface LlmResponse {
  content: string;
  toolCalls?: LlmToolCall[];
}

/** LLM 客户端接口 */
export interface LlmClient {
  chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse>;
}

const logger = createLogger("server:llm");

/** Anthropic Messages API 的 content block 类型 */
interface AnthropicContentBlock {
  type: "text" | "tool_use";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Anthropic Messages API 响应体 */
interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
}

/**
 * 将内部 LlmMessage[] 转换为 Anthropic Messages API 的请求格式
 *
 * 规则：
 * - `role: "system"` → 提取到 `system` 顶层参数
 * - `role: "tool"` → 转为 `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }`
 * - 其他角色直接映射
 */
function buildAnthropicMessages(messages: LlmMessage[]): {
  system: string | undefined;
  messages: Array<{ role: string; content: unknown }>;
} {
  let system: string | undefined;
  const apiMessages: Array<{ role: string; content: unknown }> = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = msg.content;
    } else if (msg.role === "tool") {
      apiMessages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.toolCallId ?? "", content: msg.content }],
      });
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  return { system, messages: apiMessages };
}

/**
 * 将 LlmToolDef[] 转换为 Anthropic tools 格式
 */
function buildAnthropicTools(tools: LlmToolDef[]): Array<{ name: string; description: string; input_schema: unknown }> {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
}

/**
 * 基于 Anthropic Messages API 的 LLM 客户端
 *
 * 使用原生 `fetch` 调用 API，无需额外 SDK 依赖。
 * 支持文本消息和工具调用。
 *
 * @example
 * ```typescript
 * import { AnthropicLlmClient } from "./llm-client.js";
 *
 * const client = new AnthropicLlmClient({
 *   provider: "anthropic",
 *   apiKey: "sk-ant-...",
 *   model: "claude-sonnet-4-20250514",
 *   maxTokens: 4096,
 * });
 * const response = await client.chat([{ role: "user", content: "你好" }]);
 * ```
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly config: LlmConfig;
  private readonly baseUrl: string;

  constructor(config: LlmConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
  }

  /**
   * 发送消息到 Anthropic Messages API
   *
   * @param messages - 消息列表
   * @param tools - 可选的工具定义列表
   * @returns LLM 响应
   *
   * @example
   * ```typescript
   * const resp = await client.chat([{ role: "user", content: "分析代码" }]);
   * console.log(resp.content);
   * ```
   */
  async chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse> {
    const { system, messages: apiMessages } = buildAnthropicMessages(messages);

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: apiMessages,
    };
    if (system) body.system = system;
    if (tools && tools.length > 0) body.tools = buildAnthropicTools(tools);

    const resp = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      logger.error({ status: resp.status, body: errorText }, "Anthropic API 调用失败");
      throw new Error(`Anthropic API error: ${resp.status} — ${errorText}`);
    }

    const result = (await resp.json()) as AnthropicResponse;
    return parseAnthropicResponse(result);
  }
}

/** 将 Anthropic 响应解析为内部 LlmResponse 格式 */
function parseAnthropicResponse(result: AnthropicResponse): LlmResponse {
  let content = "";
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const block of result.content) {
    if (block.type === "text" && block.text) {
      content += block.text;
    } else if (block.type === "tool_use" && block.name && block.input) {
      toolCalls.push({ name: block.name, args: block.input });
    }
  }

  return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
}
