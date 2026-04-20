import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentRecord } from "@teamsland/types";
import type { CommandRunner } from "./command-runner.js";
import { BunCommandRunner } from "./command-runner.js";

/**
 * 可回收的 Agent 子集字段
 *
 * 仅包含 `reap()` 所需的 AgentRecord 字段，避免耦合完整记录结构。
 *
 * @example
 * ```typescript
 * import type { ReapableAgent } from "@teamsland/git";
 *
 * const agent: ReapableAgent = {
 *   worktreePath: "/repo/.worktrees/req-42",
 *   status: "completed",
 *   createdAt: Date.now() - 86_400_000 * 10,
 *   issueId: "42",
 * };
 * ```
 */
export type ReapableAgent = Pick<AgentRecord, "worktreePath" | "status" | "createdAt" | "issueId">;

/**
 * 回收动作类型
 *
 * @example
 * ```typescript
 * import type { ReapAction } from "@teamsland/git";
 *
 * const action: ReapAction = "removed";
 * ```
 */
export type ReapAction = "removed" | "auto-committed-and-removed" | "skipped-running" | "error";

/**
 * 回收操作结果
 *
 * @example
 * ```typescript
 * import type { ReapResult } from "@teamsland/git";
 *
 * const result: ReapResult = {
 *   worktreePath: "/repo/.worktrees/req-42",
 *   action: "removed",
 * };
 * ```
 */
export interface ReapResult {
  /** 被操作的 worktree 路径 */
  worktreePath: string;
  /** 执行的回收动作 */
  action: ReapAction;
  /** 错误信息（仅 action 为 "error" 时存在） */
  error?: string;
}

/**
 * Git worktree 操作错误
 *
 * 当 git 命令返回非零退出码时抛出。
 *
 * @example
 * ```typescript
 * import { WorktreeError } from "@teamsland/git";
 *
 * try {
 *   await manager.create("/repo", "issue-1");
 * } catch (err) {
 *   if (err instanceof WorktreeError) {
 *     console.error(`命令失败: ${err.command.join(" ")}, 退出码: ${err.exitCode}`);
 *     console.error(err.stderr);
 *   }
 * }
 * ```
 */
export class WorktreeError extends Error {
  override readonly name = "WorktreeError";

