// @teamsland/server — Evolution Log
// 追加/读取 Coordinator 自我进化日志

import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const LOG_FILE = "evolution-log.jsonl";

/**
 * 进化日志条目
 *
 * @example
 * ```typescript
 * import type { EvolutionLogEntry } from "./evolution-log.js";
 *
 * const entry: EvolutionLogEntry = {
 *   timestamp: new Date().toISOString(),
 *   action: "create_hook",
 *   path: "hooks/meego/issue-assigned.ts",
 *   reason: "处理了 5 次相同的 issue.assigned",
 *   patternCount: 5,
 * };
 * ```
 */
export interface EvolutionLogEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 动作类型 */
  action: "create_hook" | "create_skill" | "create_subagent" | "approve_hook" | "reject_hook";
  /** 产物路径 */
  path: string;
  /** 原因 */
  reason: string;
  /** 模式出现次数 */
  patternCount?: number;
  /** 审批人 */
  approvedBy?: string;
  /** 拒绝原因 */
  rejectedReason?: string;
}

/**
 * 追加一条进化日志
 *
 * @example
 * ```typescript
 * await appendEvolutionLog("/path/to/workspace", {
 *   timestamp: new Date().toISOString(),
 *   action: "create_hook",
 *   path: "hooks/meego/issue-assigned.ts",
 *   reason: "识别到重复模式",
 * });
 * ```
 */
export async function appendEvolutionLog(workspacePath: string, entry: EvolutionLogEntry): Promise<void> {
  const logPath = join(workspacePath, LOG_FILE);
  const line = `${JSON.stringify(entry)}\n`;
  await appendFile(logPath, line);
}

/**
 * 读取进化日志
 *
 * @param workspacePath - 工作目录路径
 * @param limit - 返回条数上限（默认 100）
 * @param offset - 跳过前 N 条（默认 0）
 * @returns 日志条目数组
 *
 * @example
 * ```typescript
 * const entries = await readEvolutionLog("/path/to/workspace", 10, 0);
 * ```
 */
export async function readEvolutionLog(workspacePath: string, limit = 100, offset = 0): Promise<EvolutionLogEntry[]> {
  const logPath = join(workspacePath, LOG_FILE);
  const file = Bun.file(logPath);
  if (!(await file.exists())) return [];

  const text = await file.text();
  const lines = text.trim().split("\n").filter(Boolean);
  const entries = lines.map((line) => JSON.parse(line) as EvolutionLogEntry);
  return entries.slice(offset, offset + limit);
}
