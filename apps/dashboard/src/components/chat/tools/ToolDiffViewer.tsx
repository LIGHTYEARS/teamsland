import { CodeBlock } from "@teamsland/ui/elements/code-block";
import { Tool, ToolContent, ToolHeader } from "@teamsland/ui/elements/tool";
import type { ToolState } from "@teamsland/ui/elements/types";
import { FileEdit, FilePlus } from "lucide-react";
import type { BundledLanguage } from "shiki";

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
  toolName: string;
  toolInput: Record<string, unknown>;
  result?: string;
}

/**
 * 从文件路径推断 Shiki 高亮语言
 *
 * @example
 * ```ts
 * inferLanguage("/src/index.ts"); // "typescript"
 * inferLanguage("/styles/app.css"); // "css"
 * ```
 */
function inferLanguage(filePath: string): BundledLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    bash: "bash",
    toml: "toml",
    sql: "sql",
    xml: "xml",
    svg: "xml",
  };
  return (langMap[ext] ?? "text") as BundledLanguage;
}

function extractString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * 简易行级 diff 渲染
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
        <div key={`old-${i.toString()}`} className="bg-destructive/10 text-destructive px-2 py-0.5">
          <span className="select-none text-destructive/50 mr-2">-</span>
          {line}
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`new-${i.toString()}`} className="bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-0.5">
          <span className="select-none text-green-500/50 mr-2">+</span>
          {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Edit/Write 工具 Diff 可视化组件（基于 AI Elements Tool + CodeBlock）
 *
 * Edit 工具：行级 diff 展示 old_string → new_string 的变更。
 * Write 工具：使用 CodeBlock 展示写入内容（带 Shiki 语法高亮）。
 *
 * @example
 * ```tsx
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
  const state: ToolState = result ? "output-available" : "input-available";

  const isEdit = toolName === "Edit";
  const icon = isEdit ? <FileEdit className="size-4 text-amber-600" /> : <FilePlus className="size-4 text-green-600" />;

  if (isEdit) {
    const oldString = extractString(toolInput, "old_string") ?? "";
    const newString = extractString(toolInput, "new_string") ?? "";

    return (
      <Tool defaultOpen>
        <ToolHeader type="tool-invocation" state={state} title={`Edit: ${filePath}`} icon={icon} />
        <ToolContent>
          <div className="rounded-md border border-border overflow-hidden">
            <InlineDiff oldText={oldString} newText={newString} />
          </div>
        </ToolContent>
      </Tool>
    );
  }

  const content = extractString(toolInput, "content") ?? "";
  const preview = content.length > 500 ? `${content.slice(0, 500)}...(已截断)` : content;
  const language = inferLanguage(filePath);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader type="tool-invocation" state={state} title={`Write: ${filePath}`} icon={icon} />
      <ToolContent>
        <CodeBlock code={preview} language={language} showLineNumbers />
      </ToolContent>
    </Tool>
  );
}
