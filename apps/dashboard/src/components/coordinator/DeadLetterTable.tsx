import { Badge } from "@teamsland/ui/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@teamsland/ui/components/ui/tooltip";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { DeadLetterMessage } from "../../hooks/useDeadLetters";

export function DeadLetterTable({ messages }: { messages: DeadLetterMessage[] }) {
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) return null;

  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Dead Letters ({messages.length})
      </button>

      {expanded && (
        <div className="border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="text-left px-3 py-1.5 font-medium">Type</th>
                <th className="text-left px-3 py-1.5 font-medium">Priority</th>
                <th className="text-left px-3 py-1.5 font-medium">Error</th>
                <th className="text-left px-3 py-1.5 font-medium">Retries</th>
                <th className="text-left px-3 py-1.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((msg) => (
                <tr key={msg.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                  <td className="px-3 py-1.5 font-mono text-xs">{msg.type}</td>
                  <td className="px-3 py-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {msg.priority}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 max-w-[200px]">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs text-red-500 truncate block">{msg.lastError ?? "\u2014"}</span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[400px] break-all text-xs">
                        {msg.lastError ?? "No error message"}
                      </TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {msg.retryCount}/{msg.maxRetries}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
