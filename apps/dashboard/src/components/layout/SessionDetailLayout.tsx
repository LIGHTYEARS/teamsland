import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@teamsland/ui/components/ui/resizable";
import { ArrowLeft, PanelRightClose, PanelRightOpen, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import { useSessionStore } from "../../stores/useSessionStore";
import { ChatInterface } from "../chat/ChatInterface";
import { DetailPanel } from "./DetailPanel";

export interface SessionDetailLayoutProps {
  sessionId: string;
  projectName: string | null;
  onNavigate: (path: string) => void;
}

export function SessionDetailLayout({ sessionId, projectName, onNavigate }: SessionDetailLayoutProps) {
  const { status, send, subscribe } = useWebSocket();
  const { messages, loading: messagesLoading, isStreaming } = useSessionStore(sessionId);

  const projectPath = projectName ? projectName.replace(/-/g, "/") : null;

  const [detailOpen, setDetailOpen] = useState(true);

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
  const StatusIcon = status === "connected" ? Wifi : WifiOff;
  const DetailToggleIcon = detailOpen ? PanelRightClose : PanelRightOpen;

  return (
    <div className="flex h-full w-full overflow-hidden">
      <ResizablePanelGroup direction="horizontal" autoSaveId="session-detail-panels">
        <ResizablePanel defaultSize={detailOpen ? 70 : 100} minSize={40} className="min-w-0 overflow-hidden">
          <div className="flex h-full flex-col">
            <header className="flex h-10 items-center justify-between bg-muted/30 px-3">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => onNavigate("/sessions")}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  aria-label="Back to sessions"
                >
                  <ArrowLeft size={14} />
                </button>
                <span className="text-xs font-medium text-foreground truncate">{sessionId.slice(0, 12)}</span>
                <StatusIcon size={10} className={`shrink-0 ${statusColor}`} />
                {messagesLoading && <span className="text-[11px] text-muted-foreground">Loading…</span>}
                {commandError && <span className="text-[11px] text-red-500">{commandError}</span>}
              </div>
              <button
                type="button"
                onClick={() => setDetailOpen((prev) => !prev)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                aria-label={detailOpen ? "Hide detail panel" : "Show detail panel"}
              >
                <DetailToggleIcon size={14} />
              </button>
            </header>

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

        {detailOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20} maxSize={45} className="min-w-0 overflow-hidden">
              <DetailPanel sessionId={sessionId} projectPath={projectPath ?? undefined} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}

function getStatusColor(status: string): string {
  if (status === "connected") return "text-green-500";
  if (status === "connecting") return "text-yellow-500";
  return "text-red-500";
}
