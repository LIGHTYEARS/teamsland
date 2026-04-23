import type { NormalizedMessage } from "@teamsland/types";
import { AlertCircle, Brain, ChevronDown, ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolRenderer } from "./tools/ToolRenderer";

/**
 * 消息气泡组件属性
 *
 * @example
 * ```tsx
 * <MessageBubble
 *   message={normalizedMsg}
 *   toolResult={resultMsg}
 *   onPermissionResponse={(id, action) => console.log(id, action)}
 * />
 * ```
 */
export interface MessageBubbleProps {
  /** 要渲染的归一化消息 */
  message: NormalizedMessage;
  /** 对应的 tool_result 消息（仅当 kind='tool_use' 时） */
  toolResult?: NormalizedMessage;
  /**
   * 权限请求响应回调
   *
   * 当用户点击"允许"或"拒绝"按钮时触发，传递消息 ID 和操作类型。
   *
   * @example
   * ```tsx
   * <MessageBubble
   *   message={msg}
   *   onPermissionResponse={(messageId, action) => {
   *     send({ type: "permission-response", messageId, action });
   *   }}
   * />
   * ```
   */
  onPermissionResponse?: (messageId: string, action: "allow" | "deny") => void;
}

/**
 * 思考过程折叠块
 *
 * @example
 * ```tsx
 * <ThinkingBlock content="让我思考一下这个问题..." />
 * ```
 */
function ThinkingBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mr-auto max-w-[80%]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        <Brain size={12} />
        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="italic">思考中...</span>
      </button>
      {isOpen && (
        <div className="mt-1 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-sm text-gray-500 italic">
          {content}
        </div>
      )}
    </div>
  );
}

/**
 * 权限请求块
 *
 * @example
 * ```tsx
 * <PermissionBlock message={permissionMsg} onRespond={(action) => console.log(action)} />
 * ```
 */
function PermissionBlock({
  message,
  onRespond,
}: {
  message: NormalizedMessage;
  onRespond?: (action: "allow" | "deny") => void;
}) {
  const toolName = typeof message.toolName === "string" ? message.toolName : "操作";
  return (
    <div className="mr-auto max-w-[80%] rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
        <ShieldCheck size={16} />
        <span>权限请求: {toolName}</span>
      </div>
      <p className="mt-1 text-xs text-amber-700">该工具请求执行权限，请确认是否允许。</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onRespond?.("allow")}
          className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 transition-colors"
        >
          允许
        </button>
        <button
          type="button"
          onClick={() => onRespond?.("deny")}
          className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

/**
 * 渲染文本类消息气泡（用户或助手）
 *
 * @example
 * ```tsx
 * <TextBubble messageRole="user" content="你好" />
 * ```
 */
function TextBubble({ messageRole, content }: { messageRole?: string; content: string }) {
  if (messageRole === "user") {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2 text-white">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
      </div>
    );
  }

  return (
    <div className="mr-auto max-w-[80%] rounded-2xl rounded-bl-sm bg-gray-100 px-4 py-2 text-gray-900">
      <div className="prose prose-sm max-w-none text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * 渲染独立的 tool_result 消息
 *
 * @example
 * ```tsx
 * <ToolResultBubble message={toolResultMsg} />
 * ```
 */
function ToolResultBubble({ message }: { message: NormalizedMessage }) {
  const isError = message.toolResult?.isError === true;
  const resultContent = message.toolResult?.content;
  if (!resultContent) return null;

  return (
    <div className="mr-auto max-w-[80%]">
      <div
        className={`rounded-lg border px-3 py-2 text-xs font-mono ${
          isError ? "border-red-200 bg-red-50 text-red-800" : "border-gray-200 bg-gray-50 text-gray-700"
        }`}
      >
        <pre className="whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
          {resultContent.length > 500 ? `${resultContent.slice(0, 500)}...` : resultContent}
        </pre>
      </div>
    </div>
  );
}

/**
 * 渲染错误消息气泡
 *
 * @example
 * ```tsx
 * <ErrorBubble content="连接超时" />
 * ```
 */
function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="mr-auto max-w-[80%] rounded-lg border-2 border-red-300 bg-red-50 px-4 py-2">
      <div className="flex items-center gap-2 text-sm font-medium text-red-800">
        <AlertCircle size={16} />
        <span>错误</span>
      </div>
      <p className="mt-1 text-sm text-red-700">{content}</p>
    </div>
  );
}

/**
 * 渲染状态消息
 *
 * @example
 * ```tsx
 * <StatusBubble text="Agent 已启动" />
 * ```
 */
function StatusBubble({ text }: { text: string }) {
  return (
    <div className="text-center">
      <span className="inline-block rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">{text}</span>
    </div>
  );
}

/** kind 到渲染函数的映射表类型 */
type BubbleRenderFn = (props: { message: NormalizedMessage; toolResult?: NormalizedMessage }) => React.ReactNode;

/**
 * 各消息类型的渲染映射
 *
 * @example
 * ```ts
 * const renderer = KIND_RENDERERS.text;
 * ```
 */
const KIND_RENDERERS: Record<string, BubbleRenderFn> = {
  text: ({ message }) => <TextBubble messageRole={message.role} content={message.content ?? ""} />,
  stream_delta: ({ message }) => <TextBubble messageRole={message.role} content={message.content ?? ""} />,
  tool_use: ({ message, toolResult }) => (
    <div className="mr-auto max-w-[90%]">
      <ToolRenderer message={message} result={toolResult} />
    </div>
  ),
  tool_result: ({ message }) => <ToolResultBubble message={message} />,
  thinking: ({ message }) => <ThinkingBlock content={message.content ?? ""} />,
  error: ({ message }) => <ErrorBubble content={message.content ?? "未知错误"} />,
  status: ({ message }) => <StatusBubble text={message.text ?? message.content ?? ""} />,
  // 控制信号类型 — 不渲染可见内容
  stream_start: () => null,
  stream_end: () => null,
  // 完整消息类型
  user_message: ({ message }) => <TextBubble messageRole="user" content={message.content ?? ""} />,
  assistant_message: ({ message }) => <TextBubble messageRole="assistant" content={message.content ?? ""} />,
  complete: () => <StatusBubble text="会话完成" />,
  system: ({ message }) => <StatusBubble text={message.content ?? "系统消息"} />,
};

/**
 * 消息气泡渲染组件
 *
 * 根据消息的 kind 和 role 渲染不同样式的消息气泡。
 * 支持文本消息、工具调用、思考过程、错误提示、状态消息等多种类型。
 * 用户消息右对齐蓝色气泡，助手消息左对齐灰色气泡，
 * 工具调用委托给 ToolRenderer，思考过程以可折叠块展示。
 *
 * @example
 * ```tsx
 * import { MessageBubble } from "./MessageBubble";
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const userMsg: NormalizedMessage = {
 *   id: "msg_001",
 *   sessionId: "sess_abc",
 *   timestamp: new Date().toISOString(),
 *   provider: "claude",
 *   kind: "text",
 *   role: "user",
 *   content: "你好！",
 * };
 *
 * <MessageBubble message={userMsg} />
 * ```
 */
export function MessageBubble({ message, toolResult, onPermissionResponse }: MessageBubbleProps) {
  // 权限请求需要额外的回调，特殊处理
  if (message.kind === "permission_request") {
    return (
      <PermissionBlock
        message={message}
        onRespond={onPermissionResponse ? (action) => onPermissionResponse(message.id, action) : undefined}
      />
    );
  }

  const renderer = KIND_RENDERERS[message.kind];
  if (!renderer) return null;
  return <>{renderer({ message, toolResult })}</>;
}
