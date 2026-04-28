import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RepoMappingEntry } from "@teamsland/types";
import type { CommandRunner } from "./command-runner.js";
import { BunCommandRunner } from "./command-runner.js";

/**
 * 展开路径中的 ~ 为用户 home 目录
 *
 * @example
 * ```typescript
 * expandHome("~/teamsland-repos/foo"); // "/Users/alice/teamsland-repos/foo"
 * expandHome("/absolute/path");        // "/absolute/path"
 * ```
 */
function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace("~", homedir()) : p;
}

/**
 * RepoManager 构造配置
 *
 * @example
 * ```typescript
 * import type { RepoManagerConfig } from "@teamsland/git";
 *
 * const cfg: RepoManagerConfig = {
 *   reposDir: "/Users/me/teamsland-repos",
 *   repoMapping: [{ meegoProjectId: "p1", repos: [{ path: "/repos/fe", name: "前端" }] }],
 * };
 * ```
 */
export interface RepoManagerConfig {
  /** 托管仓库目录绝对路径 */
  reposDir: string;
  /** 来自 config.json 的仓库映射 */
  repoMapping: ReadonlyArray<RepoMappingEntry>;
}

/**
 * 仓库解析结果
 *
 * @example
 * ```typescript
 * import type { ResolvedRepo } from "@teamsland/git";
 *
 * const repo: ResolvedRepo = { path: "/repos/fe", name: "前端", source: "config" };
 * ```
 */
export interface ResolvedRepo {
  /** 本地绝对路径 */
  path: string;
  /** 显示名称 */
  name: string;
  /** 来源：config 映射 or 托管目录扫描 */
  source: "config" | "managed";
}

/**
 * clone 操作状态
 */
export type CloneStatus = "success" | "already_exists" | "failed";

/**
 * clone 操作结果
 *
 * @example
 * ```typescript
 * import type { CloneResult } from "@teamsland/git";
 *
 * const result: CloneResult = { status: "success", path: "/repos/my-app" };
 * ```
 */
export interface CloneResult {
  status: CloneStatus;
  /** clone 后的本地路径 */
  path: string;
  /** 失败时的错误信息 */
  error?: string;
}

/**
 * 仓库管理器
 *
 * 负责仓库解析（config + 托管目录扫描）、自动 clone、并发去重。
 *
 * @example
 * ```typescript
 * import { RepoManager } from "@teamsland/git";
 *
 * const manager = new RepoManager({
 *   reposDir: "/Users/me/teamsland-repos",
 *   repoMapping: config.repoMapping,
 * });
 *
 * const resolved = manager.resolve("project_xxx");
 * if (!resolved) {
 *   const url = manager.findRemoteUrl("project_xxx");
 *   if (url) {
 *     const result = await manager.clone(url, "my-repo");
 *   }
 * }
 * ```
 */
export class RepoManager {
  private readonly config: RepoManagerConfig;
  private readonly runner: CommandRunner;
  /** 进行中的 clone 任务，按 remoteUrl 去重 */
  private readonly inFlight = new Map<string, Promise<CloneResult>>();

  constructor(config: RepoManagerConfig, runner?: CommandRunner) {
    this.config = config;
    this.runner = runner ?? new BunCommandRunner();
  }

  /**
   * 解析 Meego 项目 key 到本地仓库路径
   *
   * 优先查 config.repoMapping（path 实际存在时返回），
   * 其次扫描 reposDir 下的子目录按名称匹配。
   */
  resolve(projectKey: string): ResolvedRepo | undefined {
    // 1. config 映射优先
    const entry = this.config.repoMapping.find((e) => e.meegoProjectId === projectKey);
    if (entry && entry.repos.length > 0) {
      const repo = entry.repos[0];
      const resolvedPath = expandHome(repo.path);
      if (existsSync(resolvedPath)) {
        return { path: resolvedPath, name: repo.name, source: "config" };
      }
    }

    // 2. 扫描托管目录：按 config 中的 name 匹配
    if (entry && entry.repos.length > 0) {
      const repo = entry.repos[0];
      const managedPath = join(this.config.reposDir, repo.name);
      if (existsSync(managedPath)) {
        return { path: managedPath, name: repo.name, source: "managed" };
      }
    }

    return undefined;
  }

  /**
   * 从 config.repoMapping 中查找某项目的 remoteUrl
   */
  findRemoteUrl(projectKey: string): string | undefined {
    const entry = this.config.repoMapping.find((e) => e.meegoProjectId === projectKey);
    if (!entry || entry.repos.length === 0) return undefined;
    return entry.repos[0].remoteUrl;
  }

  /**
   * 从 config.repoMapping 中查找某项目的仓库名称
   */
  findRepoName(projectKey: string): string | undefined {
    const entry = this.config.repoMapping.find((e) => e.meegoProjectId === projectKey);
    if (!entry || entry.repos.length === 0) return undefined;
    return entry.repos[0].name;
  }

  /**
   * clone 仓库到 reposDir/<repoName>/
   *
   * 并发请求同一 remoteUrl 时只执行一次 clone，后续调用共享同一 Promise。
   * 失败时清理残留目录。
   */
  async clone(remoteUrl: string, repoName: string): Promise<CloneResult> {
    const existing = this.inFlight.get(remoteUrl);
    if (existing) return existing;

    const promise = this.doClone(remoteUrl, repoName);
    this.inFlight.set(remoteUrl, promise);

    try {
      return await promise;
    } finally {
      this.inFlight.delete(remoteUrl);
    }
  }

  /**
   * 某 remoteUrl 是否正在 clone 中
   */
  isCloning(remoteUrl: string): boolean {
    return this.inFlight.has(remoteUrl);
  }

  /**
   * git fetch origin（确保仓库最新）
   */
  async fetch(repoPath: string): Promise<void> {
    await this.runner.run(["git", "-C", repoPath, "fetch", "origin"]);
  }

  /**
   * 扫描托管目录下所有仓库
   *
   * @returns Map<目录名, 绝对路径>
   */
  async scanManagedRepos(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!existsSync(this.config.reposDir)) return result;

    const entries = await readdir(this.config.reposDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = join(this.config.reposDir, entry.name);
        // 简单检查是否为 git 仓库
        if (existsSync(join(fullPath, ".git"))) {
          result.set(entry.name, fullPath);
        }
      }
    }
    return result;
  }

  private async doClone(remoteUrl: string, repoName: string): Promise<CloneResult> {
    const targetPath = join(this.config.reposDir, repoName);

    // 已存在 → 直接返回
    if (existsSync(targetPath)) {
      return { status: "already_exists", path: targetPath };
    }

    const cmd = ["git", "clone", remoteUrl, targetPath];
    const result = await this.runner.run(cmd);

    if (result.exitCode !== 0) {
      // 清理残留目录
      await this.runner.run(["rm", "-rf", targetPath]);
      return { status: "failed", path: targetPath, error: result.stderr.trim() || `exit code ${result.exitCode}` };
    }

    return { status: "success", path: targetPath };
  }
}
