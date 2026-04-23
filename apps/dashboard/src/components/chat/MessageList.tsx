import type { NormalizedMessage } from "@teamsland/types";
import { useEffect, useMemo, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

/**
 * 消息列表组件属性
 *
 * @example
 * ```tsx
 * <MessageList
 *   messages={messages}
 *   isStreaming={false}
 *   onPermissionResponse={(id, action) => console.log(id, action)}
 * />
 * ```
 */
export interface MessageListProps {
  /** 归一化消息数组 */
  messages: NormalizedMessage[];
  /** 是否正在流式接收中 */
  isStreaming: boolean;
  /**
   * 权限请求响应回调，透传给 MessageBubble
   *
   * @example
   * ```tsx
   * <MessageList
   *   messages={msgs}
   *   isStreaming={false}
   *   onPermissionResponse={(messageId, action) => {
   *     send({ type: "permission-response", messageId, action });
   *   }}
   * />
   * ```
   */
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
}

/**
 * 构建 tool_use ID 到 tool_result 的映射
 *
 * @example
 * ```ts
 * const map = buildToolResultMap(messages);
 * const result = map.get("tool_001");
 * ```
 */
function buildToolResultMap(messages: NormalizedMessage[]): Map<string, NormalizedMessage> {
  const map = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.kind === "tool_result" && msg.toolId) {
      map.set(msg.toolId, msg);
    }
  }
  return map;
}

/**
 * 消息列表渲染组件
 *
 * 按时间顺序渲染所有消息，自动滚动到最新消息。
 * 将 tool_use 消息与其对应的 tool_result 配对传递给 MessageBubble，
 * 并跳过已被配对消费的 tool_result 消息。
 *
 * @example
 * ```tsx
 * import { MessageList } from "./MessageList";
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const messages: NormalizedMessage[] = [
 *   {
 *     id: "msg_001",
 *     sessionId: "sess_abc",
 *     timestamp: new Date().toISOString(),
 *     provider: "claude",
 *     kind: "text",
 *     role: "user",
 *     content: "你好",
 *   },
 * ];
 *
 * <MessageList messages={messages} isStreaming={false} />
 * ```
 */
export function MessageList({ messages, isStreaming, onPermissionResponse }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // 新消息到达时自动滚动到底部
  // 使用 messages 的最后一条 ID 作为依赖触发滚动
  const lastMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    if (lastMessageId) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [lastMessageId]);

  // 构建 tool_result 映射，用于 tool_use → tool_result 配对
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);

  // 收集已被配对的 tool_result ID，渲染时跳过
  const pairedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.kind === "tool_use" && msg.toolId) {
        const result = toolResultMap.get(msg.toolId);
        if (result) {
          ids.add(result.id);
        }
      }
    }
    return ids;
  }, [messages, toolResultMap]);

  if (messages.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-gray-400 text-sm">暂无消息</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {messages.map((msg) => {
        // 跳过已被 tool_use 配对的 tool_result
        if (pairedResultIds.has(msg.id)) return null;

        // 为 tool_use 附加对应的 tool_result
        const toolResult = msg.kind === "tool_use" && msg.toolId ? toolResultMap.get(msg.toolId) : undefined;

        return (
          <MessageBubble
            key={msg.id}
            message={msg}
            toolResult={toolResult}
            onPermissionResponse={onPermissionResponse}
          />
        );
      })}

      {isStreaming && (
        <div className="mr-auto flex items-center gap-1.5 text-gray-400 text-sm">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400 delay-75" />
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400 delay-150" />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
