import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../command-runner.js";
import type { ReapableAgent } from "../worktree-manager.js";
import { WorktreeError, WorktreeManager } from "../worktree-manager.js";

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

      const promise = manager.create(tempDir, "ISSUE-1");
      await expect(promise).rejects.toThrow(WorktreeError);
      await expect(promise).rejects.toMatchObject({
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
      await writeFile(join(tempDir, ".git", "info", "exclude"), "# existing\n.agent_context\nCLAUDE.md\n.claude\n");

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
