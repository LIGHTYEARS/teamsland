import type { NormalizedMessage } from "@teamsland/types";
import { CodeBlock } from "@teamsland/ui/elements/code-block";
import { MessageResponse } from "@teamsland/ui/elements/message";
import { cn } from "@teamsland/ui/lib/utils";
import Ansi from "ansi-to-react";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileEdit,
  FilePlus,
  Loader2,
  Search,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { BundledLanguage } from "shiki";

export interface ToolRendererProps {
  message: NormalizedMessage;
  result?: NormalizedMessage;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function getResultText(resultMsg?: NormalizedMessage): string | undefined {
  return resultMsg?.toolResult?.content;
}

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
    toml: "toml",
    sql: "sql",
  };
  return (langMap[ext] ?? "text") as BundledLanguage;
}

function CompactTool({
  icon,
  label,
  children,
  defaultOpen = true,
}: {
  icon: ReactNode;
  label: string;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const hasContent = children != null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => hasContent && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 transition-colors text-left",
          hasContent && "cursor-pointer",
          !hasContent && "cursor-default",
        )}
      >
        <span className="shrink-0 text-muted-foreground/70">{icon}</span>
        <span className="truncate font-mono">{label}</span>
        {hasContent && (
          <ChevronRight
            className={cn("ml-auto size-3 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-90")}
          />
        )}
      </button>
      {open && hasContent && <div className="mt-1 ml-5 overflow-hidden rounded">{children}</div>}
    </div>
  );
}

interface ToolContext {
  toolName: string;
  input: Record<string, unknown>;
  resultText: string | undefined;
  isError: boolean;
  result?: NormalizedMessage;
}

function renderDiffTool(ctx: ToolContext): ReactNode {
  const filePath = typeof ctx.input.file_path === "string" ? ctx.input.file_path : "file";
  const isEdit = ctx.toolName === "Edit";
  const icon = isEdit ? <FileEdit className="size-3" /> : <FilePlus className="size-3" />;
  const shortPath = filePath.split("/").slice(-2).join("/");

  if (isEdit) {
    const oldString = typeof ctx.input.old_string === "string" ? ctx.input.old_string : "";
    const newString = typeof ctx.input.new_string === "string" ? ctx.input.new_string : "";
    const hasContent = oldString || newString;

    return (
      <CompactTool icon={icon} label={`${ctx.toolName} ${shortPath}`}>
        {hasContent && (
          <div className="font-mono text-[11px] overflow-x-auto max-h-60 overflow-y-auto">
            {oldString.split("\n").map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines never reorder
              <div key={`o${i}`} className="bg-destructive/10 text-destructive px-2 py-px">
                <span className="select-none text-destructive/50 mr-1">-</span>
                {line}
              </div>
            ))}
            {newString.split("\n").map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines never reorder
              <div key={`n${i}`} className="bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-px">
                <span className="select-none text-green-500/50 mr-1">+</span>
                {line}
              </div>
            ))}
          </div>
        )}
      </CompactTool>
    );
  }

  const content = typeof ctx.input.content === "string" ? ctx.input.content : "";
  const preview = content.length > 500 ? `${content.slice(0, 500)}…` : content;

  return (
    <CompactTool icon={icon} label={`Write ${shortPath}`}>
      {preview && (
        <div className="max-h-40 overflow-y-auto">
          <CodeBlock code={preview} language={inferLanguage(filePath)} />
        </div>
      )}
    </CompactTool>
  );
}

function renderBashTool(ctx: ToolContext): ReactNode {
  const command = typeof ctx.input.command === "string" ? ctx.input.command : "bash";
  const truncated = command.length > 80 ? `${command.slice(0, 80)}…` : command;

  return (
    <CompactTool icon={<TerminalSquare className="size-3" />} label={truncated}>
      {ctx.resultText && (
        <pre className="p-2 font-mono text-[11px] overflow-auto max-h-60 whitespace-pre-wrap break-words text-foreground bg-muted">
          <Ansi>{ctx.resultText}</Ansi>
        </pre>
      )}
    </CompactTool>
  );
}

function renderFileSearchTool(ctx: ToolContext): ReactNode {
  const pattern = typeof ctx.input.pattern === "string" ? ctx.input.pattern : undefined;
  const path = typeof ctx.input.path === "string" ? ctx.input.path : undefined;
  const label = pattern ?? path ?? ctx.toolName;

  const resultData = ctx.result?.toolResult?.toolUseResult;
  let files = toStringArray(resultData);
  if (files.length === 0 && ctx.resultText) {
    files = ctx.resultText.split("\n").filter((line) => line.trim().length > 0);
  }

  return (
    <CompactTool
      icon={<Search className="size-3" />}
      label={`${ctx.toolName} ${label}${files.length > 0 ? ` (${files.length})` : ""}`}
    >
      {files.length > 0 && (
        <div className="px-2 py-1 text-[11px] font-mono max-h-40 overflow-y-auto space-y-px">
          {files.slice(0, 20).map((f) => (
            <div key={f} className="text-muted-foreground truncate">
              {f}
            </div>
          ))}
          {files.length > 20 && <div className="text-muted-foreground/60 italic">+{files.length - 20} more</div>}
        </div>
      )}
    </CompactTool>
  );
}

