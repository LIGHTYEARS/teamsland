import type { Logger } from "@teamsland/observability";
import { describe, expect, it, vi } from "vitest";
import { SidecarDataPlane } from "../data-plane.js";
import type { SubagentRegistry } from "../registry.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => `${l}\n`).join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function makeNdjsonStreamChunked(lines: string[], chunkSize: number): ReadableStream<Uint8Array> {
  const text = lines.map((l) => `${l}\n`).join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      let offset = 0;
      while (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
        offset += chunkSize;
      }
      controller.close();
    },
  });
}

function makeFakeRegistry(): SubagentRegistry {
  const records = new Map<string, { status: string; pid: number }>();
  return {
    get: (agentId: string) => records.get(agentId) as never,
    unregister: vi.fn((agentId: string) => {
      records.delete(agentId);
    }),
    register: vi.fn(),
    runningCount: vi.fn().mockReturnValue(0),
    allRunning: vi.fn().mockReturnValue([]),
    persist: vi.fn().mockResolvedValue(undefined),
    restoreOnStartup: vi.fn().mockResolvedValue(undefined),
    toRegistryState: vi.fn().mockReturnValue({ agents: [], updatedAt: 0 }),
  } as unknown as SubagentRegistry;
}

describe("SidecarDataPlane", () => {
  it("processStream: 拦截 delegate 工具调用，不写入 SessionDB", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "tool_use", name: "delegate", input: {} }),
      JSON.stringify({ type: "assistant", content: "已完成分析" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // delegate 被拦截，只有 assistant 消息写入 DB
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 拦截 spawn_agent 工具调用", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "tool_use", name: "spawn_agent", input: {} }),
      JSON.stringify({ type: "tool_use", name: "bash", input: { command: "ls" } }),
    ];

    await dataPlane.processStream("agent-002", makeNdjsonStream(lines));

    // spawn_agent 拦截，bash 正常写入
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 流结束后自动注销 Agent", async () => {
    const registry = makeFakeRegistry();
    const fakeSessionDb = { appendMessage: vi.fn().mockResolvedValue(1) };

    const dataPlane = new SidecarDataPlane({
      registry,
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    await dataPlane.processStream("agent-001", makeNdjsonStream([]));

    expect(registry.unregister).toHaveBeenCalledWith("agent-001");
  });

  it("processStream: 单行 JSON 解析失败不中断整个流", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = ["INVALID JSON {{{", JSON.stringify({ type: "assistant", content: "正常消息" })];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // 无效 JSON 跳过，assistant 消息正常写入
    expect(appendedMessages).toHaveLength(1);
  });

  it("processStream: 跨 chunk 的行正确拼接", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "assistant", content: "消息一" }),
      JSON.stringify({ type: "assistant", content: "消息二" }),
    ];

    // 使用小 chunk size 模拟跨行切割
    await dataPlane.processStream("agent-001", makeNdjsonStreamChunked(lines, 5));

    expect(appendedMessages).toHaveLength(2);
  });

  it("processStream: log 事件不写入 SessionDB", async () => {
    const appendedMessages: unknown[] = [];
    const fakeSessionDb = {
      appendMessage: vi.fn(async (msg: unknown) => {
        appendedMessages.push(msg);
        return 1;
      }),
    };

    const dataPlane = new SidecarDataPlane({
      registry: makeFakeRegistry(),
      sessionDb: fakeSessionDb as never,
      logger: fakeLogger,
    });

    const lines = [
      JSON.stringify({ type: "log", message: "调试信息" }),
      JSON.stringify({ type: "system", session_id: "sess-123" }),
    ];

    await dataPlane.processStream("agent-001", makeNdjsonStream(lines));

    // log 和 system 均不写入 DB
    expect(appendedMessages).toHaveLength(0);
  });
});
