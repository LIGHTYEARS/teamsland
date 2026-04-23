import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VikingHealthMonitor } from "../viking-health-monitor.js";
import type { IVikingMemoryClient, NullVikingMemoryClient, VikingMemoryClient } from "../viking-memory-client.js";

function makeMockClient(healthy: boolean): IVikingMemoryClient {
  return {
    healthCheck: vi.fn().mockResolvedValue(healthy),
    find: vi.fn(),
    read: vi.fn(),
    abstract: vi.fn(),
    overview: vi.fn(),
    write: vi.fn(),
    ls: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
    addResource: vi.fn(),
    createSession: vi.fn(),
    getSessionContext: vi.fn(),
    addMessage: vi.fn(),
    commitSession: vi.fn(),
    deleteSession: vi.fn(),
    getTask: vi.fn(),
  } as unknown as IVikingMemoryClient;
}

describe("VikingHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts unhealthy, becomes healthy after successful check", async () => {
    const real = makeMockClient(true);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as unknown as VikingMemoryClient,
      nullClient as unknown as NullVikingMemoryClient,
      { intervalMs: 1000, failThreshold: 3 },
    );

    expect(monitor.isHealthy).toBe(false);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.client).toBe(real);
    monitor.stop();
  });

  it("degrades after failThreshold consecutive failures", async () => {
    const real = makeMockClient(false);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as unknown as VikingMemoryClient,
      nullClient as unknown as NullVikingMemoryClient,
      { intervalMs: 1000, failThreshold: 2 },
    );

    // First make it healthy
    vi.mocked(real.healthCheck).mockResolvedValueOnce(true);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(true);

    // Now fail twice
    vi.mocked(real.healthCheck).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(true); // 1 fail, threshold is 2

    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(false); // 2 fails = degraded
    expect(monitor.client).toBe(nullClient);
    monitor.stop();
  });

  it("recovers after failure streak ends", async () => {
    const real = makeMockClient(false);
    const nullClient = makeMockClient(false);
    const monitor = new VikingHealthMonitor(
      real as unknown as VikingMemoryClient,
      nullClient as unknown as NullVikingMemoryClient,
      { intervalMs: 1000, failThreshold: 1 },
    );

    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.isHealthy).toBe(false);

    // Now succeed
    vi.mocked(real.healthCheck).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.client).toBe(real);
    monitor.stop();
  });
});