  constructor(
    message: string,
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

/** 需要追加到 .git/info/exclude 的排除模式 */
const EXCLUDE_PATTERNS = [".agent_context", "CLAUDE.md", ".claude"] as const;

/**
 * Git Worktree 管理器
 *
 * 为每个 agent 会话创建隔离的 git worktree，并定期回收过期的 worktree。
 * 通过构造函数注入 `CommandRunner` 实现可测试性。
 *
 * @example
 * ```typescript
 * import { WorktreeManager } from "@teamsland/git";
 *
 * const manager = new WorktreeManager();
 * const worktreePath = await manager.create("/path/to/repo", "ISSUE-42", "main");
 * console.log(`Worktree 创建于: ${worktreePath}`);
 * ```
 */
export class WorktreeManager {
  private readonly runner: CommandRunner;

  constructor(runner?: CommandRunner) {
    this.runner = runner ?? new BunCommandRunner();
  }

  /**
   * 创建新的 git worktree
   *
   * 在 `{repoPath}/.worktrees/req-{issueId}` 创建一个基于指定分支的 worktree，
   * 并更新 `.git/info/exclude` 以排除 agent 专用文件。
   *
   * @param repoPath - 仓库根目录绝对路径
   * @param issueId - 关联的 issue ID，用于命名分支和目录
   * @param baseBranch - 基础分支，默认为 HEAD
   * @returns worktree 的绝对路径
   * @throws {WorktreeError} git worktree add 命令失败时抛出
   *
   * @example
   * ```typescript
   * import { WorktreeManager } from "@teamsland/git";
   *
   * const manager = new WorktreeManager();
   * const path = await manager.create("/repos/frontend", "PROJ-123", "main");
   * // path === "/repos/frontend/.worktrees/req-PROJ-123"
   * ```
   */
  async create(repoPath: string, issueId: string, baseBranch = "HEAD"): Promise<string> {
    const branchName = `feat/req-${issueId}`;
    const worktreePath = join(repoPath, ".worktrees", `req-${issueId}`);

    const cmd = ["git", "-C", repoPath, "worktree", "add", "-b", branchName, worktreePath, baseBranch];
    const result = await this.runner.run(cmd);

    if (result.exitCode !== 0) {
      throw new WorktreeError(
        `Failed to create worktree for issue ${issueId}: ${result.stderr}`,
        cmd,
        result.exitCode,
        result.stderr,
      );
    }

    await this.updateExcludeFile(repoPath);

    return worktreePath;
  }

  /**
   * 回收过期的 agent worktree
   *
   * 过滤出非 running 且超过 maxAgeDays 的 agent，对其 worktree 执行清理：
   * 若有未提交更改则先 auto-commit，然后强制移除 worktree。
   *
   * @param agents - 待检查的 agent 列表
   * @param maxAgeDays - 最大存活天数，默认 7
   * @returns 每个被处理 agent 的回收结果
   *
   * @example
   * ```typescript
   * import { WorktreeManager } from "@teamsland/git";
   * import type { ReapableAgent } from "@teamsland/git";
   *
   * const manager = new WorktreeManager();
   * const agents: ReapableAgent[] = [
   *   { worktreePath: "/repo/.worktrees/req-1", status: "completed", createdAt: 0, issueId: "1" },
   * ];
   * const results = await manager.reap(agents);
   * for (const r of results) {
   *   console.log(`${r.worktreePath}: ${r.action}`);
   * }
   * ```
   */
  async reap(agents: ReapableAgent[], maxAgeDays = 7): Promise<ReapResult[]> {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const results: ReapResult[] = [];

    for (const agent of agents) {
      if (agent.status === "running") {
        results.push({ worktreePath: agent.worktreePath, action: "skipped-running" });
        continue;
      }

      if (agent.createdAt >= cutoff) {
        continue;
      }

      const reapResult = await this.reapSingle(agent);
      results.push(reapResult);
    }

    return results;
  }

  private async reapSingle(agent: ReapableAgent): Promise<ReapResult> {
    const { worktreePath, issueId } = agent;

    try {
      // 检查是否有未提交更改
      const statusResult = await this.runner.run(["git", "-C", worktreePath, "status", "--porcelain"]);
      const isDirty = statusResult.stdout.trim().length > 0;

      if (isDirty) {
        // auto-commit
        const addResult = await this.runner.run(["git", "-C", worktreePath, "add", "-A"]);
        if (addResult.exitCode !== 0) {
          return { worktreePath, action: "error", error: addResult.stderr };
        }

        const commitResult = await this.runner.run([
          "git",
          "-C",
          worktreePath,
          "commit",
          "-m",
          `auto-save before worktree cleanup (req-${issueId})`,
        ]);
        if (commitResult.exitCode !== 0) {
          return { worktreePath, action: "error", error: commitResult.stderr };
        }
      }

      // 移除 worktree
      const removeResult = await this.runner.run(["git", "worktree", "remove", "--force", worktreePath]);
      if (removeResult.exitCode !== 0) {
        return { worktreePath, action: "error", error: removeResult.stderr };
      }

      return { worktreePath, action: isDirty ? "auto-committed-and-removed" : "removed" };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { worktreePath, action: "error", error: message };
    }
  }

  private async updateExcludeFile(repoPath: string): Promise<void> {
    const excludePath = join(repoPath, ".git", "info", "exclude");

    let content: string;
    try {
      content = await readFile(excludePath, "utf-8");
    } catch {
      content = "";
    }

    const linesToAdd: string[] = [];
    for (const pattern of EXCLUDE_PATTERNS) {
      if (!content.includes(pattern)) {
        linesToAdd.push(pattern);
      }
    }

    if (linesToAdd.length === 0) {
      return;
    }

    const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
    const newContent = `${content + suffix + linesToAdd.join("\n")}\n`;
    await writeFile(excludePath, newContent);
  }
}
