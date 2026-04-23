// @teamsland/sidecar — TranscriptReader
// Claude Code transcript JSONL 文件读取与解析

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@teamsland/observability";

/** 内容最大截断长度 */
const MAX_CONTENT_LENGTH = 2000;

/** isLive 判定窗口（毫秒） */
const LIVE_THRESHOLD_MS = 60_000;

/**
 * 标准化后的 transcript 条目
 *
 * 将 Claude Code JSONL 中各种事件格式统一为标准化条目，
 * 便于上层消费和展示。
 *
 * @example
 * ```typescript
 * import type { NormalizedEntry } from "@teamsland/sidecar";
 *
 * const entry: NormalizedEntry = {
 *   index: 0,
 *   type: "assistant",
 *   timestamp: Date.now(),
 *   content: "已完成代码审查",
 * };
 * ```
 */
export interface NormalizedEntry {
  /** 条目在文件中的行索引（从 0 开始） */
  index: number;
  /** 条目类型 */
  type: "user" | "assistant" | "tool_use" | "tool_result" | "system" | "unknown";
  /** 时间戳（Unix 毫秒），缺失时为 0 */
  timestamp: number;
  /** 文本内容（最长 2000 字符） */
  content: string;
  /** 工具名称（仅 tool_use 类型） */
  toolName?: string;
  /** 是否为错误结果（仅 tool_result / error 类型） */
  isError?: boolean;
}

/**
 * 增量读取结果
 *
 * 包含本次读取的条目列表、下次读取的偏移量，
 * 以及文件是否仍在活跃写入的判定。
 *
 * @example
 * ```typescript
 * import type { ReadResult } from "@teamsland/sidecar";
 *
 * const result: ReadResult = {
 *   entries: [],
 *   offset: 42,
 *   isLive: true,
 * };
 * ```
 */
export interface ReadResult {
  /** 本次读取到的标准化条目 */
  entries: NormalizedEntry[];
  /** 下次读取的起始偏移（行号） */
  offset: number;
  /** 文件是否仍在活跃写入（mtime 在最近 60 秒内） */
  isLive: boolean;
}

/**
 * Transcript 结构化摘要
 *
 * 从条目列表中提取关键信息，包括工具调用记录、
 * 错误列表、最后一条助手消息和总耗时。
 *
 * @example
 * ```typescript
 * import type { TranscriptSummary } from "@teamsland/sidecar";
 *
 * const summary: TranscriptSummary = {
 *   totalEntries: 120,
 *   toolCalls: [{ name: "Read", timestamp: 1700000000000, isError: false }],
 *   errors: [],
 *   lastAssistantMessage: "任务完成",
 *   durationMs: 45000,
 * };
 * ```
 */
export interface TranscriptSummary {
  /** 条目总数 */
  totalEntries: number;
  /** 工具调用列表 */
  toolCalls: Array<{ name: string; timestamp: number; isError: boolean }>;
  /** 错误条目列表 */
  errors: NormalizedEntry[];
  /** 最后一条助手消息内容 */
  lastAssistantMessage: string;
  /** 首尾条目时间跨度（毫秒） */
  durationMs: number;
}

/**
 * 从 content 数组中提取文本片段
 *
 * Claude Code 的 message.content 可能是包含 text block 的数组。
 */
function extractTextFromContentArray(blocks: unknown[]): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      texts.push(block);
      continue;
    }
    if (typeof block === "object" && block !== null) {
      const rec = block as Record<string, unknown>;
      if (typeof rec.text === "string") texts.push(rec.text);
    }
  }
  return texts.join("\n");
}

/**
 * 从 message 字段提取内容
 *
 * 处理 `message.content` 为字符串或数组两种格式。
 */
function extractMessageContent(raw: Record<string, unknown>): string | undefined {
  const message = raw.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return undefined;

  const msgContent = message.content;
  if (typeof msgContent === "string") return msgContent;
  if (Array.isArray(msgContent)) return extractTextFromContentArray(msgContent);
  return undefined;
}

/**
 * 提取原始 JSONL 行中的文本内容
 *
 * 按优先级依次尝试：message.content → result → error.message → content → input。
 */
function extractContent(raw: Record<string, unknown>): string {
  const fromMessage = extractMessageContent(raw);
  if (fromMessage !== undefined) return fromMessage;

  if (typeof raw.result === "string") return raw.result;

  const error = raw.error as Record<string, unknown> | undefined;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }

  if (typeof raw.content === "string") return raw.content;

  if (raw.input !== undefined) {
    try {
      return JSON.stringify(raw.input);
    } catch {
      return "[input]";
    }
  }

  return "";
}

/**
 * 映射原始 type 到标准化类型
 */
