import { AppLayout } from "./components/layout/AppLayout";

/**
 * 应用根组件
 *
 * 渲染 AppLayout 三面板布局（侧边栏 + 聊天 + 详情面板）。
 * WebSocket 和 Auth 由 index.tsx 中的 Provider 包裹提供。
 *
 * @example
 * ```tsx
 * import { App } from "./App";
 * <App />
 * ```
 */
export function App() {
  return <AppLayout />;
}
