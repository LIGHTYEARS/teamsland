import type { AppConfig } from "@teamsland/types";
import { resolveEnvVars } from "./env.js";

/**
 * 从 JSON 文件加载全局配置，执行环境变量替换，返回类型安全的 AppConfig
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
  return resolveEnvVars(raw) as AppConfig;
}
