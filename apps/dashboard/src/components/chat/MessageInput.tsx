import { Send } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * 消息输入框组件属性
 *
 * @example
 * ```tsx
 * <MessageInput
 *   onSend={(msg) => console.log(msg)}
 *   disabled={false}
 *   placeholder="输入消息..."
 * />
 * ```
 */
export interface MessageInputProps {
  /** 发送消息回调 */
  onSend: (message: string) => void;
  /** 是否禁用输入 */
  disabled: boolean;
  /** 占位文本 */
  placeholder?: string;
}

/**
 * 消息输入框组件
 *
 * 带发送按钮的文本输入区域。支持 Ctrl+Enter 快捷键发送，
 * 可通过 disabled 属性禁用交互（如只读模式或流式响应中）。
 *
 * @example
 * ```tsx
 * import { MessageInput } from "./MessageInput";
 *
 * function ChatPanel() {
 *   const handleSend = (msg: string) => {
 *     console.log("发送消息:", msg);
 *   };
 *
 *   return (
 *     <MessageInput
 *       onSend={handleSend}
 *       disabled={false}
 *       placeholder="输入你的消息，Ctrl+Enter 发送"
 *     />
 *   );
 * }
 * ```
 */
export function MessageInput({ onSend, disabled, placeholder = "输入消息，Ctrl+Enter 发送..." }: MessageInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSend(trimmed);
    setValue("");
  }, [value, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={2}
        className="flex-1 resize-none rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || value.trim().length === 0}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Send size={18} />
      </button>
    </div>
  );
}
