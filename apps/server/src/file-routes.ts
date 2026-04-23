// @teamsland/server — 文件系统操作路由
// 提供 /api/files/tree、/api/files/read、/api/files/write 端点

import { readdir, realpath, stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:file-routes");

/** 最大目录遍历深度 */
const MAX_DEPTH = 10;

/** 最大单次目录条目数 */
const MAX_ENTRIES_PER_DIR = 200;

/** 最大文件读取大小（5 MB） */
const MAX_READ_SIZE = 5 * 1024 * 1024;

/** 允许的项目根目录列表（防止目录遍历） */
const ALLOWED_ROOTS = ["/Users", "/home", "/tmp"];

/**
 * 文件树节点
 *
 * @example
 * ```typescript
 * import type { FileTreeNode } from "./file-routes.js";
 *
 * const node: FileTreeNode = {
 *   name: "src",
 *   path: "/Users/dev/project/src",
 *   type: "directory",
 *   children: [{ name: "index.ts", path: "/Users/dev/project/src/index.ts", type: "file" }],
 * };
 * ```
 */
interface FileTreeNode {
  /** 文件或目录名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 类型：file 或 directory */
  type: "file" | "directory";
  /** 子节点（仅目录有） */
  children?: FileTreeNode[];
  /** 文件大小（字节，仅文件有） */
  size?: number;
}

/**
 * 写入文件请求体
 *
 * @example
 * ```typescript
 * const body: WriteFileBody = { path: "/Users/dev/project/src/index.ts", content: "export default {};" };
 * ```
 */
interface WriteFileBody {
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
}

/** JSON 响应工具函数 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 验证路径安全性，防止目录遍历攻击
 *
 * 将路径规范化后检查是否位于允许的根目录之下，
 * 同时拒绝包含 ".." 的路径以及符号链接穿越。
 *
 * @param targetPath - 待验证的目标路径
 * @returns 规范化后的绝对路径，或 null（验证失败时）
 *
 * @example
 * ```typescript
 * const safe = await validatePath("/Users/dev/project/src");
 * // => "/Users/dev/project/src"
 *
 * const unsafe = await validatePath("/etc/passwd");
 * // => null
 * ```
 */
export async function validatePath(targetPath: string): Promise<string | null> {
  if (!targetPath || typeof targetPath !== "string") return null;

  // 规范化路径（解析 ./ ../ 等）
  const normalized = resolve(normalize(targetPath));

  // 检查是否包含遍历特征
  if (targetPath.includes("\0")) return null;

  // 先检查规范化路径是否在允许范围内（防止 ../../../ 绕过）
  const basicCheck = ALLOWED_ROOTS.some((root) => normalized.startsWith(root));
  if (!basicCheck) {
    logger.warn({ targetPath, normalized }, "路径不在允许的目录范围内");
    return null;
  }

  // 解析 symlink 后再次检查（防止 symlink 逃逸）
  try {
    const resolved = await realpath(normalized);
    const symlinkCheck = ALLOWED_ROOTS.some((root) => resolved.startsWith(root));
    if (!symlinkCheck) {
      logger.warn({ targetPath, normalized, resolved }, "Symlink 目标不在允许的目录范围内");
      return null;
    }
    return resolved;
  } catch {
    // 文件可能不存在（写入场景），回退到规范化路径
    return normalized;
  }
}

/**
 * 处理文件系统操作路由
 *
 * 匹配 /api/files/tree、/api/files/read、PUT /api/files/write 路由。
 * 匹配时返回 Response 或 Promise<Response>，不匹配时返回 null。
 *
 * @param req - HTTP 请求
 * @param url - 解析后的 URL
 * @returns Response（匹配时）或 null（不匹配时）
 *
 * @example
 * ```typescript
 * import { handleFileRoutes } from "./file-routes.js";
 *
 * const result = handleFileRoutes(req, url);
 * if (result) return result;
 * ```
 */
export function handleFileRoutes(req: Request, url: URL): Response | Promise<Response> | null {
  if (!url.pathname.startsWith("/api/files")) return null;

  // GET /api/files/tree?path=...&depth=...
  if (req.method === "GET" && url.pathname === "/api/files/tree") {
    return handleTreeRoute(url);
  }

  // GET /api/files/read?path=...
  if (req.method === "GET" && url.pathname === "/api/files/read") {
    return handleReadRoute(url);
  }

  // PUT /api/files/write
  if (req.method === "PUT" && url.pathname === "/api/files/write") {
    return handleWriteRoute(req);
  }

  return null;
}

/**
 * 处理 GET /api/files/tree — 获取目录树
 *
 * 递归遍历指定目录，返回文件和子目录的树形结构。
 * 支持 ?path= 指定根目录，?depth= 限制遍历深度（默认 3，最大 10）。
 *
 * @param url - 请求 URL
 * @returns 目录树 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleTreeRoute(new URL("http://localhost/api/files/tree?path=/Users/dev/project&depth=2"));
 * ```
 */
async function handleTreeRoute(url: URL): Promise<Response> {
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    return jsonResponse({ error: "missing_param", message: "path 参数为必填" }, 400);
  }

  const safePath = await validatePath(rawPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  const depthParam = Number(url.searchParams.get("depth") ?? "3");
  const depth = Number.isFinite(depthParam) && depthParam > 0 ? Math.min(depthParam, MAX_DEPTH) : 3;

  try {
    const tree = await buildTree(safePath, depth);
    return jsonResponse(tree);
  } catch (err: unknown) {
    logger.error({ err, path: safePath }, "目录树构建失败");
    return jsonResponse({ error: "tree_failed", message: "目录读取失败" }, 500);
  }
}

/**
 * 递归构建目录树
 *
 * @param dirPath - 目录路径
 * @param maxDepth - 最大递归深度
 * @param currentDepth - 当前递归深度
 * @returns 文件树节点
 *
 * @example
 * ```typescript
 * const tree = await buildTree("/Users/dev/project", 3);
 * ```
 */
async function buildTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<FileTreeNode> {
  const name = dirPath.split("/").pop() ?? dirPath;
  const node: FileTreeNode = { name, path: dirPath, type: "directory", children: [] };

  if (currentDepth >= maxDepth) return node;

  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const filtered = filterEntries(entries);

    for (const entry of filtered) {
      const entryPath = join(dirPath, entry.name);
      const child = await buildTreeEntry(entry, entryPath, maxDepth, currentDepth);
      if (child) node.children?.push(child);
    }
  } catch (err: unknown) {
    logger.debug({ err, dirPath }, "目录读取失败");
  }

  return node;
}

