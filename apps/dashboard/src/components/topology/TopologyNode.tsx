import type { TopologyNode as TopologyNodeType } from "@teamsland/types";
import { Brain, Eye, Hammer } from "lucide-react";

/**
 * TopologyNode 组件的 Props
 *
 * @example
 * ```tsx
 * import type { TopologyNodeProps } from "./TopologyNode.js";
 *
 * const props: TopologyNodeProps = {
 *   node: {
 *     id: "node_1",
 *     type: "coordinator",
 *     sessionId: "sess_001",
 *     status: "running",
 *     label: "主协调器",
 *     metadata: {},
 *   },
 *   onClick: () => console.log("clicked"),
 * };
 * ```
 */
interface TopologyNodeProps {
  /** 拓扑节点数据 */
  node: TopologyNodeType;
  /** 点击回调 */
  onClick: () => void;
}

/** 节点状态对应的左边框颜色和脉冲动画 */
const STATUS_BORDER_STYLES: Record<string, string> = {
  running: "border-l-green-500",
  completed: "border-l-gray-500",
  failed: "border-l-red-500",
  idle: "border-l-blue-500",
};

/** 节点状态对应的徽章样式 */
const STATUS_BADGE_STYLES: Record<string, string> = {
  running: "bg-green-900/40 text-green-400",
  completed: "bg-gray-800 text-gray-400",
  failed: "bg-red-900/40 text-red-400",
  idle: "bg-blue-900/40 text-blue-400",
};

/** 节点状态的中文标签 */
const STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  idle: "空闲",
};

/**
 * 根据节点类型返回对应的 lucide-react 图标组件
 *
 * @param type - 节点类型
 * @returns 对应的图标 JSX 元素
 */
function NodeTypeIcon({ type }: { type: TopologyNodeType["type"] }) {
  switch (type) {
    case "coordinator":
      return <Brain className="h-5 w-5 text-purple-400" />;
    case "task_worker":
      return <Hammer className="h-5 w-5 text-orange-400" />;
    case "observer_worker":
      return <Eye className="h-5 w-5 text-cyan-400" />;
  }
}

/** 节点类型的中文标签 */
const TYPE_LABELS: Record<TopologyNodeType["type"], string> = {
  coordinator: "协调器",
  task_worker: "任务 Worker",
  observer_worker: "观察者",
};

/**
 * 拓扑图节点卡片组件
 *
 * 渲染单个拓扑节点，显示类型图标、标签、任务摘要和运行状态。
 * 根据节点状态呈现不同的左边框颜色和脉冲动画效果。
 *
 * @param props - 节点组件属性
 *
 * @example
 * ```tsx
 * import { TopologyNodeCard } from "./TopologyNode.js";
 * import type { TopologyNode } from "@teamsland/types";
 *
 * const node: TopologyNode = {
 *   id: "node_coord",
 *   type: "coordinator",
 *   sessionId: "sess_001",
 *   status: "running",
 *   label: "主协调器",
 *   taskBrief: "管理分布式任务调度",
 *   metadata: { startedAt: "2026-04-23T09:00:00.000Z" },
 * };
 *
 * function Example() {
 *   return (
 *     <TopologyNodeCard
 *       node={node}
 *       onClick={() => console.log("选中:", node.id)}
 *     />
 *   );
 * }
 * ```
 */
export function TopologyNodeCard({ node, onClick }: TopologyNodeProps) {
  const borderColor = STATUS_BORDER_STYLES[node.status] ?? "border-l-gray-500";
  const badgeStyle = STATUS_BADGE_STYLES[node.status] ?? "bg-gray-800 text-gray-400";
  const statusLabel = STATUS_LABELS[node.status] ?? node.status;
  const typeLabel = TYPE_LABELS[node.type];
  const isRunning = node.status === "running";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative flex flex-col gap-1.5 p-3 w-48
        bg-gray-800/80 border-l-4 ${borderColor}
        rounded-lg
        hover:bg-gray-750
        transition-all cursor-pointer text-left
      `}
    >
      {/* 运行中的脉冲指示器 */}
      {isRunning && (
        <span className="absolute top-2 right-2 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>
      )}

      {/* 类型图标和标签 */}
      <div className="flex items-center gap-2">
        <NodeTypeIcon type={node.type} />
        <span className="text-xs text-gray-500">{typeLabel}</span>
      </div>

      {/* 节点标签 */}
      <div className="text-sm font-medium text-gray-200 truncate" title={node.label}>
        {node.label}
      </div>

      {/* 任务摘要 */}
      {node.taskBrief && (
        <div className="text-xs text-gray-400 truncate" title={node.taskBrief}>
          {node.taskBrief}
        </div>
      )}

      {/* 状态徽章 */}
      <div className="mt-0.5">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${badgeStyle}`}>
          {statusLabel}
        </span>
      </div>
    </button>
  );
}
