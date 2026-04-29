import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type { InterruptController, ProcessController, SidecarDataPlane, SubagentRegistry } from "@teamsland/sidecar";
import type { NormalizedMessage } from "@teamsland/types";
import { validatePath } from "./file-routes.js";
import type { TerminalService } from "./terminal-service.js";

const logger = createLogger("server:dashboard-ws");

/** 归一化消息推送（展平 NormalizedMessage 字段到顶层） */
interface WsNormalizedMessage {
  type: "normalized_message";
  [key: string]: unknown;
}

/** claude-command 处理错误响应 */
interface WsCommandError {
  type: "claude-command-error";
  sessionId: string;
  error: string;
  message: string;
}

/** claude-command 处理确认响应 */
interface WsCommandAck {
  type: "claude-command-ack";
  sessionId: string;
  agentId: string;
}

/** WebSocket 客户端消息类型定义 */
interface WsClientMessage {
  type: string;
  [key: string]: unknown;
}

/** WebSocket 消息处理所需的服务上下文 */
export interface WsHandlerContext {
  terminalService: TerminalService;
  wsTerminals: Map<unknown, Set<string>>;
  registry: SubagentRegistry;
  processController: ProcessController;
  dataPlane: SidecarDataPlane;
  clients: Set<unknown>;
  interruptController?: InterruptController;
  sessionDb?: SessionDB;
  teamId?: string;
}

/**
 * 处理 WebSocket 客户端消息，分派到终端、claude-command 等处理逻辑
 *
 * @example
 * ```typescript
 * handleWsMessage(ws, rawMessage, wsContext);
 * ```
 */
export function handleWsMessage(ws: unknown, message: string | Buffer, ctx: WsHandlerContext): void {
  let parsed: WsClientMessage;
  try {
    parsed = JSON.parse(String(message)) as WsClientMessage;
  } catch {
    logger.debug({ message: String(message).slice(0, 100) }, "WebSocket 消息解析失败");
    return;
  }

  const sender = ws as { send(data: string): void };

  if (parsed.type.startsWith("terminal-")) {
    handleTerminalMessage(parsed, sender, ctx.terminalService, ws, ctx.wsTerminals);
    return;
  }

  if (parsed.type === "claude-command") {
    handleClaudeCommand(parsed, sender, ctx).catch((err: unknown) => {
      logger.error({ err }, "claude-command 处理失败");
    });
    return;
  }

  if (parsed.type === "abort-session") {
    handleAbortSession(parsed, sender, ctx);
    return;
  }

  logger.debug({ type: parsed.type }, "WebSocket 收到未识别的消息类型");
}

/** 序列化并广播到所有连接的客户端 */
function broadcast(clients: Set<unknown>, message: WsNormalizedMessage): void {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    try {
      (ws as { send(data: string): void }).send(payload);
    } catch {
      // 忽略已断开的连接，close 事件会清理
    }
  }
}

/**
 * 分派 terminal-start/input/resize/stop 消息到对应处理逻辑
 *
 * @example
 * ```typescript
 * handleTerminalMessage(parsed, sender, terminalService, ws, wsTerminals);
 * ```
 */
function handleTerminalMessage(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  terminalService: TerminalService,
  ws: unknown,
  wsTerminals: Map<unknown, Set<string>>,
): void {
  switch (parsed.type) {
    case "terminal-start":
      handleTerminalStart(parsed, sender, terminalService, ws, wsTerminals).catch((err: unknown) => {
        logger.error({ err }, "终端启动处理失败");
      });
      break;
    case "terminal-input":
      handleTerminalInput(parsed, terminalService);
      break;
    case "terminal-resize":
      handleTerminalResize(parsed, terminalService);
      break;
    case "terminal-stop":
      handleTerminalStop(parsed, sender, terminalService, ws, wsTerminals);
      break;
    default:
      logger.debug({ type: parsed.type }, "WebSocket 收到未识别的终端消息类型");
  }
}

