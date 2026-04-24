/**
 * 消息类型枚举
 *
 * 定义了系统中所有可能的消息种类，涵盖文本消息、工具调用、
 * 流式传输、错误处理、会话管理等场景。
 *
 * @example
 * ```ts
 * import type { MessageKind } from "@teamsland/types";
 *
 * const kind: MessageKind = "text";
 * const streamKind: MessageKind = "stream_delta";
 * ```
 */
export type MessageKind =
  | "text"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "stream_delta"
  | "stream_end"
  | "error"
  | "complete"
  | "status"
  | "permission_request"
  | "permission_cancelled"
  | "session_created"
  | "interactive_prompt"
  | "task_notification";

/**
 * 归一化消息格式 — Provider 无关的统一消息信封
 *
 * 所有 session 消息（无论来自 JSONL 历史还是实时流）
 * 都归一化为此格式后交给前端渲染。
 *
 * @example
 * ```ts
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const msg: NormalizedMessage = {
 *   id: "msg_001",
 *   sessionId: "sess_abc",
 *   timestamp: "2026-04-23T10:00:00.000Z",
 *   provider: "claude",
 *   kind: "text",
 *   role: "assistant",
 *   content: "你好，有什么可以帮助你的？",
 * };
 * ```
 *
 * @example
 * ```ts
 * import type { NormalizedMessage } from "@teamsland/types";
 *
 * const toolMsg: NormalizedMessage = {
 *   id: "msg_002",
 *   sessionId: "sess_abc",
 *   timestamp: "2026-04-23T10:01:00.000Z",
 *   provider: "claude",
 *   kind: "tool_use",
 *   toolName: "read_file",
 *   toolInput: { path: "/src/index.ts" },
 *   toolId: "tool_xyz",
 * };
 * ```
 */
export interface NormalizedMessage {
  /** 消息唯一标识 */
  id: string;
  /** 所属会话 ID */
  sessionId: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** LLM 提供商 */
  provider: "claude";
  /** 消息类型 */
  kind: MessageKind;

  // kind='text' / 'stream_delta'
  /** 消息角色（用户或助手） */
  role?: "user" | "assistant";
  /** 文本内容 */
  content?: string;
  /** 图片 URL 列表 */
  images?: string[];

  // kind='tool_use'
  /** 工具名称 */
  toolName?: string;
  /** 工具输入参数 */
  toolInput?: unknown;
  /** 工具调用 ID */
  toolId?: string;

  // kind='tool_result'
  /** 工具执行结果 */
  toolResult?: {
    /** 结果文本内容 */
    content?: string;
    /** 是否为错误结果 */
    isError?: boolean;
    /** 工具使用结果的原始数据 */
    toolUseResult?: unknown;
  };

  // kind='error'
  /** 是否为错误消息 */
  isError?: boolean;

  // kind='status'
  /** 状态文本 */
  text?: string;
  /** Token 使用量 */
  tokens?: number;
  /** 是否可中断 */
  canInterrupt?: boolean;
  /** Token 预算信息 */
  tokenBudget?: { used: number; total: number };

  // kind='permission_request'
  /** 权限请求 ID */
  requestId?: string;
  /** 权限请求输入 */
  input?: unknown;
  /** 权限请求上下文 */
  context?: unknown;

  // kind='session_created'
  /** 新创建的会话 ID */
  newSessionId?: string;

  // kind='complete'
  /** 退出码 */
  exitCode?: number;
  /** 完成摘要 */
  summary?: string;
  /** 请求耗费（美元） */
  cost?: number;
  /** 请求耗时（毫秒） */
  durationMs?: number;

  // Sub-agent
  /** 父级工具调用 ID，用于子代理场景 */
  parentToolUseId?: string;
  /** 子代理可用工具列表 */
  subagentTools?: unknown[];

  // Streaming
  /** 是否为流的最终消息 */
  isFinal?: boolean;
}

/**
 * 获取历史消息的选项
 *
 * 用于从持久化存储中分页查询某个 session 的历史消息记录。
 *
 * @example
 * ```ts
 * import type { FetchHistoryOptions } from "@teamsland/types";
 *
 * const opts: FetchHistoryOptions = {
 *   sessionId: "sess_abc",
 *   projectName: "my-project",
 *   limit: 50,
 *   offset: 0,
 * };
 * ```
 */
export interface FetchHistoryOptions {
  /** 目标会话 ID */
  sessionId: string;
  /** 项目名称 */
  projectName: string;
  /** 每页返回消息数量上限 */
  limit?: number;
  /** 分页偏移量 */
  offset?: number;
}

/**
 * 获取历史消息的结果
 *
 * 包含分页后的消息列表以及总量信息，用于前端渲染历史消息。
 *
 * @example
 * ```ts
 * import type { FetchHistoryResult, NormalizedMessage } from "@teamsland/types";
 *
 * const result: FetchHistoryResult = {
 *   messages: [
 *     {
 *       id: "msg_001",
 *       sessionId: "sess_abc",
 *       timestamp: "2026-04-23T10:00:00.000Z",
 *       provider: "claude",
 *       kind: "text",
 *       role: "user",
 *       content: "帮我重构这个模块",
 *     },
 *   ],
 *   total: 128,
 *   hasMore: true,
 * };
 * ```
 */
export interface FetchHistoryResult {
  /** 消息列表 */
  messages: NormalizedMessage[];
  /** 总消息数 */
  total: number;
  /** 是否还有更多消息 */
  hasMore: boolean;
}
