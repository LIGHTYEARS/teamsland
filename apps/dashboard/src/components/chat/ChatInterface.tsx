import type { NormalizedMessage } from "@teamsland/types";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@teamsland/ui/elements/conversation";
import { useMemo } from "react";
import { MessageBubble, type TimelineDotColor } from "./MessageBubble";
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

function isUserMessage(msg: NormalizedMessage): boolean {
  return msg.kind === "text" && msg.role === "user";
}

function getDotColor(msg: NormalizedMessage, toolResult?: NormalizedMessage): TimelineDotColor {
  if (msg.kind === "error") return "red";
  if (msg.kind === "complete") return "muted";
  if (msg.kind === "tool_use") {
    if (toolResult?.toolResult?.isError) return "red";
    if (toolResult) return "green";
    return "blue";
  }
  return "default";
}

type MessageGroup =
  | { type: "user"; messages: NormalizedMessage[] }
  | { type: "timeline"; messages: NormalizedMessage[] };

function groupMessages(messages: NormalizedMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const isUser = isUserMessage(msg);
    const groupType = isUser ? "user" : "timeline";
    const last = groups[groups.length - 1];
    if (last && last.type === groupType) {
      last.messages.push(msg);
    } else {
      groups.push({ type: groupType, messages: [msg] });
    }
  }
  return groups;
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

  const visibleMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (pairedResultIds.has(msg.id)) return false;
      if (msg.kind === "status") return false;
      if (msg.kind === "stream_end") return false;
      return true;
    });
  }, [messages, pairedResultIds]);

  const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages]);

  return (
    <div className="flex h-full flex-col" data-session-id={sessionId}>
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-3">
          {visibleMessages.length === 0 ? (
            <ConversationEmptyState title="暂无消息" description="等待会话开始..." />
          ) : (
            <div className="space-y-2">
              {groups.map((group) => {
                if (group.type === "user") {
                  return group.messages.map((msg) => (
                    <div key={msg.id} className="py-1 pl-6">
                      <MessageBubble message={msg} onPermissionResponse={onPermissionResponse} />
                    </div>
                  ));
                }

                return (
                  <div key={group.messages[0].id} className="relative pl-6">
                    {group.messages.map((msg, idx) => {
                      const toolResult =
                        msg.kind === "tool_use" && msg.toolId ? toolResultMap.get(msg.toolId) : undefined;
                      const dotColor = getDotColor(msg, toolResult);
                      const hasStreaming = isStreaming && group === groups[groups.length - 1];
                      const isLast = idx === group.messages.length - 1 && !hasStreaming;

                      return (
                        <div key={msg.id} className="relative flex items-start gap-0 py-0.5">
                          {!isLast && (
                            <div className="absolute left-[-18px] w-px bg-border" style={{ top: 14, bottom: -14 }} />
                          )}
                          <div className="absolute left-[-21px] top-0 flex h-6 w-2 items-center justify-center">
                            <TimelineDot color={dotColor} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <MessageBubble
                              message={msg}
                              toolResult={toolResult}
                              onPermissionResponse={onPermissionResponse}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {isStreaming && group === groups[groups.length - 1] && (
                      <div className="relative flex items-start gap-0 py-0.5">
                        <div className="absolute left-[-21px] top-0 flex h-6 w-2 items-center justify-center">
                          <span className="block size-2 shrink-0 rounded-full bg-primary animate-pulse" />
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground text-xs h-6">
                          <span className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          <span>Thinking…</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
        placeholder={canInteract ? "输入消息，Enter 发送..." : "只读模式"}
      />
    </div>
  );
}

function TimelineDot({ color }: { color: TimelineDotColor }) {
  const colorClasses: Record<TimelineDotColor, string> = {
    default: "bg-neutral-400",
    blue: "bg-primary",
    green: "bg-green-500",
    red: "bg-red-500",
    muted: "bg-neutral-300 dark:bg-neutral-600",
  };
  return <span className={`block size-2 shrink-0 rounded-full ${colorClasses[color]}`} />;
}
