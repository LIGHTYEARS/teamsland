import type { NormalizedMessage } from "@teamsland/types";
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@teamsland/ui/elements/confirmation";
import { Message, MessageContent, MessageResponse } from "@teamsland/ui/elements/message";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@teamsland/ui/elements/plan";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@teamsland/ui/elements/reasoning";
import { AlertCircle, Clock, Coins, Hash, ShieldCheck } from "lucide-react";
import { ToolRenderer } from "./tools/ToolRenderer";

export interface MessageBubbleProps {
  message: NormalizedMessage;
  toolResult?: NormalizedMessage;
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
}

function StatusBubble({ text }: { text: string }) {
  return (
    <div className="text-center">
      <span className="inline-block rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{text}</span>
    </div>
  );
}

function CompleteBubble({ message }: { message: NormalizedMessage }) {
  const { cost, durationMs, tokens } = message;
  const hasMeta = cost !== undefined || durationMs !== undefined || tokens !== undefined;

  if (!hasMeta) {
    return <StatusBubble text="会话完成" />;
  }

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="text-center">
      <span className="inline-flex items-center gap-3 rounded-full bg-secondary px-4 py-1.5 text-xs text-muted-foreground">
        {durationMs !== undefined && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3" />
            {formatDuration(durationMs)}
          </span>
        )}
        {cost !== undefined && (
          <span className="inline-flex items-center gap-1">
            <Coins className="size-3" />${cost.toFixed(4)}
          </span>
        )}
        {tokens !== undefined && (
          <span className="inline-flex items-center gap-1">
            <Hash className="size-3" />
            {tokens.toLocaleString()} tokens
          </span>
        )}
      </span>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="mr-auto max-w-[80%] rounded-lg border-2 border-destructive/30 bg-destructive/5 px-4 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertCircle size={16} />
        <span>错误</span>
      </div>
      <p className="mt-1 text-sm text-destructive/80">{content}</p>
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
  const toolName = typeof message.toolName === "string" ? message.toolName : "操作";
  return (
    <Confirmation state="approval-requested" approval={{ id: message.id }}>
      <ConfirmationTitle>
        <ShieldCheck size={14} className="mr-1.5 inline" />
        权限请求: {toolName}
      </ConfirmationTitle>
      <ConfirmationRequest>
        <p className="text-sm text-muted-foreground">该工具请求执行权限，请确认是否允许。</p>
        <ConfirmationActions>
          <ConfirmationAction onClick={() => onRespond?.("allow")}>允许</ConfirmationAction>
          <ConfirmationAction variant="outline" onClick={() => onRespond?.("deny")}>
            拒绝
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationRequest>
    </Confirmation>
  );
}

type BubbleRenderFn = (props: { message: NormalizedMessage; toolResult?: NormalizedMessage }) => React.ReactNode;

const KIND_RENDERERS: Record<string, BubbleRenderFn> = {
  text: ({ message }) => (
    <Message from={message.role ?? "assistant"}>
      <MessageContent>
        <MessageResponse>{message.content ?? ""}</MessageResponse>
      </MessageContent>
    </Message>
  ),
  stream_delta: ({ message }) => (
    <Message from={message.role ?? "assistant"}>
      <MessageContent>
        <MessageResponse>{message.content ?? ""}</MessageResponse>
      </MessageContent>
    </Message>
  ),
  tool_use: ({ message, toolResult }) => (
    <div className="w-full max-w-[95%]">
      <ToolRenderer message={message} result={toolResult} />
    </div>
  ),
  tool_result: ({ message }) => {
    const isError = message.toolResult?.isError === true;
    const resultContent = message.toolResult?.content;
    if (!resultContent) return null;
    return (
      <div className="w-full max-w-[95%]">
        <div
          className={`rounded-lg border px-3 py-2 text-xs font-mono ${
            isError
              ? "border-destructive/20 bg-destructive/5 text-destructive"
              : "border-border bg-secondary text-secondary-foreground"
          }`}
        >
          <pre className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
            {resultContent.length > 500 ? `${resultContent.slice(0, 500)}...` : resultContent}
          </pre>
        </div>
      </div>
    );
  },
  thinking: ({ message }) => (
    <Reasoning defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{message.content ?? ""}</ReasoningContent>
    </Reasoning>
  ),
  error: ({ message }) => <ErrorBubble content={message.content ?? "未知错误"} />,
  status: ({ message }) => <StatusBubble text={message.text ?? message.content ?? ""} />,
  stream_start: () => null,
  stream_end: () => null,
  user_message: ({ message }) => (
    <Message from="user">
      <MessageContent>
        <MessageResponse>{message.content ?? ""}</MessageResponse>
      </MessageContent>
    </Message>
  ),
  assistant_message: ({ message }) => (
    <Message from="assistant">
      <MessageContent>
        <MessageResponse>{message.content ?? ""}</MessageResponse>
      </MessageContent>
    </Message>
  ),
  complete: ({ message }) => <CompleteBubble message={message} />,
  system: ({ message }) => <StatusBubble text={message.content ?? "系统消息"} />,
  task_notification: ({ message }) => {
    const title = message.text ?? "任务通知";
    const description = message.content ?? "";

    return (
      <div className="w-full max-w-[95%]">
        <Plan defaultOpen>
          <PlanHeader>
            <PlanTitle>{title}</PlanTitle>
            {description && <PlanDescription>{description}</PlanDescription>}
            <PlanAction>
              <PlanTrigger />
            </PlanAction>
          </PlanHeader>
          {description && (
            <PlanContent>
              <MessageResponse>{description}</MessageResponse>
            </PlanContent>
          )}
        </Plan>
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
