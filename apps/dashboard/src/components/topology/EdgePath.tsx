/**
 * EdgePath 组件的 Props
 *
 * @example
 * ```tsx
 * import type { EdgePathProps } from "./EdgePath.js";
 *
 * const props: EdgePathProps = {
 *   from: { x: 100, y: 50 },
 *   to: { x: 200, y: 150 },
 *   type: "spawned",
 * };
 * ```
 */
interface EdgePathProps {
  /** 起始坐标 */
  from: { x: number; y: number };
  /** 目标坐标 */
  to: { x: number; y: number };
  /** 边类型: spawned=生成关系, observes=观察关系 */
  type: "spawned" | "observes";
}

/** 边类型对应的颜色配置 */
const EDGE_COLORS: Record<EdgePathProps["type"], string> = {
  spawned: "#6b7280",
  observes: "#a855f7",
};

/**
 * 根据起止坐标计算 SVG 三次贝塞尔曲线路径
 *
 * 控制点在起止点之间垂直方向偏移，使连线呈现平滑弧线。
 *
 * @param from - 起始坐标
 * @param to - 目标坐标
 * @returns SVG path d 属性值
 */
function computeBezierPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const deltaY = to.y - from.y;
  const controlOffset = Math.abs(deltaY) * 0.5;

  const cp1x = from.x;
  const cp1y = from.y + controlOffset;
  const cp2x = to.x;
  const cp2y = to.y - controlOffset;

  return `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;
}

/**
 * SVG 贝塞尔曲线边连接组件
 *
 * 在拓扑图中渲染两个节点之间的有向连线。
 * spawned（生成）类型使用灰色实线，observes（观察）类型使用紫色虚线。
 *
 * @param props - 边路径属性
 *
 * @example
 * ```tsx
 * import { EdgePath } from "./EdgePath.js";
 *
 * function TopologyEdges() {
 *   return (
 *     <svg className="absolute inset-0 w-full h-full pointer-events-none">
 *       <EdgePath
 *         from={{ x: 100, y: 50 }}
 *         to={{ x: 200, y: 150 }}
 *         type="spawned"
 *       />
 *       <EdgePath
 *         from={{ x: 300, y: 50 }}
 *         to={{ x: 200, y: 150 }}
 *         type="observes"
 *       />
 *     </svg>
 *   );
 * }
 * ```
 */
export function EdgePath({ from, to, type }: EdgePathProps) {
  const pathD = computeBezierPath(from, to);
  const color = EDGE_COLORS[type];
  const isDashed = type === "observes";

  return (
    <g>
      <defs>
        <marker
          id={`arrowhead-${type}`}
          markerWidth="8"
          markerHeight="6"
          refX="8"
          refY="3"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <polygon points="0 0, 8 3, 0 6" fill={color} opacity={0.7} />
        </marker>
      </defs>
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={isDashed ? "6 4" : undefined}
        opacity={0.7}
        markerEnd={`url(#arrowhead-${type})`}
      />
    </g>
  );
}
