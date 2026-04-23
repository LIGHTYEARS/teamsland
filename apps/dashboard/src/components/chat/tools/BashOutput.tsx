import { Terminal } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

/**
 * Bash 命令输出组件属性
 *
 * @example
 * ```tsx
 * <BashOutput command="ls -la" output="total 0\ndrwxr-xr-x" />
 * ```
 */
export interface BashOutputProps {
  /** 执行的命令 */
  command?: string;
  /** 命令输出内容 */
  output?: string;
  /** 命令是否执行出错 */
  isError?: boolean;
}

/**
 * Bash 命令输出可折叠组件
 *
 * 以终端风格显示 Bash 命令及其输出。标题栏展示命令文本，
 * 点击展开后显示完整输出内容，支持滚动查看长输出。
 *
 * @example
 * ```tsx
 * import { BashOutput } from "./BashOutput";
 *
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

  return (
    <CollapsibleSection
      title={truncatedCommand}
      icon={<Terminal size={14} className="text-gray-500" />}
      badge={isError ? "error" : undefined}
      defaultOpen={false}
    >
      <div
        className={`rounded-md p-3 font-mono text-xs overflow-x-auto max-h-80 overflow-y-auto ${
          isError ? "bg-red-50 text-red-800 border border-red-200" : "bg-gray-900 text-gray-100"
        }`}
      >
        <div className="mb-2 text-gray-400 select-none">$ {displayCommand}</div>
        {output ? (
          <pre className="whitespace-pre-wrap break-words">{output}</pre>
        ) : (
          <span className="text-gray-500 italic">（无输出）</span>
        )}
      </div>
    </CollapsibleSection>
  );
}
