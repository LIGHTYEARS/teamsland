/**
 * 环境变量占位符正则，匹配 `${VAR_NAME}` 格式
 * 变量名仅包含大写字母、数字和下划线
 */
const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

/**
 * 递归遍历对象/数组，将字符串中的 `${VAR_NAME}` 替换为对应环境变量值
 *
 * @example
 * ```typescript
 * import { resolveEnvVars } from "@teamsland/config";
 *
 * process.env.DB_HOST = "localhost";
 * const result = resolveEnvVars({ host: "${DB_HOST}", port: 5432 });
 * // result: { host: "localhost", port: 5432 }
 * ```
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(ENV_VAR_PATTERN, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`环境变量未定义: ${varName}`);
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }

  return obj;
}
