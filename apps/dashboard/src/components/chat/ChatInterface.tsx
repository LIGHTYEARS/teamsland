import type { NormalizedMessage } from "@teamsland/types";
import { MessageInput } from "./MessageInput";
import { MessageList } from "./MessageList";

/**
 * 聊天界面容器组件属性
 *
 * @example
 * ```tsx
 * <ChatInterface
 *   sessionId="sess_abc"
 *   messages={messages}
 *   isStreaming={false}
 *   onSendMessage={(msg) => console.log(msg)}
 *   onPermissionResponse={(id, action) => console.log(id, action)}
 *   canInteract={true}
 * />
 * ```
 */
export interface ChatInterfaceProps {
  /** 当前会话 ID */
  sessionId: string;
  /** 归一化消息数组 */
  messages: NormalizedMessage[];
  /** 是否正在流式接收 */
  isStreaming: boolean;
  /** 发送消息回调 */
  onSendMessage: (message: string) => void;
  /**
   * 权限请求响应回调，透传给 MessageList -> MessageBubble
   *
   * @example
   * ```tsx
   * <ChatInterface
   *   sessionId="sess_001"
   *   messages={[]}
   *   isStreaming={false}
   *   onSendMessage={(msg) => console.log(msg)}
   *   onPermissionResponse={(messageId, action) => {
   *     send({ type: "permission-response", messageId, action });
   *   }}
   *   canInteract={true}
   * />
   * ```
   */
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
  /** 是否可交互（false 为只读模式，true 为接管模式） */
  canInteract: boolean;
}

/**
 * 聊天界面容器组件
 *
 * 整合 MessageList 和 MessageInput，构成完整的聊天交互界面。
 * MessageList 占据剩余空间用于消息展示，MessageInput 固定在底部。
 * canInteract 为 false 时输入框禁用，适用于只读观察模式。
 *
 * @example
 * ```tsx
 * import { ChatInterface } from "./ChatInterface";
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * function SessionView() {
 *   const messages: NormalizedMessage[] = [];
 *   const [isStreaming] = useState(false);
 *
 *   return (
 *     <ChatInterface
 *       sessionId="sess_001"
 *       messages={messages}
 *       isStreaming={isStreaming}
 *       onSendMessage={(msg) => console.log("发送:", msg)}
 *       canInteract={true}
 *     />
 *   );
 * }
 * ```
 */
export function ChatInterface({
  sessionId,
  messages,
  isStreaming,
  onSendMessage,
  onPermissionResponse,
  canInteract,
}: ChatInterfaceProps) {
  return (
    <div className="flex h-full flex-col" data-session-id={sessionId}>
      <MessageList messages={messages} isStreaming={isStreaming} onPermissionResponse={onPermissionResponse} />
      <MessageInput
        onSend={onSendMessage}
        disabled={!canInteract || isStreaming}
        placeholder={canInteract ? "输入消息，Ctrl+Enter 发送..." : "只读模式 — 接管后可发送消息"}
      />
    </div>
  );
}
