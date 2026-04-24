import {
  Commit,
  CommitActions,
  CommitAuthor,
  CommitAuthorAvatar,
  CommitContent,
  CommitCopyButton,
  CommitFile,
  CommitFileAdditions,
  CommitFileChanges,
  CommitFileDeletions,
  CommitFileIcon,
  CommitFileInfo,
  CommitFilePath,
  CommitFileStatus,
  CommitFiles,
  CommitHash,
  CommitHeader,
  CommitInfo,
  CommitMessage,
  CommitMetadata,
  CommitSeparator,
  CommitTimestamp,
} from "@teamsland/ui/elements/commit";
import { useCallback, useEffect, useState } from "react";

/**
 * 提交记录条目
 *
 * @example
 * ```ts
 * const entry: CommitLogEntry = {
 *   hash: "abc1234567890",
 *   message: "feat: add login",
 *   author: "Dev",
 *   date: "2026-04-23T10:00:00+08:00",
 *   files: [{ path: "src/login.ts", status: "modified", additions: 12, deletions: 3 }],
 * };
 * ```
 */
interface CommitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: Array<{
    path: string;
    status: string;
    additions: number;
    deletions: number;
  }>;
}

type ValidFileStatus = "added" | "modified" | "deleted" | "renamed";

const VALID_STATUSES = new Set<string>(["added", "modified", "deleted", "renamed"]);

function toFileStatus(status: string): ValidFileStatus {
  return VALID_STATUSES.has(status) ? (status as ValidFileStatus) : "modified";
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/**
 * CommitHistory 组件 Props
 *
 * @example
 * ```tsx
 * <CommitHistory projectPath="/workspace/teamsland" />
 * ```
 */
interface CommitHistoryProps {
  projectPath: string;
}

/**
 * 提交历史组件（基于 AI Elements Commit 体系）
 *
 * 从 git log API 获取最近提交记录，以 Commit 组件可折叠展示。
 * 每条 commit 显示 hash、消息、作者头像、相对时间及变更文件列表。
 *
 * @example
 * ```tsx
 * <CommitHistory projectPath="/Users/dev/my-project" />
 * ```
 */
export function CommitHistory({ projectPath }: CommitHistoryProps) {
  const [commits, setCommits] = useState<CommitLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/git/log?path=${encodeURIComponent(projectPath)}&limit=15`);
      if (!response.ok) return;
      const data: unknown = await response.json();
      const resp = data as { commits?: CommitLogEntry[] };
      setCommits(resp.commits ?? []);
    } catch {
      // 获取日志失败不阻塞主流程
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void fetchLog();
  }, [fetchLog]);

  if (loading) {
    return <div className="py-4 text-center text-muted-foreground text-xs">加载提交历史...</div>;
  }

  if (commits.length === 0) {
    return <div className="py-4 text-center text-muted-foreground text-xs">暂无提交记录</div>;
  }

  return (
    <div className="space-y-2">
      {commits.map((entry) => (
        <Commit key={entry.hash}>
          <CommitHeader>
            <CommitAuthor>
              <CommitAuthorAvatar initials={getInitials(entry.author)} className="mr-2" />
              <CommitInfo>
                <CommitMessage>{entry.message}</CommitMessage>
                <CommitMetadata>
                  <CommitHash>{entry.hash.slice(0, 7)}</CommitHash>
                  <CommitSeparator />
                  <span>{entry.author}</span>
                  <CommitSeparator />
                  <CommitTimestamp date={new Date(entry.date)} />
                </CommitMetadata>
              </CommitInfo>
            </CommitAuthor>
            <CommitActions>
              <CommitCopyButton hash={entry.hash} />
            </CommitActions>
          </CommitHeader>
          {entry.files.length > 0 && (
            <CommitContent>
              <CommitFiles>
                {entry.files.map((file) => (
                  <CommitFile key={file.path}>
                    <CommitFileInfo>
                      <CommitFileStatus status={toFileStatus(file.status)} />
                      <CommitFileIcon />
                      <CommitFilePath>{file.path}</CommitFilePath>
                    </CommitFileInfo>
                    <CommitFileChanges>
                      <CommitFileAdditions count={file.additions} />
                      <CommitFileDeletions count={file.deletions} />
                    </CommitFileChanges>
                  </CommitFile>
                ))}
              </CommitFiles>
            </CommitContent>
          )}
        </Commit>
      ))}
    </div>
  );
}
