import { Tool, ToolContent, ToolHeader } from "@teamsland/ui/elements/tool";
import { File, FolderSearch } from "lucide-react";

const MAX_DISPLAY_COUNT = 20;

/**
 * 文件列表组件属性
 *
 * @example
 * ```tsx
 * <FileListContent files={["/src/index.ts", "/src/app.ts"]} toolName="Glob" />
 * ```
 */
export interface FileListContentProps {
  files: string[];
  toolName: string;
}

/**
 * 文件列表展示组件（基于 AI Elements Tool 容器）
 *
 * 渲染 Glob/Grep 工具返回的文件路径列表，
 * 超过阈值时自动截断并显示剩余数量提示。
 *
 * @example
 * ```tsx
 * <FileListContent
 *   files={["/src/index.ts", "/src/utils.ts", "/src/types.ts"]}
 *   toolName="Grep"
 * />
 * ```
 */
export function FileListContent({ files, toolName }: FileListContentProps) {
  const displayFiles = files.slice(0, MAX_DISPLAY_COUNT);
  const remaining = files.length - displayFiles.length;

  return (
    <Tool defaultOpen={files.length <= 5}>
      <ToolHeader
        type="tool-invocation"
        state="output-available"
        title={`${toolName}: ${files.length} 个文件`}
        icon={<FolderSearch className="size-4 text-muted-foreground" />}
      />
      <ToolContent>
        <ul className="space-y-1">
          {displayFiles.map((filePath) => (
            <li key={filePath} className="flex items-center gap-2 text-xs font-mono text-foreground">
              <File size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{filePath}</span>
            </li>
          ))}
        </ul>
        {remaining > 0 && <p className="mt-2 text-xs text-muted-foreground italic">...及其他 {remaining} 个文件</p>}
      </ToolContent>
    </Tool>
  );
}
