import type { DiscoveredProject } from "@teamsland/types";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { useState } from "react";
import { SessionList } from "./SessionList";

/**
 * 项目列表组件属性
 *
 * @example
 * ```tsx
 * <ProjectList
 *   projects={projects}
 *   selectedSessionId="sess_001"
 *   onSelectSession={(proj, sess) => console.log(proj, sess)}
 * />
 * ```
 */
export interface ProjectListProps {
  /** 已发现的项目数组 */
  projects: DiscoveredProject[];
  /** 当前选中的会话 ID */
  selectedSessionId: string | null;
  /** 选择会话回调 */
  onSelectSession: (projectName: string, sessionId: string) => void;
  /** 当前激活的过滤器集合 */
  activeFilters?: Set<string>;
}

/**
 * 可折叠项目列表组件
 *
 * 以分组形式展示所有已发现的项目，每个项目可展开查看其下的会话列表。
 * 点击项目名称切换展开/折叠状态。自动展开包含当前选中会话的项目。
 *
 * @example
 * ```tsx
 * import { ProjectList } from "./ProjectList";
 * import type { DiscoveredProject } from "@teamsland/types";
 *
 * const projects: DiscoveredProject[] = [
 *   {
 *     name: "teamsland",
 *     path: "/workspace/teamsland",
 *     displayName: "Teamsland",
 *     sessions: [],
 *     sessionMeta: { hasMore: false, total: 0 },
 *   },
 * ];
 *
 * <ProjectList
 *   projects={projects}
 *   selectedSessionId={null}
 *   onSelectSession={(proj, sess) => console.log(proj, sess)}
 * />
 * ```
 */
export function ProjectList({ projects, selectedSessionId, onSelectSession, activeFilters }: ProjectListProps) {
  // 追踪每个项目的展开状态；包含选中会话的项目默认展开
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (selectedSessionId) {
      for (const project of projects) {
        const hasSelected = project.sessions.some((s) => s.id === selectedSessionId);
        if (hasSelected) {
          initial.add(project.name);
        }
      }
    }
    return initial;
  });

  const toggleProject = (projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }
      return next;
    });
  };

  if (projects.length === 0) {
    return <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无发现的项目</div>;
  }

  return (
    <div className="space-y-1">
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.name);
        const filteredCount =
          activeFilters && activeFilters.size > 0
            ? project.sessions.filter((s) => activeFilters.has(s.sessionType ?? "unknown")).length
            : project.sessions.length;

        return (
          <div key={project.name}>
            <button
              type="button"
              onClick={() => toggleProject(project.name)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent transition-colors"
            >
              {isExpanded ? (
                <ChevronDown size={14} className="shrink-0 text-gray-400" />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
              )}
              <Folder size={14} className="shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{project.displayName}</span>
              <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                {filteredCount}
              </span>
            </button>
            {isExpanded && (
              <SessionList
                sessions={project.sessions}
                projectName={project.name}
                selectedSessionId={selectedSessionId}
                onSelectSession={onSelectSession}
                activeFilters={activeFilters}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
