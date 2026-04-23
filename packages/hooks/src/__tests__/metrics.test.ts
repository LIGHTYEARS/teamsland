import { describe, expect, it } from "vitest";
import { HookMetricsCollector } from "../metrics.js";

describe("HookMetricsCollector", () => {
  it("recordHookHit: 累加命中计数", () => {
    const collector = new HookMetricsCollector();
    collector.recordHookHit("hook-a", "issue.created");
    collector.recordHookHit("hook-a", "issue.created");
    collector.recordHookHit("hook-b", "issue.assigned");

    const snapshot = collector.getSnapshot();
    expect(snapshot.hookHitCounts["hook-a"]).toBe(2);
    expect(snapshot.hookHitCounts["hook-b"]).toBe(1);
  });

  it("recordHookHit: 同时递增 tierDistribution.hook", () => {
    const collector = new HookMetricsCollector();
    collector.recordHookHit("hook-a", "issue.created");
    collector.recordHookHit("hook-a", "issue.created");

    const snapshot = collector.getSnapshot();
    expect(snapshot.tierDistribution.hook).toBe(2);
  });

  it("recordHookError: 累加错误计数", () => {
    const collector = new HookMetricsCollector();
    collector.recordHookError("hook-a", "issue.created");
    collector.recordHookError("hook-a", "issue.status_changed");
    collector.recordHookError("hook-b", "issue.assigned");

    const snapshot = collector.getSnapshot();
    expect(snapshot.hookErrorCounts["hook-a"]).toBe(2);
    expect(snapshot.hookErrorCounts["hook-b"]).toBe(1);
  });

  it("recordMatchDuration: 存储延迟数据", () => {
    const collector = new HookMetricsCollector();
    collector.recordMatchDuration("hook-a", 1.5);
    collector.recordMatchDuration("hook-a", 2.0);

    // matchDurations 不直接暴露在 snapshot 中，但不应抛出
    const snapshot = collector.getSnapshot();
    expect(snapshot).toBeDefined();
  });

  it("recordHandleDuration: 存储延迟数据并反映在快照中", () => {
    const collector = new HookMetricsCollector();
    collector.recordHandleDuration("hook-a", 10);
    collector.recordHandleDuration("hook-a", 20);
    collector.recordHandleDuration("hook-a", 30);

    const snapshot = collector.getSnapshot();
    expect(snapshot.hookLatencies["hook-a"]).toBeDefined();
    expect(snapshot.hookLatencies["hook-a"].p50).toBeGreaterThan(0);
  });

  it("getSnapshot: 返回正确的结构", () => {
    const collector = new HookMetricsCollector();
    const snapshot = collector.getSnapshot();

    expect(snapshot).toHaveProperty("tierDistribution");
    expect(snapshot).toHaveProperty("hookHitCounts");
    expect(snapshot).toHaveProperty("hookErrorCounts");
    expect(snapshot).toHaveProperty("hookLatencies");
    expect(snapshot.tierDistribution).toEqual({ hook: 0, queue: 0 });
    expect(snapshot.hookHitCounts).toEqual({});
    expect(snapshot.hookErrorCounts).toEqual({});
    expect(snapshot.hookLatencies).toEqual({});
  });

  it("getSnapshot: 百分位数计算正确", () => {
    const collector = new HookMetricsCollector();
    // 插入 1..100 的数据
    for (let i = 1; i <= 100; i++) {
      collector.recordHandleDuration("hook-a", i);
    }

    const snapshot = collector.getSnapshot();
    const latency = snapshot.hookLatencies["hook-a"];

    // p50 应在 50 附近
    expect(latency.p50).toBe(50);
    // p95 应在 95 附近
    expect(latency.p95).toBe(95);
    // p99 应在 99 附近
    expect(latency.p99).toBe(99);
  });

  it("滚动窗口: 超过 1000 条后最旧数据被丢弃", () => {
    const collector = new HookMetricsCollector();
    // 插入 1100 条，前 100 条应被丢弃
    for (let i = 1; i <= 1100; i++) {
      collector.recordHandleDuration("hook-a", i);
    }

    const snapshot = collector.getSnapshot();
    const latency = snapshot.hookLatencies["hook-a"];

    // 保留的是 101..1100，p50 应在中位 ~600 附近
    // p50 = ceil(50/100 * 1000) - 1 = 499 → sorted[499] = 101 + 499 = 600
    expect(latency.p50).toBe(600);
    // p99 = ceil(99/100 * 1000) - 1 = 989 → sorted[989] = 101 + 989 = 1090
    expect(latency.p99).toBe(1090);
  });

  it("reset: 清除所有数据", () => {
    const collector = new HookMetricsCollector();
    collector.recordHookHit("hook-a", "issue.created");
    collector.recordHookError("hook-a", "issue.created");
    collector.recordMatchDuration("hook-a", 5);
    collector.recordHandleDuration("hook-a", 10);
    collector.recordTierQueue();

    collector.reset();

    const snapshot = collector.getSnapshot();
    expect(snapshot.hookHitCounts).toEqual({});
    expect(snapshot.hookErrorCounts).toEqual({});
    expect(snapshot.hookLatencies).toEqual({});
    expect(snapshot.tierDistribution).toEqual({ hook: 0, queue: 0 });
  });

  it("recordTierQueue: 递增 queue 计数", () => {
    const collector = new HookMetricsCollector();
    collector.recordTierQueue();
    collector.recordTierQueue();
    collector.recordTierQueue();

    const snapshot = collector.getSnapshot();
    expect(snapshot.tierDistribution.queue).toBe(3);
    expect(snapshot.tierDistribution.hook).toBe(0);
  });
});
