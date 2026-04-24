import type { TopologyEdge, TopologyGraph, TopologyNode } from "@teamsland/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdgePath } from "./EdgePath.js";
import { TopologyNodeCard } from "./TopologyNode.js";

/**
 * TopologyView 组件的 Props
 *
 * @example
 * ```tsx
 * import type { TopologyViewProps } from "./TopologyView.js";
 * import type { TopologyGraph } from "@teamsland/types";
 *
 * const graph: TopologyGraph = { nodes: [], edges: [] };
 * const props: TopologyViewProps = {
 *   graph,
 *   onNodeClick: (nodeId, sessionId) => console.log(nodeId, sessionId),
 * };
 * ```
 */
interface TopologyViewProps {
  /** 拓扑图数据 */
  graph: TopologyGraph;
  /** 节点点击回调，传递 nodeId 和 sessionId */
  onNodeClick: (nodeId: string, sessionId: string) => void;
}

/** 节点层级顺序：coordinator → task_worker → observer_worker */
const LAYER_ORDER: TopologyNode["type"][] = ["coordinator", "task_worker", "observer_worker"];

/** 层级中文标签 */
const LAYER_LABELS: Record<TopologyNode["type"], string> = {
  coordinator: "协调器",
  task_worker: "任务 Worker",
  observer_worker: "观察者",
};

/**
 * 边坐标信息，用于 SVG 渲染
 */
interface EdgePosition {
  from: { x: number; y: number };
  to: { x: number; y: number };
  type: TopologyEdge["type"];
}

/**
 * 拓扑图主视图组件
 *
 * 将节点按类型分为三层（协调器、任务 Worker、观察者）水平排列，
 * 并用 SVG 贝塞尔曲线绘制节点间的连线关系。
 * 使用 ResizeObserver + useEffect 在渲染后计算 DOM 节点位置来确定连线坐标。
 *
 * @param props - 拓扑视图属性
 *
 * @example
 * ```tsx
 * import { TopologyView } from "./TopologyView.js";
 * import type { TopologyGraph } from "@teamsland/types";
 *
 * const graph: TopologyGraph = {
 *   nodes: [
 *     { id: "c1", type: "coordinator", sessionId: "s1", status: "running", label: "主协调器", metadata: {} },
 *     { id: "w1", type: "task_worker", sessionId: "s2", status: "running", label: "Worker 1", metadata: {} },
 *   ],
 *   edges: [{ from: "c1", to: "w1", type: "spawned" }],
 * };
 *
 * function Dashboard() {
 *   return (
 *     <TopologyView
 *       graph={graph}
 *       onNodeClick={(nodeId, sessionId) => console.log("选中:", nodeId, sessionId)}
 *     />
 *   );
 * }
 * ```
 */
export function TopologyView({ graph, onNodeClick }: TopologyViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const [edgePositions, setEdgePositions] = useState<EdgePosition[]>([]);

  /** 按类型分组节点 */
  const groupedNodes = useMemo(() => {
    const groups = new Map<TopologyNode["type"], TopologyNode[]>();
    for (const layerType of LAYER_ORDER) {
      groups.set(layerType, []);
    }
    for (const node of graph.nodes) {
      const group = groups.get(node.type);
      if (group) {
        group.push(node);
      }
    }
    return groups;
  }, [graph.nodes]);

  /** 注册节点 DOM 引用 */
  const setNodeRef = useCallback((nodeId: string, el: HTMLDivElement | null) => {
    if (el) {
      nodeRefsMap.current.set(nodeId, el);
    } else {
      nodeRefsMap.current.delete(nodeId);
    }
  }, []);

  /** 计算所有边的坐标位置 */
  const calculateEdgePositions = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const positions: EdgePosition[] = [];

    for (const edge of graph.edges) {
      const fromEl = nodeRefsMap.current.get(edge.from);
      const toEl = nodeRefsMap.current.get(edge.to);
      if (!fromEl || !toEl) continue;

      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();

      // 计算相对于容器的中心底部（from）和中心顶部（to）
      const fromX = fromRect.left + fromRect.width / 2 - containerRect.left;
      const fromY = fromRect.bottom - containerRect.top;
      const toX = toRect.left + toRect.width / 2 - containerRect.left;
      const toY = toRect.top - containerRect.top;

      positions.push({
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
        type: edge.type,
      });
    }

    setEdgePositions(positions);
  }, [graph.edges]);

  /** 渲染后计算边位置，并监听容器 resize */
  useEffect(() => {
    // 使用 requestAnimationFrame 确保 DOM 已完成布局
    const rafId = requestAnimationFrame(() => {
      calculateEdgePositions();
    });

    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        calculateEdgePositions();
      });
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
  }, [calculateEdgePositions]);

  /** 处理节点点击 */
  const handleNodeClick = useCallback(
    (node: TopologyNode) => {
      onNodeClick(node.id, node.sessionId);
    },
    [onNodeClick],
  );

  const hasNodes = graph.nodes.length > 0;

  return (
    <div ref={containerRef} className="relative w-full min-h-[300px] bg-muted rounded-lg border border-border p-6">
      {/* 无节点状态 */}
      {!hasNodes && (
        <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">暂无拓扑节点</div>
      )}

      {/* 三层布局 */}
      {hasNodes && (
        <div className="flex flex-col gap-12">
          {LAYER_ORDER.map((layerType) => {
            const nodes = groupedNodes.get(layerType);
            if (!nodes || nodes.length === 0) return null;
            return (
              <div key={layerType}>
                {/* 层级标题 */}
                <div className="text-xs text-muted-foreground mb-3 uppercase tracking-wide font-medium">
                  {LAYER_LABELS[layerType]}
                </div>
                {/* 节点行 */}
                <div className="flex flex-wrap items-start justify-center gap-4">
                  {nodes.map((node) => (
                    <div key={node.id} ref={(el) => setNodeRef(node.id, el)}>
                      <TopologyNodeCard node={node} onClick={() => handleNodeClick(node)} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* SVG 边连线叠加层 */}
      {edgePositions.length > 0 && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 0 }}
          role="img"
          aria-label="拓扑节点连线"
        >
          {edgePositions.map((edge) => (
            <EdgePath
              key={`edge-${edge.from.x},${edge.from.y}-${edge.to.x},${edge.to.y}-${edge.type}`}
              from={edge.from}
              to={edge.to}
              type={edge.type}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
