// @teamsland/server — Git 操作路由
// 提供 /api/git/status、/api/git/diff、/api/git/branches、/api/git/stage、/api/git/commit、/api/git/checkout 端点

import { normalize, resolve } from "node:path";
import { createLogger } from "@teamsland/observability";

const logger = createLogger("server:git-routes");

/** 允许的项目根目录列表（防止命令注入） */
const ALLOWED_ROOTS = ["/Users", "/home", "/tmp"];

/** Git 命令执行超时（毫秒） */
const GIT_TIMEOUT_MS = 30_000;

/**
 * Git 命令执行结果
 *
 * @example
 * ```typescript
 * import type { GitExecResult } from "./git-routes.js";
 *
 * const result: GitExecResult = { stdout: "M src/index.ts\n", stderr: "", exitCode: 0 };
 * ```
 */
interface GitExecResult {
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number;
}

/**
 * Stage 请求体
 *
 * @example
 * ```typescript
 * const body: StageBody = { path: "/Users/dev/project", files: ["src/index.ts", "src/utils.ts"] };
 * ```
 */
interface StageBody {
  /** 仓库路径 */
  path: string;
  /** 要 stage 的文件列表 */
  files: string[];
}

/**
 * Commit 请求体
 *
 * @example
 * ```typescript
 * const body: CommitBody = { path: "/Users/dev/project", message: "feat: add user login" };
 * ```
 */
interface CommitBody {
  /** 仓库路径 */
  path: string;
  /** 提交消息 */
  message: string;
}

/** JSON 响应工具函数 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * 验证仓库路径安全性
 *
 * 规范化路径并检查是否在允许的根目录范围内。
 *
 * @param rawPath - 原始路径字符串
 * @returns 规范化后的安全路径，或 null
 *
 * @example
 * ```typescript
 * const safe = validateRepoPath("/Users/dev/project");
 * // => "/Users/dev/project"
 *
 * const unsafe = validateRepoPath("/etc/shadow");
 * // => null
 * ```
 */
function validateRepoPath(rawPath: unknown): string | null {
  if (!rawPath || typeof rawPath !== "string") return null;

  const normalized = resolve(normalize(rawPath));

  if (rawPath.includes("\0")) return null;

  const isAllowed = ALLOWED_ROOTS.some((root) => normalized.startsWith(root));
  if (!isAllowed) {
    logger.warn({ rawPath, normalized }, "Git 路径不在允许的目录范围内");
    return null;
  }

  return normalized;
}

/**
 * 验证 Git 命令参数安全性
 *
 * 拒绝包含 shell 特殊字符或命令注入尝试的参数。
 *
 * @param arg - 待验证的参数
 * @returns 是否安全
 *
 * @example
 * ```typescript
 * isSafeGitArg("src/index.ts");  // => true
 * isSafeGitArg("; rm -rf /");    // => false
 * ```
 */
