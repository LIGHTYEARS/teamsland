/**
 * 入队函数签名
 *
 * Connector 和 Server API 通用的消息入队回调类型。
 * 避免包之间直接依赖 @teamsland/queue。
 *
 * @example
 * ```typescript
 * import type { EnqueueFn } from "@teamsland/types";
 *
 * const enqueue: EnqueueFn = (opts) => {
 *   console.log("入队:", opts.type, opts.payload);
 *   return "msg-001";
 * };
 *
 * enqueue({ type: "lark_mention", payload: { event: {} } });
 * ```
 */
export type EnqueueFn = (opts: {
  type: string;
  payload: unknown;
  priority?: string;
  scheduledAt?: number;
  maxRetries?: number;
  traceId?: string;
}) => string;
