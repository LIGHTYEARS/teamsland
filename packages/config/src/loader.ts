import type { AppConfig } from "@teamsland/types";
import { resolveEnvVars } from "./env.js";
import { AppConfigSchema } from "./schema.js";

/**
 * 从 JSON 文件加载全局配置，执行环境变量替换并进行 Zod 校验，返回类型安全的 AppConfig
 *
 * 校验失败时抛出 `ZodError`，包含所有缺失/非法字段的详细路径信息，
 * 便于快速定位配置错误。
 *
 * @param configPath - 配置文件路径，默认为 `config/config.json`（相对于 cwd）
 * @returns 解析后的 AppConfig 对象
 *
 * @example
 * ```typescript
 * import { loadConfig } from "@teamsland/config";
 *
 * const config = await loadConfig();
 * console.log(config.meego.spaces[0].name);
 * ```
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const path = configPath ?? "config/config.json";
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`配置文件不存在: ${path}`);
  }

  const raw: unknown = await file.json();
  const resolved: unknown = resolveEnvVars(raw);
  return AppConfigSchema.parse(resolved) as AppConfig;
}
