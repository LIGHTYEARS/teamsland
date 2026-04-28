import type { NormalizedMessage } from "@teamsland/types";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@teamsland/ui/elements/confirmation";
import { MessageResponse } from "@teamsland/ui/elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@teamsland/ui/elements/reasoning";
import { cn } from "@teamsland/ui/lib/utils";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { ToolRenderer } from "./tools/ToolRenderer";

export interface MessageBubbleProps {
  message: NormalizedMessage;
  toolResult?: NormalizedMessage;
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
}

export type TimelineDotColor = "default" | "blue" | "green" | "red" | "muted";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function CompleteBubble({ message }: { message: NormalizedMessage }) {
  const { cost, durationMs, tokens } = message;
  const parts: string[] = [];
  if (durationMs !== undefined) parts.push(formatDuration(durationMs));
  if (cost !== undefined) parts.push(`$${cost.toFixed(4)}`);
  if (tokens !== undefined) parts.push(`${tokens.toLocaleString()} tok`);

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60 my-2">
      <div className="h-px flex-1 bg-border" />
      <span>{parts.length > 0 ? parts.join(" · ") : "Done"}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function PermissionBubble({
  message,
  onRespond,
}: {
  message: NormalizedMessage;
  onRespond?: (action: "allow" | "deny") => void;
}) {
  const toolName = typeof message.toolName === "string" ? message.toolName : "Action";
  return (
    <Confirmation state="approval-requested" approval={{ id: message.id }}>
      <ConfirmationTitle>
        <ShieldCheck size={12} className="mr-1 inline" />
        Permission: {toolName}
      </ConfirmationTitle>
      <ConfirmationRequest>
        <p className="text-xs text-muted-foreground">This tool requires permission to execute.</p>
        <ConfirmationActions>
          <ConfirmationAction onClick={() => onRespond?.("allow")}>Allow</ConfirmationAction>
          <ConfirmationAction variant="outline" onClick={() => onRespond?.("deny")}>
            Deny
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  );
}

function CollapsibleUserMessage({ content }: { content: string }) {
  const MAX_HEIGHT = 72;
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  const checkOverflow = (el: HTMLDivElement | null) => {
    contentRef.current = el;
    if (el) setNeedsCollapse(el.scrollHeight > MAX_HEIGHT);
  };

  return (
    <div className="w-full overflow-hidden rounded-lg bg-card">
      <div className="relative">
        <div
          ref={checkOverflow}
          className={cn("px-3 py-2 text-sm text-foreground overflow-hidden", !expanded && "max-h-[72px]")}
        >
          <MessageResponse>{content}</MessageResponse>
        </div>
        {needsCollapse && !expanded && (
          <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>
      {needsCollapse && (
        <div className="flex justify-end px-2 py-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </div>
      )}
    </div>
  );
}

type BubbleRenderFn = (props: { message: NormalizedMessage; toolResult?: NormalizedMessage }) => React.ReactNode;

const KIND_RENDERERS: Record<string, BubbleRenderFn> = {
  text: ({ message }) =>
    message.role === "user" ? (
      <CollapsibleUserMessage content={message.content ?? ""} />
    ) : (
      <div className="px-2 text-sm text-foreground">
        <MessageResponse>{message.content ?? ""}</MessageResponse>
      </div>
    ),
  stream_delta: ({ message }) => (
    <div className="px-2 text-sm text-foreground">
      <MessageResponse>{message.content ?? ""}</MessageResponse>
    </div>
  ),
  tool_use: ({ message, toolResult }) => <ToolRenderer message={message} result={toolResult} />,
  tool_result: ({ message }) => {
    const isError = message.toolResult?.isError === true;
    const resultContent = message.toolResult?.content;
    if (!resultContent) return null;
    return (
      <pre
        className={`rounded px-2 py-1 font-mono text-[11px] whitespace-pre-wrap break-words max-h-32 overflow-y-auto ${
          isError ? "text-destructive bg-destructive/5" : "text-muted-foreground bg-muted"
        }`}
      >
        {resultContent.length > 500 ? `${resultContent.slice(0, 500)}…` : resultContent}
      </pre>
    );
  },
  thinking: ({ message }) => (
    <Reasoning defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{message.content ?? ""}</ReasoningContent>
    </Reasoning>
  ),
  error: ({ message }) => (
    <div className="flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle size={12} className="mt-0.5 shrink-0" />
      <span>{message.content ?? "Unknown error"}</span>
    </div>
  ),
  status: () => null,
  stream_start: () => null,
  stream_end: () => null,
  user_message: ({ message }) => <CollapsibleUserMessage content={message.content ?? ""} />,
  assistant_message: ({ message }) => (
    <div className="px-2 text-sm text-foreground">
      <MessageResponse>{message.content ?? ""}</MessageResponse>
    </div>
  ),
  complete: ({ message }) => <CompleteBubble message={message} />,
  system: () => null,
  task_notification: ({ message }) => {
    const title = message.text ?? "Task";
    const description = message.content ?? "";
    return (
      <div className="rounded bg-muted/50 px-2 py-1.5 text-xs">
        <div className="font-medium text-foreground">{title}</div>
        {description && (
          <div className="mt-1 text-muted-foreground">
            <MessageResponse>{description}</MessageResponse>
          </div>
        )}
      </div>
    );
  },
};

export function MessageBubble({ message, toolResult, onPermissionResponse }: MessageBubbleProps) {
  if (message.kind === "permission_request") {
    return (
      <PermissionBubble
        message={message}
        onRespond={onPermissionResponse ? (action) => onPermissionResponse(message.id, action) : undefined}
      />
    );
  }
  const renderer = KIND_RENDERERS[message.kind];
  if (!renderer) return null;
  return <>{renderer({ message, toolResult })}</>;
}
