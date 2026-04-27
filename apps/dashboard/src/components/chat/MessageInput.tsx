import type { PromptInputMessage } from "@teamsland/ui/elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@teamsland/ui/elements/prompt-input";
import { Square } from "lucide-react";
import { useCallback } from "react";

export interface MessageInputProps {
  onSend: (message: string) => void;
  onAbort?: () => void;
  isStreaming?: boolean;
  disabled: boolean;
  placeholder?: string;
}

export function MessageInput({
  onSend,
  onAbort,
  isStreaming,
  disabled,
  placeholder = "Ask a question...",
}: MessageInputProps) {
  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const trimmed = message.text.trim();
      if (trimmed.length === 0) return;
      onSend(trimmed);
    },
    [onSend],
  );

  return (
    <div className="relative grid w-auto shrink-0 gap-4 p-4">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder={placeholder} disabled={disabled} />
        </PromptInputBody>
        <PromptInputFooter>
          {isStreaming && onAbort ? (
            <button
              type="button"
              onClick={onAbort}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-accent transition-colors"
            >
              <Square className="size-2.5 fill-current" />
              停止
            </button>
          ) : (
            <PromptInputSubmit disabled={disabled} />
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
