import { Button } from "@teamsland/ui/components/ui/button";
import { Card, CardContent } from "@teamsland/ui/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@teamsland/ui/components/ui/dialog";
import { EmptyState } from "@teamsland/ui/components/ui/empty-state";
import { Input } from "@teamsland/ui/components/ui/input";
import { Skeleton } from "@teamsland/ui/components/ui/skeleton";
import { Spinner } from "@teamsland/ui/components/ui/spinner";
import { Textarea } from "@teamsland/ui/components/ui/textarea";
import { ChevronRight, FileText, Folder, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface VikingEntry {
  name: string;
  uri: string;
  is_dir: boolean;
}

interface SearchResult {
  uri: string;
  score?: number;
  abstract?: string;
}

// ─── Add Memory helpers ───

const DEFAULT_MEMORY_LOCATION = "viking://agent/teamsland/memories/";

function isWritableMemoryUri(uri: string): boolean {
  return uri.includes("/memories/");
}

function resolveDialogLocation(selectedUri?: string): string {
  if (!selectedUri) return DEFAULT_MEMORY_LOCATION;
  if (selectedUri.includes("/memories/")) {
    if (!selectedUri.endsWith("/")) {
      const lastSlash = selectedUri.lastIndexOf("/");
      if (lastSlash > 0) {
        const parent = selectedUri.slice(0, lastSlash + 1);
        if (parent.includes("/memories/")) return parent;
      }
    }
    return selectedUri.endsWith("/") ? selectedUri : `${selectedUri}/`;
  }
  return DEFAULT_MEMORY_LOCATION;
}

/**
 * Memory 浏览器页面
 *
 * 左侧 URI 目录树，右侧内容查看器，顶部语义搜索。
 */
export function MemoryPage({ selectedUri, onUriChange }: { selectedUri?: string; onUriChange: (uri: string) => void }) {
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogLocation, setDialogLocation] = useState(DEFAULT_MEMORY_LOCATION);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);

  const handleNewMemory = useCallback(() => {
    setDialogLocation(resolveDialogLocation(selectedUri));
    setDialogOpen(true);
  }, [selectedUri]);

  const handleTreeAddMemory = useCallback((dirUri: string) => {
    setDialogLocation(dirUri);
    setDialogOpen(true);
  }, []);

  const handleMemoryCreated = useCallback(
    (uri: string) => {
      setTreeRefreshKey((k) => k + 1);
      onUriChange(uri);
    },
    [onUriChange],
  );

  const handleSearch = useCallback(async () => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch("/api/viking/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: search, limit: 20 }),
      });
      if (res.ok) {
        const data = await res.json();
        const results: SearchResult[] = [
          ...(data.result?.memories ?? []),
          ...(data.result?.resources ?? []),
          ...(data.result?.skills ?? []),
        ];
        setSearchResults(results);
      }
    } catch {
      // 静默处理
    } finally {
      setSearching(false);
    }
  }, [search]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 页面标题 */}
      <header className="shrink-0 border-b border-border px-6 py-4 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">记忆</h1>
          <p className="text-sm text-muted-foreground">浏览与搜索 OpenViking 语义记忆库</p>
        </div>
        <Button size="sm" variant="outline" onClick={handleNewMemory}>
          <Plus size={14} />
          新建记忆
        </Button>
      </header>

      {/* 搜索栏 */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="relative flex-1 max-w-lg">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="语义搜索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
        <Button size="sm" variant="outline" onClick={handleSearch} disabled={searching}>
          {searching ? (
            <>
              <Spinner className="mr-1.5 size-3.5" />
              搜索中
            </>
          ) : (
            "搜索"
          )}
        </Button>
      </div>

      {/* 主内容区：树 + 内容查看器 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧目录树 */}
        <div className="w-64 shrink-0 border-r border-border overflow-y-auto p-3">
          <VikingTree
            key={treeRefreshKey}
            selectedUri={selectedUri}
            onSelect={onUriChange}
            onAddMemory={handleTreeAddMemory}
          />
        </div>

        {/* 右侧内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {searchResults ? (
            <SearchResultsView
              results={searchResults}
              onSelect={(uri) => {
                setSearchResults(null);
                onUriChange(uri);
              }}
            />
          ) : selectedUri ? (
            <ContentViewer uri={selectedUri} />
          ) : (
            <EmptyState
              icon={<FileText size={32} strokeWidth={1} />}
              title="从文件树中选择文件"
              description="或使用搜索查找记忆"
              className="h-full"
            />
          )}
        </div>
      </div>

      <AddMemoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        location={dialogLocation}
        onCreated={handleMemoryCreated}
      />
    </div>
  );
}

/** 递归目录树 */
function VikingTree({
  selectedUri,
  onSelect,
  onAddMemory,
}: {
  selectedUri?: string;
  onSelect: (uri: string) => void;
  onAddMemory?: (dirUri: string) => void;
}) {
  const [rootEntries, setRootEntries] = useState<VikingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/viking/ls?uri=viking://")
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setRootEntries(data.result ?? []);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholders, no reordering
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <EmptyState title="Viking 服务不可用" className="py-6" />;
  if (rootEntries.length === 0) return <EmptyState title="命名空间为空" className="py-6" />;

  return (
    <div className="space-y-0.5">
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.uri}
          entry={entry}
          selectedUri={selectedUri}
          onSelect={onSelect}
          onAddMemory={onAddMemory}
          depth={0}
        />
      ))}
    </div>
  );
}

