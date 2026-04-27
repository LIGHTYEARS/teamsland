import type { NormalizedMessage } from "@teamsland/types";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@teamsland/ui/elements/conversation";
import { useMemo } from "react";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";

export interface ChatInterfaceProps {
  sessionId: string;
  messages: NormalizedMessage[];
  isStreaming: boolean;
  onSendMessage: (message: string) => void;
  onAbort?: () => void;
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
  canInteract: boolean;
}

function buildToolResultMap(messages: NormalizedMessage[]): Map<string, NormalizedMessage> {
  const map = new Map<string, NormalizedMessage>();
  for (const msg of messages) {
    if (msg.kind === "tool_result" && msg.toolId) {
      map.set(msg.toolId, msg);
    }
  }
  return map;
}

export function ChatInterface({
  sessionId,
  messages,
  isStreaming,
  onSendMessage,
  onAbort,
  onPermissionResponse,
  canInteract,
}: ChatInterfaceProps) {
  const toolResultMap = useMemo(() => buildToolResultMap(messages), [messages]);

  const pairedResultIds = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.kind === "tool_use" && msg.toolId) {
        const result = toolResultMap.get(msg.toolId);
        if (result) ids.add(result.id);
      }
    }
    return ids;
  }, [messages, toolResultMap]);

  return (
    <div className="flex h-full flex-col" data-session-id={sessionId}>
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto min-w-[20rem] max-w-[80rem] gap-4 px-6 py-6">
          {messages.length === 0 ? (
            <ConversationEmptyState title="暂无消息" description="等待会话开始..." />
          ) : (
            messages.map((msg) => {
              if (pairedResultIds.has(msg.id)) return null;
              // Hide internal status messages (from system JSONL entries) — they clutter the chat
              if (msg.kind === "status") return null;
              const toolResult = msg.kind === "tool_use" && msg.toolId ? toolResultMap.get(msg.toolId) : undefined;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  toolResult={toolResult}
                  onPermissionResponse={onPermissionResponse}
                />
              );
            })
          )}
          {isStreaming && (
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:75ms]" />
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <MessageInput
        onSend={onSendMessage}
        onAbort={onAbort}
        isStreaming={isStreaming}
        disabled={!canInteract || isStreaming}
        placeholder={canInteract ? "输入消息，Enter 发送..." : "只读模式 — 接管后可发送消息"}
      />
    </div>
  );
}