/** 处理终端输入消息 */
function handleTerminalInput(parsed: WsClientMessage, terminalService: TerminalService): void {
  const id = typeof parsed.id === "string" ? parsed.id : "";
  const data = typeof parsed.data === "string" ? parsed.data : "";
  if (id && data) {
    terminalService.write(id, data);
  }
}

/** 处理终端尺寸调整消息 */
function handleTerminalResize(parsed: WsClientMessage, terminalService: TerminalService): void {
  const id = typeof parsed.id === "string" ? parsed.id : "";
  const cols = typeof parsed.cols === "number" ? Math.trunc(Math.min(Math.max(parsed.cols, 1), 500)) : 0;
  const rows = typeof parsed.rows === "number" ? Math.trunc(Math.min(Math.max(parsed.rows, 1), 500)) : 0;
  if (id && cols > 0 && rows > 0) {
    terminalService.resize(id, cols, rows);
  }
}

/** 处理终端停止消息 */
function handleTerminalStop(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  terminalService: TerminalService,
  ws: unknown,
  wsTerminals: Map<unknown, Set<string>>,
): void {
  const id = typeof parsed.id === "string" ? parsed.id : "";
  if (!id) return;

  terminalService.destroy(id);
  wsTerminals.get(ws)?.delete(id);
  try {
    sender.send(JSON.stringify({ type: "terminal-stopped", id }));
  } catch {
    // WebSocket 可能已断开
  }
}

/**
 * 创建 PTY 终端会话，通过回调将输出数据实时转发到 WebSocket 客户端
 *
 * @example
 * ```typescript
 * await handleTerminalStart(parsed, sender, terminalService, ws, wsTerminals);
 * ```
 */
async function handleTerminalStart(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  terminalService: TerminalService,
  ws: unknown,
  wsTerminals: Map<unknown, Set<string>>,
): Promise<void> {
  const id = typeof parsed.id === "string" ? parsed.id : `term-${Date.now()}`;
  const cwd = typeof parsed.cwd === "string" ? parsed.cwd : process.cwd();

  let validatedCwd: string | null;
  try {
    validatedCwd = await validatePath(cwd);
  } catch (err) {
    logger.error({ err, cwd }, "终端工作目录验证异常");
    try {
      sender.send(JSON.stringify({ type: "terminal-error", id, error: "工作目录验证失败" }));
    } catch {
      // WebSocket 可能已断开
    }
    return;
  }
  if (!validatedCwd) {
    sender.send(JSON.stringify({ type: "terminal-error", id, error: "工作目录路径无效" }));
    return;
  }

  const decoder = new TextDecoder();
  const ok = terminalService.create(id, validatedCwd, {
    cols: typeof parsed.cols === "number" ? parsed.cols : undefined,
    rows: typeof parsed.rows === "number" ? parsed.rows : undefined,
    onData: (data) => {
      try {
        const text = decoder.decode(data, { stream: true });
        sender.send(JSON.stringify({ type: "terminal-output", id, data: text }));
      } catch {
        // WebSocket 可能已断开
      }
    },
    onExit: () => {
      // flush TextDecoder 残留的不完整 UTF-8 字节
      try {
        const remaining = decoder.decode();
        if (remaining) {
          sender.send(JSON.stringify({ type: "terminal-output", id, data: remaining }));
        }
      } catch {
        // WebSocket 可能已断开
      }
      // 仅在会话仍存在时（即非主动 destroy）发送 stopped
      if (terminalService.has(id)) {
        terminalService.destroy(id);
        wsTerminals.get(ws)?.delete(id);
        try {
          sender.send(JSON.stringify({ type: "terminal-stopped", id }));
        } catch {
          // WebSocket 可能已断开
        }
      }
    },
  });

  if (!ok) {
    sender.send(JSON.stringify({ type: "terminal-error", id, error: "终端会话已存在" }));
    return;
  }

  // 注册 ws → terminal 映射
  let termIds = wsTerminals.get(ws);
  if (!termIds) {
    termIds = new Set();
    wsTerminals.set(ws, termIds);
  }
  termIds.add(id);

  sender.send(JSON.stringify({ type: "terminal-started", id }));
}

