"use client";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-denied"
  | "output-error";

export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface ToolUIPart {
  type: "tool-invocation";
  toolInvocationId: string;
  toolName: string;
  args: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  errorText?: string;
  state: ToolState;
}

export interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolName: string;
  args: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  errorText?: string;
  state: ToolState;
}

export interface FileUIPart {
  type: "file";
  filename: string;
  url: string;
  mediaType: string;
}

export interface SourceDocumentUIPart {
  type: "source";
  source: {
    sourceType: string;
    id: string;
    url?: string;
    title?: string;
  };
}
