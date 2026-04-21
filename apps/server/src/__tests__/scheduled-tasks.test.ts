import type { WorktreeManager } from "@teamsland/git";
import type { MeegoEventBus } from "@teamsland/meego";
import type { MemoryReaper, TeamMemoryStore } from "@teamsland/memory";
import type { SubagentRegistry } from "@teamsland/sidecar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startFts5Optimize, startMemoryReaper, startSeenEventsSweep, startWorktreeReaper } from "../scheduled-tasks.js";

// ─── mock @teamsland/observability ───
vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── startWorktreeReaper ───

describe("startWorktreeReaper", () => {
  it("返回有效的定时器 ID", () => {
    const mockRegistry = { allRunning: vi.fn().mockReturnValue([]) } as unknown as SubagentRegistry;
    const mockManager = { reap: vi.fn().mockResolvedValue([]) } as unknown as WorktreeManager;

    const timer = startWorktreeReaper(mockManager, mockRegistry, 5000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("按间隔调用 worktreeManager.reap", async () => {
    const mockRegistry = { allRunning: vi.fn().mockReturnValue([{ agentId: "a1" }]) } as unknown as SubagentRegistry;
    const mockManager = {
      reap: vi.fn().mockResolvedValue([{ worktreePath: "/tmp/wt", action: "removed" }]),
    } as unknown as WorktreeManager;

    const timer = startWorktreeReaper(mockManager, mockRegistry, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    expect(mockRegistry.allRunning).toHaveBeenCalledTimes(1);
    expect(mockManager.reap).toHaveBeenCalledTimes(1);
    expect(mockManager.reap).toHaveBeenCalledWith([{ agentId: "a1" }], 7);

    clearInterval(timer);
  });

  it("依赖抛出异常时不向外传播", async () => {
    const mockRegistry = { allRunning: vi.fn().mockReturnValue([]) } as unknown as SubagentRegistry;
    const mockManager = { reap: vi.fn().mockRejectedValue(new Error("boom")) } as unknown as WorktreeManager;

    const timer = startWorktreeReaper(mockManager, mockRegistry, 1000);

    // 不应抛出
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockManager.reap).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });
});

// ─── startMemoryReaper ───

describe("startMemoryReaper", () => {
  it("返回有效的定时器 ID", () => {
    const mockReaper = { reap: vi.fn().mockResolvedValue({ archived: 0, skipped: 0 }) } as unknown as MemoryReaper;

    const timer = startMemoryReaper(mockReaper, 5000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("按间隔调用 reaper.reap", async () => {
    const mockReaper = {
      reap: vi.fn().mockResolvedValue({ archived: 3, skipped: 5 }),
    } as unknown as MemoryReaper;

    const timer = startMemoryReaper(mockReaper, 2000);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockReaper.reap).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mockReaper.reap).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });

  it("依赖抛出异常时不向外传播", async () => {
    const mockReaper = { reap: vi.fn().mockRejectedValue(new Error("reap failed")) } as unknown as MemoryReaper;

    const timer = startMemoryReaper(mockReaper, 1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(mockReaper.reap).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });
});

// ─── startSeenEventsSweep ───

describe("startSeenEventsSweep", () => {
  it("返回有效的定时器 ID", () => {
    const mockBus = { sweepSeenEvents: vi.fn() } as unknown as MeegoEventBus;

    const timer = startSeenEventsSweep(mockBus, 5000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("按间隔调用 eventBus.sweepSeenEvents", () => {
    const mockBus = { sweepSeenEvents: vi.fn() } as unknown as MeegoEventBus;

    const timer = startSeenEventsSweep(mockBus, 3000);

    vi.advanceTimersByTime(3000);
    expect(mockBus.sweepSeenEvents).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(3000);
    expect(mockBus.sweepSeenEvents).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });

  it("依赖抛出异常时不向外传播", () => {
    const mockBus = {
      sweepSeenEvents: vi.fn().mockImplementation(() => {
        throw new Error("sweep failed");
      }),
    } as unknown as MeegoEventBus;

    const timer = startSeenEventsSweep(mockBus, 1000);

    // 不应抛出
    vi.advanceTimersByTime(1000);
    expect(mockBus.sweepSeenEvents).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });
});

// ─── startFts5Optimize ───

describe("startFts5Optimize", () => {
  it("返回有效的定时器 ID", () => {
    const mockStore = { optimizeFts5: vi.fn() } as unknown as TeamMemoryStore;

    const timer = startFts5Optimize(mockStore, 5000);
    expect(timer).toBeDefined();
    clearInterval(timer);
  });

  it("按间隔调用 memoryStore.optimizeFts5", () => {
    const mockStore = { optimizeFts5: vi.fn() } as unknown as TeamMemoryStore;

    const timer = startFts5Optimize(mockStore, 4000);

    vi.advanceTimersByTime(4000);
    expect(mockStore.optimizeFts5).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    expect(mockStore.optimizeFts5).toHaveBeenCalledTimes(2);

    clearInterval(timer);
  });

  it("依赖抛出异常时不向外传播", () => {
    const mockStore = {
      optimizeFts5: vi.fn().mockImplementation(() => {
        throw new Error("optimize failed");
      }),
    } as unknown as TeamMemoryStore;

    const timer = startFts5Optimize(mockStore, 1000);

    // 不应抛出
    vi.advanceTimersByTime(1000);
    expect(mockStore.optimizeFts5).toHaveBeenCalledTimes(1);

    clearInterval(timer);
  });
});
