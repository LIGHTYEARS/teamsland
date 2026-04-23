import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * 可折叠区域组件属性
 *
 * @example
 * ```tsx
 * <CollapsibleSection title="详情" defaultOpen={false}>
 *   <p>折叠内容</p>
 * </CollapsibleSection>
 * ```
 */
export interface CollapsibleSectionProps {
  /** 区域标题 */
  title: string;
  /** 是否默认展开 */
  defaultOpen?: boolean;
  /** 子内容 */
  children: ReactNode;
  /** 标题前的图标 */
  icon?: ReactNode;
  /** 标题旁的徽章文字 */
  badge?: string;
}

/**
 * 可折叠区域包装组件
 *
 * 提供可展开/折叠的内容区域，带有动画切换图标和可选的徽章标签。
 * 用于工具输出、思考过程等需要按需查看的内容。
 *
 * @example
 * ```tsx
 * import { CollapsibleSection } from "./CollapsibleSection";
 * import { Terminal } from "lucide-react";
 *
 * <CollapsibleSection
 *   title="Bash 输出"
 *   icon={<Terminal size={14} />}
 *   badge="完成"
 *   defaultOpen={false}
 * >
 *   <pre>Hello World</pre>
 * </CollapsibleSection>
 * ```
 */
export function CollapsibleSection({ title, defaultOpen = false, children, icon, badge }: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={14} className="shrink-0 text-gray-500" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-gray-500" />
        )}
        {icon && <span className="shrink-0">{icon}</span>}
        <span className="truncate">{title}</span>
        {badge && (
          <span className="ml-auto shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">{badge}</span>
        )}
      </button>
      {isOpen && <div className="px-3 py-2 text-sm">{children}</div>}
    </div>
  );
}