/**
 * 从 session JSONL 文件中提取工作目录
 *
 * 在 `~/.claude/projects/` 下扫描所有项目目录，查找匹配 sessionId 的 JSONL 文件，
 * 解析其中的 `cwd` 字段作为工作目录。
 *
 * @param sessionId - Session ID
 * @returns 工作目录路径，未找到时返回 null
 *
 * @example
 * ```typescript
 * const cwd = await resolveSessionCwd("sess-abc123");
 * ```
 */
async function resolveSessionCwd(sessionId: string): Promise<string | null> {
  const projectsDir = resolve(homedir(), ".claude/projects");
  const fileName = `${sessionId}.jsonl`;

  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = join(projectsDir, entry.name, fileName);
      const file = Bun.file(filePath);
      if (!(await file.exists())) continue;

      const cwd = parseCwdFromJsonl(await file.text());
      if (cwd) return cwd;
    }
  } catch {
    // 目录不存在或不可读
  }

  return null;
}

/** 从 Claude session JSONL 文本中提取首个 cwd 字段 */
function parseCwdFromJsonl(text: string): string | null {
  for (const line of text.split("\n")) {
    const cwd = parseCwdFromLine(line);
    if (cwd) return cwd;
  }
  return null;
}

/** 从单行 JSONL 中提取 cwd，格式错误时返回 null */
function parseCwdFromLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof parsed.cwd === "string" && parsed.cwd ? parsed.cwd : null;
  } catch {
    return null;
  }
}

/**
 * 处理 Dashboard 用户发送的 abort-session 消息
 *
 * 通过 registry 查找 sessionId 对应的运行中 agent，使用 InterruptController 发送中断信号。
 *
 * @param parsed - 解析后的 WebSocket 消息（需包含 sessionId 字段）
 * @param sender - 消息发送方的 WebSocket 连接
 * @param ctx - WebSocket 处理上下文
 *
 * @example
 * ```typescript
 * handleAbortSession(
 *   { type: "abort-session", sessionId: "sess-abc" },
 *   sender,
 *   wsContext,
 * );
 * ```
 */
function handleAbortSession(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  ctx: WsHandlerContext,
): void {
  const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
  if (!sessionId) {
    logger.warn("abort-session: 缺少 sessionId");
    return;
  }

  const record = ctx.registry.findBySessionId(sessionId);
  if (!record) {
    logger.debug({ sessionId }, "abort-session: 未找到对应运行中的 agent");
    sendWsJson(sender, {
      type: "claude-command-error",
      sessionId,
      error: "not_found",
      message: "未找到运行中的会话",
    });
    return;
  }

  if (!ctx.interruptController) {
    logger.warn("abort-session: InterruptController 不可用");
    return;
  }

  logger.info({ sessionId, agentId: record.agentId }, "Dashboard 用户请求中止会话");
  ctx.interruptController.interrupt({ agentId: record.agentId, reason: "user_abort_from_dashboard" }).catch((err) => {
    logger.error({ err, agentId: record.agentId }, "abort-session 中断失败");
  });
}

/**
 * 处理 Dashboard 用户发送的 claude-command 消息
 *
 * 当用户在 Dashboard 聊天界面发送消息时，通过 `claude -p --resume <sessionId>`
 * 启动新进程续写已有会话，并将流式输出通过 WebSocket 广播。
 *
 * @param parsed - 解析后的 WebSocket 消息（需包含 sessionId 和 content 字段）
 * @param sender - 消息发送方的 WebSocket 连接
 * @param ctx - WebSocket 处理上下文
 *
 * @example
 * ```typescript
 * await handleClaudeCommand(
 *   { type: "claude-command", sessionId: "sess-abc", content: "请继续" },
 *   sender,
 *   wsContext,
 * );
 * ```
 */
