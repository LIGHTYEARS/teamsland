import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord, SidecarConfig } from "@teamsland/types";
import { describe, expect, it, vi } from "vitest";
import { CapacityError, SubagentRegistry } from "../registry.js";

const restConfig: Omit<SidecarConfig, "maxConcurrentSessions"> = {
  maxRetryCount: 3,
  maxDelegateDepth: 2,
  workerTimeoutSeconds: 300,
  healthCheckTimeoutMs: 30000,
  minSwarmSuccessRatio: 0.5,
};

function makeFakeLarkNotifier() {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRecord(agentId: string, pid: number): AgentRecord {
  return {
    agentId,
    pid,
    sessionId: `sess-${agentId}`,
    issueId: `ISSUE-${agentId}`,
    worktreePath: `/tmp/worktree-${agentId}`,
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
  };
}

describe("SubagentRegistry", () => {
  it("register: 正常注册后可通过 get 检索", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    expect(registry.get("agent-a")).toBeDefined();
    expect(registry.get("agent-a")?.pid).toBe(1001);
  });

  it("register: 容量超限抛出 CapacityError", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 1, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    expect(() => registry.register(makeRecord("agent-b", 1002))).toThrow(CapacityError);
  });

  it("CapacityError: current 和 max 字段正确", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 2, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.register(makeRecord("agent-b", 1002));
    try {
      registry.register(makeRecord("agent-c", 1003));
      expect.fail("应抛出 CapacityError");
    } catch (err) {
      expect(err).toBeInstanceOf(CapacityError);
      const capacityErr = err as CapacityError;
      expect(capacityErr.current).toBe(2);
      expect(capacityErr.max).toBe(2);
    }
  });

  it("unregister: 移除已注册的 Agent", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.unregister("agent-a");
    expect(registry.get("agent-a")).toBeUndefined();
    expect(registry.runningCount()).toBe(0);
  });

  it("unregister: 不存在的 agentId 静默忽略", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    expect(() => registry.unregister("nonexistent")).not.toThrow();
  });

  it("runningCount: 正确反映注册表大小", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    expect(registry.runningCount()).toBe(0);
    registry.register(makeRecord("agent-a", 1001));
    expect(registry.runningCount()).toBe(1);
    registry.register(makeRecord("agent-b", 1002));
    expect(registry.runningCount()).toBe(2);
  });

  it("allRunning: 返回所有注册的 AgentRecord 快照", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    registry.register(makeRecord("agent-b", 1002));
    const all = registry.allRunning();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.agentId).sort()).toEqual(["agent-a", "agent-b"]);
  });

  it("persist/restoreOnStartup: 存活进程正确恢复，死进程被清除", async () => {
    const path = join(tmpdir(), `test-registry-${Date.now()}.json`);

    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });

    // process.pid 是当前进程，必然存活；999999999 不存在
    registry.register(makeRecord("agent-alive", process.pid));
    registry.register(makeRecord("agent-dead", 999999999));
    await registry.persist();

    const restored = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });
    const timer = await restored.restoreOnStartup();
    if (timer) clearInterval(timer);

    expect(restored.runningCount()).toBe(1);
    expect(restored.get("agent-alive")).toBeDefined();
    expect(restored.get("agent-dead")).toBeUndefined();
  });

  it("restoreOnStartup: 文件不存在时静默跳过", async () => {
    const path = join(tmpdir(), `nonexistent-registry-${Date.now()}.json`);
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 20, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
      registryPath: path,
    });
    await expect(registry.restoreOnStartup()).resolves.toBeNull();
    expect(registry.runningCount()).toBe(0);
  });

  it("toRegistryState: 快照包含所有 Agent 和 updatedAt", () => {
    const registry = new SubagentRegistry({
      config: { maxConcurrentSessions: 5, ...restConfig },
      notifier: makeFakeLarkNotifier() as never,
    });
    registry.register(makeRecord("agent-a", 1001));
    const state = registry.toRegistryState();
    expect(state.agents).toHaveLength(1);
    expect(state.updatedAt).toBeGreaterThan(0);
  });
});
