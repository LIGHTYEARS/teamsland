import type { DiscoveredProject } from "@teamsland/types";
import { BookOpen, LayoutDashboard, Settings } from "lucide-react";
import { useCallback, useState } from "react";
import { ProjectList } from "./ProjectList";
import { SessionFilters } from "./SessionFilters";

/**
 * 侧边栏组件属性
 *
 * @example
 * ```tsx
 * <Sidebar
 *   projects={projects}
 *   selectedSessionId="sess_001"
 *   onSelectSession={(proj, sess) => console.log(proj, sess)}
 *   onNavigate={(path) => console.log("导航:", path)}
 * />
 * ```
 */
export interface SidebarProps {
  /** 已发现的项目列表 */
  projects: DiscoveredProject[];
  /** 当前选中的会话 ID */
  selectedSessionId: string | null;
  /** 选择会话回调 */
  onSelectSession: (projectName: string, sessionId: string) => void;
  /** 导航回调 */
  onNavigate: (path: string) => void;
}

/** 底部导航链接配置 */
const NAV_LINKS = [
  { path: "/", label: "仪表盘", icon: LayoutDashboard },
  { path: "/docs", label: "文档", icon: BookOpen },
  { path: "/settings", label: "设置", icon: Settings },
] as const;

/**
 * 主侧边栏组件
 *
 * 页面左侧固定的导航面板，上方展示项目列表（可展开查看会话），
 * 下方提供全局导航链接。整体为 flex 纵向布局，
 * 项目列表区域可滚动，导航链接固定在底部。
 *
 * @example
 * ```tsx
 * import { Sidebar } from "./Sidebar";
 * import type { DiscoveredProject } from "@teamsland/types";
 *
 * const projects: DiscoveredProject[] = [];
 *
 * function Layout() {
 *   return (
 *     <div className="flex h-screen">
 *       <Sidebar
 *         projects={projects}
 *         selectedSessionId={null}
 *         onSelectSession={(proj, sess) => console.log(proj, sess)}
 *         onNavigate={(path) => console.log(path)}
 *       />
 *       <main className="flex-1">主内容</main>
 *     </div>
 *   );
 * }
 * ```
 */
export function Sidebar({ projects, selectedSessionId, onSelectSession, onNavigate }: SidebarProps) {
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
    <aside className="flex h-full w-64 flex-col overflow-hidden border-r border-border bg-background">
      {/* 标题 */}
      <div className="shrink-0 border-b border-gray-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Teamsland</h2>
        <p className="text-xs text-gray-400">会话浏览器</p>
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

      {/* 底部导航 */}
      <nav className="shrink-0 border-t border-border px-2 py-2 space-y-0.5">
        {NAV_LINKS.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            type="button"
            onClick={() => onNavigate(path)}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Icon size={16} className="shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
