import { Tool, ToolContent, ToolHeader } from "@teamsland/ui/elements/tool";
import type { ToolState } from "@teamsland/ui/elements/types";
import Ansi from "ansi-to-react";
import { TerminalSquare } from "lucide-react";

/**
 * Bash 命令输出组件属性
 *
 * @example
 * ```tsx
 * <BashOutput command="ls -la" output="total 0\ndrwxr-xr-x" />
 * ```
 */
export interface BashOutputProps {
  command?: string;
  output?: string;
  isError?: boolean;
}

/**
 * Bash 命令输出组件（基于 AI Elements Tool 容器）
 *
 * 以终端风格展示命令及输出，支持 ANSI 颜色渲染。
 * 使用 Tool/ToolHeader/ToolContent 提供一致的折叠/状态徽章体验。
 *
 * @example
 * ```tsx
 * <BashOutput
 *   command="git status"
 *   output="On branch main\nnothing to commit"
 *   isError={false}
 * />
 * ```
 */
export function BashOutput({ command, output, isError = false }: BashOutputProps) {
  const displayCommand = command ?? "bash";
  const truncatedCommand = displayCommand.length > 60 ? `${displayCommand.slice(0, 60)}...` : displayCommand;

  const state: ToolState = isError ? "output-error" : output !== undefined ? "output-available" : "input-available";

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        type="tool-invocation"
        state={state}
        title={truncatedCommand}
        icon={<TerminalSquare className="size-4 text-muted-foreground" />}
      />
      <ToolContent>
        <div className="overflow-hidden rounded-md bg-muted">
          <pre className="p-3 font-mono text-xs overflow-auto max-h-80 whitespace-pre-wrap break-words text-foreground">
            <span className="text-muted-foreground select-none">
              $ {displayCommand}
              {"\n"}
            </span>
            {output ? <Ansi>{output}</Ansi> : <span className="text-muted-foreground italic">（无输出）</span>}
          </pre>
        </div>
      </ToolContent>
    </Tool>
  );
}
