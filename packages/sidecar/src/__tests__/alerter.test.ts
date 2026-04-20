import { describe, expect, it, vi } from "vitest";
import { Alerter } from "../alerter.js";

function makeFakeNotifier() {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Alerter", () => {
  it("check: 超过阈值时发送飞书卡片", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("concurrent_agents", 19, 18);

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
    const [channelId] = fakeNotifier.sendCard.mock.calls[0];
    expect(channelId).toBe("oc_test");
  });

  it("check: 等于阈值时不发送（value <= threshold 不触发）", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("concurrent_agents", 18, 18);

    expect(fakeNotifier.sendCard).not.toHaveBeenCalled();
  });

  it("check: 未超过阈值时不发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("memory_usage", 70, 80);

    expect(fakeNotifier.sendCard).not.toHaveBeenCalled();
  });

  it("check: 冷却窗口内不重复发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("cpu_usage", 95, 80);
    await alerter.check("cpu_usage", 95, 80); // 第二次在冷却期内

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
  });

  it("check: 不同指标冷却窗口相互独立", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 60_000,
    });

    await alerter.check("metric_a", 100, 90);
    await alerter.check("metric_b", 100, 90); // 不同指标，不受 metric_a 冷却影响

    expect(fakeNotifier.sendCard).toHaveBeenCalledTimes(2);
  });

  it("check: 冷却过期后可再次发送", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
      cooldownMs: 0, // 零冷却时间，立即过期
    });

    await alerter.check("cpu", 95, 80);
    await alerter.check("cpu", 95, 80);

    expect(fakeNotifier.sendCard).toHaveBeenCalledTimes(2);
  });

  it("check: 卡片内容包含指标名和数值", async () => {
    const fakeNotifier = makeFakeNotifier();
    const alerter = new Alerter({
      notifier: fakeNotifier as never,
      channelId: "oc_test",
    });

    await alerter.check("error_rate_pct", 15, 10);

    expect(fakeNotifier.sendCard).toHaveBeenCalledOnce();
    const [, card] = fakeNotifier.sendCard.mock.calls[0];
    expect(card.title).toContain("error_rate_pct");
    expect(card.content).toContain("15");
    expect(card.content).toContain("10");
  });
});
