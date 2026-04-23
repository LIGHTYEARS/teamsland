import type { NormalizedMessage } from "@teamsland/types";
import { Wrench } from "lucide-react";
import { BashOutput } from "./BashOutput";
import { CollapsibleSection } from "./CollapsibleSection";
import { FileListContent } from "./FileListContent";
import { ToolDiffViewer } from "./ToolDiffViewer";

/**
 * 工具渲染器组件属性
 *
 * @example
 * ```tsx
 * <ToolRenderer
 *   message={toolUseMessage}
 *   result={toolResultMessage}
 * />
 * ```
 */
export interface ToolRendererProps {
  /** tool_use 类型的消息 */
  message: NormalizedMessage;
  /** 匹配的 tool_result 消息 */
  result?: NormalizedMessage;
}

/**
 * 安全地将 unknown 转换为 Record<string, unknown>
 *
 * @example
 * ```ts
 * toRecord({ a: 1 }); // { a: 1 }
 * toRecord("not-object"); // {}
 * ```
 */
function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * 安全地将 unknown 转换为字符串数组
 *
 * @example
 * ```ts
 * toStringArray(["a.ts", "b.ts"]); // ["a.ts", "b.ts"]
 * toStringArray("not-array"); // []
 * ```
 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * 获取工具结果的文本内容
 *
 * @example
 * ```ts
 * getResultText({ toolResult: { content: "OK" } }); // "OK"
 * ```
 */
function getResultText(resultMsg?: NormalizedMessage): string | undefined {
  return resultMsg?.toolResult?.content;
}

/**
 * 安全地将 JSON 转为格式化字符串
 *
 * @example
 * ```ts
 * safeStringify({ key: "value" }); // '{\n  "key": "value"\n}'
 * ```
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 工具渲染上下文 */
interface ToolContext {
  toolName: string;
  input: Record<string, unknown>;
  resultText: string | undefined;
  isError: boolean;
  result?: NormalizedMessage;
}

/**
 * 渲染 Edit/Write 工具
 *
 * @example
 * ```tsx
 * renderDiffTool({ toolName: "Edit", input: {}, resultText: "OK", isError: false });
 * ```
 */
function renderDiffTool(ctx: ToolContext): React.ReactNode {
  return <ToolDiffViewer toolName={ctx.toolName} toolInput={ctx.input} result={ctx.resultText} />;
}

/**
 * 渲染 Bash 工具
 *
 * @example
 * ```tsx
 * renderBashTool({ toolName: "Bash", input: { command: "ls" }, resultText: "file.ts", isError: false });
 * ```
 */
function renderBashTool(ctx: ToolContext): React.ReactNode {
  const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
  return <BashOutput command={command} output={ctx.resultText} isError={ctx.isError} />;
}

/**
 * 渲染 Glob/Grep 工具的文件列表
 *
 * @example
 * ```tsx
 * renderFileSearchTool({ toolName: "Glob", input: {}, resultText: "a.ts\nb.ts", isError: false });
 * ```
 */
function renderFileSearchTool(ctx: ToolContext): React.ReactNode {
  const resultData = ctx.result?.toolResult?.toolUseResult;
  const files = toStringArray(resultData);

  if (files.length > 0) {
    return <FileListContent files={files} toolName={ctx.toolName} />;
  }

  if (ctx.resultText) {
    const lines = ctx.resultText.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length > 0) {
      return <FileListContent files={lines} toolName={ctx.toolName} />;
    }
  }

  return (
    <CollapsibleSection title={`${ctx.toolName}（无结果）`} icon={<Wrench size={14} className="text-gray-500" />}>
      <p className="text-xs text-gray-500 italic">未找到匹配文件</p>
    </CollapsibleSection>
  );
}

/**
 * 渲染 Read 工具的文件内容
 *
 * @example
 * ```tsx
 * renderReadTool({ toolName: "Read", input: { file_path: "/a.ts" }, resultText: "content", isError: false });
 * ```
 */
function renderReadTool(ctx: ToolContext): React.ReactNode {
  const filePath = typeof ctx.input.file_path === "string" ? ctx.input.file_path : "文件";
  return (
    <CollapsibleSection
      title={`Read: ${filePath}`}
      icon={<Wrench size={14} className="text-blue-500" />}
      defaultOpen={false}
    >
      {ctx.resultText ? (
        <pre className="rounded-md bg-gray-900 text-gray-100 p-3 text-xs font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words">
          {ctx.resultText.length > 2000 ? `${ctx.resultText.slice(0, 2000)}...(已截断)` : ctx.resultText}
        </pre>
      ) : (
        <p className="text-xs text-gray-500 italic">（无内容）</p>
      )}
    </CollapsibleSection>
  );
}

/**
 * 渲染未知工具的 JSON 输入/输出
 *
 * @example
 * ```tsx
 * renderDefaultTool({ toolName: "Custom", input: {}, resultText: "OK", isError: false });
 * ```
 */
function renderDefaultTool(ctx: ToolContext): React.ReactNode {
  return (
    <CollapsibleSection
      title={ctx.toolName}
      icon={<Wrench size={14} className="text-gray-500" />}
      badge={ctx.isError ? "error" : undefined}
      defaultOpen={false}
    >
      <div className="space-y-2">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">输入：</p>
          <pre className="rounded-md bg-gray-100 p-2 text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
            {safeStringify(ctx.input)}
          </pre>
        </div>
        {ctx.resultText && (
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">输出：</p>
            <pre
              className={`rounded-md p-2 text-xs font-mono overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-words ${
                ctx.isError ? "bg-red-50 text-red-800" : "bg-gray-100 text-gray-800"
              }`}
            >
              {ctx.resultText}
            </pre>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

/** 工具名称到渲染函数的映射 */
const TOOL_RENDERERS: Record<string, (ctx: ToolContext) => React.ReactNode> = {
  Edit: renderDiffTool,
  Write: renderDiffTool,
  Bash: renderBashTool,
  Glob: renderFileSearchTool,
  Grep: renderFileSearchTool,
  Read: renderReadTool,
};

/**
 * 工具渲染分发器
 *
 * 根据 toolName 将工具调用消息分发到专门的渲染组件。
 * 支持 Edit、Write、Bash、Glob、Grep、Read 等工具的专用渲染，
 * 未知工具类型则以 JSON 形式展示输入/输出。
 *
 * @example
 * ```tsx
 * import { ToolRenderer } from "./ToolRenderer";
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const toolUse: NormalizedMessage = {
 *   id: "msg_001",
 *   sessionId: "sess_abc",
 *   timestamp: new Date().toISOString(),
 *   provider: "claude",
 *   kind: "tool_use",
 *   toolName: "Bash",
 *   toolInput: { command: "ls -la" },
 *   toolId: "tool_001",
 * };
 *
 * <ToolRenderer message={toolUse} />
 * ```
 */
export function ToolRenderer({ message, result }: ToolRendererProps) {
  const toolName = message.toolName ?? "unknown";
  const ctx: ToolContext = {
    toolName,
    input: toRecord(message.toolInput),
    resultText: getResultText(result),
    isError: result?.toolResult?.isError === true,
    result,
  };

  const renderer = TOOL_RENDERERS[toolName];
  return <>{renderer ? renderer(ctx) : renderDefaultTool(ctx)}</>;
}
