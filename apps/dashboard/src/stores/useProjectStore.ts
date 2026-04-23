import type { DiscoveredProject } from "@teamsland/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/**
 * 项目列表状态管理 Hook
 *
 * 挂载时从 `/api/projects` 拉取项目列表，并通过 WebSocket 订阅
 * `projects_updated` 事件自动刷新。提供手动选择项目和刷新能力。
 *
 * @returns 项目列表、加载状态、选中项目、选择与刷新函数
 *
 * @example
 * ```tsx
 * import { useProjectStore } from "../stores/useProjectStore.js";
 *
 * function ProjectSidebar() {
 *   const { projects, loading, selectedProject, selectProject } = useProjectStore();
 *   if (loading) return <div>加载中...</div>;
 *   return (
 *     <ul>
 *       {projects.map((p) => (
 *         <li key={p.name} onClick={() => selectProject(p)}>
 *           {p.displayName}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useProjectStore(): {
  projects: DiscoveredProject[];
  loading: boolean;
  selectedProject: DiscoveredProject | null;
  selectProject: (project: DiscoveredProject | null) => void;
  refresh: () => void;
} {
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<DiscoveredProject | null>(null);
  const { subscribe } = useWebSocket();
  const fetchVersionRef = useRef(0);

  const fetchProjects = useCallback(() => {
    const version = ++fetchVersionRef.current;
    setLoading(true);

    fetch("/api/projects")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<DiscoveredProject[]>;
      })
      .then((data) => {
        if (version !== fetchVersionRef.current) return;
        setProjects(data);
      })
      .catch(() => {
        if (version !== fetchVersionRef.current) return;
        setProjects([]);
      })
      .finally(() => {
        if (version !== fetchVersionRef.current) return;
        setLoading(false);
      });
  }, []);

  // 初次挂载拉取
  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // 订阅 WebSocket 项目更新事件
  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "projects_updated") {
        fetchProjects();
      }
    });
  }, [subscribe, fetchProjects]);

  const selectProject = useCallback((project: DiscoveredProject | null) => {
    setSelectedProject(project);
  }, []);

  return { projects, loading, selectedProject, selectProject, refresh: fetchProjects };
}
