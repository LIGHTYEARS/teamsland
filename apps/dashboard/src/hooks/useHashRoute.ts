import { useCallback, useEffect, useState } from "react";

/**
 * 从 hash 字符串中解析路径
 *
 * 去除前导 `#` 和可选的 `/`，返回标准化路径。
 * 空 hash 返回 `"/"`。
 *
 * @param hash - window.location.hash 值
 * @returns 标准化后的路径字符串
 *
 * @example
 * ```ts
 * parseHashPath("#/session/abc"); // => "/session/abc"
 * parseHashPath("#/");            // => "/"
 * parseHashPath("");              // => "/"
 * ```
 */
function parseHashPath(hash: string): string {
  const raw = hash.replace(/^#/, "");
  if (!raw || raw === "/") return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

/**
 * 从路径中提取命名参数
 *
 * 将路径按 `/` 分割后，每两段作为一对 key-value 解析。
 * 例如 `/session/abc/page/2` 解析为 `{ session: "abc", page: "2" }`。
 *
 * 返回 `Partial<Record>` 以表达任意 key 在运行时可能不存在。
 *
 * @param path - 标准化路径
 * @returns 解析出的参数键值对，未匹配的 key 为 `undefined`
 *
 * @example
 * ```ts
 * extractParams("/session/abc");       // => { session: "abc" }
 * extractParams("/project/foo/tab/2"); // => { project: "foo", tab: "2" }
 * extractParams("/");                  // => {}
 * ```
 */
function extractParams(path: string): Partial<Record<string, string>> {
  const segments = path.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length - 1; i += 2) {
    const key = segments[i];
    const value = segments[i + 1];
    if (key && value) {
      params[key] = value;
    }
  }
  return params;
}

/**
 * 简单 Hash 路由 Hook
 *
 * 监听 `hashchange` 事件，解析 URL hash 为路径和参数。
 * 提供 `navigate` 方法用于编程式导航。
 *
 * @returns 当前路径、导航函数和解析出的参数
 *
 * @example
 * ```tsx
 * import { useHashRoute } from "../hooks/useHashRoute.js";
 *
 * function Router() {
 *   const { path, navigate, params } = useHashRoute();
 *
 *   if (path.startsWith("/session/")) {
 *     return <SessionView sessionId={params.session} />;
 *   }
 *
 *   return (
 *     <div>
 *       <button onClick={() => navigate("/session/abc123")}>
 *         查看会话
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useHashRoute(): {
  path: string;
  navigate: (path: string) => void;
  params: Partial<Record<string, string>>;
} {
  const [path, setPath] = useState<string>(() => parseHashPath(window.location.hash));

  useEffect(() => {
    function handleHashChange() {
      setPath(parseHashPath(window.location.hash));
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const navigate = useCallback((target: string) => {
    const normalized = target.startsWith("/") ? target : `/${target}`;
    window.location.hash = `#${normalized}`;
  }, []);

  const params = extractParams(path);

  return { path, navigate, params };
}
