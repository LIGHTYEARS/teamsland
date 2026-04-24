import { Check, FileQuestion, GitBranch, GitCommit, Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CommitHistory } from "./CommitHistory";

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
  path: string;
  status: string;
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
  branch: string;
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
  projectPath: string;
}

const STATUS_CONFIG: Record<string, { label: string; colorClass: string }> = {
  M: { label: "修改", colorClass: "text-yellow-400" },
  A: { label: "新增", colorClass: "text-green-400" },
  D: { label: "删除", colorClass: "text-red-400" },
  "??": { label: "未跟踪", colorClass: "text-muted-foreground" },
  R: { label: "重命名", colorClass: "text-primary" },
  C: { label: "复制", colorClass: "text-primary" },
};

/** 根据状态码获取对应图标 */
function StatusIcon({ status }: { status: string }) {
  const colorClass = STATUS_CONFIG[status]?.colorClass ?? "text-muted-foreground";
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
      const resp = data as { branches?: string[]; currentBranch?: string };
      if (Array.isArray(resp.branches)) {
        setBranches(resp.branches);
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
        const endpoint = currentlyStaged ? "/api/git/unstage" : "/api/git/stage";
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: projectPath,
            files: [filePath],
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
    return <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">加载 Git 状态...</div>;
  }

  if (error && !gitStatus) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm mb-2">{error}</p>
        <button
          type="button"
          onClick={() => void fetchStatus()}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  const stagedFiles = gitStatus?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = gitStatus?.files.filter((f) => !f.staged) ?? [];

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowBranchSelector((prev) => !prev)}
            className="flex items-center gap-1.5 text-sm hover:text-foreground transition-colors"
          >
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="font-mono">{gitStatus?.branch ?? "—"}</span>
          </button>
          {showBranchSelector && branches.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-popover border border-border rounded-md shadow-lg z-10 max-h-48 overflow-y-auto">
              {branches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => void checkoutBranch(branch)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                    branch === gitStatus?.branch ? "text-primary" : "text-popover-foreground"
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
          className="p-1 hover:bg-accent rounded transition-colors disabled:opacity-50"
          title="刷新"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-destructive/10 border-b border-destructive/30 text-destructive text-xs">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {stagedFiles.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              已暂存 ({stagedFiles.length})
            </div>
            {stagedFiles.map((file) => (
              <button
                key={`staged-${file.path}`}
                type="button"
                onClick={() => void handleStageToggle(file.path, true)}
                className="flex items-center gap-2 w-full min-w-0 text-left px-3 py-1 text-sm hover:bg-accent/50 transition-colors group"
                title="点击取消暂存"
              >
                <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <StatusIcon status={file.status} />
                <span className="truncate flex-1 min-w-0 text-foreground">{file.path}</span>
                <Minus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}

        {unstagedFiles.length > 0 && (
          <div>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
              未暂存 ({unstagedFiles.length})
            </div>
            {unstagedFiles.map((file) => (
              <button
                key={`unstaged-${file.path}`}
                type="button"
                onClick={() => void handleStageToggle(file.path, false)}
                className="flex items-center gap-2 w-full min-w-0 text-left px-3 py-1 text-sm hover:bg-accent/50 transition-colors group"
                title="点击暂存"
              >
                <StatusIcon status={file.status} />
                <span className="truncate flex-1 min-w-0 text-foreground">{file.path}</span>
                <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </button>
            ))}
          </div>
        )}

        {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">工作区无变更</div>
        )}

        <div className="px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">提交历史</div>
          <CommitHistory projectPath={projectPath} />
        </div>
      </div>

      <div className="border-t border-border p-3">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
          placeholder="提交信息..."
          rows={3}
          className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors resize-none"
        />
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={committing || !commitMessage.trim() || stagedFiles.length === 0}
          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground text-sm rounded-md transition-colors"
        >
          <GitCommit className="h-4 w-4" />
          <span>{committing ? "提交中..." : "提交"}</span>
        </button>
      </div>
    </div>
  );
}
