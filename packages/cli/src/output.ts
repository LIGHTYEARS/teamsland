/**
 * 将时间戳格式化为人类可读的相对时间
 *
 * @example
 * ```typescript
 * import { formatTimeAgo } from "@teamsland/cli";
 *
 * const ts = Date.now() - 120_000;
 * console.log(formatTimeAgo(ts)); // "2m ago"
 * ```
 */
export function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

/**
 * 以格式化 JSON 形式输出数据到 stdout
 *
 * @example
 * ```typescript
 * import { printJson } from "@teamsland/cli";
 *
 * printJson({ workerId: "worker-abc", status: "running" });
 * // 输出: { "workerId": "worker-abc", "status": "running" }
 * ```
 */
export function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/**
 * 输出错误信息到 stderr
 *
 * @example
 * ```typescript
 * import { printError } from "@teamsland/cli";
 *
 * printError("Worker not found");
 * // stderr 输出: Error: Worker not found
 * ```
 */
export function printError(msg: string): void {
  process.stderr.write(`Error: ${msg}\n`);
}

/**
 * 输出普通信息到 stdout
 *
 * @example
 * ```typescript
 * import { printLine } from "@teamsland/cli";
 *
 * printLine("Worker worker-abc spawned (PID 12345)");
 * ```
 */
export function printLine(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

/**
 * 将字符串截断到指定长度，超出部分用省略号替代
 *
 * @example
 * ```typescript
 * import { truncate } from "@teamsland/cli";
 *
 * console.log(truncate("很长的文本内容", 6)); // "很长的文..."
 * ```
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen)}...`;
}

/**
 * 将字符串右填充到指定宽度
 *
 * @example
 * ```typescript
 * import { padEnd } from "@teamsland/cli";
 *
 * console.log(padEnd("hello", 10)); // "hello     "
 * ```
 */
export function padEnd(str: string, width: number): string {
  if (str.length >= width) {
    return str;
  }
  return str + " ".repeat(width - str.length);
}