async function handleClaudeCommand(
  parsed: WsClientMessage,
  sender: { send(data: string): void },
  ctx: WsHandlerContext,
): Promise<void> {
  const sessionId = typeof parsed.sessionId === "string" ? parsed.sessionId : "";
  const content = typeof parsed.content === "string" ? parsed.content : "";

  if (!sessionId || !content) {
    sendWsJson(sender, {
      type: "claude-command-error",
      sessionId,
      error: "invalid_params",
      message: "缺少 sessionId 或 content",
    } satisfies WsCommandError);
    return;
  }

  // 检查是否有运行中的进程占用该 session
  const existingAgent = ctx.registry.findBySessionId(sessionId);
  if (existingAgent && existingAgent.status === "running" && ctx.processController.isAlive(existingAgent.pid)) {
    sendWsJson(sender, {
      type: "claude-command-error",
      sessionId,
      error: "session_busy",
      message: "会话正在运行中，请等待完成或取消当前任务",
    } satisfies WsCommandError);
    return;
  }

  // 确定工作目录：优先 registry，兜底从 JSONL 文件提取
  let worktreePath = existingAgent?.worktreePath ?? null;
  if (!worktreePath) {
    worktreePath = await resolveSessionCwd(sessionId);
  }
  if (!worktreePath) {
    sendWsJson(sender, {
      type: "claude-command-error",
      sessionId,
      error: "no_cwd",
      message: "无法确定会话的工作目录",
    } satisfies WsCommandError);
    return;
  }

  // 广播用户消息，让发送者立即看到自己的消息
  const userMessage: NormalizedMessage = {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: new Date().toISOString(),
    provider: "claude",
    kind: "text",
    role: "user",
    content,
  };
  broadcast(ctx.clients, { type: "normalized_message", ...userMessage } as WsNormalizedMessage);

  try {
    const spawnResult = await ctx.processController.spawnResume({
      sessionId,
      worktreePath,
      prompt: content,
    });

    // 注册新进程到 registry
    const newAgentId = `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    ctx.registry.register({
      agentId: newAgentId,
      pid: spawnResult.pid,
      sessionId: spawnResult.sessionId,
      issueId: `dashboard-${sessionId}`,
      worktreePath,
      status: "running",
      retryCount: 0,
      createdAt: Date.now(),
      workerType: "task",
    });

    // 启动流处理（后台 fire-and-forget，事件通过 rawEventListener 自动广播）
    if (ctx.sessionDb && ctx.teamId) {
      ctx.sessionDb
        .createSession({
          sessionId: spawnResult.sessionId,
          teamId: ctx.teamId,
          agentId: newAgentId,
          sessionType: "task_worker",
          source: "dashboard",
        })
        .catch((err: unknown) => {
          logger.error({ err, sessionId: spawnResult.sessionId }, "Dashboard session 注册失败");
        });
    }

    ctx.dataPlane.processStream(newAgentId, spawnResult.stdout).catch((err: unknown) => {
      logger.error({ err, agentId: newAgentId }, "Resume 流处理异常");
    });

    sendWsJson(sender, {
      type: "claude-command-ack",
      sessionId,
      agentId: newAgentId,
    } satisfies WsCommandAck);

    logger.info({ sessionId, agentId: newAgentId, pid: spawnResult.pid }, "Dashboard claude-command 已启动");
  } catch (err: unknown) {
    logger.error({ err, sessionId }, "claude-command spawn 失败");
    sendWsJson(sender, {
      type: "claude-command-error",
      sessionId,
      error: "spawn_failed",
      message: err instanceof Error ? err.message : "进程启动失败",
    } satisfies WsCommandError);
  }
}

/** 安全地向 WebSocket 发送 JSON 数据 */
function sendWsJson(sender: { send(data: string): void }, data: unknown): void {
  try {
    sender.send(JSON.stringify(data));
  } catch {
    // WebSocket 可能已断开
  }
}
