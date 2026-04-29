// @teamsland/server — 扩展 API 路由
// 提供 /api/projects、/api/topology、/api/sessions/:id/normalized-messages 端点

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { SessionDB } from "@teamsland/session";
import type { SubagentRegistry } from "@teamsland/sidecar";
import type { NormalizedMessage, TopologyEdge, TopologyGraph, TopologyNode } from "@teamsland/types";
import { discoverProjects } from "./session-discovery.js";
import { normalizeJsonlEntry } from "./utils/normalized-message.js";

const logger = createLogger("server:api-routes");

/**
 * 扩展 API 路由依赖
 *
 * @example
 * ```typescript
 * import type { ApiRouteDeps } from "./api-routes.js";
 *
 * const deps: ApiRouteDeps = { registry: subagentRegistry };
 * ```
 */
export interface ApiRouteDeps {
  /** Agent 注册表，用于查询运行中的 Agent 列表以构建拓扑图 */
  registry: SubagentRegistry;
  /** Session 数据库，用于查询 Session 列表 */
  sessionDb: SessionDB;
  /** 团队 ID */
  teamId: string;
}

/** JSON 响应工具函数 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 处理扩展 API 路由
 *
 * 匹配 /api/projects、/api/topology、/api/sessions/:id/normalized-messages 路由。
 * 匹配时返回 Response 或 Promise<Response>，不匹配时返回 null 以便上层继续路由。
 *
 * @param req - HTTP 请求
 * @param url - 解析后的 URL
 * @param deps - 路由依赖
 * @returns Response（匹配时）或 null（不匹配时）
 *
 * @example
 * ```typescript
 * import { handleExtendedApiRoutes } from "./api-routes.js";
 *
 * const result = handleExtendedApiRoutes(req, url, deps);
 * if (result) return result;
 * ```
 */
export function handleExtendedApiRoutes(
  req: Request,
  url: URL,
  deps: ApiRouteDeps,
): Response | Promise<Response> | null {
  // GET /api/projects
  if (url.pathname === "/api/projects" && req.method === "GET") {
    return handleProjectsRoute(url);
  }

  // GET /api/topology
  if (url.pathname === "/api/topology" && req.method === "GET") {
    return handleTopologyRoute(deps);
  }

  // GET /api/sessions/:id/normalized-messages
  const normalizedMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/normalized-messages$/);
  if (normalizedMatch?.[1] && req.method === "GET") {
    return handleNormalizedMessagesRoute(normalizedMatch[1], url);
  }

  // GET /api/sessions
  if (url.pathname === "/api/sessions" && req.method === "GET") {
    return handleSessionsListRoute(url, deps);
  }

  return null;
}

/**
 * 处理 GET /api/projects — 发现 Claude Code 项目列表
 *
 * 从 ~/.claude/projects/ 扫描发现所有项目及其 Session。
 * 支持 ?maxSessions=N 参数限制每个项目返回的 Session 数量。
 *
 * @param url - 请求 URL（用于读取 query 参数）
 * @returns 项目列表 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleProjectsRoute(new URL("http://localhost/api/projects?maxSessions=10"));
 * ```
 */
async function handleProjectsRoute(url: URL): Promise<Response> {
  const maxSessions = Math.min(Number(url.searchParams.get("maxSessions") ?? "20"), 100);
  const validLimit = Number.isFinite(maxSessions) && maxSessions > 0 ? maxSessions : 20;

  try {
    const projects = await discoverProjects(validLimit);
    return jsonResponse({ projects, total: projects.length });
  } catch (err: unknown) {
    logger.error({ err }, "项目列表获取失败");
    return jsonResponse({ error: "discovery_failed", message: "项目发现失败" }, 500);
  }
}

/**
 * 处理 GET /api/sessions — 获取 Session 列表
 *
 * 支持 ?type=、?source=、?status=、?search=、?limit=、?offset= 参数。
 *
 * @param url - 请求 URL
 * @param deps - 路由依赖
 * @returns Session 列表 JSON 响应
 */
function handleSessionsListRoute(url: URL, deps: ApiRouteDeps): Response {
  const type = url.searchParams.get("type") ?? undefined;
  const source = url.searchParams.get("source") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 100);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  try {
    const sessions = deps.sessionDb.listSessions({
      teamId: deps.teamId,
      sessionType: type,
      source,
      status,
      search,
      limit,
      offset,
    });
    const total = deps.sessionDb.countSessions({
      teamId: deps.teamId,
      sessionType: type,
      source,
      status,
      search,
    });

    return jsonResponse({
      sessions,
      total,
      hasMore: offset + limit < total,
    });
  } catch (err: unknown) {
    logger.error({ err }, "Session 列表获取失败");
    return jsonResponse({ error: "query_failed", message: "Session 列表查询失败" }, 500);
  }
}

/**
 * 处理 GET /api/topology — 获取 Agent 拓扑图
 *
 * 从 SubagentRegistry 构建当前运行 Agent 的拓扑关系图，
 * 包含 coordinator、task_worker、observer_worker 三种节点类型。
 *
 * @param deps - 路由依赖
 * @returns 拓扑图 JSON 响应
 *
 * @example
 * ```typescript
 * const response = handleTopologyRoute(deps);
 * ```
 */
function handleTopologyRoute(deps: ApiRouteDeps): Response {
  try {
    const topology = buildTopology(deps);
    return jsonResponse(topology);
  } catch (err: unknown) {
    logger.error({ err }, "拓扑图构建失败");
    return jsonResponse({ error: "topology_failed", message: "拓扑图构建失败" }, 500);
  }
}

