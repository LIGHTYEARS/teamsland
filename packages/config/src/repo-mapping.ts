import type { RepoEntry, RepoMappingConfig } from "@teamsland/types";

/**
 * Meego 项目到 Git 仓库的映射查找器
 *
 * @example
 * ```typescript
 * import { RepoMapping } from "@teamsland/config";
 * import type { RepoMappingConfig } from "@teamsland/types";
 *
 * const cfg: RepoMappingConfig = [
 *   { meegoProjectId: "proj_a", repos: [{ path: "/repos/fe", name: "前端" }] },
 * ];
 * const mapping = RepoMapping.fromConfig(cfg);
 * const repos = mapping.resolve("proj_a");
 * // repos: [{ path: "/repos/fe", name: "前端" }]
 * ```
 */
export class RepoMapping {
  private readonly map: Map<string, RepoEntry[]>;

  private constructor(map: Map<string, RepoEntry[]>) {
    this.map = map;
  }

  /**
   * 从配置数组构造 RepoMapping 实例
   *
   * @param config - 仓库映射配置数组
   * @returns RepoMapping 实例
   *
   * @example
   * ```typescript
   * import { RepoMapping } from "@teamsland/config";
   *
   * const mapping = RepoMapping.fromConfig([
   *   { meegoProjectId: "proj_a", repos: [{ path: "/repos/fe", name: "前端" }] },
   * ]);
   * ```
   */
  static fromConfig(config: RepoMappingConfig): RepoMapping {
    const map = new Map<string, RepoEntry[]>();
    for (const entry of config) {
      map.set(entry.meegoProjectId, entry.repos);
    }
    return new RepoMapping(map);
  }

  /**
   * 根据 Meego 项目 ID 查找关联的仓库列表
   *
   * @param meegoProjectId - Meego 项目 ID
   * @returns 关联的仓库条目数组，未找到时返回空数组
   *
   * @example
   * ```typescript
   * const repos = mapping.resolve("project_xxx");
   * // repos: [{ path: "/repos/fe", name: "前端主仓库" }, ...]
   * ```
   */
  resolve(meegoProjectId: string): RepoEntry[] {
    return this.map.get(meegoProjectId) ?? [];
  }
}
