import type { NormalizedMessage } from "@teamsland/types";
import { Agent, AgentContent, AgentHeader, AgentInstructions, AgentOutput } from "@teamsland/ui/elements/agent";
import { CodeBlock } from "@teamsland/ui/elements/code-block";
import { MessageResponse } from "@teamsland/ui/elements/message";
import { Plan, PlanAction, PlanContent, PlanHeader, PlanTitle, PlanTrigger } from "@teamsland/ui/elements/plan";
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from "@teamsland/ui/elements/task";
import { Tool, ToolContent, ToolHeader, ToolOutput } from "@teamsland/ui/elements/tool";
import type { ToolState } from "@teamsland/ui/elements/types";
import { cn } from "@teamsland/ui/lib/utils";
import { BookOpen, CheckCircle2, Circle, FileText, Loader2, Wrench } from "lucide-react";
import type { BundledLanguage } from "shiki";
import { BashOutput } from "./BashOutput";
import { ToolDiffViewer } from "./ToolDiffViewer";

/**
 * 工具渲染器组件属性
 *
 * @example
 * ```tsx
 * <ToolRenderer message={toolUseMessage} result={toolResultMessage} />
 * ```
 */
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 从文件路径推断 Shiki 高亮语言
 *
 * @example
 * ```ts
 * inferLanguage("/src/index.ts"); // "typescript"
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
    toml: "toml",
    sql: "sql",
  };
  return (langMap[ext] ?? "text") as BundledLanguage;
}

/**
 * 从结果和错误状态推导 ToolState
 *
 * @example
 * ```ts
 * deriveToolState("OK", false); // "output-available"
 * deriveToolState(undefined, false); // "input-available"
 * ```
 */
function deriveToolState(resultText: string | undefined, isError: boolean): ToolState {
  if (isError) return "output-error";
  if (resultText !== undefined) return "output-available";
  return "input-available";
}

interface ToolContext {
  toolName: string;
  input: Record<string, unknown>;
  resultText: string | undefined;
  isError: boolean;
  result?: NormalizedMessage;
}

function renderDiffTool(ctx: ToolContext): React.ReactNode {
  return <ToolDiffViewer toolName={ctx.toolName} toolInput={ctx.input} result={ctx.resultText} />;
}

function renderBashTool(ctx: ToolContext): React.ReactNode {
  const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
  return <BashOutput command={command} output={ctx.resultText} isError={ctx.isError} />;
}

/**
 * 渲染搜索工具（Glob/Grep，使用 Task 组件展示搜索结果）
 *
 * @example
 * ```tsx
 * renderFileSearchTool({ toolName: "Grep", input: { pattern: "TODO" }, resultText: "a.ts\nb.ts", isError: false });
 * ```
 */
function renderFileSearchTool(ctx: ToolContext): React.ReactNode {
  const pattern = typeof ctx.input.pattern === "string" ? ctx.input.pattern : undefined;
  const path = typeof ctx.input.path === "string" ? ctx.input.path : undefined;
  const title = pattern ? `${ctx.toolName}: ${pattern}` : path ? `${ctx.toolName}: ${path}` : ctx.toolName;

  const resultData = ctx.result?.toolResult?.toolUseResult;
  let files = toStringArray(resultData);

  if (files.length === 0 && ctx.resultText) {
    files = ctx.resultText.split("\n").filter((line) => line.trim().length > 0);
  }

  const MAX_FILES = 20;
  const hasMore = files.length > MAX_FILES;
  const displayFiles = hasMore ? files.slice(0, MAX_FILES) : files;

  return (
    <Task defaultOpen={false}>
      <TaskTrigger title={title} />
      <TaskContent>
        {displayFiles.length > 0 ? (
          <>
            {displayFiles.map((file) => (
              <TaskItem key={file}>
                <TaskItemFile>
                  <FileText className="size-3" />
                  {file}
                </TaskItemFile>
              </TaskItem>
            ))}
            {hasMore && (
              <TaskItem>
                <span className="text-xs italic">还有 {files.length - MAX_FILES} 个文件...</span>
              </TaskItem>
            )}
          </>
        ) : (
          <TaskItem>
            <span className="italic">未找到匹配文件</span>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  );
}

/**
 * 渲染 Read 工具（使用 CodeBlock 展示文件内容）
 *
 * @example
 * ```tsx
 * renderReadTool({ toolName: "Read", input: { file_path: "/a.ts" }, resultText: "content", isError: false });
 * ```
 */
function renderReadTool(ctx: ToolContext): React.ReactNode {
  const filePath = typeof ctx.input.file_path === "string" ? ctx.input.file_path : "文件";
  const state = deriveToolState(ctx.resultText, ctx.isError);
  const language = inferLanguage(filePath);
  const displayContent = ctx.resultText
    ? ctx.resultText.length > 2000
      ? `${ctx.resultText.slice(0, 2000)}...(已截断)`
      : ctx.resultText
    : "";

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        type="tool-invocation"
        state={state}
        title={`Read: ${filePath}`}
        icon={<BookOpen className="size-4 text-muted-foreground" />}
      />
      <ToolContent>
        {displayContent ? (
          <CodeBlock code={displayContent} language={language} showLineNumbers />
        ) : (
          <p className="text-xs text-muted-foreground italic">（无内容）</p>
        )}
      </ToolContent>
    </Tool>
  );
}

/**
 * 渲染 Agent/Task 子代理工具调用（使用 Agent 组件展示）
 *
 * @example
 * ```tsx
 * renderAgentTool({ toolName: "Task", input: { description: "搜索", query: "..." }, resultText: "Done", isError: false });
 * ```
 */
function renderAgentTool(ctx: ToolContext): React.ReactNode {
  const description = typeof ctx.input.description === "string" ? ctx.input.description : undefined;
  const query = typeof ctx.input.query === "string" ? ctx.input.query : undefined;
  const subagentType = typeof ctx.input.subagent_type === "string" ? ctx.input.subagent_type : undefined;
  const agentName = description ?? subagentType ?? ctx.toolName;

  return (
    <Agent>
      <AgentHeader name={agentName} model={subagentType} />
      <AgentContent>
        {query && <AgentInstructions>{query}</AgentInstructions>}
        {ctx.resultText && (
          <AgentOutput>
            <p className={ctx.isError ? "text-destructive" : "text-foreground"}>
              {ctx.resultText.length > 3000 ? `${ctx.resultText.slice(0, 3000)}...` : ctx.resultText}
            </p>
          </AgentOutput>
        )}
      </AgentContent>
    </Agent>
  );
}

/**
 * 渲染未知工具（使用 ToolOutput 展示 JSON）
 *
 * @example
 * ```tsx
 * renderDefaultTool({ toolName: "Custom", input: {}, resultText: "OK", isError: false });
 * ```
 */
function renderDefaultTool(ctx: ToolContext): React.ReactNode {
  const state = deriveToolState(ctx.resultText, ctx.isError);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        type="tool-invocation"
        state={state}
        title={ctx.toolName}
        icon={<Wrench className="size-4 text-muted-foreground" />}
      />
      <ToolContent>
        <div className="space-y-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wide">参数</p>
            <CodeBlock code={safeStringify(ctx.input)} language="json" />
          </div>
          {ctx.resultText && (
            <ToolOutput output={ctx.resultText} errorText={ctx.isError ? ctx.resultText : undefined} />
          )}
        </div>
      </ToolContent>
    </Tool>
  );
}

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

function statusIcon(status: string): React.ReactNode {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 shrink-0 text-green-500" />;
    case "in_progress":
      return <Loader2 className="size-4 shrink-0 text-blue-500 animate-spin" />;
    default:
      return <Circle className="size-4 shrink-0 text-muted-foreground" />;
  }
}

/**
 * 渲染 TodoWrite 工具（任务清单，带状态图标）
 *
 * @example
 * ```tsx
 * renderTodoWriteTool({ toolName: "TodoWrite", input: { todos: [{ content: "写测试", status: "completed", activeForm: "写测试中" }] }, resultText: undefined, isError: false });
 * ```
 */
function renderTodoWriteTool(ctx: ToolContext): React.ReactNode {
  const rawTodos = Array.isArray(ctx.input.todos) ? ctx.input.todos : [];
  const todos = rawTodos.filter(
    (t): t is TodoItem => typeof t === "object" && t !== null && typeof (t as TodoItem).content === "string",
  );
  const completedCount = todos.filter((t) => t.status === "completed").length;

  return (
    <Task defaultOpen>
      <TaskTrigger title={`任务清单 (${completedCount}/${todos.length} 完成)`} />
      <TaskContent>
        {todos.length === 0 ? (
          <TaskItem>
            <span className="text-xs italic text-muted-foreground">空任务列表</span>
          </TaskItem>
        ) : (
          todos.map((todo, i) => (
            <TaskItem key={`${todo.content}-${String(i)}`}>
              <div className="flex items-center gap-2">
                {statusIcon(todo.status)}
                <span
                  className={cn(
                    "text-sm",
                    todo.status === "completed" && "line-through text-muted-foreground",
                    todo.status === "in_progress" && "font-medium",
                  )}
                >
                  {todo.status === "in_progress" && todo.activeForm ? todo.activeForm : todo.content}
                </span>
              </div>
            </TaskItem>
          ))
        )}
      </TaskContent>
    </Task>
  );
}

/**
 * 渲染 ExitPlanMode 工具（实施计划卡片）
 *
 * @example
 * ```tsx
 * renderExitPlanModeTool({ toolName: "ExitPlanMode", input: { plan: "## Step 1\n..." }, resultText: undefined, isError: false });
 * ```
 */
function renderExitPlanModeTool(ctx: ToolContext): React.ReactNode {
  const planText = typeof ctx.input.plan === "string" ? ctx.input.plan : "";

  return (
    <Plan defaultOpen>
      <PlanHeader>
        <PlanTitle>实施计划</PlanTitle>
        <PlanAction>
          <PlanTrigger />
        </PlanAction>
      </PlanHeader>
      {planText && (
        <PlanContent>
          <MessageResponse>{planText}</MessageResponse>
        </PlanContent>
      )}
    </Plan>
  );
}

const TOOL_RENDERERS: Record<string, (ctx: ToolContext) => React.ReactNode> = {
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

/**
 * 工具渲染分发器
 *
 * 根据 toolName 将工具调用消息分发到专门的渲染组件。
 * 所有工具均使用 AI Elements Tool/ToolHeader/ToolContent 体系，
 * 支持统一的折叠、状态徽章、Shiki 高亮和 ANSI 渲染能力。
 *
 * @example
 * ```tsx
 * <ToolRenderer message={toolUse} result={toolResult} />
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
