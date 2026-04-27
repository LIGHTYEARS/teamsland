import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "@teamsland/observability";

/**
 * Skill 清单条目
 *
 * 描述一个可注入的 Skill：名称 + 源文件目录路径。
 *
 * @example
 * ```typescript
 * import type { SkillManifest } from "@teamsland/sidecar";
 *
 * const manifest: SkillManifest = {
 *   name: "lark-reply",
 *   sourcePath: "config/worker-skills/lark-reply",
 * };
 * ```
 */
export interface SkillManifest {
  /** Skill 唯一名称 */
  name: string;
  /** Skill 源文件目录的绝对路径 */
  sourcePath: string;
}

/**
 * Skill 路由配置
 *
 * 任务类型 -> 需要注入的 Skill 名称列表。
 *
 * @example
 * ```typescript
 * import type { SkillRouting } from "@teamsland/sidecar";
 *
 * const routing: SkillRouting = {
 *   frontend_dev: ["lark-reply", "meego-update"],
 *   code_review: ["lark-reply"],
 * };
 * ```
 */
export type SkillRouting = Record<string, string[]>;

/**
 * SkillInjector 构造参数
 *
 * @example
 * ```typescript
 * import type { SkillInjectorOpts } from "@teamsland/sidecar";
 *
 * const opts: SkillInjectorOpts = {
 *   skills: [{ name: "lark-reply", sourcePath: "/config/worker-skills/lark-reply" }],
 *   routing: { frontend_dev: ["lark-reply"] },
 *   logger: createLogger("skill-injector"),
 * };
 * ```
 */
export interface SkillInjectorOpts {
  /** 可用 Skill 清单列表 */
  skills: SkillManifest[];
  /** 任务类型到 Skill 名称的路由映射 */
  routing: SkillRouting;
  /** 日志实例 */
  logger: Logger;
  /** 核心 Skill 名称列表，无论路由如何都会被注入 */
  coreSkills?: string[];
}

/**
 * Skill 注入请求
 *
 * @example
 * ```typescript
 * import type { InjectRequest } from "@teamsland/sidecar";
 *
 * const req: InjectRequest = {
 *   worktreePath: "/tmp/worktree-abc",
 *   taskType: "frontend_dev",
 *   extraSkills: ["teamsland-report"],
 * };
 * ```
 */
export interface InjectRequest {
  /** Worker worktree 目录路径 */
  worktreePath: string;
  /** 任务类型，用于查找路由配置 */
  taskType: string;
  /** 额外需要注入的 Skill 名称（可选） */
  extraSkills?: string[];
}

/**
 * Skill 注入结果
 *
 * @example
 * ```typescript
 * import type { InjectResult } from "@teamsland/sidecar";
 *
 * const result: InjectResult = {
 *   injected: ["lark-reply", "meego-update"],
 *   skipped: ["unknown-skill"],
 * };
 * ```
 */
export interface InjectResult {
  /** 成功注入的 Skill 名称列表 */
  injected: string[];
  /** 跳过的 Skill 名称列表（清单中不存在） */
  skipped: string[];
}

/** 标记文件名，用于标识由 teamsland 注入的 Skill 目录 */
const MARKER_FILE = ".injected-by-teamsland";

/**
 * Skill 注入器
 *
 * 根据任务类型和路由配置，将 Skill 文件复制到 Worker worktree 的
 * `.claude/skills/<skill-name>/` 目录下。每个注入的目录包含一个标记文件
 * `.injected-by-teamsland`，清理时仅移除带有该标记的目录。
 *
 * @example
 * ```typescript
 * import { SkillInjector } from "@teamsland/sidecar";
 * import { createLogger } from "@teamsland/observability";
 *
 * const injector = new SkillInjector({
 *   skills: [
 *     { name: "lark-reply", sourcePath: "/config/worker-skills/lark-reply" },
 *     { name: "meego-update", sourcePath: "/config/worker-skills/meego-update" },
 *   ],
 *   routing: { frontend_dev: ["lark-reply", "meego-update"] },
 *   logger: createLogger("skill-injector"),
 * });
 *
 * const result = await injector.inject({
 *   worktreePath: "/tmp/worktree-abc",
 *   taskType: "frontend_dev",
 * });
 * // result.injected => ["lark-reply", "meego-update"]
 * ```
 */
export class SkillInjector {
  private readonly skillMap: Map<string, SkillManifest>;
  private readonly routing: SkillRouting;
  private readonly logger: Logger;
  private readonly coreSkills: string[];

  constructor(opts: SkillInjectorOpts) {
    this.routing = opts.routing;
    this.logger = opts.logger;
    this.coreSkills = opts.coreSkills ?? [];
    this.skillMap = new Map<string, SkillManifest>();
    for (const skill of opts.skills) {
      this.skillMap.set(skill.name, skill);
    }
  }

