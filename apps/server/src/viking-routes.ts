import type { IVikingMemoryClient } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:viking-routes");

/**
 * 处理 Viking find 搜索请求
 *
 * @example
 * ```typescript
 * const response = await handleFind(req, vikingClient);
 * // => Response.json({ status: "ok", result: { memories: [], resources: [], skills: [], total: 0 } })
 * ```
 */
async function handleFind(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const query = typeof body.query === "string" ? body.query : "";
  const result = await client.find(query, {
    targetUri: typeof body.targetUri === "string" ? body.targetUri : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  });
  return Response.json({ status: "ok", result });
}

/**
 * 处理 Viking addResource 资源导入请求
 *
 * @example
 * ```typescript
 * const response = await handleAddResource(req, vikingClient);
 * // => Response.json({ status: "ok", result: { uri: "mem://resources/project", task_id: "task-1" } })
 * ```
 */
async function handleAddResource(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const path = typeof body.path === "string" ? body.path : "";
  const to = typeof body.to === "string" ? body.to : "";
  const result = await client.addResource(path, {
    to,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    wait: typeof body.wait === "boolean" ? body.wait : undefined,
    ignore_dirs: typeof body.ignore_dirs === "string" ? body.ignore_dirs : undefined,
    include: typeof body.include === "string" ? body.include : undefined,
    exclude: typeof body.exclude === "string" ? body.exclude : undefined,
  });
  return Response.json({ status: "ok", result });
}

/**
 * 处理 Viking read 内容读取请求
 *
 * @example
 * ```typescript
 * const response = await handleRead(url, vikingClient);
 * // => Response.json({ status: "ok", result: "file content..." })
 * ```
 */
async function handleRead(url: URL, client: IVikingMemoryClient): Promise<Response> {
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "缺少 uri 参数" }, { status: 400 });
  }
  const result = await client.read(uri);
  return Response.json({ status: "ok", result });
}

/**
 * 处理 Viking ls 文件列表请求
 *
 * @example
 * ```typescript
 * const response = await handleLs(url, vikingClient);
 * // => Response.json({ status: "ok", result: [{ name: "notes.md", uri: "mem://...", is_dir: false }] })
 * ```
 */
async function handleLs(url: URL, client: IVikingMemoryClient): Promise<Response> {
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "缺少 uri 参数" }, { status: 400 });
  }
  const result = await client.ls(uri);
  return Response.json({ status: "ok", result });
}

/**
 * 处理 Viking write 内容写入请求
 *
 * @example
 * ```typescript
 * const response = await handleWrite(req, vikingClient);
 * // => Response.json({ status: "ok" })
 * ```
 */
async function handleWrite(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const uri = typeof body.uri === "string" ? body.uri : "";
  const content = typeof body.content === "string" ? body.content : "";
  if (!uri) {
    return Response.json({ error: "缺少 uri 字段" }, { status: 400 });
  }
  const mode = body.mode === "replace" || body.mode === "create" ? body.mode : undefined;
  await client.write(uri, content, { mode });
  return Response.json({ status: "ok" });
}

/**
 * 处理 Viking rm 文件删除请求
 *
 * @example
 * ```typescript
 * const response = await handleRm(url, vikingClient);
 * // => Response.json({ status: "ok" })
 * ```
 */
async function handleRm(url: URL, client: IVikingMemoryClient): Promise<Response> {
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "缺少 uri 参数" }, { status: 400 });
  }
  const recursiveParam = url.searchParams.get("recursive");
  const recursive = recursiveParam === "true" ? true : recursiveParam === "false" ? false : undefined;
  await client.rm(uri, recursive);
  return Response.json({ status: "ok" });
}

/**
 * Viking 代理路由处理器
 *
 * 处理 `/api/viking/*` 下的所有代理路由，将请求转发到 OpenViking 记忆服务客户端。
 * 如果路径不匹配则返回 null，由调用方继续下一个路由。
 *
 * 支持的路由：
 * - `POST /api/viking/resource` — 添加资源
 * - `POST /api/viking/find` — 搜索记忆
 * - `GET /api/viking/read?uri=...` — 读取内容
 * - `GET /api/viking/ls?uri=...` — 列出文件
 * - `POST /api/viking/write` — 写入内容
 * - `DELETE /api/viking/fs?uri=...&recursive=...` — 删除文件
 *
 * @param req - HTTP 请求对象
 * @param url - 解析后的 URL 对象
 * @param vikingClient - OpenViking 记忆服务客户端
 * @returns 匹配路由时返回 Response，不匹配时返回 null
 *
 * @example
 * ```typescript
 * import { handleVikingRoutes } from "./viking-routes.js";
 * import type { IVikingMemoryClient } from "@teamsland/memory";
 *
 * async function handleRequest(req: Request, url: URL, client: IVikingMemoryClient) {
 *   const result = await handleVikingRoutes(req, url, client);
 *   if (result) return result;
 *   return new Response("Not Found", { status: 404 });
 * }
 * ```
 */
export async function handleVikingRoutes(
  req: Request,
  url: URL,
  vikingClient: IVikingMemoryClient,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/viking/")) return null;

  try {
    if (req.method === "POST" && url.pathname === "/api/viking/find") {
      return await handleFind(req, vikingClient);
    }
    if (req.method === "POST" && url.pathname === "/api/viking/resource") {
      return await handleAddResource(req, vikingClient);
    }
    if (req.method === "GET" && url.pathname === "/api/viking/read") {
      return await handleRead(url, vikingClient);
    }
    if (req.method === "GET" && url.pathname === "/api/viking/ls") {
      return await handleLs(url, vikingClient);
    }
    if (req.method === "POST" && url.pathname === "/api/viking/write") {
      return await handleWrite(req, vikingClient);
    }
    if (req.method === "DELETE" && url.pathname === "/api/viking/fs") {
      return await handleRm(url, vikingClient);
    }
    return null;
  } catch (err: unknown) {
    logger.error({ err, path: url.pathname }, "Viking 路由处理失败");
    return Response.json({ error: "OpenViking request failed" }, { status: 503 });
  }
}
