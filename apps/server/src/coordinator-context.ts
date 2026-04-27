// @teamsland/server — Coordinator 上下文加载器

import type { FindResult, IVikingMemoryClient, SessionContext } from "@teamsland/memory";
import { withSpan } from "@teamsland/observability";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { CoordinatorContext, CoordinatorContextLoader, CoordinatorEvent } from "@teamsland/types";

/**
 * LiveContextLoader 构造参数
 *
 * @example
 * ```typescript
 * import type { LiveContextLoaderOpts } from "./coordinator-context.js";
 *
 * const opts: LiveContextLoaderOpts = {
 *   registry,
 *   vikingClient,
 * };
 * ```
 */
export interface LiveContextLoaderOpts {
  /** Agent 注册表（获取运行中 Worker 列表） */
  registry: SubagentRegistry;
  /** OpenViking client（替代 store + embedder） */
  vikingClient: IVikingMemoryClient;
}

/**
 * 实时上下文加载器
 *
 * 从多个 OpenViking 数据源并发加载 Coordinator 所需的上下文：
 * 1. taskStateSummary — 从 SubagentRegistry 获取运行中 Worker 列表 + Viking 活跃任务
 * 2. recentMessages — 从 Viking 会话上下文获取近期对话
 * 3. relevantMemories — 从 Viking 检索 Agent 记忆和用户记忆
 *
 * 每个数据源独立容错：失败时降级为空字符串，不阻塞其他数据源。
 *
 * @example
 * ```typescript
 * import { LiveContextLoader } from "./coordinator-context.js";
 *
 * const loader = new LiveContextLoader({
 *   registry,
 *   vikingClient,
 * });
 *
 * const ctx = await loader.load(event);
 * console.log(ctx.taskStateSummary);
 * console.log(ctx.relevantMemories);
 * ```
 */
export class LiveContextLoader implements CoordinatorContextLoader {
  private readonly registry: SubagentRegistry;
  private readonly vikingClient: IVikingMemoryClient;

  constructor(opts: LiveContextLoaderOpts) {
    this.registry = opts.registry;
    this.vikingClient = opts.vikingClient;
  }

  /**
   * 根据事件并发加载上下文
   *
   * 五个数据源通过 Promise.allSettled 并发加载，
   * 任一失败不影响其他数据源的结果。
   *
   * @param event - Coordinator 事件
   * @returns 上下文信息
   *
   * @example
   * ```typescript
   * const ctx = await loader.load(event);
   * ```
   */
  async load(event: CoordinatorEvent): Promise<CoordinatorContext> {
    return withSpan("coordinator-context", "load", async () => {
      const query = buildMemoryQuery(event);
      const requesterId = extractRequesterId(event);
      const coordSessionId = `coord-${event.payload.chatId ?? event.id}`;

      const fetches = this.buildFetches(query, requesterId, coordSessionId);
      const [taskResult, vikingTasksResult, agentMemResult, userMemResult, sessionResult] =
        await Promise.allSettled(fetches);

      const taskSummary = taskResult.status === "fulfilled" ? taskResult.value : "";
      const vikingTasks =
        vikingTasksResult.status === "fulfilled" ? formatFindResult(vikingTasksResult.value, "活跃任务") : "";
      const agentMem =
        agentMemResult.status === "fulfilled" ? formatFindResult(agentMemResult.value, "Agent 记忆") : "";
      const userMem = userMemResult.status === "fulfilled" ? formatFindResult(userMemResult.value, "用户记忆") : "";
      const sessionCtx = sessionResult.status === "fulfilled" ? formatSessionContext(sessionResult.value) : "";

      return {
        taskStateSummary: [taskSummary, vikingTasks].filter(Boolean).join("\n"),
        recentMessages: sessionCtx,
        relevantMemories: [agentMem, userMem].filter(Boolean).join("\n"),
      };
    });
  }

  /**
   * 构建并发数据源请求列表
   */
  private buildFetches(
    query: string,
    requesterId: string | undefined,
    coordSessionId: string,
  ): [Promise<string>, Promise<FindResult>, Promise<FindResult>, Promise<FindResult>, Promise<SessionContext>] {
    const empty: FindResult = { memories: [], resources: [], skills: [], total: 0 };

    const tasksFetch = query
      ? this.vikingClient.find(query, { targetUri: "viking://resources/tasks/active/", limit: 5 })
      : Promise.resolve(empty);

    const agentMemFetch = query
      ? this.vikingClient.find(query, { targetUri: "viking://agent/teamsland/memories/", limit: 5 })
      : Promise.resolve(empty);

    const userMemFetch =
      query && requesterId
        ? this.vikingClient.find(query, { targetUri: `viking://user/${requesterId}/memories/`, limit: 3 })
        : Promise.resolve(empty);

    return [
      this.loadTaskStateSummary(),
      tasksFetch,
      agentMemFetch,
      userMemFetch,
      this.vikingClient.getSessionContext(coordSessionId, 8000),
    ];
  }

  /**
   * 从 SubagentRegistry 加载运行中 Worker 列表摘要
   */
  private async loadTaskStateSummary(): Promise<string> {
    const agents = this.registry.allRunning();
    if (agents.length === 0) {
      return "";
    }

    return agents
      .map((a) => {
        const elapsed = Math.round((Date.now() - a.createdAt) / 1000);
        return `- ${a.agentId} [${a.status}] 任务: ${a.issueId} (运行 ${elapsed}s)`;
      })
      .join("\n");
  }
}

/**
 * 从 CoordinatorEvent 提取记忆检索查询关键词
 *
 * 优先使用 payload 中的 message / description / title / query 字段，
 * 最后回退到 issueId。
 */
function buildMemoryQuery(event: CoordinatorEvent): string {
  const { payload } = event;
  const candidates: string[] = [];

  for (const key of ["message", "description", "title", "query", "resultSummary", "details"]) {
    const val = payload[key];
    if (typeof val === "string" && val.length > 0) {
      candidates.push(val);
    }
  }

  if (candidates.length > 0) {
    return candidates.join(" ");
  }

  const issueId = payload.issueId;
  if (typeof issueId === "string" && issueId.length > 0) {
    return issueId;
  }

  return "";
}

/**
 * 从事件 payload 中提取发起者 ID
 */
function extractRequesterId(event: CoordinatorEvent): string | undefined {
  const payload = event.payload;
  if (typeof payload.requesterId === "string") return payload.requesterId;
  if (typeof payload.userId === "string") return payload.userId;
  if (typeof payload.senderId === "string") return payload.senderId;
  return undefined;
}

/**
 * 格式化 FindResult 为可读的多行摘要
 */
function formatFindResult(result: FindResult, label: string): string {
  const items = [...result.memories, ...result.resources, ...result.skills];
  if (items.length === 0) return "";
  return items.map((item) => `- [${label}] ${item.abstract}`).join("\n");
}

/**
 * 格式化 SessionContext 为可读的对话历史摘要
 */
function formatSessionContext(ctx: SessionContext): string {
  const parts: string[] = [];
  if (ctx.latest_archive_overview) {
    parts.push(`[对话历史概要] ${ctx.latest_archive_overview}`);
  }
  for (const msg of ctx.messages) {
    const content = msg.parts
      .map((p) => {
        if (typeof p === "string") return p;
        const obj = p as Record<string, unknown>;
        return typeof obj.text === "string" ? obj.text : "";
      })
      .join("");
    parts.push(`- [${msg.role}] ${content.slice(0, 200)}`);
  }
  return parts.join("\n");
}
