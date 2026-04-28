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

export function MessageInput({ onSend, onAbort, isStreaming, disabled, placeholder = "输入问题…" }: MessageInputProps) {
  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const trimmed = message.text.trim();
      if (trimmed.length === 0) return;
      onSend(trimmed);
    },
    [onSend],
  );

  return (
    <div className="shrink-0 bg-muted/30 px-4 py-2">
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea placeholder={placeholder} disabled={disabled} />
        </PromptInputBody>
        <PromptInputFooter>
          {isStreaming && onAbort ? (
            <button
              type="button"
              onClick={onAbort}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
            >
              <Square className="size-2.5 fill-current" />
              Stop
            </button>
          ) : (
            <PromptInputSubmit disabled={disabled} />
          )}
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
