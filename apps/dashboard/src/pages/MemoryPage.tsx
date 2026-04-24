import { Button } from "@teamsland/ui/components/ui/button";
import { Card, CardContent } from "@teamsland/ui/components/ui/card";
import { ChevronRight, FileText, Folder, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface VikingEntry {
  name: string;
  uri: string;
  is_dir: boolean;
}

interface SearchResult {
  uri: string;
  score?: number;
  snippet?: string;
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
      <header className="shrink-0 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold text-foreground">Memory</h1>
        <p className="text-sm text-muted-foreground">Browse and search the OpenViking semantic memory store</p>
      </header>

      {/* 搜索栏 */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border px-6 py-3">
        <div className="relative flex-1 max-w-lg">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Semantic search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
        </div>
        <Button size="sm" variant="outline" onClick={handleSearch} disabled={searching}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </div>

      {/* 主内容区：树 + 内容查看器 */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧目录树 */}
        <div className="w-64 shrink-0 border-r border-border overflow-y-auto p-3">
          <VikingTree selectedUri={selectedUri} onSelect={onUriChange} />
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
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Select a file from the tree or search to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 递归目录树 */
function VikingTree({ selectedUri, onSelect }: { selectedUri?: string; onSelect: (uri: string) => void }) {
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

  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-xs text-muted-foreground">Viking not available.</p>;
  if (rootEntries.length === 0) return <p className="text-xs text-muted-foreground">Empty namespace.</p>;

  return (
    <div className="space-y-0.5">
      {rootEntries.map((entry) => (
        <TreeNode key={entry.uri} entry={entry} selectedUri={selectedUri} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}

function TreeNode({
  entry,
  selectedUri,
  onSelect,
  depth,
}: {
  entry: VikingEntry;
  selectedUri?: string;
  onSelect: (uri: string) => void;
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
      <button
        type="button"
        onClick={handleToggle}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] ${
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
      {expanded && children && (
        <div>
          {children.map((child) => (
            <TreeNode key={child.uri} entry={child} selectedUri={selectedUri} onSelect={onSelect} depth={depth + 1} />
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
        if (r.ok) {
          const data = await r.json();
          setContent(data.result ?? null);
        } else {
          setContent(null);
        }
      })
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [uri]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (content === null) return <p className="text-sm text-muted-foreground">Failed to load content.</p>;

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
    return <p className="text-sm text-muted-foreground">No results found.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground mb-4">{results.length} results</p>
      {results.map((r) => (
        <button
          key={r.uri}
          type="button"
          onClick={() => onSelect(r.uri)}
          className="block w-full text-left rounded-md border border-border p-3 hover:bg-accent/50 transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          <p className="font-mono text-xs text-foreground truncate">{r.uri}</p>
          {r.snippet && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.snippet}</p>}
          {r.score !== undefined && <p className="text-xs text-muted-foreground mt-1">Score: {r.score.toFixed(3)}</p>}
        </button>
      ))}
    </div>
  );
}