/**
 * 从 SubagentRegistry 构建拓扑图
 *
 * 遍历注册表中所有运行中的 Agent，将其转换为拓扑图节点，
 * 并根据 parentAgentId / observeTargetId 字段生成边。
 *
 * @param deps - 路由依赖
 * @returns 拓扑图
 *
 * @example
 * ```typescript
 * const graph = buildTopology({ registry });
 * // => { nodes: [...], edges: [...] }
 * ```
 */
function buildTopology(deps: ApiRouteDeps): TopologyGraph {
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  for (const agent of deps.registry.allRunning()) {
    const nodeType = resolveNodeType(agent.workerType);
    const nodeStatus = resolveNodeStatus(agent.status);

    nodes.push({
      id: agent.agentId,
      type: nodeType,
      sessionId: agent.sessionId,
      status: nodeStatus,
      label: agent.taskBrief ?? agent.agentId,
      taskBrief: agent.taskBrief,
      metadata: {
        workerId: agent.agentId,
        requester: agent.origin?.senderId,
        chatId: agent.origin?.chatId,
        meegoIssueId: agent.issueId,
        startedAt: new Date(agent.createdAt).toISOString(),
        completedAt: agent.completedAt ? new Date(agent.completedAt).toISOString() : undefined,
      },
    });

    // 父级 Agent 关系边
    if (agent.parentAgentId) {
      edges.push({
        from: agent.parentAgentId,
        to: agent.agentId,
        type: "spawned",
      });
    }

    // Observer 监控关系边
    if (agent.observeTargetId) {
      edges.push({
        from: agent.agentId,
        to: agent.observeTargetId,
        type: "observes",
      });
    }
  }

  return { nodes, edges };
}

/**
 * 将 AgentRecord 的 workerType 映射到拓扑节点类型
 *
 * @param workerType - Worker 类型
 * @returns 拓扑节点类型
 *
 * @example
 * ```typescript
 * resolveNodeType("observer"); // => "observer_worker"
 * resolveNodeType(undefined);  // => "task_worker"
 * ```
 */
function resolveNodeType(workerType: "task" | "observer" | undefined): TopologyNode["type"] {
  if (workerType === "observer") return "observer_worker";
  return "task_worker";
}

/**
 * 将 AgentStatus 映射到拓扑节点状态
 *
 * @param status - Agent 状态
 * @returns 拓扑节点状态
 *
 * @example
 * ```typescript
 * resolveNodeStatus("running");     // => "running"
 * resolveNodeStatus("interrupted"); // => "idle"
 * ```
 */
function resolveNodeStatus(status: string): TopologyNode["status"] {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

/**
 * 处理 GET /api/sessions/:id/normalized-messages — 获取 Session 归一化消息
 *
 * 从 ~/.claude/projects/ 下查找指定 Session ID 的 JSONL 文件，
 * 将其转换为 NormalizedMessage 数组返回。支持 ?project= 参数指定项目，
 * 以及 ?limit= 和 ?offset= 分页参数。
 *
 * @param sessionId - Session ID
 * @param url - 请求 URL（用于读取 query 参数）
 * @returns 归一化消息列表 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleNormalizedMessagesRoute(
 *   "abc123",
 *   new URL("http://localhost/api/sessions/abc123/normalized-messages?project=my-project"),
 * );
 * ```
 */
async function handleNormalizedMessagesRoute(sessionId: string, url: URL): Promise<Response> {
  const projectName = url.searchParams.get("project") ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "1000"), 10000);
  const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0);

  const validLimit = Number.isFinite(limit) && limit > 0 ? limit : 1000;
  const validOffset = Number.isFinite(offset) ? offset : 0;

  const filePath = await findSessionFile(sessionId, projectName);
  if (!filePath) {
    return jsonResponse({ error: "not_found", message: `Session ${sessionId} 未找到` }, 404);
  }

  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    const lines = text.split("\n").filter((line) => line.trim());

    const allMessages: NormalizedMessage[] = [];
    for (const line of lines) {
      const normalized = normalizeJsonlEntry(line, sessionId);
      for (const msg of normalized) {
        allMessages.push(msg);
      }
    }

    const total = allMessages.length;
    const paged = allMessages.slice(validOffset, validOffset + validLimit);

    return jsonResponse({
      messages: paged,
      total,
      hasMore: validOffset + validLimit < total,
    });
  } catch (err: unknown) {
    logger.error({ err, sessionId }, "Session 消息读取失败");
    return jsonResponse({ error: "read_failed", message: "Session 文件读取失败" }, 500);
  }
}

/**
 * 查找 Session JSONL 文件路径
 *
 * 若提供了 projectName，直接在对应项目目录下查找；
 * 否则遍历所有项目目录寻找匹配的 Session 文件。
 *
 * @param sessionId - Session ID
 * @param projectName - 项目编码名称（可选）
 * @returns 文件路径，或 null
 *
 * @example
 * ```typescript
 * const path = await findSessionFile("abc123", "my-project");
 * ```
 */
async function findSessionFile(sessionId: string, projectName: string): Promise<string | null> {
  const projectsDir = resolve(homedir(), ".claude/projects");
  const fileName = `${sessionId}.jsonl`;

  // 若指定了项目名，直接查找
  if (projectName) {
    const filePath = join(projectsDir, projectName, fileName);
    const file = Bun.file(filePath);
    if (await file.exists()) return filePath;
    return null;
  }

  // 遍历所有项目目录寻找匹配的 Session 文件
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const filePath = join(projectsDir, entry.name, fileName);
      const file = Bun.file(filePath);
      if (await file.exists()) return filePath;
    }
  } catch {
    // 目录不存在或不可读
  }

  return null;
}
