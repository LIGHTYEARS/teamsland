import type { IFuseOptions } from "fuse.js";
import Fuse from "fuse.js";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 文件节点数据结构
 *
 * @example
 * ```ts
 * import type { FileNode } from "./FileTree.js";
 *
 * const node: FileNode = {
 *   name: "index.ts",
 *   path: "/src/index.ts",
 *   type: "file",
 * };
 * ```
 */
interface FileNode {
  /** 文件或目录名称 */
  name: string;
  /** 完整路径 */
  path: string;
  /** 节点类型 */
  type: "file" | "directory";
  /** 子节点（仅目录拥有） */
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
  /** 项目根目录路径 */
  projectPath: string;
  /** 文件选中回调 */
  onFileSelect: (filePath: string) => void;
  /** 当前选中的文件路径 */
  selectedFile?: string;
}

/** Fuse.js 搜索配置 */
const FUSE_OPTIONS: IFuseOptions<FileNode> = {
  keys: ["name"],
  threshold: 0.4,
  includeScore: true,
};

/**
 * 将树状结构展平为一维数组，用于 Fuse.js 搜索
 *
 * @param nodes - 文件节点数组
 * @returns 展平后的所有文件节点（仅文件，不含目录）
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
 * @param nodes - 文件节点数组
 * @param matchPaths - 匹配的文件路径集合
 * @returns 过滤后的树结构
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
 * 递归渲染单个文件树节点
 *
 * @param props - 节点渲染属性
 */
function FileTreeNode({
  node,
  depth,
  expandedDirs,
  onToggle,
  onFileSelect,
  selectedFile,
}: {
  node: FileNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggle: (path: string) => void;
  onFileSelect: (filePath: string) => void;
  selectedFile?: string;
}) {
  const isDir = node.type === "directory";
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = node.path === selectedFile;
  const paddingLeft = depth * 16 + 8;

  if (isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          className="flex items-center gap-1.5 w-full text-left py-1 px-2 text-sm hover:bg-gray-700/50 rounded transition-colors text-gray-300"
          style={{ paddingLeft }}
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-500" />
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-yellow-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-yellow-600" />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expandedDirs={expandedDirs}
                onToggle={onToggle}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onFileSelect(node.path)}
      className={`flex items-center gap-1.5 w-full text-left py-1 px-2 text-sm rounded transition-colors ${
        isSelected ? "bg-blue-600/30 text-blue-300" : "text-gray-400 hover:bg-gray-700/50 hover:text-gray-300"
      }`}
      style={{ paddingLeft: paddingLeft + 18 }}
    >
      <File className="h-4 w-4 shrink-0 text-gray-500" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

/**
 * 递归文件树浏览器组件
 *
 * 从服务端 API 获取项目文件结构，支持递归展开/折叠目录、
 * Fuse.js 模糊搜索以及文件选中高亮。
 *
 * @param props - 文件树组件属性
 *
 * @example
 * ```tsx
 * import { FileTree } from "./FileTree.js";
 *
 * function Sidebar() {
 *   const [selected, setSelected] = useState<string>();
 *   return (
 *     <FileTree
 *       projectPath="/workspace/teamsland"
 *       onFileSelect={setSelected}
 *       selectedFile={selected}
 *     />
 *   );
 * }
 * ```
 */
export function FileTree({ projectPath, onFileSelect, selectedFile }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

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
      setTree(data as FileNode[]);
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

  /** 展平节点用于搜索 */
  const flatNodes = useMemo(() => flattenNodes(tree), [tree]);

  /** Fuse.js 搜索实例 */
  const fuse = useMemo(() => new Fuse(flatNodes, FUSE_OPTIONS), [flatNodes]);

  /** 根据搜索词过滤后的文件树 */
  const displayTree = useMemo(() => {
    if (!searchQuery.trim()) return tree;
    const results = fuse.search(searchQuery);
    const matchPaths = new Set(results.map((r) => r.item.path));
    return filterTree(tree, matchPaths);
  }, [tree, searchQuery, fuse]);

  /** 切换目录展开/折叠状态 */
  const handleToggle = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-8 text-gray-500 text-sm">加载文件树...</div>;
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-red-400 text-sm mb-2">{error}</p>
        <button
          type="button"
          onClick={() => void fetchTree()}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-300">
      {/* 搜索栏 */}
      <div className="p-2 border-b border-gray-700">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索文件..."
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>
      </div>

      {/* 文件树 */}
      <div className="flex-1 overflow-y-auto py-1">
        {displayTree.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">{searchQuery ? "无匹配文件" : "目录为空"}</div>
        ) : (
          displayTree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              onToggle={handleToggle}
              onFileSelect={onFileSelect}
              selectedFile={selectedFile}
            />
          ))
        )}
      </div>
    </div>
  );
}
