import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@teamsland/ui/components/ui/resizable";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import { useProjectStore } from "../../stores/useProjectStore";
import { useSessionStore } from "../../stores/useSessionStore";
import { ChatInterface } from "../chat/ChatInterface";
import { Sidebar } from "../sidebar/Sidebar";
import { DetailPanel } from "./DetailPanel";

export interface SessionDetailLayoutProps {
  sessionId: string;
  projectName: string | null;
  onNavigate: (path: string) => void;
}

/**
 * Session 详情布局
 *
 * 三面板：左侧 session 树 + 中间聊天 + 右侧详情面板。
 * 从旧 AppLayout 提取而来。
 */
export function SessionDetailLayout({ sessionId, projectName, onNavigate }: SessionDetailLayoutProps) {
  const { status, send, subscribe } = useWebSocket();
  const { projects } = useProjectStore();
  const { messages, loading: messagesLoading, isStreaming } = useSessionStore(sessionId);

  const projectPath = projectName ? projectName.replace(/-/g, "/") : null;

  // 详情面板开关
  const [detailOpen, setDetailOpen] = useState(true);
  const showDetail = detailOpen;

  // 命令错误提示
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe((data) => {
      const msg = data as Record<string, unknown>;
      if (msg.type === "claude-command-error" && msg.sessionId === sessionId) {
        if (errorTimer) clearTimeout(errorTimer);
        setCommandError(typeof msg.message === "string" ? msg.message : "发送消息失败");
        errorTimer = setTimeout(() => {
          setCommandError(null);
          errorTimer = null;
        }, 3000);
      }
    });
    return () => {
      unsubscribe();
      if (errorTimer) clearTimeout(errorTimer);
    };
  }, [subscribe, sessionId]);

  const handleSelectSession = useCallback(
    (projName: string, sessId: string) => {
      onNavigate(`/sessions/${projName}/${sessId}`);
    },
    [onNavigate],
  );

  const handleAbortSession = useCallback(() => {
    send({ type: "abort-session", sessionId });
  }, [sessionId, send]);

  const handleSendMessage = useCallback(
    (message: string) => {
      send({ type: "claude-command", sessionId, content: message });
    },
    [sessionId, send],
  );

  const handlePermissionResponse = useCallback(
    (messageId: string, action: "allow" | "deny") => {
      send({ type: "permission-response", sessionId, messageId, action });
    },
    [sessionId, send],
  );

  const statusColor = getStatusColor(status);
  const statusLabel = getStatusLabel(status);
  const StatusIcon = status === "connected" ? Wifi : WifiOff;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ResizablePanelGroup direction="horizontal">
        {/* 左侧 session 树 */}
        <ResizablePanel defaultSize={15} minSize={10} maxSize={25} className="min-w-0 overflow-hidden">
          <Sidebar
            projects={projects}
            selectedSessionId={sessionId}
            onSelectSession={handleSelectSession}
            onNavigate={onNavigate}
          />
        </ResizablePanel>

        <ResizableHandle />

        {/* 中间聊天面板 */}
        <ResizablePanel defaultSize={60} minSize={30} className="min-w-0 overflow-hidden">
          <div className="flex h-full flex-col">
            {/* 顶部状态栏 */}
            <header className="flex items-center justify-between border-b border-border bg-background px-4 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate("/sessions")}
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  aria-label="Back to sessions"
                >
                  <ArrowLeft size={16} />
                </button>
                <h1 className="text-sm font-semibold text-foreground truncate max-w-[300px]">
                  {sessionId.slice(0, 16)}…
                </h1>
                {messagesLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
                {commandError && <span className="text-xs text-red-500">{commandError}</span>}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDetailOpen((prev) => !prev)}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {detailOpen ? "Hide Panel" : "Show Panel"}
                </button>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StatusIcon size={12} className={statusColor} />
                  <span>{statusLabel}</span>
                </div>
              </div>
            </header>

            {/* 聊天内容 */}
            <div className="flex-1 min-h-0">
              <ChatInterface
                sessionId={sessionId}
                messages={messages}
                isStreaming={isStreaming}
                onSendMessage={handleSendMessage}
                onAbort={handleAbortSession}
                onPermissionResponse={handlePermissionResponse}
                canInteract={true}
              />
            </div>
          </div>
        </ResizablePanel>

        {/* 右侧详情面板 */}
        {showDetail && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={15} maxSize={40} className="min-w-0 overflow-hidden">
              <DetailPanel sessionId={sessionId} projectPath={projectPath ?? undefined} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function getStatusLabel(status: string): string {
  if (status === "connected") return "Connected";
  if (status === "connecting") return "Connecting…";
  return "Disconnected";
}

function getStatusColor(status: string): string {
  if (status === "connected") return "text-green-500";
  if (status === "connecting") return "text-yellow-500";
  return "text-red-500";
}
