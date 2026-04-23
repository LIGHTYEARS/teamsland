import { Check, FileQuestion, GitBranch, GitCommit, Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * Git 文件状态信息
 *
 * @example
 * ```ts
 * const file: GitFileStatus = {
 *   path: "src/index.ts",
 *   status: "M",
 *   staged: false,
 * };
 * ```
 */
interface GitFileStatus {
  /** 文件路径 */
  path: string;
  /** Git 状态码: "M"=modified, "A"=added, "D"=deleted, "??"=untracked */
  status: string;
  /** 是否已暂存 */
  staged: boolean;
}

/**
 * Git 仓库状态
 *
 * @example
 * ```ts
 * const gitStatus: GitStatus = {
 *   branch: "main",
 *   files: [{ path: "src/app.ts", status: "M", staged: true }],
 * };
 * ```
 */
interface GitStatus {
  /** 当前分支名 */
  branch: string;
  /** 变更文件列表 */
  files: GitFileStatus[];
}

/**
 * GitPanel 组件的 Props
 *
 * @example
 * ```tsx
 * <GitPanel projectPath="/workspace/my-project" />
 * ```
 */
interface GitPanelProps {
  /** 项目根目录路径 */
  projectPath: string;
}

/** 状态码对应的显示文本和样式 */
const STATUS_CONFIG: Record<string, { label: string; colorClass: string }> = {
  M: { label: "修改", colorClass: "text-yellow-400" },
  A: { label: "新增", colorClass: "text-green-400" },
  D: { label: "删除", colorClass: "text-red-400" },
  "??": { label: "未跟踪", colorClass: "text-gray-500" },
  R: { label: "重命名", colorClass: "text-blue-400" },
  C: { label: "复制", colorClass: "text-blue-400" },
};

/** 根据状态码获取对应图标 */
function StatusIcon({ status }: { status: string }) {
  const colorClass = STATUS_CONFIG[status]?.colorClass ?? "text-gray-400";
  switch (status) {
    case "M":
      return <span className={`font-mono font-bold text-xs ${colorClass}`}>M</span>;
    case "A":
      return <Plus className={`h-3.5 w-3.5 ${colorClass}`} />;
    case "D":
      return <Minus className={`h-3.5 w-3.5 ${colorClass}`} />;
    case "??":
      return <FileQuestion className={`h-3.5 w-3.5 ${colorClass}`} />;
    default:
      return <span className={`font-mono font-bold text-xs ${colorClass}`}>{status}</span>;
  }
}

/**
 * Git 操作面板组件
 *
 * 展示当前 Git 仓库状态，支持查看变更文件、暂存/取消暂存、
 * 切换分支以及提交更改等操作。
 *
 * @param props - Git 面板属性
 *
 * @example
 * ```tsx
 * import { GitPanel } from "./GitPanel.js";
 *
 * function SidePanel() {
 *   return (
 *     <div className="w-80">
 *       <GitPanel projectPath="/workspace/teamsland" />
 *     </div>
 *   );
 * }
 * ```
 */
export function GitPanel({ projectPath }: GitPanelProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [showBranchSelector, setShowBranchSelector] = useState(false);

  /** 获取 Git 状态 */
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/git/status?path=${encodeURIComponent(projectPath)}`);
      if (!response.ok) {
        throw new Error(`获取 Git 状态失败: ${response.status}`);
      }
      const data: unknown = await response.json();
      setGitStatus(data as GitStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  /** 获取分支列表 */
  const fetchBranches = useCallback(async () => {
    try {
      const response = await fetch(`/api/git/branches?path=${encodeURIComponent(projectPath)}`);
      if (!response.ok) return;
      const data: unknown = await response.json();
      if (Array.isArray(data)) {
        setBranches(data as string[]);
      }
    } catch {
      // 分支列表获取失败不阻塞主流程
    }
  }, [projectPath]);

  useEffect(() => {
    void fetchStatus();
    void fetchBranches();
  }, [fetchStatus, fetchBranches]);

  /** 暂存或取消暂存单个文件 */
  const handleStageToggle = useCallback(
    async (filePath: string, currentlyStaged: boolean) => {
      try {
        const response = await fetch("/api/git/stage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: projectPath,
            filePath,
            action: currentlyStaged ? "unstage" : "stage",
          }),
        });
        if (!response.ok) {
          throw new Error(`暂存操作失败: ${response.status}`);
        }
        await fetchStatus();
      } catch (err) {
        const message = err instanceof Error ? err.message : "暂存操作失败";
        setError(message);
      }
    },
    [projectPath, fetchStatus],
  );

  /** 提交变更 */
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    setError(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: projectPath,
          message: commitMessage.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(`提交失败: ${response.status}`);
      }
      setCommitMessage("");
      await fetchStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : "提交失败";
      setError(message);
    } finally {
      setCommitting(false);
    }
  }, [commitMessage, projectPath, fetchStatus]);

  /** 切换到指定分支 */
  const checkoutBranch = useCallback(
    async (branch: string) => {
      setShowBranchSelector(false);
      if (branch === gitStatus?.branch) return;
      try {
        const response = await fetch("/api/git/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectPath, branch }),
        });
        if (response.ok) {
          await fetchStatus();
        }
      } catch {
        // 静默失败——分支切换错误不阻塞主流程
      }
    },
    [projectPath, gitStatus?.branch, fetchStatus],
  );

  /** 处理提交消息框的键盘事件 */
  const handleCommitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleCommit();
      }
    },
    [handleCommit],
  );

  if (loading && !gitStatus) {
    return <div className="flex items-center justify-center py-8 text-gray-500 text-sm">加载 Git 状态...</div>;
  }

  if (error && !gitStatus) {
    return (
      <div className="p-4">
        <p className="text-red-400 text-sm mb-2">{error}</p>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const stagedFiles = gitStatus?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = gitStatus?.files.filter((f) => !f.staged) ?? [];

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
      {/* 头部：分支信息和刷新 */}
      <div className="flex items-center justify-between p-3 border-b border-gray-700">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowBranchSelector((prev) => !prev)}
            className="flex items-center gap-1.5 text-sm hover:text-white transition-colors"
          >
            <GitBranch className="h-4 w-4 text-blue-400" />
            <span className="font-mono">{gitStatus?.branch ?? "—"}</span>
          </button>
          {/* 分支选择下拉 */}
          {showBranchSelector && branches.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-gray-800 border border-gray-700 rounded shadow-lg z-10 max-h-48 overflow-y-auto">
              {branches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => void checkoutBranch(branch)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-700 transition-colors ${
                    branch === gitStatus?.branch ? "text-blue-400" : "text-gray-300"
                  }`}
                >
                  {branch}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          disabled={loading}
          className="p-1 hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* 错误提示 */}
      {error && <div className="px-3 py-2 bg-red-900/30 border-b border-red-800 text-red-300 text-xs">{error}</div>}

      {/* 文件变更列表 */}
      <div className="flex-1 overflow-y-auto">
        {/* 已暂存文件 */}
        {stagedFiles.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
              已暂存 ({stagedFiles.length})
            </div>
            {stagedFiles.map((file) => (
              <button
                key={`staged-${file.path}`}
                type="button"
                onClick={() => void handleStageToggle(file.path, true)}
                className="flex items-center gap-2 w-full text-left px-3 py-1 text-sm hover:bg-gray-700/50 transition-colors group"
                title="点击取消暂存"
              >
                <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <StatusIcon status={file.status} />
                <span className="truncate flex-1 text-gray-300">{file.path}</span>
                <Minus className="h-3 w-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* 未暂存文件 */}
        {unstagedFiles.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
              未暂存 ({unstagedFiles.length})
            </div>
            {unstagedFiles.map((file) => (
              <button
                key={`unstaged-${file.path}`}
                type="button"
                onClick={() => void handleStageToggle(file.path, false)}
                className="flex items-center gap-2 w-full text-left px-3 py-1 text-sm hover:bg-gray-700/50 transition-colors group"
                title="点击暂存"
              >
                <StatusIcon status={file.status} />
                <span className="truncate flex-1 text-gray-300">{file.path}</span>
                <Plus className="h-3 w-3 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* 无变更 */}
        {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">工作区无变更</div>
        )}
      </div>

      {/* 提交区域 */}
      <div className="border-t border-gray-700 p-3">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          placeholder="提交信息..."
          rows={3}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
        />
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={committing || !commitMessage.trim() || stagedFiles.length === 0}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm rounded transition-colors"
        >
          <GitCommit className="h-4 w-4" />
          <span>{committing ? "提交中..." : "提交"}</span>
        </button>
      </div>
    </div>
  );
}
