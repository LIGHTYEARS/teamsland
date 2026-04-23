// @teamsland/server — Session 发现服务
// 扫描 ~/.claude/projects/ 发现 Claude Code 项目及其 Session

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createLogger } from "@teamsland/observability";
import type { DiscoveredProject, DiscoveredSession } from "@teamsland/types";

const logger = createLogger("server:session-discovery");

/**
 * 扫描 ~/.claude/projects/ 发现所有项目和 Session
 *
 * 遍历 Claude Code 项目目录，解码路径信息并解析 JSONL Session 文件，
 * 返回按最后活动时间排序的项目列表及其 Session 信息。
 *
 * @param maxSessionsPerProject - 每个项目最多返回的 Session 数量，默认 20
 * @returns 发现的项目列表
 *
 * @example
 * ```typescript
 * import { discoverProjects } from "./session-discovery.js";
 *
 * const projects = await discoverProjects();
 * for (const project of projects) {
 *   console.log(project.displayName, project.sessions.length);
 * }
 * ```
 */
export async function discoverProjects(maxSessionsPerProject = 20): Promise<DiscoveredProject[]> {
  const projectsDir = resolve(homedir(), ".claude/projects");
  const projects: DiscoveredProject[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Claude Code 将路径中的 / 编码为 -，但此解码不可逆（原始路径中的 - 也会被转换为 /）
      // 仅用于 display 提示，规范标识符使用 entry.name
      const projectPath = `/${entry.name.replace(/-/g, "/")}`;
      const displayName = projectPath.split("/").filter(Boolean).pop() ?? entry.name;

      const projectDir = join(projectsDir, entry.name);
      const sessions = await discoverSessions(projectDir, maxSessionsPerProject);

      projects.push({
        name: entry.name,
        path: projectPath,
        displayName,
        sessions: sessions.slice(0, maxSessionsPerProject),
        sessionMeta: {
          hasMore: sessions.length > maxSessionsPerProject,
          total: sessions.length,
        },
      });
    }

    logger.info({ projectCount: projects.length }, "项目发现扫描完成");
  } catch (err: unknown) {
    logger.warn({ err }, "项目发现扫描失败");
  }

  return projects;
}

/**
 * 发现指定项目目录下的所有 Session
 *
 * 扫描目录中的 .jsonl 文件，解析每个 Session 的元数据，
 * 按最后活动时间降序排列返回。
 *
 * @param projectDir - 项目目录路径
 * @param limit - 最大返回数量
 * @returns 发现的 Session 列表
 *
 * @example
 * ```typescript
 * const sessions = await discoverSessions("/home/user/.claude/projects/my-project", 20);
 * ```
 */
async function discoverSessions(projectDir: string, limit: number): Promise<DiscoveredSession[]> {
  const sessions: DiscoveredSession[] = [];

  try {
    const files = await readdir(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      if (sessions.length >= limit * 2) break; // 提前终止避免扫描过多文件

      const filePath = join(projectDir, file);
      const sessionId = file.replace(".jsonl", "");

      try {
        const fileStat = await stat(filePath);
        const session = await parseSessionFile(filePath, sessionId, fileStat.mtimeMs);
        if (session) sessions.push(session);
      } catch (err: unknown) {
        logger.debug({ err, filePath }, "跳过无法读取的 Session 文件");
      }
    }
  } catch {
    // 目录可能不存在或无 JSONL 文件
  }

  // 按最后活动时间降序排列
  sessions.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());

  return sessions;
}

/** 单行解析后的提取信息 */
interface ParsedLineInfo {
  summary: string;
  cwd: string;
  messageCount: number;
}

/**
 * 解析 Session JSONL 文件，提取元数据
 *
 * 读取整个文件内容，逐行解析 JSON 以提取摘要、工作目录、消息数等信息。
 * 对空文件或完全无法解析的文件返回 null。
 *
 * @param filePath - JSONL 文件路径
 * @param sessionId - Session ID
 * @param mtimeMs - 文件最后修改时间（毫秒时间戳）
 * @returns 解析后的 Session 信息，或 null
 *
 * @example
 * ```typescript
 * const session = await parseSessionFile("/path/to/session.jsonl", "abc123", Date.now());
 * ```
 */
async function parseSessionFile(
  filePath: string,
  sessionId: string,
  mtimeMs: number,
): Promise<DiscoveredSession | null> {
  const file = Bun.file(filePath);
  const text = await file.text();
  const lines = text.split("\n").filter((line) => line.trim());

  if (lines.length === 0) return null;

  const info = extractLineInfo(lines);

  // 若未能从结构化字段提取摘要，则从前 10 行的用户消息中提取
  const summary = info.summary || extractFallbackSummary(lines) || `Session ${sessionId.slice(0, 8)}`;

  return {
    id: sessionId,
    summary,
    messageCount: info.messageCount,
    lastActivity: new Date(mtimeMs).toISOString(),
    cwd: info.cwd,
  };
}

/**
 * 逐行解析 JSONL 提取结构化信息
 *
 * @param lines - 非空 JSONL 行数组
 * @returns 提取的摘要、工作目录和消息计数
 *
 * @example
 * ```typescript
 * const info = extractLineInfo(['{"type":"summary","summary":"重构配置模块"}']);
 * ```
 */
function extractLineInfo(lines: string[]): ParsedLineInfo {
  let summary = "";
  let cwd = "";
  let messageCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;

      if (entry.type === "summary" && typeof entry.summary === "string") {
        summary = entry.summary;
      }
      if (typeof entry.cwd === "string" && entry.cwd) {
        cwd = entry.cwd;
      }
      messageCount++;
    } catch {
      // 跳过格式错误的行
    }
  }

  return { summary, cwd, messageCount };
}

/**
 * 从用户消息中提取回退摘要
 *
 * 当 JSONL 中没有 summary 类型的条目时，尝试从前 10 行的
 * 用户消息（message 字段或 content 数组中的 text block）中提取。
 *
 * @param lines - JSONL 行数组
 * @returns 摘要文本，或空字符串
 *
 * @example
 * ```typescript
 * const summary = extractFallbackSummary(['{"role":"user","message":"帮我重构模块"}']);
 * // => "帮我重构模块"
 * ```
 */
function extractFallbackSummary(lines: string[]): string {
  for (const line of lines.slice(0, 10)) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;

      if (entry.role !== "user") continue;

      // 尝试 message 字段
      if (typeof entry.message === "string") {
        return entry.message.slice(0, 100);
      }

      // 尝试 content 数组中的 text block
      if (Array.isArray(entry.content)) {
        const textBlock = (entry.content as Array<Record<string, unknown>>).find((b) => b.type === "text");
        if (textBlock && typeof textBlock.text === "string") {
          return textBlock.text.slice(0, 100);
        }
      }
    } catch {
      // 跳过
    }
  }

  return "";
}