function mapType(rawType: unknown): NormalizedEntry["type"] {
  switch (rawType) {
    case "human":
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "tool_use":
      return "tool_use";
    case "tool_result":
      return "tool_result";
    case "system":
      return "system";
    case "result":
      return "assistant";
    case "error":
      return "unknown";
    default:
      return "unknown";
  }
}

/**
 * 将原始 JSONL 行解析为标准化条目
 *
 * 处理各种 Claude Code 事件格式（system、assistant、tool_use、
 * tool_result、result、error），统一归一化为 NormalizedEntry。
 */
function normalizeLine(raw: Record<string, unknown>, index: number): NormalizedEntry {
  const type = mapType(raw.type);
  const content = extractContent(raw);
  const truncated = content.length > MAX_CONTENT_LENGTH ? content.slice(0, MAX_CONTENT_LENGTH) : content;

  const entry: NormalizedEntry = {
    index,
    type,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : 0,
    content: truncated,
  };

  // tool_use: 提取工具名
  if (raw.type === "tool_use" && typeof raw.name === "string") {
    entry.toolName = raw.name;
  }

  // tool_result: 提取 isError
  if (raw.type === "tool_result") {
    entry.isError = raw.is_error === true;
  }

  // error 类型标记
  if (raw.type === "error") {
    entry.isError = true;
  }

  return entry;
}

/**
 * Claude Code Transcript 读取器
 *
 * 支持增量读取、尾部读取和结构化摘要。路径解析支持两种策略：
 * slug（路径替换）和 hash（SHA-256 前缀），自动探测并回退。
 *
 * @example
 * ```typescript
 * import { createLogger } from "@teamsland/observability";
 * import { TranscriptReader } from "@teamsland/sidecar";
 *
 * const reader = new TranscriptReader(createLogger("sidecar:transcript"));
 * const path = reader.resolveTranscriptPath("/repos/my-project", "sess-001");
 * const result = await reader.read(path, 0, 100);
 * console.log(result.entries.length, result.isLive);
 * ```
 */
export class TranscriptReader {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * 推算 transcript 文件路径
   *
   * 依次尝试两种路径推算策略，返回第一个存在的路径：
   * 1. Slug: `~/.claude/projects/{slug}/{sessionId}.jsonl`
   *    其中 slug = worktreePath 的 `/` 替换为 `-` 并去掉前导 `-`
   * 2. Hash: `~/.claude/projects/{hash}/{sessionId}.jsonl`
   *    其中 hash = SHA-256(worktreePath) 的前 16 个十六进制字符
   *
   * 若两个路径均不存在，返回 slug 路径作为默认值。
   *
   * @param worktreePath - 工作区路径
   * @param sessionId - 会话 ID
   * @returns transcript JSONL 文件的完整路径
   *
   * @example
   * ```typescript
   * import { createLogger } from "@teamsland/observability";
   * import { TranscriptReader } from "@teamsland/sidecar";
   *
   * const reader = new TranscriptReader(createLogger("sidecar:transcript"));
   * const path = reader.resolveTranscriptPath("/home/dev/repo", "session-abc");
   * // 可能返回: /Users/dev/.claude/projects/home-dev-repo/session-abc.jsonl
   * ```
   */
  resolveTranscriptPath(worktreePath: string, sessionId: string): string {
    const home = homedir();
    const fileName = `${sessionId}.jsonl`;

    // 策略 1: slug
    const slug = worktreePath.replaceAll("/", "-").replace(/^-/, "");
    const slugPath = join(home, ".claude", "projects", slug, fileName);

    if (existsSync(slugPath)) {
      this.logger.debug({ strategy: "slug", path: slugPath }, "transcript 路径命中 slug 策略");
      return slugPath;
    }

    // 策略 2: hash
    const hash = createHash("sha256").update(worktreePath).digest("hex").slice(0, 16);
    const hashPath = join(home, ".claude", "projects", hash, fileName);

    if (existsSync(hashPath)) {
      this.logger.debug({ strategy: "hash", path: hashPath }, "transcript 路径命中 hash 策略");
      return hashPath;
    }

    this.logger.debug({ slugPath, hashPath }, "transcript 路径均未命中，返回 slug 默认路径");
    return slugPath;
  }

