import type { DiscoveredProject } from "@teamsland/types";
import { useCallback, useState } from "react";
import { ProjectList } from "./ProjectList";
import { SessionFilters } from "./SessionFilters";

export interface SidebarProps {
  projects: DiscoveredProject[];
  selectedSessionId: string | null;
  onSelectSession: (projectName: string, sessionId: string) => void;
  onNavigate: (path: string) => void;
}

/**
 * Session 侧边栏
 *
 * 在 session 详情视图中使用，显示项目/会话树和类型过滤器。
 * 全局导航已移至 NavSidebar。
 */
export function Sidebar({ projects, selectedSessionId, onSelectSession }: SidebarProps) {
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());

  const handleToggleFilter = useCallback((filter: string) => {
    setActiveFilters((prev) => {
      if (filter === "all") return new Set();
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  }, []);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-background">
      {/* 标题 */}
      <div className="shrink-0 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">会话</h2>
      </div>

      {/* 会话过滤器 */}
      <SessionFilters activeFilters={activeFilters} onToggleFilter={handleToggleFilter} />

      {/* 项目列表（可滚动） */}
      <div className="flex-1 overflow-y-auto px-1 py-2">
        <ProjectList
          projects={projects}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          activeFilters={activeFilters}
        />
      </div>
    </aside>
  );
}
