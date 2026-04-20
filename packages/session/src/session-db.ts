import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type {
  CompactResult,
  MessageRow,
  SessionConfig,
  SessionRow,
  SessionStatus,
  TaskConfig,
  TaskRow,
  TaskStatus,
} from "@teamsland/types";
import { jitter } from "./jitter.js";
import { migrateSchema } from "./schema.js";

/**
 * SessionDB 错误码
 */
type SessionDbErrorCode = "SCHEMA_MIGRATION_FAILED" | "SESSION_NOT_FOUND" | "COMPACTION_FAILED" | "FTS_QUERY_ERROR";

/**
 * SessionDB 专用错误类
 *
 * 携带结构化错误码，便于上层根据 code 进行分类处理。
 *
 * @example
 * ```typescript
 * import { SessionDbError } from "@teamsland/session";
 *
 * try {
 *   db.getSession("nonexistent");
 * } catch (err) {
 *   if (err instanceof SessionDbError && err.code === "SESSION_NOT_FOUND") {
 *     console.log("会话不存在");
 *   }
 * }
 * ```
 */
export class SessionDbError extends Error {
  override readonly name = "SessionDbError";

  constructor(
    message: string,
    public readonly code: SessionDbErrorCode,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Session 持久化数据库
 *
 * 基于 bun:sqlite 的 WAL 模式数据库，提供会话、消息、任务的 CRUD 操作，
 * 以及 FTS5 全文搜索和上下文 compaction 功能。所有写操作引入随机 jitter
 * 以减少多 Agent 并发场景下的 WAL 锁竞争。
 *
 * @example
 * ```typescript
 * import { SessionDB } from "@teamsland/session";
 * import type { SessionConfig } from "@teamsland/types";
 *
 * const config: SessionConfig = {
 *   compactionTokenThreshold: 80000,
 *   sqliteJitterRangeMs: [20, 150],
 *   busyTimeoutMs: 5000,
 * };
 *
 * const db = new SessionDB("./data/session.sqlite", config);
 * await db.createSession({ sessionId: "sess-001", teamId: "team-alpha" });
 * await db.appendMessage({ sessionId: "sess-001", role: "user", content: "你好" });
 * const messages = db.getMessages("sess-001");
 * db.close();
 * ```
 */
export class SessionDB {
  private readonly db: InstanceType<typeof Database>;
  private readonly config: SessionConfig;

  constructor(dbPath: string, config: SessionConfig) {
    this.config = config;
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`PRAGMA busy_timeout = ${config.busyTimeoutMs};`);

    try {
      migrateSchema(this.db);
    } catch (err: unknown) {
      throw new SessionDbError("Schema migration failed", "SCHEMA_MIGRATION_FAILED", err);
    }
  }

  // ─── Sessions ───

  /**
   * 创建新会话
   *
   * @param params - 会话参数
   *
   * @example
   * ```typescript
   * await db.createSession({
   *   sessionId: "sess-001",
   *   teamId: "team-alpha",
   *   agentId: "agent-fe",
   *   metadata: { source: "meego" },
   * });
   * ```
   */
  async createSession(params: {
    sessionId: string;
    teamId: string;
    agentId?: string;
    projectId?: string;
    parentSessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (session_id, parent_session_id, team_id, project_id, agent_id, status, created_at, updated_at, metadata)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(
        params.sessionId,
        params.parentSessionId ?? null,
        params.teamId,
        params.projectId ?? null,
        params.agentId ?? null,
        now,
        now,
        params.metadata ? JSON.stringify(params.metadata) : null,
      );
  }

  /**
   * 根据 ID 获取会话
   *
   * @param sessionId - 会话 ID
   * @returns 会话行数据，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const session = db.getSession("sess-001");
   * if (session) {
   *   console.log(session.status);
   * }
   * ```
   */
  getSession(sessionId: string): SessionRow | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as RawSessionRow | null;

    if (!row) return undefined;
    return this.mapSessionRow(row);
  }

  /**
   * 更新会话状态
   *
   * @param sessionId - 会话 ID
   * @param status - 新状态
   *
   * @example
   * ```typescript
   * await db.updateSessionStatus("sess-001", "compacted");
   * ```
   */
  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    this.db
      .prepare("UPDATE sessions SET status = ?, updated_at = ? WHERE session_id = ?")
      .run(status, Date.now(), sessionId);
  }

  /**
   * 列出团队下所有活跃会话
   *
   * @param teamId - 团队 ID
   * @returns 活跃会话列表
   *
   * @example
   * ```typescript
   * const sessions = db.listActiveSessions("team-alpha");
   * console.log(`活跃会话数: ${sessions.length}`);
   * ```
   */
  listActiveSessions(teamId: string): SessionRow[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions WHERE team_id = ? AND status = 'active' ORDER BY created_at DESC")
      .all(teamId) as RawSessionRow[];

    return rows.map((row) => this.mapSessionRow(row));
  }

