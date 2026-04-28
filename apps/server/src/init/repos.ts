// @teamsland/server — 仓库管理初始化模块

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { RepoManager } from "@teamsland/git";
import { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";

const logger = createLogger("server:repos");

/**
 * 初始化 RepoManager
 *
 * 解析 reposDir（支持 ~ 展开），确保目录存在，返回 RepoManager 实例。
 *
 * @param config - 应用配置
 * @returns RepoManager 实例
 *
 * @example
 * ```typescript
 * import { initRepoManager } from "./init/repos.js";
 *
 * const repoManager = initRepoManager(config);
 * const resolved = repoManager.resolve("project_xxx");
 * ```
 */
export function initRepoManager(config: AppConfig): RepoManager {
  const rawDir = config.coordinator?.reposDir ?? "~/teamsland-repos";
  const reposDir = rawDir.startsWith("~") ? rawDir.replace("~", homedir()) : rawDir;

  mkdirSync(reposDir, { recursive: true });
  logger.info({ reposDir }, "托管仓库目录已就绪");

  return new RepoManager({ reposDir, repoMapping: config.repoMapping });
}
