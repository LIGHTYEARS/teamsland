import type { HookModule } from "./types.js";

/**
 * 校验模块是否为有效的 HookModule
 *
 * 依次检查以下条件：
 * 1. `mod` 是非 null 的对象
 * 2. `mod.match` 是一个函数
 * 3. `mod.handle` 是一个函数
 * 4. 如果 `mod.priority` 存在，则必须是数字类型
 * 5. 如果 `mod.description` 存在，则必须是字符串类型
 *
 * @param mod - 待校验的未知值
 * @returns 如果 mod 满足 HookModule 接口则返回 true，否则返回 false
 *
 * @example
 * ```typescript
 * import { isValidHookModule } from "@teamsland/hooks";
 *
 * const validModule = {
 *   match: (event: unknown) => true,
 *   handle: async () => {},
 *   priority: 10,
 *   description: "示例 hook",
 * };
 *
 * if (isValidHookModule(validModule)) {
 *   // validModule 在此分支中被收窄为 HookModule 类型
 *   validModule.match({ type: "issue.created" } as never);
 * }
 *
 * isValidHookModule(null);       // false
 * isValidHookModule("string");   // false
 * isValidHookModule({ match: 1, handle: 2 }); // false
 * ```
 */
export function isValidHookModule(mod: unknown): mod is HookModule {
  if (mod === null || mod === undefined || typeof mod !== "object") {
    return false;
  }

  const candidate = mod as Record<string, unknown>;

  if (typeof candidate.match !== "function") {
    return false;
  }

  if (typeof candidate.handle !== "function") {
    return false;
  }

  if ("priority" in candidate && typeof candidate.priority !== "number") {
    return false;
  }

  if ("description" in candidate && typeof candidate.description !== "string") {
    return false;
  }

  return true;
}
