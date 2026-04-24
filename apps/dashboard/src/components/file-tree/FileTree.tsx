import { FileTree as ElementsFileTree, FileTreeFile, FileTreeFolder } from "@teamsland/ui/elements/file-tree";
import type { IFuseOptions } from "fuse.js";
import Fuse from "fuse.js";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 文件节点数据结构
 *
 * @example
 * ```ts
 * const node: FileNode = {
 *   name: "index.ts",
 *   path: "/src/index.ts",
 *   type: "file",
 * };
 * ```
 */
interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

/**
 * FileTree 组件的 Props
 *
 * @example
 * ```tsx
 * <FileTree
 *   projectPath="/workspace/my-project"
 *   onFileSelect={(path) => console.log("选中文件:", path)}
 *   selectedFile="/workspace/my-project/src/index.ts"
 * />
 * ```
 */
interface FileTreeProps {
  projectPath: string;
  onFileSelect: (filePath: string) => void;
  selectedFile?: string;
}

const FUSE_OPTIONS: IFuseOptions<FileNode> = {
  keys: ["name"],
  threshold: 0.4,
  includeScore: true,
};

/**
 * 递归排序文件树：目录在前、文件在后，同类型按名称字母排序
 *
 * @example
 * ```ts
 * const sorted = sortTree(rawNodes);
 * ```
 */
function sortTree(nodes: FileNode[]): FileNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    })
    .map((node) => (node.children ? { ...node, children: sortTree(node.children) } : node));
}

/**
 * 将树状结构展平为一维数组，用于 Fuse.js 搜索
 *
 * @example
 * ```ts
 * const flat = flattenNodes(treeData);
 * ```
 */
function flattenNodes(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      result.push(...flattenNodes(node.children));
    }
  }
  return result;
}

/**
 * 根据搜索结果过滤树结构，保留匹配节点及其父目录
 *
 * @example
 * ```ts
 * const filtered = filterTree(tree, new Set(["/src/index.ts"]));
 * ```
 */
function filterTree(nodes: FileNode[], matchPaths: Set<string>): FileNode[] {
  const result: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (matchPaths.has(node.path)) {
        result.push(node);
      }
    } else {
      const filteredChildren = node.children ? filterTree(node.children, matchPaths) : [];
      if (filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
  }
  return result;
}

/**
 * 递归渲染文件树节点，使用 AI Elements FileTreeFolder / FileTreeFile
 *
 * @example
 * ```tsx
 * <RenderNodes nodes={tree} />
 * ```
 */
function RenderNodes({ nodes }: { nodes: FileNode[] }) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "directory" ? (
          <FileTreeFolder key={node.path} path={node.path} name={node.name}>
            {node.children && <RenderNodes nodes={node.children} />}
          </FileTreeFolder>
        ) : (
          <FileTreeFile key={node.path} path={node.path} name={node.name} />
        ),
      )}
    </>
  );
}

/**
 * 文件树浏览器组件（基于 AI Elements FileTree）
 *
 * 从服务端 API 获取项目文件结构，支持 Fuse.js 模糊搜索，
 * 渲染层使用 AI Elements FileTree 组件体系。
 *
 * @example
 * ```tsx
 * <FileTree
 *   projectPath="/workspace/teamsland"
 *   onFileSelect={(path) => setSelected(path)}
 *   selectedFile="/workspace/teamsland/src/index.ts"
 * />
 * ```
 */
export function FileTree({ projectPath, onFileSelect, selectedFile }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  /** 从 API 获取文件树数据 */
  const fetchTree = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/tree?path=${encodeURIComponent(projectPath)}`);
      if (!response.ok) {
        throw new Error(`获取文件树失败: ${response.status}`);
      }
      const data: unknown = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("文件树数据格式错误");
      }
      setTree(sortTree(data as FileNode[]));
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    void fetchTree();
  }, [fetchTree]);

  const flatNodes = useMemo(() => flattenNodes(tree), [tree]);
  const fuse = useMemo(() => new Fuse(flatNodes, FUSE_OPTIONS), [flatNodes]);

  /** 根据搜索词过滤后的文件树 */
  const displayTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const results = fuse.search(searchQuery);
    const matchPaths = new Set(results.map((r) => r.item.path));
    return filterTree(tree, matchPaths);
  }, [tree, searchQuery, fuse]);

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">加载文件树...</div>;
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-destructive text-sm mb-2">{error}</p>
        <button
          type="button"
          onClick={() => void fetchTree()}
          className="text-xs text-primary hover:underline transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {displayTree.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {searchQuery ? "无匹配文件" : "目录为空"}
          </div>
        ) : (
          <ElementsFileTree selectedPath={selectedFile} onSelect={onFileSelect} className="border-0 rounded-none">
            <RenderNodes nodes={displayTree} />
          </ElementsFileTree>
        )}
      </div>
    </div>
  );
}
