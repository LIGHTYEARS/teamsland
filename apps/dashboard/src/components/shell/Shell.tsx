import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

/**
 * Shell 组件的 Props
 *
 * @example
 * ```tsx
 * import type { ShellProps } from "./Shell.js";
 *
 * const props: ShellProps = {
 *   send: (data) => ws.send(JSON.stringify(data)),
 *   subscribe: (handler) => { ws.onmessage = handler; return () => {}; },
 *   cwd: "/Users/dev/project",
 * };
 * ```
 */
interface ShellProps {
  /** WebSocket send 函数，用于发送终端输入 */
  send: (data: unknown) => void;
  /** 订阅 WebSocket 消息，返回取消订阅函数 */
  subscribe: (handler: (data: unknown) => void) => () => void;
  /** 终端启动时的工作目录 */
  cwd: string;
}

/** xterm.js 终端深色主题配色，与 oneDark CodeMirror 主题协调一致 */
const DARK_THEME = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#6a9955",
  yellow: "#d7ba7d",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#4ec9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#6a9955",
  brightYellow: "#d7ba7d",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#4ec9b0",
  brightWhite: "#ffffff",
} as const;

/**
 * 检查 WebSocket 消息是否为终端相关类型，并返回 Record 结构以便后续读取字段
 *
 * @param data - 待检查的消息数据
 * @returns 若为终端消息则返回对应 Record，否则返回 null
 *
 * @example
 * ```typescript
 * const record = asTerminalMessage(data);
 * if (record && record.type === "terminal-output") {
 *   terminal.write(record.data as string);
 * }
 * ```
 */
function asTerminalMessage(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  if (
    record.type === "terminal-output" ||
    record.type === "terminal-started" ||
    record.type === "terminal-stopped" ||
    record.type === "terminal-error"
  ) {
    return record;
  }
  return null;
}

/**
 * xterm.js 终端 Shell 组件
 *
 * 基于 xterm.js 的交互式终端组件，通过 WebSocket 双向通信实现远程终端功能。
 * 自带暗色主题、自动 resize 适配和可点击链接支持。
 *
 * @param props - Shell 组件属性，包含 WebSocket 的 send / subscribe 方法和工作目录 cwd
 *
 * @example
 * ```tsx
 * import { Shell } from "./Shell.js";
 * import { useWebSocket } from "../../contexts/WebSocketContext.js";
 *
 * function TerminalPanel() {
 *   const { send, subscribe } = useWebSocket();
 *   return <Shell send={send} subscribe={subscribe} cwd="/Users/dev/project" />;
 * }
 * ```
 */
export function Shell({ send, subscribe, cwd }: ShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef(`term-${Date.now()}`);

  /** 封装发送终端输入消息 */
  const handleTerminalData = useCallback(
    (data: string) => {
      send({ type: "terminal-input", id: termIdRef.current, data });
    },
    [send],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      theme: DARK_THEME,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // 初始 fit
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // 监听终端输入
    const dataDisposable = terminal.onData(handleTerminalData);

    // 使用 ResizeObserver 监听容器尺寸变化，自动重新 fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
      });
    });
    resizeObserver.observe(container);

    // 订阅 WebSocket 消息，将终端输出写入 xterm
    const unsubscribe = subscribe((data: unknown) => {
      const record = asTerminalMessage(data);
      if (!record || record.id !== termIdRef.current) return;

      if (record.type === "terminal-started") {
        terminal.writeln("\r\n\x1b[32m终端已连接\x1b[0m\r\n");
      }
      if (record.type === "terminal-output" && typeof record.data === "string") {
        terminal.write(record.data);
      }
      if (record.type === "terminal-error" && typeof record.error === "string") {
        terminal.writeln(`\r\n\x1b[31m错误: ${record.error}\x1b[0m\r\n`);
      }
    });

    // 发送 terminal-start 消息以创建服务端终端进程
    send({ type: "terminal-start", id: termIdRef.current, cwd });

    return () => {
      send({ type: "terminal-stop", id: termIdRef.current });
      dataDisposable.dispose();
      resizeObserver.disconnect();
      unsubscribe();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [handleTerminalData, subscribe, send, cwd]);

  return <div ref={containerRef} className="h-full w-full min-h-[200px]" style={{ backgroundColor: "#1e1e1e" }} />;
}
