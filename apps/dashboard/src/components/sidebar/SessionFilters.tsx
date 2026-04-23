import { Filter } from "lucide-react";

/** 所有可用的会话类型过滤选项 */
const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "coordinator", label: "Coordinator" },
  { key: "task_worker", label: "Task Worker" },
  { key: "observer_worker", label: "Observer" },
] as const;

/**
 * 会话过滤器组件属性
 *
 * @example
 * ```tsx
 * <SessionFilters
 *   activeFilters={new Set(["coordinator"])}
 *   onToggleFilter={(filter) => console.log("切换:", filter)}
 * />
 * ```
 */
export interface SessionFiltersProps {
  /** 当前激活的过滤器集合 */
  activeFilters: Set<string>;
  /** 切换过滤器回调 */
  onToggleFilter: (filter: string) => void;
}

/**
 * 会话类型过滤器组件
 *
 * 以可切换的标签芯片形式展示过滤选项，支持多选。
 * 选中 "全部" 等效于不过滤。每个芯片点击后触发 onToggleFilter 回调。
 *
 * @example
 * ```tsx
 * import { SessionFilters } from "./SessionFilters";
 * import { useState } from "react";
 *
 * function FilterDemo() {
 *   const [filters, setFilters] = useState<Set<string>>(new Set());
 *
 *   const handleToggle = (filter: string) => {
 *     setFilters((prev) => {
 *       const next = new Set(prev);
 *       if (next.has(filter)) {
 *         next.delete(filter);
 *       } else {
 *         next.add(filter);
 *       }
 *       return next;
 *     });
 *   };
 *
 *   return <SessionFilters activeFilters={filters} onToggleFilter={handleToggle} />;
 * }
 * ```
 */
export function SessionFilters({ activeFilters, onToggleFilter }: SessionFiltersProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      <Filter size={14} className="shrink-0 text-gray-400" />
      {FILTER_OPTIONS.map(({ key, label }) => {
        const isActive = key === "all" ? activeFilters.size === 0 : activeFilters.has(key);

        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggleFilter(key)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
              isActive ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