function TreeNode({
  entry,
  selectedUri,
  onSelect,
  onAddMemory,
  depth,
}: {
  entry: VikingEntry;
  selectedUri?: string;
  onSelect: (uri: string) => void;
  onAddMemory?: (dirUri: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<VikingEntry[] | null>(null);

  const handleToggle = useCallback(async () => {
    if (!entry.is_dir) {
      onSelect(entry.uri);
      return;
    }
    if (!expanded && children === null) {
      try {
        const res = await fetch(`/api/viking/ls?uri=${encodeURIComponent(entry.uri)}`);
        if (res.ok) {
          const data = await res.json();
          setChildren(data.result ?? []);
        }
      } catch {
        // 静默处理
      }
    }
    setExpanded((prev) => !prev);
  }, [entry, expanded, children, onSelect]);

  const isSelected = selectedUri === entry.uri;
  const Icon = entry.is_dir ? Folder : FileText;

  return (
    <div>
      <div className="group flex items-center">
        <button
          type="button"
          onClick={handleToggle}
          className={`flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
            isSelected
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.is_dir && (
            <ChevronRight size={12} className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
          )}
          <Icon size={12} className="shrink-0" />
          <span className="truncate">{entry.name}</span>
        </button>
        {entry.is_dir && isWritableMemoryUri(entry.uri) && onAddMemory && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddMemory(entry.uri.endsWith("/") ? entry.uri : `${entry.uri}/`);
            }}
            className="mr-1 hidden rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground group-hover:block"
            title="在此添加记忆"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
      {expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.uri}
              entry={child}
              selectedUri={selectedUri}
              onSelect={onSelect}
              onAddMemory={onAddMemory}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentViewer({ uri }: { uri: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/viking/read?uri=${encodeURIComponent(uri)}`)
      .then(async (r) => {
        if (!r.ok) return null;
        const data = await r.json();
        const text = data.result ?? "";
        if (text) return text;
        // read returned empty (likely a directory) — fall back to abstract
        const absRes = await fetch(`/api/viking/abstract?uri=${encodeURIComponent(uri)}`);
        if (!absRes.ok) return null;
        const absData = await absRes.json();
        return absData.result || null;
      })
      .then((result) => setContent(result))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [uri]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }
  if (content === null) return <EmptyState title="加载内容失败" description="请检查 URI 是否有效" />;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground break-all">{uri}</span>
      </div>
      <Card>
        <CardContent className="pt-4">
          <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono">{content}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

function SearchResultsView({ results, onSelect }: { results: SearchResult[]; onSelect: (uri: string) => void }) {
  if (results.length === 0) {
    return <EmptyState icon={<Search size={32} strokeWidth={1} />} title="未找到结果" description="尝试其他关键词" />;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-4">{results.length} 条结果</p>
      {results.map((r) => (
        <button
          key={r.uri}
          type="button"
          onClick={() => onSelect(r.uri)}
          className="block w-full text-left rounded-md border border-border p-3 hover:bg-accent/50 transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          <p className="font-mono text-xs text-foreground truncate">{r.uri}</p>
          {r.abstract && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.abstract}</p>}
          {r.score !== undefined && <p className="text-xs text-muted-foreground mt-1">得分：{r.score.toFixed(3)}</p>}
        </button>
      ))}
    </div>
  );
}

// ─── Add Memory Dialog ───

function AddMemoryDialog({
  open,
  onOpenChange,
  location,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: string;
  onCreated: (uri: string) => void;
}) {
  const [filename, setFilename] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const canCreate = filename.trim().length > 0 && !creating;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: multi-branch error handling for write API
  const handleCreate = useCallback(async () => {
    if (!canCreate) return;
    setError("");
    setCreating(true);
    const uri = `${location}${filename.trim()}.md`;
    try {
      const res = await fetch("/api/viking/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uri, content, mode: "create" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error ?? "创建记忆失败，请重试。";
        if (typeof msg === "string" && msg.includes("ALREADY_EXISTS")) {
          setError("同名文件已存在");
        } else if (typeof msg === "string" && (msg.includes("scope") || msg.includes("write not allowed"))) {
          setError("无法写入此位置");
        } else {
          setError(typeof msg === "string" ? msg : "创建记忆失败，请重试。");
        }
        return;
      }
      setFilename("");
      setContent("");
      onOpenChange(false);
      onCreated(uri);
    } catch {
      setError("创建记忆失败，请重试。");
    } finally {
      setCreating(false);
    }
  }, [canCreate, filename, content, location, onOpenChange, onCreated]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建记忆</DialogTitle>
          <DialogDescription>在 Viking 存储中创建新的记忆文件</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1.5">位置</p>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs text-muted-foreground">
              {location}
            </div>
          </div>

          <div>
            <label htmlFor="add-memory-filename" className="text-sm text-muted-foreground mb-1.5 block">
              文件名
            </label>
            <div className="flex">
              <Input
                id="add-memory-filename"
                value={filename}
                onChange={(e) => {
                  setFilename(e.target.value);
                  setError("");
                }}
                placeholder="my-memory"
                className="rounded-r-none"
              />
              <span className="inline-flex items-center rounded-r-md border border-l-0 border-border bg-muted/50 px-3 text-sm text-muted-foreground">
                .md
              </span>
            </div>
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
          </div>

          <div>
            <label htmlFor="add-memory-content" className="text-sm text-muted-foreground mb-1.5 block">
              内容
            </label>
            <Textarea
              id="add-memory-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此输入记忆内容…"
              className="min-h-32 font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={handleCreate} disabled={!canCreate}>
            {creating ? "创建中…" : "创建"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
