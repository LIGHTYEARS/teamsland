# @teamsland/git Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/git` package — a `WorktreeManager` class that creates isolated git worktrees for agent sessions and reaps stale ones. All git operations are delegated to an injectable `CommandRunner` interface, making the core logic fully testable without real git repos.

**Architecture:** Three source files: `command-runner.ts` (interface + Bun implementation), `worktree-manager.ts` (WorktreeManager class with `create()` and `reap()` methods), and `index.ts` (barrel exports). File I/O for `.git/info/exclude` uses `node:fs/promises` to remain compatible with both Bun runtime and Vitest/Node.js test runner.

**Tech Stack:** TypeScript (strict), Bun (runtime), Vitest (testing under Node.js), Biome (lint/format), `@teamsland/types` (AgentRecord type)

---

## Context

The `@teamsland/git` package scaffold exists with a placeholder `export {}` in `src/index.ts`. Its `package.json` already declares the dependency on `@teamsland/types` and its `tsconfig.json` references the types package. No additional dependencies are needed — this is a pure git CLI wrapper.

The spec is at `docs/superpowers/specs/2026-04-20-teamsland-git-design.md`.

## Critical Files

- **Create:** `packages/git/src/command-runner.ts` (CommandRunner interface + BunCommandRunner class)
- **Create:** `packages/git/src/worktree-manager.ts` (WorktreeManager class)
- **Modify:** `packages/git/src/index.ts` (barrel exports)
- **Create:** `packages/git/src/__tests__/worktree-manager.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- Vitest for tests (runs under Node.js)
- `import type` for type-only imports
- Use `node:` protocol for Node.js built-ins
- Tests inject a mock `CommandRunner` — no real git needed

---

### Task 1: Create command-runner.ts — CommandRunner Interface + BunCommandRunner

**Files:**
- Create: `packages/git/src/command-runner.ts`

- [ ] **Step 1: Create `packages/git/src/command-runner.ts`**

Create `/Users/bytedance/workspace/teamsland/packages/git/src/command-runner.ts`:

```typescript
/**
 * 命令执行结果
 *
 * 封装子进程退出码、标准输出和标准错误输出。
 *
 * @example
 * ```typescript
 * import type { CommandResult } from "@teamsland/git";
 *
 * const result: CommandResult = { exitCode: 0, stdout: "main\n", stderr: "" };
 * ```
 */
export interface CommandResult {
  /** 进程退出码，0 表示成功 */
  exitCode: number;
  /** 标准输出内容 */
  stdout: string;
  /** 标准错误输出内容 */
  stderr: string;
}

/**
 * 命令执行器接口
 *
 * 抽象子进程调用，允许在测试中注入 mock 实现。
 *
 * @example
 * ```typescript
 * import type { CommandRunner } from "@teamsland/git";
 *
 * const mockRunner: CommandRunner = {
 *   async run(cmd) {
 *     return { exitCode: 0, stdout: "", stderr: "" };
 *   },
 * };
 * ```
 */
export interface CommandRunner {
  /** 执行命令并返回结果 */
  run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult>;
}

/**
 * 基于 Bun.spawn 的命令执行器
 *
 * 生产环境默认实现，通过 `Bun.spawn` 执行 git 子进程。
 *
 * @example
 * ```typescript
 * import { BunCommandRunner } from "@teamsland/git";
 *
 * const runner = new BunCommandRunner();
 * const result = await runner.run(["git", "status"]);
 * console.log(result.stdout);
 * ```
 */
