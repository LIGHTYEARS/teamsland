import type { Logger } from "@teamsland/observability";
import type { TeamMessage } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import { ObservableMessageBus } from "../message-bus.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

const baseMsg: TeamMessage = {
  traceId: "existing-trace",
  fromAgent: "orchestrator",
  toAgent: "agent-001",
  type: "delegation",
  payload: { issueId: "ISSUE-42" },
  timestamp: Date.now(),
};

describe("ObservableMessageBus", () => {
  it("send: traceId 为空字符串时自动注入 UUID", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "" });

    expect(received[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("send: traceId 非空时保留原值", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "custom-trace-id" });

    expect(received[0]).toBe("custom-trace-id");
  });

  it("send: 注入的 UUID 每次不同", () => {
    const received: string[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg.traceId));

    bus.send({ ...baseMsg, traceId: "" });
    bus.send({ ...baseMsg, traceId: "" });

    expect(received[0]).not.toBe(received[1]);
  });

  it("on: 多个 handler 均被调用", () => {
    const callCounts = [0, 0];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on(() => callCounts[0]++);
    bus.on(() => callCounts[1]++);

    bus.send({ ...baseMsg, traceId: "t1" });

    expect(callCounts).toEqual([1, 1]);
  });

  it("send: handler 接收到完整消息字段", () => {
    const received: TeamMessage[] = [];
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    bus.on((msg) => received.push(msg));

    bus.send(baseMsg);

    expect(received[0].fromAgent).toBe("orchestrator");
    expect(received[0].toAgent).toBe("agent-001");
    expect(received[0].type).toBe("delegation");
    expect(received[0].payload).toEqual({ issueId: "ISSUE-42" });
  });

  it("send: 记录结构化日志（info 被调用）", () => {
    const infoSpy = vi.fn();
    const loggerWithSpy = { ...fakeLogger, info: infoSpy };
    const bus = new ObservableMessageBus({ logger: loggerWithSpy as unknown as Logger });

    bus.send(baseMsg);

    expect(infoSpy).toHaveBeenCalledOnce();
    const [fields] = infoSpy.mock.calls[0];
    expect(fields).toMatchObject({
      fromAgent: "orchestrator",
      toAgent: "agent-001",
      type: "delegation",
    });
  });

  it("on: 无 handler 注册时 send 不抛出异常", () => {
    const bus = new ObservableMessageBus({ logger: fakeLogger });
    expect(() => bus.send(baseMsg)).not.toThrow();
  });
});
