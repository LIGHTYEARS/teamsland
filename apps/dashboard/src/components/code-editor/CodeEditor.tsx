import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";
import type { Extension } from "@uiw/react-codemirror";
import CodeMirror, { keymap } from "@uiw/react-codemirror";
import { useCallback, useMemo } from "react";

/**
 * CodeEditor 组件的 Props
 *
 * @example
 * ```tsx
 * import type { CodeEditorProps } from "./CodeEditor.js";
 *
 * const props: CodeEditorProps = {
 *   filePath: "/src/index.ts",
 *   content: "console.log('hello');",
 *   readOnly: false,
 *   onChange: (v) => console.log("内容变更:", v),
 *   onSave: (v) => console.log("保存:", v),
 * };
 * ```
 */
interface CodeEditorProps {
  /** 当前编辑的文件路径，用于推断语言高亮 */
  filePath: string;
  /** 编辑器内容 */
  content: string;
  /** 是否只读模式 */
  readOnly?: boolean;
  /** 内容变更回调 */
  onChange?: (content: string) => void;
  /** 保存回调（Ctrl+S / Cmd+S 触发） */
  onSave?: (content: string) => void;
}

/** JavaScript/TypeScript 相关扩展名集合 */
const JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".cts", ".cjs"]);

/** JSON 相关扩展名集合 */
const JSON_EXTENSIONS = new Set([".json", ".jsonc"]);

/**
 * 根据文件扩展名返回对应的 CodeMirror 语言扩展
 *
 * @param filePath - 文件路径
 * @returns 语言扩展数组
 */
function getLanguageExtension(filePath: string): Extension[] {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex === -1) return [];
  const ext = filePath.slice(dotIndex).toLowerCase();

  if (JS_EXTENSIONS.has(ext)) {
    const isTsx = ext === ".tsx" || ext === ".jsx";
    const isTs = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
    return [javascript({ jsx: isTsx, typescript: isTs })];
  }
  if (JSON_EXTENSIONS.has(ext)) {
    return [json()];
  }
  return [];
}

/**
 * CodeMirror 代码编辑器组件
 *
 * 基于 @uiw/react-codemirror 的代码编辑器，支持 TypeScript/JavaScript/JSON 语法高亮、
 * oneDark 暗色主题、Ctrl+S / Cmd+S 快捷保存以及只读模式。
 *
 * @param props - 编辑器组件属性
 *
 * @example
 * ```tsx
 * import { CodeEditor } from "./CodeEditor.js";
 *
 * function EditorPanel() {
 *   const [content, setContent] = useState("const x = 1;");
 *   return (
 *     <CodeEditor
 *       filePath="/src/app.ts"
 *       content={content}
 *       onChange={setContent}
 *       onSave={(c) => fetch("/api/save", { method: "POST", body: c })}
 *     />
 *   );
 * }
 * ```
 */
export function CodeEditor({ filePath, content, readOnly = false, onChange, onSave }: CodeEditorProps) {
  /** 语言扩展，随文件路径变化重新计算 */
  const langExtension = useMemo(() => getLanguageExtension(filePath), [filePath]);

  /** Ctrl+S / Cmd+S 保存快捷键扩展 */
  const saveKeymap = useMemo((): Extension[] => {
    if (!onSave) return [];
    return [
      keymap.of([
        {
          key: "Mod-s",
          run: (view) => {
            onSave(view.state.doc.toString());
            return true;
          },
        },
      ]),
    ];
  }, [onSave]);

  /** 合并所有扩展 */
  const extensions = useMemo(() => [...langExtension, ...saveKeymap], [langExtension, saveKeymap]);

  /** 内容变更处理 */
  const handleChange = useCallback(
    (value: string) => {
      onChange?.(value);
    },
    [onChange],
  );

  return (
    <div className="h-full w-full overflow-hidden">
      <CodeMirror
        value={content}
        onChange={handleChange}
        theme={oneDark}
        extensions={extensions}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          searchKeymap: true,
          foldKeymap: true,
          completionKeymap: true,
          lintKeymap: true,
        }}
        className="h-full [&_.cm-editor]:h-full"
      />
    </div>
  );
}