function isSafeGitArg(arg: string): boolean {
  // 禁止 shell 元字符和命令注入
  const dangerousPattern = /[;&|`$(){}[\]<>!\\]/;
  return !dangerousPattern.test(arg);
}

/**
 * 执行 Git 命令
 *
 * 使用 Bun.spawn 在指定工作目录中执行 git 命令，
 * 收集 stdout、stderr 和退出码。
 *
 * @param args - Git 子命令及参数列表
 * @param cwd - 工作目录
 * @returns 执行结果
 *
 * @example
 * ```typescript
 * const result = await runGit(["status", "--porcelain"], "/Users/dev/project");
 * if (result.exitCode === 0) {
 *   console.log(result.stdout);
 * }
 * ```
 */
async function runGit(args: string[], cwd: string): Promise<GitExecResult> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      // 禁用 git pager 和颜色输出
      GIT_PAGER: "",
      NO_COLOR: "1",
    },
  });

  const timeoutId = setTimeout(() => {
    try {
      proc.kill();
    } catch {
      // 进程可能已退出
    }
  }, GIT_TIMEOUT_MS);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 处理 Git 操作路由
 *
 * 匹配 /api/git/status、/api/git/diff、/api/git/branches、
 * /api/git/stage、/api/git/commit、/api/git/checkout 路由。
 * 匹配时返回 Response 或 Promise<Response>，不匹配时返回 null。
 *
 * @param req - HTTP 请求
 * @param url - 解析后的 URL
 * @returns Response（匹配时）或 null（不匹配时）
 *
 * @example
 * ```typescript
 * import { handleGitRoutes } from "./git-routes.js";
 *
 * const result = handleGitRoutes(req, url);
 * if (result) return result;
 * ```
 */
export function handleGitRoutes(req: Request, url: URL): Response | Promise<Response> | null {
  if (!url.pathname.startsWith("/api/git")) return null;

  // GET /api/git/status?path=...
  if (req.method === "GET" && url.pathname === "/api/git/status") {
    return handleGitStatus(url);
  }

  // GET /api/git/diff?path=...
  if (req.method === "GET" && url.pathname === "/api/git/diff") {
    return handleGitDiff(url);
  }

  // GET /api/git/branches?path=...
  if (req.method === "GET" && url.pathname === "/api/git/branches") {
    return handleGitBranches(url);
  }

  // POST /api/git/stage
  if (req.method === "POST" && url.pathname === "/api/git/stage") {
    return handleGitStage(req);
  }

  // POST /api/git/commit
  if (req.method === "POST" && url.pathname === "/api/git/commit") {
    return handleGitCommit(req);
  }

  // POST /api/git/checkout
  if (req.method === "POST" && url.pathname === "/api/git/checkout") {
    return handleGitCheckout(req);
  }

  return null;
}

/**
 * 处理 GET /api/git/status — 获取 Git 状态
 *
 * 在指定目录执行 `git status --porcelain -b`，返回当前分支和变更文件列表。
 *
 * @param url - 请求 URL
 * @returns Git 状态 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitStatus(new URL("http://localhost/api/git/status?path=/Users/dev/project"));
 * ```
 */
async function handleGitStatus(url: URL): Promise<Response> {
  const rawPath = url.searchParams.get("path");
  const safePath = validateRepoPath(rawPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  const result = await runGit(["status", "--porcelain", "-b"], safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath }, "git status 执行失败");
    return jsonResponse({ error: "git_error", message: result.stderr.trim() || "git status 失败" }, 500);
  }

  const lines = result.stdout.split("\n").filter((l) => l.trim());
  let branch = "";
  const files: Array<{ status: string; file: string }> = [];

  for (const line of lines) {
    if (line.startsWith("##")) {
      // ## main...origin/main => "main"
      branch = line.replace("## ", "").split("...")[0] ?? "";
    } else {
      const statusCode = line.slice(0, 2).trim();
      const filePath = line.slice(3).trim();
      if (filePath) {
        files.push({ status: statusCode, file: filePath });
      }
    }
  }

  return jsonResponse({ branch, files, raw: result.stdout });
}

/**
 * 处理 GET /api/git/diff — 获取 Git diff
 *
 * 在指定目录执行 `git diff`（或 `git diff --cached` 若 staged=true）。
 *
 * @param url - 请求 URL
 * @returns Git diff JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitDiff(new URL("http://localhost/api/git/diff?path=/Users/dev/project&staged=true"));
 * ```
 */
async function handleGitDiff(url: URL): Promise<Response> {
  const rawPath = url.searchParams.get("path");
  const safePath = validateRepoPath(rawPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  const staged = url.searchParams.get("staged") === "true";
  const args = staged ? ["diff", "--cached"] : ["diff"];

  const result = await runGit(args, safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath }, "git diff 执行失败");
    return jsonResponse({ error: "git_error", message: result.stderr.trim() || "git diff 失败" }, 500);
  }

  return jsonResponse({ diff: result.stdout, staged });
}

/**
 * 处理 GET /api/git/branches — 获取分支列表
 *
 * 在指定目录执行 `git branch -a`，返回本地和远程分支列表及当前分支。
 *
 * @param url - 请求 URL
 * @returns 分支列表 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitBranches(new URL("http://localhost/api/git/branches?path=/Users/dev/project"));
 * ```
 */
async function handleGitBranches(url: URL): Promise<Response> {
  const rawPath = url.searchParams.get("path");
  const safePath = validateRepoPath(rawPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  const result = await runGit(["branch", "-a", "--no-color"], safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath }, "git branch 执行失败");
    return jsonResponse({ error: "git_error", message: result.stderr.trim() || "git branch 失败" }, 500);
  }

  let currentBranch = "";
  const branches: string[] = [];

  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("* ")) {
      currentBranch = trimmed.slice(2);
      branches.push(currentBranch);
    } else {
      branches.push(trimmed);
    }
  }

  return jsonResponse({ currentBranch, branches });
}

