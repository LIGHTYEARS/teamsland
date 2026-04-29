import { homedir } from "node:os";
import { join } from "node:path";
import type { HookEngine, HookMetricsCollector } from "@teamsland/hooks";
import type { AppConfig } from "@teamsland/types";

/** JSON 响应工具函数（本模块局部使用） */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** 解析以 ~ 开头的路径 */
function resolveTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** GET /api/hooks/pending — 待审批 hook 列表 */
async function handleHooksPending(pendingDir: string): Promise<Response> {
  const resolvedDir = resolveTilde(pendingDir);
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(resolvedDir).catch(() => [] as string[]);
  const pending = files.filter((f) => f.endsWith(".ts")).map((f) => ({ filename: f, path: join(resolvedDir, f) }));
  return jsonResponse({ pending });
}

/** POST /api/hooks/:filename/approve — 审批通过 */
async function handleHookApprove(
  filename: string,
  pendingDir: string,
  hooksDir: string,
  workspacePath: string,
): Promise<Response> {
  const resolvedPending = resolveTilde(pendingDir);
  const resolvedHooks = resolveTilde(hooksDir);
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { rename } = await import("node:fs/promises");
  try {
    await rename(join(resolvedPending, filename), join(resolvedHooks, filename));
    const { appendEvolutionLog } = await import("./evolution-log.js");
    await appendEvolutionLog(resolvedWorkspace, {
      timestamp: new Date().toISOString(),
      action: "approve_hook",
      path: `hooks/${filename}`,
      reason: "Dashboard 审批通过",
    });
    return jsonResponse({ approved: filename });
  } catch (err: unknown) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

/** POST /api/hooks/:filename/reject — 拒绝 */
async function handleHookReject(
  req: Request,
  filename: string,
  pendingDir: string,
  workspacePath: string,
): Promise<Response> {
  const resolvedPending = resolveTilde(pendingDir);
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { unlink } = await import("node:fs/promises");
  let reason = "未指定原因";
  try {
    const body = (await req.json()) as { reason?: string };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    /* 使用默认原因 */
  }
  try {
    await unlink(join(resolvedPending, filename));
    const { appendEvolutionLog } = await import("./evolution-log.js");
    await appendEvolutionLog(resolvedWorkspace, {
      timestamp: new Date().toISOString(),
      action: "reject_hook",
      path: `hooks-pending/${filename}`,
      reason,
      rejectedReason: reason,
    });
    return jsonResponse({ rejected: filename });
  } catch (err: unknown) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
}

/** GET /api/hooks/evolution-log — 进化日志 */
async function handleHooksEvolutionLog(url: URL, workspacePath: string): Promise<Response> {
  const resolvedWorkspace = resolveTilde(workspacePath);
  const { readEvolutionLog } = await import("./evolution-log.js");
  const limit = Number(url.searchParams.get("limit")) || 100;
  const offset = Number(url.searchParams.get("offset")) || 0;
  const entries = await readEvolutionLog(resolvedWorkspace, limit, offset);
  return jsonResponse({ entries, total: entries.length });
}

/** Hook 进化管理所需配置项 */
interface HookEvolutionConfig {
  pendingDir: string | undefined;
  hooksDir: string | undefined;
  workspacePath: string;
}

/** 从 AppConfig 中提取 Hook 进化管理配置 */
function extractHookEvolutionConfig(config: AppConfig | null | undefined): HookEvolutionConfig {
  return {
    pendingDir: config?.hooks?.pendingDir,
    hooksDir: config?.hooks?.hooksDir,
    workspacePath: config?.coordinator?.workspacePath ?? "~/.teamsland/coordinator",
  };
}

/** 处理 POST /api/hooks/:filename/approve 或 /reject */
function handleHookMutation(req: Request, url: URL, cfg: HookEvolutionConfig): Response | Promise<Response> | null {
  const approveMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/approve$/);
  if (req.method === "POST" && approveMatch) {
    const filename = approveMatch[1];
    if (!cfg.pendingDir || !cfg.hooksDir) return jsonResponse({ error: "hooks 目录未配置" }, 400);
    return handleHookApprove(filename, cfg.pendingDir, cfg.hooksDir, cfg.workspacePath);
  }

  const rejectMatch = url.pathname.match(/^\/api\/hooks\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const filename = rejectMatch[1];
    if (!cfg.pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);
    return handleHookReject(req, filename, cfg.pendingDir, cfg.workspacePath);
  }

  return null;
}

/** 处理 Hook 进化管理路由（pending/approve/reject/evolution-log） */
function handleHookEvolutionRoutes(
  req: Request,
  url: URL,
  config?: AppConfig | null,
): Response | Promise<Response> | null {
  const cfg = extractHookEvolutionConfig(config);

  if (req.method === "GET" && url.pathname === "/api/hooks/pending") {
    if (!cfg.pendingDir) return jsonResponse({ error: "pendingDir 未配置" }, 400);
    return handleHooksPending(cfg.pendingDir);
  }

  if (req.method === "GET" && url.pathname === "/api/hooks/evolution-log") {
    return handleHooksEvolutionLog(url, cfg.workspacePath);
  }

  return handleHookMutation(req, url, cfg);
}

/** 处理 Hook 相关 API 路由 */
export function handleHookRoutes(
  req: Request,
  url: URL,
  hookEngine?: HookEngine | null,
  hookMetricsCollector?: HookMetricsCollector | null,
  config?: AppConfig | null,
): Response | Promise<Response> | null {
  if (req.method === "GET" && url.pathname === "/api/hooks/status") {
    if (!hookEngine) return jsonResponse({ enabled: false, message: "Hook 引擎未启用" });
    return jsonResponse({ enabled: true, ...hookEngine.getStatus() });
  }

  if (req.method === "GET" && url.pathname === "/api/hooks/metrics") {
    if (!hookMetricsCollector) return jsonResponse({ enabled: false, message: "Hook 指标收集器未启用" });
    return jsonResponse({ enabled: true, ...hookMetricsCollector.getSnapshot() });
  }

  return handleHookEvolutionRoutes(req, url, config);
}
