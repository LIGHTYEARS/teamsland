import { useCallback, useEffect, useMemo, useState } from "react";

/** 所有顶级页面 */
export type PageName = "overview" | "sessions" | "hooks" | "memory" | "settings";

/** 路由解析结果 */
export interface RouteState {
  /** 当前页面名称 */
  page: PageName;
  /** 路径段参数（sessions 页面下的 project / sessionId） */
  segments: Partial<Record<string, string>>;
  /** URL query 参数 */
  query: Record<string, string>;
  /** 原始路径 */
  path: string;
}

/** 从 hash 解析路径和 query */
function parseHash(hash: string): { path: string; query: Record<string, string> } {
  const raw = hash.replace(/^#/, "");
  const [pathPart = "", queryPart = ""] = raw.split("?");
  const path = pathPart === "" || pathPart === "/" ? "/" : pathPart.startsWith("/") ? pathPart : `/${pathPart}`;
  const query: Record<string, string> = {};
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      const [k, v] = pair.split("=");
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  return { path, query };
}

/** 路径 → 页面名 + 段参数 */
function resolveRoute(path: string): { page: PageName; segments: Partial<Record<string, string>> } {
  const segs = path.split("/").filter(Boolean);

  if (segs[0] === "sessions") {
    const segments: Partial<Record<string, string>> = {};
    if (segs[1]) segments.project = segs[1];
    if (segs[2]) segments.sessionId = segs[2];
    return { page: "sessions", segments };
  }

  if (segs[0] === "hooks") return { page: "hooks", segments: {} };
  if (segs[0] === "memory") return { page: "memory", segments: {} };
  if (segs[0] === "settings") return { page: "settings", segments: {} };

  // 兼容旧路由格式 #/project/{name}/session/{id}
  if (segs[0] === "project" && segs[2] === "session") {
    return {
      page: "sessions",
      segments: { project: segs[1], sessionId: segs[3] },
    };
  }

  return { page: "overview", segments: {} };
}

/** 构建 hash 路径 */
function buildHash(path: string, query?: Record<string, string>): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  return `#${normalized}${qs ? `?${qs}` : ""}`;
}

/**
 * 页面感知的 hash 路由 hook
 *
 * 解析 URL hash 为页面名、路径段参数和 query 参数。
 * 支持编程式导航和 query 参数更新。
 */
export function useRouter(): RouteState & {
  /** 导航到指定路径 */
  navigate: (path: string, query?: Record<string, string>) => void;
  /** 仅更新 query 参数，保留当前路径 */
  setQuery: (updates: Record<string, string>) => void;
} {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const state = useMemo<RouteState>(() => {
    const { path, query } = parseHash(hash);
    const { page, segments } = resolveRoute(path);
    return { page, segments, query, path };
  }, [hash]);

  const navigate = useCallback((path: string, query?: Record<string, string>) => {
    window.location.hash = buildHash(path, query);
  }, []);

  const setQuery = useCallback((updates: Record<string, string>) => {
    const { path, query } = parseHash(window.location.hash);
    window.location.hash = buildHash(path, { ...query, ...updates });
  }, []);

  return { ...state, navigate, setQuery };
}
