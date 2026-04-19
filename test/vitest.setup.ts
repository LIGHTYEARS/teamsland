import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

/**
 * 在 Node.js / Vitest 环境中为 Bun.file() 提供兼容实现
 *
 * Bun.file() 返回一个 BunFile 对象，支持 .exists() 和 .json() 方法。
 * 该 polyfill 使 packages/ 中使用 Bun.file() 的代码可以在 Vitest (Node.js 运行时) 下正常测试。
 *
 * @example
 * ```typescript
 * // 不需要显式引用，setupFiles 中自动注入
 * const file = Bun.file("/path/to/file.json");
 * const exists = await file.exists(); // true / false
 * const data = await file.json();     // parsed JSON
 * ```
 */
if (typeof globalThis.Bun === "undefined") {
  // biome-ignore lint/suspicious/noExplicitAny: polyfill 需要匹配 Bun 的动态 API 形状
  (globalThis as any).Bun = {
    file(path: string) {
      return {
        async exists(): Promise<boolean> {
          try {
            await access(path, constants.F_OK);
            return true;
          } catch {
            return false;
          }
        },
        async json(): Promise<unknown> {
          const content = await readFile(path, "utf-8");
          return JSON.parse(content) as unknown;
        },
      };
    },
  };
}