/**
 * 处理 POST /api/git/stage — 暂存文件
 *
 * 在指定目录执行 `git add` 添加指定文件到暂存区。
 * 所有文件名必须通过安全验证。
 *
 * @param req - HTTP 请求
 * @returns Stage 结果 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitStage(new Request("http://localhost/api/git/stage", {
 *   method: "POST",
 *   body: JSON.stringify({ path: "/Users/dev/project", files: ["src/index.ts"] }),
 * }));
 * ```
 */
async function handleGitStage(req: Request): Promise<Response> {
  let body: StageBody;
  try {
    body = (await req.json()) as StageBody;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  const safePath = validateRepoPath(body.path);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  if (!Array.isArray(body.files) || body.files.length === 0) {
    return jsonResponse({ error: "missing_field", message: "files 字段必须为非空数组" }, 400);
  }

  // 验证每个文件名的安全性
  for (const file of body.files) {
    if (typeof file !== "string" || !isSafeGitArg(file)) {
      return jsonResponse({ error: "invalid_file", message: `文件名不合法: ${String(file)}` }, 400);
    }
  }

  const result = await runGit(["add", "--", ...body.files], safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath }, "git add 执行失败");
    return jsonResponse({ error: "git_error", message: result.stderr.trim() || "git add 失败" }, 500);
  }

  logger.info({ path: safePath, fileCount: body.files.length }, "文件已暂存");
  return jsonResponse({ staged: true, files: body.files });
}

/**
 * 处理 POST /api/git/commit — 提交变更
 *
 * 在指定目录执行 `git commit -m`，使用请求体中的提交消息。
 * 提交消息经过长度和内容验证。
 *
 * @param req - HTTP 请求
 * @returns Commit 结果 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitCommit(new Request("http://localhost/api/git/commit", {
 *   method: "POST",
 *   body: JSON.stringify({ path: "/Users/dev/project", message: "feat: add user login" }),
 * }));
 * ```
 */
async function handleGitCommit(req: Request): Promise<Response> {
  let body: CommitBody;
  try {
    body = (await req.json()) as CommitBody;
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  const safePath = validateRepoPath(body.path);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  if (!body.message || typeof body.message !== "string") {
    return jsonResponse({ error: "missing_field", message: "message 字段为必填" }, 400);
  }

  if (body.message.length > 5000) {
    return jsonResponse({ error: "invalid_field", message: "提交消息过长（上限 5000 字符）" }, 400);
  }

  const result = await runGit(["commit", "-m", body.message], safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath }, "git commit 执行失败");
    return jsonResponse(
      { error: "git_error", message: result.stderr.trim() || result.stdout.trim() || "git commit 失败" },
      500,
    );
  }

  logger.info({ path: safePath }, "Git 提交成功");
  return jsonResponse({ committed: true, output: result.stdout.trim() });
}

/**
 * 处理 POST /api/git/checkout — 切换 Git 分支
 *
 * 在指定目录执行 `git checkout <branch>`，切换到目标分支。
 * 分支名必须通过安全验证。
 *
 * @param req - HTTP 请求
 * @returns Checkout 结果 JSON 响应
 *
 * @example
 * ```typescript
 * const response = await handleGitCheckout(new Request("http://localhost/api/git/checkout", {
 *   method: "POST",
 *   body: JSON.stringify({ projectPath: "/Users/dev/project", branch: "feature-x" }),
 * }));
 * ```
 */
async function handleGitCheckout(req: Request): Promise<Response> {
  let body: { projectPath?: string; branch?: string };
  try {
    body = (await req.json()) as { projectPath?: string; branch?: string };
  } catch {
    return jsonResponse({ error: "invalid_json", message: "请求体必须是有效的 JSON" }, 400);
  }

  const safePath = validateRepoPath(body.projectPath);
  if (!safePath) {
    return jsonResponse({ error: "invalid_path", message: "路径不合法或不在允许范围内" }, 403);
  }

  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!branch || !isSafeGitArg(branch)) {
    return jsonResponse({ error: "invalid_branch", message: "分支名不合法" }, 400);
  }

  const result = await runGit(["checkout", branch], safePath);
  if (result.exitCode !== 0) {
    logger.warn({ stderr: result.stderr, path: safePath, branch }, "git checkout 执行失败");
    return jsonResponse({ error: "git_error", message: result.stderr.trim() || "git checkout 失败" }, 500);
  }

  logger.info({ path: safePath, branch }, "Git 分支切换成功");
  return jsonResponse({ ok: true, branch });
}
