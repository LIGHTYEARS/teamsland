import { FileEdit, FilePlus } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

/**
 * 工具 Diff 查看器组件属性
 *
 * @example
 * ```tsx
 * <ToolDiffViewer
 *   toolName="Edit"
 *   toolInput={{ file_path: "/src/index.ts", old_string: "foo", new_string: "bar" }}
 * />
 * ```
 */
export interface ToolDiffViewerProps {
  /** 工具名称（Edit 或 Write） */
  toolName: string;
  /** 工具输入参数 */
  toolInput: Record<string, unknown>;
  /** 工具执行结果文本 */
  result?: string;
}

/**
 * 提取字符串类型的字段值
 *
 * @example
 * ```ts
 * extractString({ name: "test" }, "name"); // "test"
 * extractString({ count: 42 }, "count"); // undefined
 * ```
 */
function extractString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 简易行级 diff 渲染
 *
 * 将删除行和新增行分别以红色和绿色背景高亮展示。
 *
 * @example
 * ```tsx
 * <InlineDiff oldText="const a = 1;" newText="const a = 2;" />
 * ```
 */
function InlineDiff({ oldText, newText }: { oldText: string; newText: string }) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  return (
    <div className="font-mono text-xs overflow-x-auto">
      {oldLines.map((line, i) => (
        <div key={`old-${i.toString()}`} className="bg-red-50 text-red-800 px-2 py-0.5">
          <span className="select-none text-red-400 mr-2">-</span>
          {line}
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`new-${i.toString()}`} className="bg-green-50 text-green-800 px-2 py-0.5">
          <span className="select-none text-green-400 mr-2">+</span>
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Edit/Write 工具的 Diff 可视化组件
 *
 * 对于 Edit 工具，以行级 diff 形式展示 old_string 到 new_string 的变更。
 * 对于 Write 工具，展示写入的文件内容预览。
 *
 * @example
 * ```tsx
 * import { ToolDiffViewer } from "./ToolDiffViewer";
 *
 * <ToolDiffViewer
 *   toolName="Edit"
 *   toolInput={{
 *     file_path: "/src/main.ts",
 *     old_string: "console.log('old');",
 *     new_string: "console.log('new');",
 *   }}
 *   result="File edited successfully"
 * />
 * ```
 */
export function ToolDiffViewer({ toolName, toolInput, result }: ToolDiffViewerProps) {
  const filePath = extractString(toolInput, "file_path") ?? extractString(toolInput, "path") ?? "未知文件";

  const isEdit = toolName === "Edit";
  const icon = isEdit ? (
    <FileEdit size={14} className="text-amber-600" />
  ) : (
    <FilePlus size={14} className="text-green-600" />
  );

  if (isEdit) {
    const oldString = extractString(toolInput, "old_string") ?? "";
    const newString = extractString(toolInput, "new_string") ?? "";

    return (
      <CollapsibleSection title={`Edit: ${filePath}`} icon={icon} badge={result ? "完成" : undefined} defaultOpen>
        <div className="rounded-md border border-gray-200 overflow-hidden">
          <InlineDiff oldText={oldString} newText={newString} />
        </div>
      </CollapsibleSection>
    );
  }

  // Write tool
  const content = extractString(toolInput, "content") ?? "";
  const preview = content.length > 500 ? `${content.slice(0, 500)}...(已截断)` : content;

  return (
    <CollapsibleSection
      title={`Write: ${filePath}`}
      icon={icon}
      badge={result ? "完成" : undefined}
      defaultOpen={false}
    >
      <pre className="rounded-md bg-gray-900 text-gray-100 p-3 text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
        {preview}
      </pre>
    </CollapsibleSection>
  );
}
