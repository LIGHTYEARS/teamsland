import { Database } from "bun:sqlite";
import type { MeegoConfig } from "@teamsland/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeegoConnector } from "../connector.js";
import { MeegoEventBus } from "../event-bus.js";

const makeConfig = (port: number): MeegoConfig => ({
  spaces: [],
  eventMode: "webhook",
  webhook: { host: "127.0.0.1", port, path: "/meego/webhook" },
  poll: { intervalSeconds: 60, lookbackMinutes: 5 },
  longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
});

describe("MeegoConnector — webhook 模式", () => {
  it("POST 有效事件应返回 200 且 handle 被调用", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const handleSpy = vi.spyOn(bus, "handle");

    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18080), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18080/meego/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: "e1",
        issueId: "I-1",
        projectKey: "FE",
        type: "issue.created",
        payload: {},
        timestamp: Date.now(),
      }),
    });
    expect(resp.status).toBe(200);
    expect(handleSpy).toHaveBeenCalledOnce();
    ac.abort();
  });

  it("非 POST 请求应返回 405", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18081), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18081/meego/webhook");
    expect(resp.status).toBe(405);
    ac.abort();
  });

  it("body 为非法 JSON 应返回 400", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18082), eventBus: bus });
    await connector.start(ac.signal);

    const resp = await fetch("http://127.0.0.1:18082/meego/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    expect(resp.status).toBe(400);
    ac.abort();
  });

  it("AbortController abort 后服务器停止", async () => {
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const ac = new AbortController();
    const connector = new MeegoConnector({ config: makeConfig(18083), eventBus: bus });
    await connector.start(ac.signal);

    // 先确认服务正常
    const resp = await fetch("http://127.0.0.1:18083/meego/webhook");
    expect(resp.status).toBe(405);

    // abort 后应停止
    ac.abort();
    // 给服务器时间关闭
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 连接应被拒绝
    await expect(fetch("http://127.0.0.1:18083/meego/webhook")).rejects.toThrow();
  });
});

describe("MeegoConnector — poll 模式", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("eventMode=poll 时 startPoll 应被调用", async () => {
    vi.useFakeTimers();
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const config: MeegoConfig = {
      ...makeConfig(18084),
      eventMode: "poll",
    };
    const ac = new AbortController();
    const connector = new MeegoConnector({ config, eventBus: bus });
    const pollSpy = vi.spyOn(connector as never, "startPoll");
    await connector.start(ac.signal);
    expect(pollSpy).toHaveBeenCalledOnce();
    ac.abort();
  });

  it("eventMode=both 时 startWebhook 和 startPoll 均应被调用", async () => {
    vi.useFakeTimers();
    const db = new Database(":memory:");
    const bus = new MeegoEventBus(db);
    const config: MeegoConfig = {
      ...makeConfig(18085),
      eventMode: "both",
    };
    const ac = new AbortController();
    const connector = new MeegoConnector({ config, eventBus: bus });
    const webhookSpy = vi.spyOn(connector as never, "startWebhook");
    const pollSpy = vi.spyOn(connector as never, "startPoll");
    await connector.start(ac.signal);
    expect(webhookSpy).toHaveBeenCalledOnce();
    expect(pollSpy).toHaveBeenCalledOnce();
    ac.abort();
  });
});
