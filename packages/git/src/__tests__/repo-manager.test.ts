import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandResult, CommandRunner } from "../command-runner.js";
import { RepoManager } from "../repo-manager.js";

class MockCommandRunner implements CommandRunner {
  calls: Array<{ cmd: string[]; opts?: { cwd?: string } }> = [];
  results: CommandResult[] = [];
  private callIndex = 0;

  addResult(result: CommandResult): void {
    this.results.push(result);
  }

  async run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    this.calls.push({ cmd, opts });
    const result = this.results[this.callIndex];
    this.callIndex++;
    return result ?? { exitCode: 0, stdout: "", stderr: "" };
  }
}

describe("RepoManager", () => {
  let runner: MockCommandRunner;
  let reposDir: string;

  beforeEach(() => {
    runner = new MockCommandRunner();
    reposDir = join(tmpdir(), `teamsland-repos-test-${Date.now()}`);
    mkdirSync(reposDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(reposDir, { recursive: true, force: true });
  });

  describe("resolve()", () => {
    it("从 config 映射中解析到已存在的仓库", () => {
      // reposDir 本身就是一个存在的目录，用它当作 repo path
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [{ path: reposDir, name: "my-repo" }] }],
        },
        runner,
      );

      const result = manager.resolve("proj_1");

      expect(result).toEqual({ path: reposDir, name: "my-repo", source: "config" });
    });

    it("config 中 path 不存在时回退到托管目录扫描", () => {
      // 在 reposDir 下创建 my-repo 目录
      const managedRepo = join(reposDir, "my-repo");
      mkdirSync(managedRepo, { recursive: true });

      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [{ path: "/nonexistent/path", name: "my-repo" }] }],
        },
        runner,
      );

      const result = manager.resolve("proj_1");

      expect(result).toEqual({ path: managedRepo, name: "my-repo", source: "managed" });
    });

    it("找不到任何匹配时返回 undefined", () => {
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [{ path: "/nonexistent", name: "x" }] }],
        },
        runner,
      );

      expect(manager.resolve("proj_unknown")).toBeUndefined();
    });

    it("项目映射存在但 repos 为空时返回 undefined", () => {
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [] }],
        },
        runner,
      );

      expect(manager.resolve("proj_1")).toBeUndefined();
    });
  });

  describe("findRemoteUrl()", () => {
    it("返回配置中的 remoteUrl", () => {
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [
            {
              meegoProjectId: "proj_1",
              repos: [{ path: "/repo", name: "fe", remoteUrl: "git@github.com:org/fe.git" }],
            },
          ],
        },
        runner,
      );

      expect(manager.findRemoteUrl("proj_1")).toBe("git@github.com:org/fe.git");
    });

    it("无 remoteUrl 时返回 undefined", () => {
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [{ path: "/repo", name: "fe" }] }],
        },
        runner,
      );

      expect(manager.findRemoteUrl("proj_1")).toBeUndefined();
    });

    it("未知项目返回 undefined", () => {
      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);

      expect(manager.findRemoteUrl("unknown")).toBeUndefined();
    });
  });

  describe("findRepoName()", () => {
    it("返回配置中的仓库名称", () => {
      const manager = new RepoManager(
        {
          reposDir,
          repoMapping: [{ meegoProjectId: "proj_1", repos: [{ path: "/repo", name: "前端主仓库" }] }],
        },
        runner,
      );

      expect(manager.findRepoName("proj_1")).toBe("前端主仓库");
    });
  });

  describe("clone()", () => {
    it("成功 clone 仓库", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);
      const result = await manager.clone("git@github.com:org/fe.git", "fe");

      expect(result.status).toBe("success");
      expect(result.path).toBe(join(reposDir, "fe"));
      expect(runner.calls[0].cmd).toEqual(["git", "clone", "git@github.com:org/fe.git", join(reposDir, "fe")]);
    });

    it("目标目录已存在时返回 already_exists", async () => {
      mkdirSync(join(reposDir, "fe"), { recursive: true });

      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);
      const result = await manager.clone("git@github.com:org/fe.git", "fe");

      expect(result.status).toBe("already_exists");
      expect(runner.calls).toHaveLength(0); // 不执行 git 命令
    });

    it("clone 失败时清理残留并返回 error", async () => {
      runner.addResult({ exitCode: 128, stdout: "", stderr: "Permission denied" });
      // rm -rf 清理
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);
      const result = await manager.clone("git@github.com:org/private.git", "private");

      expect(result.status).toBe("failed");
      expect(result.error).toBe("Permission denied");
      expect(runner.calls[1].cmd).toEqual(["rm", "-rf", join(reposDir, "private")]);
    });

    it("并发 clone 同一 URL 只执行一次", async () => {
      // 用延迟模拟 clone 耗时
      let resolveClone: (() => void) | undefined;
      const clonePromise = new Promise<void>((r) => {
        resolveClone = r;
      });

      const slowRunner: CommandRunner = {
        calls: [] as Array<{ cmd: string[] }>,
        async run(cmd: string[]) {
          (this as { calls: Array<{ cmd: string[] }> }).calls.push({ cmd });
          if (cmd[1] === "clone") {
            await clonePromise;
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      } as CommandRunner & { calls: Array<{ cmd: string[] }> };

      const manager = new RepoManager({ reposDir, repoMapping: [] }, slowRunner);

      const p1 = manager.clone("git@github.com:org/fe.git", "fe");
      const p2 = manager.clone("git@github.com:org/fe.git", "fe");

      expect(manager.isCloning("git@github.com:org/fe.git")).toBe(true);

      expect(resolveClone).toBeDefined();
      if (!resolveClone) return;
      resolveClone();
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1.status).toBe("success");
      expect(r2.status).toBe("success");
      // git clone 只执行了一次
      const cloneCalls = (slowRunner as unknown as { calls: Array<{ cmd: string[] }> }).calls.filter(
        (c) => c.cmd[1] === "clone",
      );
      expect(cloneCalls).toHaveLength(1);
    });
  });

  describe("isCloning()", () => {
    it("无进行中 clone 时返回 false", () => {
      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);

      expect(manager.isCloning("git@github.com:org/fe.git")).toBe(false);
    });
  });

  describe("scanManagedRepos()", () => {
    it("扫描包含 .git 目录的子目录", async () => {
      // 创建两个目录，一个有 .git，一个没有
      mkdirSync(join(reposDir, "repo-a", ".git"), { recursive: true });
      mkdirSync(join(reposDir, "repo-b"), { recursive: true });
      mkdirSync(join(reposDir, "repo-c", ".git"), { recursive: true });

      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);
      const repos = await manager.scanManagedRepos();

      expect(repos.size).toBe(2);
      expect(repos.get("repo-a")).toBe(join(reposDir, "repo-a"));
      expect(repos.get("repo-c")).toBe(join(reposDir, "repo-c"));
      expect(repos.has("repo-b")).toBe(false);
    });

    it("托管目录不存在时返回空 Map", async () => {
      const manager = new RepoManager({ reposDir: "/nonexistent/dir", repoMapping: [] }, runner);
      const repos = await manager.scanManagedRepos();

      expect(repos.size).toBe(0);
    });
  });

  describe("fetch()", () => {
    it("执行 git fetch origin", async () => {
      runner.addResult({ exitCode: 0, stdout: "", stderr: "" });

      const manager = new RepoManager({ reposDir, repoMapping: [] }, runner);
      await manager.fetch("/repos/fe");

      expect(runner.calls[0].cmd).toEqual(["git", "-C", "/repos/fe", "fetch", "origin"]);
    });
  });
});
