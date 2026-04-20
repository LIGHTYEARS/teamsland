/**
 * LLM 单条消息
 *
 * @example
 * ```typescript
 * import type { LlmMessage } from "@teamsland/ingestion";
 *
 * const msg: LlmMessage = { role: "user", content: "分类这段文字" };
 * ```
 */
export interface LlmMessage {
  /** 消息角色 */
  role: "system" | "user" | "assistant";
  /** 消息内容 */
  content: string;
}

/**
 * LLM 调用返回值
 *
 * @example
 * ```typescript
 * import type { LlmResponse } from "@teamsland/ingestion";
 *
 * const res: LlmResponse = { content: '{"type":"tech_spec","confidence":0.9}' };
 * ```
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
}

/**
 * LLM 客户端接口（本地 duck-typed 定义）
 *
 * 与 @teamsland/memory 的 LlmClient 接口结构兼容，但独立声明以保持叶子包地位。
 * 真实实现由应用层在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient } from "@teamsland/ingestion";
 *
 * const fakeLlm: LlmClient = {
 *   async chat(messages) {
 *     return { content: '{"type":"tech_spec","confidence":0.92,"entities":{}}' };
 *   },
 * };
 * ```
 */
export interface LlmClient {
  /** 发送对话消息并获取回复 */
  chat(messages: LlmMessage[]): Promise<LlmResponse>;
}
