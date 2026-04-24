import { FileText, GitBranch, Network, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useWebSocket } from "../../contexts/WebSocketContext";
import { useTopologyStore } from "../../stores/useTopologyStore";
import { CodeEditor } from "../code-editor/CodeEditor";
import { FileTree } from "../file-tree/FileTree";
import { GitPanel } from "../git-panel/GitPanel";
import { Shell } from "../shell/Shell";
import { TopologyView } from "../topology/TopologyView";

/** 可用的面板标签页 */
const TABS = [
  { id: "files", label: "文件", icon: FileText },
  { id: "terminal", label: "终端", icon: Terminal },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "topology", label: "拓扑", icon: Network },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * 详情面板属性
 *
 * @example
 * ```tsx
 * <DetailPanel sessionId="sess_001" projectPath="/Users/dev/project" />
 * ```
 */
export interface DetailPanelProps {
  /** 当前会话 ID */
  sessionId: string;
  /** 项目路径（用于文件浏览和 Git 操作） */
  projectPath?: string;
}

/**
 * 详情面板组件
 *
 * 右侧标签页面板，提供文件浏览器、终端、Git 面板和拓扑视图。
 * 使用标签页切换不同功能面板。文件浏览器支持打开文件进入编辑模式。
 *
 * @example
 * ```tsx
 * import { DetailPanel } from "./DetailPanel";
 *
 * function SessionView() {
 *   return (
 *     <DetailPanel
 *       sessionId="sess_001"
 *       projectPath="/Users/dev/project"
 *     />
 *   );
 * }
 * ```
 */
export function DetailPanel({ sessionId: _sessionId, projectPath }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("files");
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const { send, subscribe } = useWebSocket();
  const { graph } = useTopologyStore();

  const cwd = projectPath ?? "/tmp";

  /** 加载文件内容 */
  const loadFileContent = useCallback(async (filePath: string) => {
    try {
      const resp = await fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`);
      if (!resp.ok) return;
      const data = (await resp.json()) as { content?: string };
      setFileContent(typeof data.content === "string" ? data.content : "");
    } catch {
      setFileContent("");
    }
  }, []);

  /** 保存文件内容 */
  const saveFileContent = useCallback(
    async (content: string) => {
      if (!editingFile) return;
      try {
        await fetch("/api/files/write", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: editingFile, content }),
        });
      } catch {
        // 静默失败
      }
    },
    [editingFile],
  );

  /** 打开文件时加载内容 */
  useEffect(() => {
    if (editingFile) {
      loadFileContent(editingFile);
    }
  }, [editingFile, loadFileContent]);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 标签栏 */}
      <div className="flex items-center border-b border-border px-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveTab(id);
              setEditingFile(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon size={12} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 面板内容 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "files" && !editingFile && (
          <FileTree projectPath={cwd} onFileSelect={(path) => setEditingFile(path)} />
        )}

        {activeTab === "files" && editingFile && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="truncate text-xs text-muted-foreground">{editingFile}</span>
              <button
                type="button"
                onClick={() => setEditingFile(null)}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <CodeEditor
                filePath={editingFile}
                content={fileContent}
                onChange={setFileContent}
                onSave={saveFileContent}
              />
            </div>
          </div>
        )}

        {activeTab === "terminal" && <Shell send={send} subscribe={subscribe} cwd={cwd} />}

        {activeTab === "git" && <GitPanel projectPath={cwd} />}

        {activeTab === "topology" && graph && (
          <TopologyView
            graph={graph}
            onNodeClick={() => {
              // 可扩展：导航到对应会话
            }}
          />
        )}

        {activeTab === "topology" && !graph && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">暂无拓扑数据</div>
        )}
      </div>
    </div>
  );
}