export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    const proc = Bun.spawn(cmd, { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/git/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/git/src/command-runner.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write packages/git/src/command-runner.ts` and re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/git/src/command-runner.ts && git commit -m "feat(git): add CommandRunner interface and BunCommandRunner implementation"
```

---

### Task 2: Create worktree-manager.ts — WorktreeManager Class

**Files:**
- Create: `packages/git/src/worktree-manager.ts`
- Create: `packages/git/src/__tests__/worktree-manager.test.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write worktree-manager.test.ts**

Create `/Users/bytedance/workspace/teamsland/packages/git/src/__tests__/worktree-manager.test.ts`:

```typescript
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../command-runner.js";
import { WorktreeError, WorktreeManager } from "../worktree-manager.js";
import type { ReapableAgent } from "../worktree-manager.js";

/** 记录所有被调用命令的 mock runner */
class MockCommandRunner implements CommandRunner {
  calls: Array<{ cmd: string[]; opts?: { cwd?: string } }> = [];
  results: CommandResult[] = [];
  private callIndex = 0;

  /** 添加一个预期返回值 */
  addResult(result: CommandResult): void {
    this.results.push(result);
  }

  async run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    this.calls.push({ cmd, opts });
    const result = this.results[this.callIndex];
    this.callIndex++;
    if (!result) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    return result;
  }
}

describe("WorktreeManager", () => {
  let runner: MockCommandRunner;
  let manager: WorktreeManager;
  let tempDir: string;

  beforeEach(async () => {
    runner = new MockCommandRunner();
    manager = new WorktreeManager(runner);
    tempDir = join(tmpdir(), `teamsland-git-test-${Date.now()}`);
    await mkdir(join(tempDir, ".git", "info"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("create()", () => {
    it("正常创建 worktree 并返回路径", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      await writeFile(join(tempDir, ".git", "info", "exclude"), "# existing\n");

      const result = await manager.create(tempDir, "ISSUE-42");

      expect(result).toBe(join(tempDir, ".worktrees", "req-ISSUE-42"));
      expect(runner.calls[0].cmd).toEqual([
        "git",
        "-C",
        tempDir,
        "worktree",
        "add",
        "-b",
        "feat/req-ISSUE-42",
        join(tempDir, ".worktrees", "req-ISSUE-42"),
        "HEAD",
      ]);
    });

    it("支持指定 baseBranch", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      await writeFile(join(tempDir, ".git", "info", "exclude"), "");

      await manager.create(tempDir, "ISSUE-99", "develop");

      expect(runner.calls[0].cmd).toContain("develop");
    });

    it("git 命令失败时抛出 WorktreeError", async () => {
      runner.addResult({ exitCode: 128, stdout: "", stderr: "fatal: branch already exists" });
      await writeFile(join(tempDir, ".git", "info", "exclude"), "");

      await expect(manager.create(tempDir, "ISSUE-1")).rejects.toThrow(WorktreeError);
      await expect(manager.create(tempDir, "ISSUE-1")).rejects.toMatchObject({
        exitCode: 128,
        stderr: "fatal: branch already exists",
      });
    });

    it("向 exclude 文件追加 .agent_context、CLAUDE.md、.claude 模式", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      await writeFile(join(tempDir, ".git", "info", "exclude"), "# existing patterns\n*.log\n");

      await manager.create(tempDir, "ISSUE-7");

      const content = await readFile(join(tempDir, ".git", "info", "exclude"), "utf-8");
      expect(content).toContain(".agent_context");
      expect(content).toContain("CLAUDE.md");
      expect(content).toContain(".claude");
      // 原有内容保留
      expect(content).toContain("*.log");
    });

    it("已有排除模式时不重复追加", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      await writeFile(
        join(tempDir, ".git", "info", "exclude"),
        "# existing\n.agent_context\nCLAUDE.md\n.claude\n",
      );

      await manager.create(tempDir, "ISSUE-8");

      const content = await readFile(join(tempDir, ".git", "info", "exclude"), "utf-8");
      const matches = content.match(/\.agent_context/g);
      expect(matches).toHaveLength(1);
    });

    it("exclude 文件不存在时创建新文件", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      // 不写 exclude 文件，让它不存在

      await manager.create(tempDir, "ISSUE-10");

      const content = await readFile(join(tempDir, ".git", "info", "exclude"), "utf-8");
      expect(content).toContain(".agent_context");
      expect(content).toContain("CLAUDE.md");
      expect(content).toContain(".claude");
    });
  });

  describe("reap()", () => {
    const oneWeekAgo = Date.now() - 8 * 86_400_000;

    it("跳过 running 状态的 agent", async () => {
      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-1", status: "running", createdAt: oneWeekAgo, issueId: "1" },
      ];

      const results = await manager.reap(agents);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped-running");
      expect(runner.calls).toHaveLength(0);
    });

    it("跳过尚未过期的 agent", async () => {
      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-2", status: "completed", createdAt: Date.now(), issueId: "2" },
      ];

      const results = await manager.reap(agents);

      expect(results).toHaveLength(0);
    });

    it("干净 worktree 直接移除", async () => {
      // status --porcelain 返回空 = 干净
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      // worktree remove 成功
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-3", status: "completed", createdAt: oneWeekAgo, issueId: "3" },
      ];

      const results = await manager.reap(agents);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("removed");
      expect(runner.calls[0].cmd).toEqual(["git", "-C", "/repo/.worktrees/req-3", "status", "--porcelain"]);
      expect(runner.calls[1].cmd).toEqual(["git", "worktree", "remove", "--force", "/repo/.worktrees/req-3"]);
    });

    it("脏 worktree 先 auto-commit 再移除", async () => {
      // status --porcelain 返回有修改
      runner.addResult({ exitCode: 0, stdout: " M file.ts\n", stderr: "" });
      // git add -A
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      // git commit
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      // worktree remove
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-4", status: "failed", createdAt: oneWeekAgo, issueId: "4" },
      ];

      const results = await manager.reap(agents);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("auto-committed-and-removed");
      expect(runner.calls[1].cmd).toEqual(["git", "-C", "/repo/.worktrees/req-4", "add", "-A"]);
      expect(runner.calls[2].cmd).toEqual([
        "git",
        "-C",
        "/repo/.worktrees/req-4",
        "commit",
        "-m",
        "auto-save before worktree cleanup (req-4)",
      ]);
    });

    it("移除失败时记录 error 而不抛出异常", async () => {
      // status --porcelain 返回空
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      // worktree remove 失败
      runner.addResult({ exitCode: 1, stdout: "", stderr: "error: failed to remove" });

      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-5", status: "completed", createdAt: oneWeekAgo, issueId: "5" },
      ];

      const results = await manager.reap(agents);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("error");
      expect(results[0].error).toBe("error: failed to remove");
    });

    it("自定义 maxAgeDays 参数", async () => {
      const twoDaysAgo = Date.now() - 2 * 86_400_000;
      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-6", status: "completed", createdAt: twoDaysAgo, issueId: "6" },
      ];

      // maxAgeDays = 1，twoDaysAgo 已过期
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const results = await manager.reap(agents, 1);

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("removed");
    });

    it("maxAgeDays 默认 7 天", async () => {
      const sixDaysAgo = Date.now() - 6 * 86_400_000;
      const agents: ReapableAgent[] = [
        { worktreePath: "/repo/.worktrees/req-7", status: "completed", createdAt: sixDaysAgo, issueId: "7" },
      ];

      // 6 天前 < 7 天阈值，不应过期
      const results = await manager.reap(agents);

      expect(results).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/git/src/__tests__/worktree-manager.test.ts`
Expected: FAIL — cannot import `WorktreeManager` or `WorktreeError` from `../worktree-manager.js`

- [ ] **Step 3: Create worktree-manager.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/git/src/worktree-manager.ts`:

```typescript
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
    const newContent = content + suffix + linesToAdd.join("\n") + "\n";
    await writeFile(excludePath, newContent);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/git/src/__tests__/worktree-manager.test.ts`
Expected: All 10 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/git/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/git/src/worktree-manager.ts packages/git/src/__tests__/worktree-manager.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/git/src/worktree-manager.ts packages/git/src/__tests__/worktree-manager.test.ts && git commit -m "$(cat <<'EOF'
feat(git): add WorktreeManager with create() and reap() methods

TDD: 10 tests covering worktree creation, exclude file handling,
reap filtering, auto-commit on dirty trees, error handling, and maxAgeDays
EOF
)"
```

---

### Task 3: Update index.ts — Barrel Exports

**Files:**
- Modify: `packages/git/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/git/src/index.ts` with:

```typescript
// @teamsland/git — Git worktree 管理
// 为 agent 会话创建隔离的 git worktree，并定期回收过期的 worktree

export type { CommandResult, CommandRunner } from "./command-runner.js";
export { BunCommandRunner } from "./command-runner.js";
export type { ReapableAgent, ReapAction, ReapResult } from "./worktree-manager.js";
export { WorktreeError, WorktreeManager } from "./worktree-manager.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/git/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/git/src/index.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/git/src/index.ts && git commit -m "feat(git): add barrel exports — WorktreeManager, CommandRunner, types"
```

---

### Task 4: Full Verification

- [ ] **Step 1: Run all git package tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/git/`
Expected: All 10 tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/git/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on entire package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/git/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import { WorktreeManager, BunCommandRunner, WorktreeError } from './packages/git/src/index.ts'; console.log('WorktreeManager:', typeof WorktreeManager); console.log('BunCommandRunner:', typeof BunCommandRunner); console.log('WorktreeError:', typeof WorktreeError);"`
Expected:
```
WorktreeManager: function
BunCommandRunner: function
WorktreeError: function
```

- [ ] **Step 5: Verify no `any` or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/git/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\!' packages/git/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules' | grep -v '!==' | grep -v '// '`
Expected: No non-null assertion operators (lines with `!.` or trailing `!`)

- [ ] **Step 6: Verify all exported symbols have Chinese JSDoc with @example**

Run: `cd /Users/bytedance/workspace/teamsland && grep -c '@example' packages/git/src/command-runner.ts packages/git/src/worktree-manager.ts`
Expected:
```
packages/git/src/command-runner.ts:3
packages/git/src/worktree-manager.ts:7
```

(3 exported symbols in command-runner: CommandResult, CommandRunner, BunCommandRunner)
(7 exported symbols in worktree-manager: ReapableAgent, ReapAction, ReapResult, WorktreeError, WorktreeManager, create, reap)

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx vitest run packages/git/` — 10 tests pass
2. `bunx tsc --noEmit --project packages/git/tsconfig.json` — exits 0
3. `bunx biome check packages/git/src/` — no errors
4. All exported functions/types/classes have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. `WorktreeManager`, `BunCommandRunner`, `WorktreeError`, `CommandRunner`, `CommandResult`, `ReapableAgent`, `ReapAction`, `ReapResult` exported from package
7. `@teamsland/types` is the only workspace dependency (for `AgentRecord` type)
8. File I/O uses `node:fs/promises` (not `Bun.file()`/`Bun.write()`) for Vitest compatibility
9. Tests use injected `MockCommandRunner` — no real git subprocess calls
