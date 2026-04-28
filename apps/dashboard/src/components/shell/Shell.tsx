import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shell 组件的 Props
 *
 * @example
 * ```tsx
 * <Shell
 *   send={(data) => ws.send(JSON.stringify(data))}
 *   subscribe={(handler) => { ws.onmessage = handler; return () => {}; }}
 *   cwd="/Users/dev/project"
 * />
 * ```
 */
interface ShellProps {
  send: (data: unknown) => void;
  subscribe: (handler: (data: unknown) => void) => () => void;
  cwd: string;
}

type ConnectionState = "connecting" | "connected" | "error";

/**
 * 检查 WebSocket 消息是否为终端相关类型
 *
 * @example
 * ```ts
 * const record = asTerminalMessage(data);
 * if (record?.type === "terminal-output") {
 *   write(record.data as string);
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

const STATUS_CONFIG: Record<ConnectionState, { dotClass: string; label: string }> = {
  connecting: {
    dotClass: "bg-yellow-400 animate-pulse",
    label: "连接中…",
  },
  connected: {
    dotClass: "bg-green-500",
    label: "已连接",
  },
  error: {
    dotClass: "bg-destructive",
    label: "连接失败",
  },
};

/**
 * 交互式终端 Shell 组件（基于 Vercel wterm）
 *
 * 顶部微型状态栏指示连接状态（连接中/已连接/错误），
 * 已连接后状态栏自动淡出，保持终端区域整洁。
 *
 * @example
 * ```tsx
 * import { Shell } from "./Shell.js";
 *
 * function TerminalPanel() {
 *   const { send, subscribe } = useWebSocket();
 *   return <Shell send={send} subscribe={subscribe} cwd="/workspace/project" />;
 * }
 * ```
 */
export function Shell({ send, subscribe, cwd }: ShellProps) {
  const { ref, write } = useTerminal();
  const termIdRef = useRef(`term-${Date.now()}`);
  const [connState, setConnState] = useState<ConnectionState>("connecting");

  const handleData = useCallback(
    (data: string) => {
      send({ type: "terminal-input", id: termIdRef.current, data });
    },
    [send],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      send({ type: "terminal-resize", id: termIdRef.current, cols, rows });
    },
    [send],
  );

  useEffect(() => {
    const unsubscribe = subscribe((data: unknown) => {
      const record = asTerminalMessage(data);
      if (!record || record.id !== termIdRef.current) return;

      if (record.type === "terminal-started") {
        setConnState("connected");
      }
      if (record.type === "terminal-output" && typeof record.data === "string") {
        write(record.data);
      }
      if (record.type === "terminal-error") {
        setConnState("error");
      }
    });

    send({ type: "terminal-start", id: termIdRef.current, cwd });

    return () => {
      send({ type: "terminal-stop", id: termIdRef.current });
      unsubscribe();
    };
  }, [subscribe, send, cwd, write]);

  const { dotClass, label } = STATUS_CONFIG[connState];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 text-xs text-muted-foreground">
        <span className={`inline-block size-1.5 rounded-full ${dotClass}`} />
        <span>{label}</span>
      </div>
      <div className="flex-1 min-h-0">
        <Terminal
          ref={ref}
          onData={handleData}
          onResize={handleResize}
          autoResize
          cursorBlink
          theme="light"
          className="h-full w-full !shadow-none !rounded-none"
        />
      </div>
    </div>
  );
}