/**
 * 过滤目录条目：排除隐藏文件、node_modules，并限制数量
 *
 * @param entries - 原始目录条目列表
 * @returns 过滤后的条目列表
 *
 * @example
 * ```typescript
 * const filtered = filterEntries(entries);
 * ```
 */
function filterEntries(
  entries: Array<{ name: string }>,
): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  const result: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
  for (const entry of entries as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
    if (result.length >= MAX_ENTRIES_PER_DIR) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    result.push(entry);
  }
  return result;
}

/**
 * 构建单个目录条目的树节点
 *
 * @param entry - 目录条目
 * @param entryPath - 条目完整路径
 * @param maxDepth - 最大递归深度
 * @param currentDepth - 当前递归深度
 * @returns 文件树节点，或 null（不支持的条目类型）
 *
 * @example
 * ```typescript
 * const child = await buildTreeEntry(entry, "/path/to/entry", 3, 1);
 * ```
 */
async function buildTreeEntry(
  entry: { name: string; isDirectory(): boolean; isFile(): boolean },
  entryPath: string,
  maxDepth: number,
  currentDepth: number,
): Promise<FileTreeNode | null> {
  if (entry.isDirectory()) {
    return buildTree(entryPath, maxDepth, currentDepth + 1);
  }

  if (entry.isFile()) {
    try {
      const fileStat = await stat(entryPath);
      return { name: entry.name, path: entryPath, type: "file", size: fileStat.size };
    } catch {
      return { name: entry.name, path: entryPath, type: "file" };
    }
  }

  return null;
}

/**
 * 处理 GET /api/files/read — 读取文件内容
 *
 * 使用 Bun.file() 读取指定路径的文件内容。
 * 文件大小超过 5 MB 时拒绝读取。
 *
 * @param url - 请求 URL
 * @returns 文件内容 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleReadRoute(new URL("http://localhost/api/files/read?path=/Users/dev/project/src/index.ts"));
 * ```
 */
async function handleReadRoute(url: URL): Promise<Response> {
  const rawPath = url.searchParams.get("path");
  if (!rawPath) {
    return jsonResponse({ error: "missing_param", message: "path 参数为必填" }, 400);
  }

  const safePath = await validatePath(rawPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  try {
    const file = Bun.file(safePath);
    if (!(await file.exists())) {
      return jsonResponse({ error: "not_found", message: `文件不存在: ${safePath}` }, 404);
    }

    if (file.size > MAX_READ_SIZE) {
      return jsonResponse(
        { error: "file_too_large", message: `文件过大: ${file.size} 字节（上限 ${MAX_READ_SIZE} 字节）` },
        413,
      );
    }

    const content = await file.text();
    return jsonResponse({ path: safePath, content, size: file.size });
  } catch (err: unknown) {
    logger.error({ err, path: safePath }, "文件读取失败");
    return jsonResponse({ error: "read_failed", message: "文件读取失败" }, 500);
  }
}

/**
 * 处理 PUT /api/files/write — 写入文件内容
 *
 * 使用 Bun.write() 将请求体中的内容写入指定路径。
 * 路径必须通过安全验证。
 *
 * @param req - HTTP 请求
 * @returns 写入结果 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleWriteRoute(new Request("http://localhost/api/files/write", {
 *   method: "PUT",
 *   body: JSON.stringify({ path: "/Users/dev/project/src/index.ts", content: "export default {};" }),
 * }));
 * ```
 */
async function handleWriteRoute(req: Request): Promise<Response> {
  let body: WriteFileBody;
  try {
    body = (await req.json()) as WriteFileBody;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  if (!body.path || typeof body.path !== "string") {
    return jsonResponse({ error: "missing_field", message: "path 字段为必填" }, 400);
  }

  if (typeof body.content !== "string") {
    return jsonResponse({ error: "missing_field", message: "content 字段为必填且必须为字符串" }, 400);
  }

  const safePath = await validatePath(body.path);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  try {
    await Bun.write(safePath, body.content);
    logger.info({ path: safePath, size: body.content.length }, "文件写入成功");
    return jsonResponse({ path: safePath, size: body.content.length, written: true });
  } catch (err: unknown) {
    logger.error({ err, path: safePath }, "文件写入失败");
    return jsonResponse({ error: "write_failed", message: "文件写入失败" }, 500);
  }
}