function renderReadTool(ctx: ToolContext): ReactNode {
  const filePath = typeof ctx.input.file_path === "string" ? ctx.input.file_path : "file";
  const shortPath = filePath.split("/").slice(-2).join("/");
  const content = ctx.resultText
    ? ctx.resultText.length > 2000
      ? `${ctx.resultText.slice(0, 2000)}…`
      : ctx.resultText
    : "";

  return (
    <CompactTool icon={<BookOpen className="size-3" />} label={`Read ${shortPath}`}>
      {content && (
        <div className="max-h-60 overflow-y-auto">
          <CodeBlock code={content} language={inferLanguage(filePath)} />
        </div>
      )}
    </CompactTool>
  );
}

function renderAgentTool(ctx: ToolContext): ReactNode {
  const description = typeof ctx.input.description === "string" ? ctx.input.description : undefined;
  const query = typeof ctx.input.query === "string" ? ctx.input.query : undefined;
  const name = description ?? query ?? ctx.toolName;
  const truncated = name.length > 80 ? `${name.slice(0, 80)}…` : name;

  return (
    <CompactTool icon={<Circle className="size-3" />} label={`Agent: ${truncated}`}>
      {ctx.resultText && (
        <div className="p-2 text-xs max-h-40 overflow-y-auto">
          <MessageResponse>
            {ctx.resultText.length > 3000 ? `${ctx.resultText.slice(0, 3000)}…` : ctx.resultText}
          </MessageResponse>
        </div>
      )}
    </CompactTool>
  );
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

function renderTodoWriteTool(ctx: ToolContext): ReactNode {
  const rawTodos = Array.isArray(ctx.input.todos) ? ctx.input.todos : [];
  const todos = rawTodos.filter(
    (t): t is TodoItem => typeof t === "object" && t !== null && typeof (t as TodoItem).content === "string",
  );
  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <CompactTool
      icon={<CheckCircle2 className="size-3" />}
      label={`Tasks (${completedCount}/${todos.length})`}
      defaultOpen
    >
      <div className="px-2 py-1 space-y-0.5">
        {todos.map((todo, i) => (
          <div key={`${todo.content}-${String(i)}`} className="flex items-center gap-1.5 text-[11px]">
            {todo.status === "completed" ? (
              <CheckCircle2 className="size-3 shrink-0 text-green-500" />
            ) : todo.status === "in_progress" ? (
              <Loader2 className="size-3 shrink-0 text-blue-500 animate-spin" />
            ) : (
              <Circle className="size-3 shrink-0 text-muted-foreground/50" />
            )}
            <span className={cn("truncate", todo.status === "completed" && "line-through text-muted-foreground")}>
              {todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </CompactTool>
  );
}

function renderExitPlanModeTool(ctx: ToolContext): ReactNode {
  const planText = typeof ctx.input.plan === "string" ? ctx.input.plan : "";

  return (
    <CompactTool icon={<FileEdit className="size-3" />} label="Implementation Plan" defaultOpen>
      {planText && (
        <div className="p-2 text-xs">
          <MessageResponse>{planText}</MessageResponse>
        </div>
      )}
    </CompactTool>
  );
}

function renderDefaultTool(ctx: ToolContext): ReactNode {
  return (
    <CompactTool icon={<Wrench className="size-3" />} label={ctx.toolName}>
      {ctx.resultText && (
        <pre className="p-2 font-mono text-[11px] overflow-auto max-h-40 whitespace-pre-wrap break-words text-foreground bg-muted">
          {ctx.resultText.length > 500 ? `${ctx.resultText.slice(0, 500)}…` : ctx.resultText}
        </pre>
      )}
    </CompactTool>
  );
}

const TOOL_RENDERERS: Record<string, (ctx: ToolContext) => ReactNode> = {
  Edit: renderDiffTool,
  Write: renderDiffTool,
  Bash: renderBashTool,
  Glob: renderFileSearchTool,
  Grep: renderFileSearchTool,
  Read: renderReadTool,
  Task: renderAgentTool,
  delegate: renderAgentTool,
  spawn_agent: renderAgentTool,
  TodoWrite: renderTodoWriteTool,
  ExitPlanMode: renderExitPlanModeTool,
};

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
