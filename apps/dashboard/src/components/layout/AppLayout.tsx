import { Wifi, WifiOff } from "lucide-react";
import { useCallback, useState } from "react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import { useHashRoute } from "../../hooks/useHashRoute";
import { useProjectStore } from "../../stores/useProjectStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { ChatInterface } from "../chat/ChatInterface";
import { Sidebar } from "../sidebar/Sidebar";
import { DetailPanel } from "./DetailPanel";

/**
 * 主布局组件
 *
 * 三面板布局：左侧侧边栏（项目+会话列表）、中间主面板（聊天/拓扑）、右侧详情面板（文件/终端/Git）。
 * 使用 hash 路由管理会话选择和面板导航。
 *
 * @example
 * ```tsx
 * import { AppLayout } from "./AppLayout";
 *
 * function App() {
 *   return <AppLayout />;
 * }
 * ```
 */
export function AppLayout() {
  const { navigate, params } = useHashRoute();
  const { status, send } = useWebSocket();
  const { projects, loading: projectsLoading } = useProjectStore();

  // 从路由参数获取当前选中的会话
  const selectedSessionId = params.session ?? null;
  const selectedProject = params.project ?? null;

  // 会话消息状态
  const { messages, loading: messagesLoading, isStreaming } = useSessionStore(selectedSessionId);

  // 详情面板是否打开
  const [detailOpen, setDetailOpen] = useState(false);

  /** 选择会话 */
  const handleSelectSession = useCallback(
    (projectName: string, sessionId: string) => {
      navigate(`/project/${projectName}/session/${sessionId}`);
    },
    [navigate],
  );

  /** 侧边栏导航 */
  const handleNavigate = useCallback(
    (navPath: string) => {
      navigate(navPath);
    },
    [navigate],
  );

  /** 发送消息 */
  const handleSendMessage = useCallback(
    (message: string) => {
      if (!selectedSessionId) return;
      send({
        type: "claude-command",
        sessionId: selectedSessionId,
        content: message,
      });
    },
    [selectedSessionId, send],
  );

  /**
   * 权限请求响应处理
   *
   * 通过 WebSocket 向服务端发送用户对权限请求的许可/拒绝决定。
   *
   * @example
   * ```ts
   * handlePermissionResponse("msg_001", "allow");
   * ```
   */
  const handlePermissionResponse = useCallback(
    (messageId: string, action: "allow" | "deny") => {
      if (!selectedSessionId) return;
      send({
        type: "permission-response",
        sessionId: selectedSessionId,
        messageId,
        action,
      });
    },
    [selectedSessionId, send],
  );

  /** 获取连接状态指示器 */
  const statusColor = getStatusColor(status);
  const statusLabel = getStatusLabel(status);
  const StatusIcon = status === "connected" ? Wifi : WifiOff;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-50">
      {/* 左侧边栏 */}
      <Sidebar
        projects={projects}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onNavigate={handleNavigate}
      />

      {/* 中间主面板 */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* 顶部状态栏 */}
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-gray-900">
              {selectedSessionId ? `会话: ${selectedSessionId.slice(0, 12)}...` : "Teamsland Dashboard"}
            </h1>
            {messagesLoading && <span className="text-xs text-gray-400">加载中...</span>}
          </div>
          <div className="flex items-center gap-3">
            {selectedSessionId && (
              <button
                type="button"
                onClick={() => setDetailOpen((prev) => !prev)}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 transition-colors"
              >
                {detailOpen ? "关闭面板" : "展开面板"}
              </button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <StatusIcon size={12} className={statusColor} />
              <span>{statusLabel}</span>
            </div>
          </div>
        </header>

        {/* 主内容区 */}
        <div className="flex flex-1 min-h-0">
          {/* 聊天区域 */}
          <div className={`flex-1 ${detailOpen ? "border-r border-gray-200" : ""}`}>
            {selectedSessionId ? (
              <ChatInterface
                sessionId={selectedSessionId}
                messages={messages}
                isStreaming={isStreaming}
                onSendMessage={handleSendMessage}
                onPermissionResponse={handlePermissionResponse}
                canInteract={true}
              />
            ) : (
              <EmptyState projectsLoading={projectsLoading} />
            )}
          </div>

          {/* 右侧详情面板 */}
          {detailOpen && selectedSessionId && (
            <div className="w-[480px] shrink-0">
              <DetailPanel sessionId={selectedSessionId} projectPath={selectedProject ?? undefined} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 连接状态文字
 *
 * @example
 * ```ts
 * getStatusLabel("connected"); // => "已连接"
 * ```
 */
function getStatusLabel(status: string): string {
  if (status === "connected") return "已连接";
  if (status === "connecting") return "连接中...";
  return "已断开";
}

/**
 * 连接状态颜色
 *
 * @example
 * ```ts
 * getStatusColor("connected"); // => "text-green-500"
 * ```
 */
function getStatusColor(status: string): string {
  if (status === "connected") return "text-green-500";
  if (status === "connecting") return "text-yellow-500";
  return "text-red-500";
}

/**
 * 空状态占位组件
 *
 * 当没有选中会话时显示引导信息。
 *
 * @example
 * ```tsx
 * <EmptyState projectsLoading={false} />
 * ```
 */
function EmptyState({ projectsLoading }: { projectsLoading: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center text-gray-400">
      <div className="text-4xl mb-4">🤖</div>
      <h2 className="text-lg font-medium text-gray-600">欢迎使用 Teamsland</h2>
      <p className="mt-1 text-sm">{projectsLoading ? "正在发现项目..." : "从左侧选择一个会话开始浏览"}</p>
    </div>
  );
}