  /**
   * 增量读取 transcript
   *
   * 从指定行偏移量开始读取 JSONL 文件，返回最多 `maxEntries` 条标准化条目。
   * 每行独立解析为 JSON 并归一化。最后一行若为不完整 JSON（流正在写入），
   * 会被容错跳过。通过文件 mtime 判定是否仍在活跃写入。
   *
   * @param filePath - JSONL 文件路径
   * @param offset - 起始行号（默认 0）
   * @param maxEntries - 最多返回条目数（默认 500）
   * @returns 读取结果，包含条目列表、下次偏移和 isLive 标记
   *
   * @example
   * ```typescript
   * import { createLogger } from "@teamsland/observability";
   * import { TranscriptReader } from "@teamsland/sidecar";
   *
   * const reader = new TranscriptReader(createLogger("sidecar:transcript"));
   * const result = await reader.read("/path/to/session.jsonl", 0, 100);
   * for (const entry of result.entries) {
   *   console.log(entry.type, entry.content.slice(0, 80));
   * }
   * ```
   */
  async read(filePath: string, offset = 0, maxEntries = 500): Promise<ReadResult> {
    const file = Bun.file(filePath);

    let text: string;
    try {
      text = await file.text();
    } catch (err: unknown) {
      this.logger.warn({ err, filePath }, "transcript 文件读取失败");
      return { entries: [], offset, isLive: false };
    }

    const rawLines = text.split("\n").filter((line) => line.trim().length > 0);
    const linesToProcess = rawLines.slice(offset, offset + maxEntries);
    const entries: NormalizedEntry[] = [];

    for (let i = 0; i < linesToProcess.length; i++) {
      const line = linesToProcess[i];
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        entries.push(normalizeLine(parsed, offset + i));
      } catch {
        // 最后一行容错：流可能正在写入
        if (i === linesToProcess.length - 1) {
          this.logger.debug({ lineIndex: offset + i }, "跳过不完整的最后一行");
        } else {
          this.logger.warn({ lineIndex: offset + i }, "跳过无法解析的 JSONL 行");
        }
      }
    }

    // 判定 isLive: mtime 在最近 60 秒内
    let isLive = false;
    try {
      const stat = statSync(filePath);
      isLive = Date.now() - stat.mtimeMs < LIVE_THRESHOLD_MS;
    } catch {
      // 无法获取 mtime，默认非活跃
    }

    const newOffset = offset + linesToProcess.length;

    this.logger.debug({ filePath, offset, newOffset, entryCount: entries.length, isLive }, "transcript 增量读取完成");

    return { entries, offset: newOffset, isLive };
  }

  /**
   * 读取最后 N 条 transcript 条目
   *
   * 读取整个文件后仅返回尾部 `count` 条标准化条目，
   * 适用于快速查看最新状态的场景。
   *
   * @param filePath - JSONL 文件路径
   * @param count - 返回的条目数量
   * @returns 最后 N 条标准化条目
   *
   * @example
   * ```typescript
   * import { createLogger } from "@teamsland/observability";
   * import { TranscriptReader } from "@teamsland/sidecar";
   *
   * const reader = new TranscriptReader(createLogger("sidecar:transcript"));
   * const last5 = await reader.tail("/path/to/session.jsonl", 5);
   * console.log("最后一条:", last5.at(-1)?.content);
   * ```
   */
  async tail(filePath: string, count: number): Promise<NormalizedEntry[]> {
    const result = await this.read(filePath, 0, Number.MAX_SAFE_INTEGER);
    const entries = result.entries;
    if (entries.length <= count) return entries;
    return entries.slice(-count);
  }

  /**
   * 生成结构化摘要
   *
   * 纯函数，从标准化条目列表中提取工具调用记录、错误条目、
   * 最后一条助手消息内容，以及首尾条目的时间跨度。
   * 不涉及 LLM 调用。
   *
   * @param entries - 标准化条目列表
   * @returns 结构化摘要
   *
   * @example
   * ```typescript
   * import { createLogger } from "@teamsland/observability";
   * import { TranscriptReader } from "@teamsland/sidecar";
   *
   * const reader = new TranscriptReader(createLogger("sidecar:transcript"));
   * const result = await reader.read("/path/to/session.jsonl");
   * const summary = reader.summarizeStructured(result.entries);
   * console.log(`共 ${summary.totalEntries} 条，耗时 ${summary.durationMs}ms`);
   * ```
   */
  summarizeStructured(entries: NormalizedEntry[]): TranscriptSummary {
    const toolCalls: TranscriptSummary["toolCalls"] = [];
    const errors: NormalizedEntry[] = [];
    let lastAssistantMessage = "";

    for (const entry of entries) {
      if (entry.type === "tool_use" && entry.toolName) {
        toolCalls.push({
          name: entry.toolName,
          timestamp: entry.timestamp,
          isError: entry.isError === true,
        });
      }

      if (entry.isError === true) {
        errors.push(entry);
      }

      if (entry.type === "assistant" && entry.content.length > 0) {
        lastAssistantMessage = entry.content;
      }
    }

    // 计算持续时间：找到第一个和最后一个有效时间戳
    let durationMs = 0;
    const timestamps = entries.filter((e) => e.timestamp > 0).map((e) => e.timestamp);
    if (timestamps.length >= 2) {
      const first = timestamps[0];
      const last = timestamps[timestamps.length - 1];
      if (first !== undefined && last !== undefined) {
        durationMs = last - first;
      }
    }

    return {
      totalEntries: entries.length,
      toolCalls,
      errors,
      lastAssistantMessage,
      durationMs,
    };
  }
}
