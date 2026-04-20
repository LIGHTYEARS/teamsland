import { Database } from "bun:sqlite";
import type { MeegoEvent } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import { MeegoEventBus } from "../event-bus.js";

const makeEvent = (id: string): MeegoEvent => ({
  eventId: id,
  issueId: "ISSUE-1",
  projectKey: "FE",
  type: "issue.created",
  payload: {},
  timestamp: Date.now(),
});

describe("MeegoEventBus", () => {
  it("首次 handle 应调用 handler", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-001"));
    expect(processFn).toHaveBeenCalledOnce();
  });

  it("重复 eventId 不应重复调用 handler（幂等）", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-dup"));
    await bus.handle(makeEvent("evt-dup"));
    expect(processFn).toHaveBeenCalledOnce();
  });

  it("无 handler 的事件类型不应抛出", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    await expect(bus.handle(makeEvent("evt-003"))).resolves.toBeUndefined();
  });

  it("同一事件类型注册多个 handler，应按顺序全部调用", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const order: number[] = [];
    bus.on("issue.created", {
      process: vi.fn().mockImplementation(async () => {
        order.push(1);
      }),
    });
    bus.on("issue.created", {
      process: vi.fn().mockImplementation(async () => {
        order.push(2);
      }),
    });

    await bus.handle(makeEvent("evt-multi"));
    expect(order).toEqual([1, 2]);
  });

  it("handler 抛出错误不应中断后续 handler", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const failHandler = { process: vi.fn().mockRejectedValue(new Error("handler error")) };
    const successHandler = { process: vi.fn().mockResolvedValue(undefined) };
    bus.on("issue.created", failHandler);
    bus.on("issue.created", successHandler);

    await expect(bus.handle(makeEvent("evt-err"))).resolves.toBeUndefined();
    expect(successHandler.process).toHaveBeenCalledOnce();
  });

  it("sweepSeenEvents 应清除超时记录，允许重新处理同一事件", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-old"));
    bus.sweepSeenEvents(0); // maxAgeMs=0 清除所有记录

    // 清除后同一事件可重新处理
    await bus.handle(makeEvent("evt-old"));
    expect(processFn).toHaveBeenCalledTimes(2);
  });

  it("sweepSeenEvents 默认 1 小时内的记录不清除", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const processFn = vi.fn().mockResolvedValue(undefined);
    bus.on("issue.created", { process: processFn });

    await bus.handle(makeEvent("evt-fresh"));
    bus.sweepSeenEvents(); // 默认 1h，不应清除刚写入的记录

    await bus.handle(makeEvent("evt-fresh"));
    expect(processFn).toHaveBeenCalledOnce(); // 仍然幂等
  });
});
