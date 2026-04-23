import { File, FolderSearch } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

/** 文件列表显示的最大条目数 */
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
  /** 文件路径列表 */
  files: string[];
  /** 工具名称（Glob 或 Grep） */
  toolName: string;
}

/**
 * 文件列表展示组件
 *
 * 渲染 Glob/Grep 工具返回的文件路径列表。当文件数量超过阈值时
 * 自动截断并显示剩余数量提示。
 *
 * @example
 * ```tsx
 * import { FileListContent } from "./FileListContent";
 *
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
    <CollapsibleSection
      title={`${toolName}: ${files.length} 个文件`}
      icon={<FolderSearch size={14} className="text-gray-500" />}
      defaultOpen={files.length <= 5}
    >
      <ul className="space-y-1">
        {displayFiles.map((filePath) => (
          <li key={filePath} className="flex items-center gap-2 text-xs font-mono text-gray-700">
            <File size={12} className="shrink-0 text-gray-400" />
            <span className="truncate">{filePath}</span>
          </li>
        ))}
      </ul>
      {remaining > 0 && <p className="mt-2 text-xs text-gray-500 italic">...及其他 {remaining} 个文件</p>}
    </CollapsibleSection>
  );
}