  /**
   * 将 Skill 文件注入到 Worker worktree
   *
   * 1. 根据 `routing[taskType]` 和 `extraSkills` 合并去重获取需要注入的 Skill 名称
   * 2. 遍历每个 Skill：从 `sourcePath` 复制文件到 `<worktreePath>/.claude/skills/<name>/`
   * 3. 在每个注入目录写入 `.injected-by-teamsland` 标记文件
   * 4. 不在清单中的 Skill 名称记入 `skipped` 列表
   *
   * @param req - 注入请求参数
   * @returns 注入结果，包含已注入和跳过的 Skill 列表
   *
   * @example
   * ```typescript
   * const result = await injector.inject({
   *   worktreePath: "/tmp/wt",
   *   taskType: "frontend_dev",
   *   extraSkills: ["teamsland-report"],
   * });
   * console.log(result.injected); // ["lark-reply", "teamsland-report"]
   * ```
   */
  async inject(req: InjectRequest): Promise<InjectResult> {
    const routedSkills = this.routing[req.taskType] ?? [];
    const extraSkills = req.extraSkills ?? [];
    const uniqueNames = [...new Set([...routedSkills, ...extraSkills])];

    const injected: string[] = [];
    const skipped: string[] = [];
    const skillsDir = join(req.worktreePath, ".claude", "skills");

    await this.ensureDir(skillsDir);

    for (const name of uniqueNames) {
      const manifest = this.skillMap.get(name);
      if (!manifest) {
        this.logger.warn({ skill: name }, "Skill 不在清单中，跳过注入");
        skipped.push(name);
        continue;
      }

      const targetDir = join(skillsDir, name);
      await this.copySkillDir(manifest.sourcePath, targetDir);
      await this.writeMarker(targetDir);
      injected.push(name);
      this.logger.info({ skill: name, target: targetDir }, "Skill 注入完成");
    }

    // Core skill fallback: ensure core skills are always injected
    for (const name of this.coreSkills) {
      if (injected.includes(name)) continue;
      const manifest = this.skillMap.get(name);
      if (!manifest) {
        this.logger.warn({ skill: name }, "Core skill 不在清单中");
        continue;
      }
      const targetDir = join(skillsDir, name);
      await this.copySkillDir(manifest.sourcePath, targetDir);
      await this.writeMarker(targetDir);
      injected.push(name);
      this.logger.info({ skill: name, target: targetDir }, "Core skill 兜底注入");
    }

    this.logger.info({ taskType: req.taskType, injected, skipped }, "Skill 注入批次完成");

    return { injected, skipped };
  }

  /**
   * 清理 worktree 中由 teamsland 注入的 Skill 目录
   *
   * 仅移除包含 `.injected-by-teamsland` 标记文件的目录，
   * 保留用户手动放置的 Skill 目录不受影响。
   *
   * @param worktreePath - Worker worktree 目录路径
   *
   * @example
   * ```typescript
   * await injector.cleanup("/tmp/worktree-abc");
   * ```
   */
  async cleanup(worktreePath: string): Promise<void> {
    const skillsDir = join(worktreePath, ".claude", "skills");

    const dirExists = await this.pathExists(skillsDir);
    if (!dirExists) {
      this.logger.debug({ skillsDir }, "Skills 目录不存在，跳过清理");
      return;
    }

    const entries = await readdir(skillsDir);

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const markerPath = join(entryPath, MARKER_FILE);
      const markerExists = await this.pathExists(markerPath);

      if (markerExists) {
        await this.removeDir(entryPath);
        this.logger.info({ skill: entry }, "已清理注入的 Skill 目录");
      } else {
        this.logger.debug({ skill: entry }, "非 teamsland 注入目录，保留");
      }
    }
  }

  /**
   * 复制 Skill 源目录的所有文件到目标目录
   */
  private async copySkillDir(sourcePath: string, targetDir: string): Promise<void> {
    await mkdir(targetDir, { recursive: true });

    const files = await readdir(sourcePath, { recursive: true, withFileTypes: true });
    for (const entry of files) {
      if (!entry.isFile()) continue;

      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path;
      const srcFile = join(parentPath, entry.name);
      const relPath = srcFile.slice(sourcePath.length + 1);
      const destFile = join(targetDir, relPath);

      await mkdir(dirname(destFile), { recursive: true });
      await copyFile(srcFile, destFile);
    }
  }

  /**
   * 写入注入标记文件
   */
  private async writeMarker(targetDir: string): Promise<void> {
    const markerPath = join(targetDir, MARKER_FILE);
    const timestamp = new Date().toISOString();
    await writeFile(markerPath, timestamp, "utf-8");
  }

  /**
   * 确保目录存在，不存在则递归创建
   */
  private async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  /**
   * 检查路径是否存在（文件或目录）
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 递归删除目录
   */
  private async removeDir(dirPath: string): Promise<void> {
    await rm(dirPath, { recursive: true, force: true });
  }
}