  // ─── Messages ───

  /**
   * 追加消息到会话
   *
   * @param params - 消息参数
   * @returns 新消息的自增 ID
   *
   * @example
   * ```typescript
   * const id = await db.appendMessage({
   *   sessionId: "sess-001",
   *   role: "user",
   *   content: "请帮我实现登录功能",
   *   traceId: "trace-abc",
   * });
   * ```
   */
  async appendMessage(params: {
    sessionId: string;
    role: string;
    content: string;
    toolName?: string;
    traceId?: string;
  }): Promise<number> {
    await jitter(this.config.sqliteJitterRangeMs);
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO messages (session_id, role, content, tool_name, trace_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(params.sessionId, params.role, params.content, params.toolName ?? null, params.traceId ?? null, now);

    return Number(result.lastInsertRowid);
  }

  /**
   * 获取会话下的消息列表
   *
   * @param sessionId - 会话 ID
   * @param opts - 分页选项
   * @returns 按 createdAt 升序排列的消息列表
   *
   * @example
   * ```typescript
   * const messages = db.getMessages("sess-001", { limit: 50, offset: 0 });
   * ```
   */
  getMessages(sessionId: string, opts?: { limit?: number; offset?: number }): MessageRow[] {
    const limit = opts?.limit ?? 1000;
    const offset = opts?.offset ?? 0;

    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?")
      .all(sessionId, limit, offset) as RawMessageRow[];

    return rows.map((row) => this.mapMessageRow(row));
  }

  /**
   * 通过 FTS5 全文搜索消息内容
   *
   * @param query - FTS5 查询字符串
   * @param opts - 过滤选项
   * @returns 匹配的消息列表
   *
   * @example
   * ```typescript
   * const results = db.searchMessages("登录", { sessionId: "sess-001", limit: 20 });
   * ```
   */
  searchMessages(query: string, opts?: { sessionId?: string; limit?: number }): MessageRow[] {
    const limit = opts?.limit ?? 100;
    const likePattern = `%${query}%`;

    try {
      if (opts?.sessionId) {
        const rows = this.db
          .prepare(`SELECT * FROM messages WHERE content LIKE ? AND session_id = ? ORDER BY created_at ASC LIMIT ?`)
          .all(likePattern, opts.sessionId, limit) as RawMessageRow[];

        return rows.map((row) => this.mapMessageRow(row));
      }

      const rows = this.db
        .prepare(`SELECT * FROM messages WHERE content LIKE ? ORDER BY created_at ASC LIMIT ?`)
        .all(likePattern, limit) as RawMessageRow[];

      return rows.map((row) => this.mapMessageRow(row));
    } catch (err: unknown) {
      throw new SessionDbError(`FTS query failed: ${query}`, "FTS_QUERY_ERROR", err);
    }
  }

  // ─── Tasks ───

  /**
   * 创建新任务
   *
   * @param params - 任务参数
   *
   * @example
   * ```typescript
   * await db.createTask({
   *   taskId: "task-001",
   *   sessionId: "sess-001",
   *   teamId: "team-alpha",
   *   meegoIssueId: "ISSUE-42",
   *   subtaskDag: [{ ... }],
   * });
   * ```
   */
  async createTask(params: {
    taskId: string;
    sessionId: string;
    teamId: string;
    meegoIssueId: string;
    subtaskDag?: TaskConfig[];
  }): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, session_id, team_id, meego_issue_id, status, subtask_dag, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        params.taskId,
        params.sessionId,
        params.teamId,
        params.meegoIssueId,
        params.subtaskDag ? JSON.stringify(params.subtaskDag) : null,
        now,
      );
  }

  /**
   * 根据 ID 获取任务
   *
   * @param taskId - 任务 ID
   * @returns 任务行数据，不存在时返回 undefined
   *
   * @example
   * ```typescript
   * const task = db.getTask("task-001");
   * if (task) {
   *   console.log(task.status);
   * }
   * ```
   */
  getTask(taskId: string): TaskRow | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as RawTaskRow | null;

    if (!row) return undefined;
    return this.mapTaskRow(row);
  }

  /**
   * 更新任务状态
   *
   * @param taskId - 任务 ID
   * @param status - 新状态
   * @param completedAt - 完成时间（可选，仅在 completed/failed 时传入）
   *
   * @example
   * ```typescript
   * await db.updateTaskStatus("task-001", "completed", Date.now());
   * ```
   */
  async updateTaskStatus(taskId: string, status: TaskStatus, completedAt?: number): Promise<void> {
    await jitter(this.config.sqliteJitterRangeMs);
    this.db
      .prepare("UPDATE tasks SET status = ?, completed_at = ? WHERE task_id = ?")
      .run(status, completedAt ?? null, taskId);
  }

  /**
   * 列出会话下所有任务
   *
   * @param sessionId - 会话 ID
   * @returns 任务列表
   *
   * @example
   * ```typescript
   * const tasks = db.listTasks("sess-001");
   * console.log(`任务数: ${tasks.length}`);
   * ```
   */
  listTasks(sessionId: string): TaskRow[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as RawTaskRow[];

    return rows.map((row) => this.mapTaskRow(row));
  }

  // ─── Compaction ───

  /**
   * 判断会话是否需要执行上下文压缩
   *
   * @param sessionId - 会话 ID
   * @param tokenCounter - 将消息列表转换为 token 数的函数
   * @returns 是否超过阈值需要压缩
   *
   * @example
   * ```typescript
   * const needsCompact = db.shouldCompact("sess-001", (msgs) => msgs.reduce((sum, m) => sum + m.content.length / 4, 0));
   * ```
   */
  shouldCompact(sessionId: string, tokenCounter: (messages: MessageRow[]) => number): boolean {
    const messages = this.getMessages(sessionId);
    if (messages.length === 0) return false;
    const tokenCount = tokenCounter(messages);
    return tokenCount >= this.config.compactionTokenThreshold;
  }

  /**
   * 执行上下文压缩
   *
   * 将当前会话的所有消息交给 compactor 生成摘要，创建新会话写入摘要，
   * 并将旧会话标记为 compacted。
   *
   * @param sessionId - 待压缩的会话 ID
   * @param compactor - 将消息列表压缩为摘要文本的异步函数
   * @returns 压缩结果（新会话 ID + 摘要）
   *
   * @example
   * ```typescript
   * const result = await db.compact("sess-001", async (messages) => {
   *   return `会话包含 ${messages.length} 条消息，主题为前端开发`;
   * });
   * console.log(result.newSessionId, result.summary);
   * ```
   */
  async compact(sessionId: string, compactor: (messages: MessageRow[]) => Promise<string>): Promise<CompactResult> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new SessionDbError(`Session not found: ${sessionId}`, "SESSION_NOT_FOUND");
    }

    const messages = this.getMessages(sessionId);

    let summary: string;
    try {
      summary = await compactor(messages);
    } catch (err: unknown) {
      throw new SessionDbError(`Compaction failed for session: ${sessionId}`, "COMPACTION_FAILED", err);
    }

    const newSessionId = `sess-${randomUUID()}`;

    // 创建新会话，parent 指向旧会话
    await this.createSession({
      sessionId: newSessionId,
      teamId: session.teamId,
      agentId: session.agentId ?? undefined,
      projectId: session.projectId ?? undefined,
      parentSessionId: sessionId,
      metadata: session.metadata ?? undefined,
    });

    // 写入摘要消息到新会话
    await this.appendMessage({
      sessionId: newSessionId,
      role: "system",
      content: summary,
    });

    // 标记旧会话为 compacted
    await this.updateSessionStatus(sessionId, "compacted");

    return { newSessionId, summary };
  }

  // ─── Lifecycle ───

  /**
   * 关闭数据库连接
   *
   * @example
   * ```typescript
   * db.close();
   * ```
   */
  close(): void {
    this.db.close();
  }

  // ─── Private Helpers ───

  private mapSessionRow(row: RawSessionRow): SessionRow {
    return {
      sessionId: row.session_id,
      parentSessionId: row.parent_session_id,
      teamId: row.team_id,
      projectId: row.project_id,
      agentId: row.agent_id,
      status: row.status as SessionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contextHash: row.context_hash,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    };
  }

  private mapMessageRow(row: RawMessageRow): MessageRow {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolName: row.tool_name,
      traceId: row.trace_id,
      createdAt: row.created_at,
    };
  }

  private mapTaskRow(row: RawTaskRow): TaskRow {
    return {
      taskId: row.task_id,
      sessionId: row.session_id,
      teamId: row.team_id,
      meegoIssueId: row.meego_issue_id,
      status: row.status as TaskStatus,
      subtaskDag: row.subtask_dag ? (JSON.parse(row.subtask_dag) as TaskConfig[]) : null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}

// ─── Raw Row Types (SQLite column names) ───

interface RawSessionRow {
  session_id: string;
  parent_session_id: string | null;
  team_id: string;
  project_id: string | null;
  agent_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
  context_hash: string | null;
  metadata: string | null;
}

interface RawMessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  trace_id: string | null;
  created_at: number;
}

interface RawTaskRow {
  task_id: string;
  session_id: string;
  team_id: string;
  meego_issue_id: string;
  status: string;
  subtask_dag: string | null;
  created_at: number;
  completed_at: number | null;
}
