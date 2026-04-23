import type { TopologyGraph } from "@teamsland/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";

/**
 * 拓扑图状态管理 Hook
 *
 * 挂载时从 `/api/topology` 拉取 coordinator/worker 拓扑数据，
 * 并通过 WebSocket 订阅 `agents_update` 事件自动触发重新拉取。
 *
 * @returns 拓扑图数据、加载状态及手动刷新函数
 *
 * @example
 * ```tsx
 * import { useTopologyStore } from "../stores/useTopologyStore.js";
 *
 * function TopologyView() {
 *   const { graph, loading, refresh } = useTopologyStore();
 *   if (loading) return <div>加载中...</div>;
 *   if (!graph) return <div>暂无拓扑数据</div>;
 *   return (
 *     <div>
 *       <span>节点数: {graph.nodes.length}</span>
 *       <span>边数: {graph.edges.length}</span>
 *       <button onClick={refresh}>刷新</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTopologyStore(): {
  graph: TopologyGraph | null;
  loading: boolean;
  refresh: () => void;
} {
  const [graph, setGraph] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const { subscribe } = useWebSocket();
  const fetchVersionRef = useRef(0);

  const fetchTopology = useCallback(() => {
    const version = ++fetchVersionRef.current;
    setLoading(true);

    fetch("/api/topology")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json() as Promise<TopologyGraph>;
      })
      .then((data) => {
        if (version !== fetchVersionRef.current) return;
        setGraph(data);
      })
      .catch(() => {
        if (version !== fetchVersionRef.current) return;
        setGraph(null);
      })
      .finally(() => {
        if (version !== fetchVersionRef.current) return;
        setLoading(false);
      });
  }, []);

  // 初次挂载拉取
  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  // 订阅 WebSocket agents_update 事件触发重新拉取
  useEffect(() => {
    return subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "agents_update") {
        fetchTopology();
      }
    });
  }, [subscribe, fetchTopology]);

  return { graph, loading, refresh: fetchTopology };
}
