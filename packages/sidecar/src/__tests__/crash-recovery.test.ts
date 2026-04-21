import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRecord, SidecarConfig } from "@teamsland/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentRegistry } from "../registry.js";

/** 保证不存在的 PID */
const DEAD_PID = 999_999_999;

/** 构造完整的 SidecarConfig */
function makeConfig(maxConcurrentSessions = 20): SidecarConfig {
  return {
    maxConcurrentSessions,
    maxRetryCount: 3,
    maxDelegateDepth: 2,
    workerTimeoutSeconds: 300,
    healthCheckTimeoutMs: 30_000,
    minSwarmSuccessRatio: 0.5,
  };
}

/** 构造无副作用的假飞书通知器 */
function makeFakeNotifier() {
  return {
    sendDm: vi.fn().mockResolvedValue(undefined),
    sendCard: vi.fn().mockResolvedValue(undefined),
  };
}

/** 构造最小化的 AgentRecord */
function makeRecord(agentId: string, pid: number): AgentRecord {
  return {
    agentId,
    pid,
    sessionId: `sess-${agentId}`,
    issueId: `issue-${agentId}`,
    worktreePath: `/tmp/wt-${agentId}`,
    status: "running",
    retryCount: 0,
    createdAt: Date.now(),
  };
}

describe("SubagentRegistry 崩溃恢复", () => {
  /** 测试结束后清理临时文件 */
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const p of cleanupPaths) {
      try {
        unlinkSync(p);
      } catch {
        /* 文件不存在时忽略 */
      }
      try {
        unlinkSync(`${p}.tmp`);
      } catch {
        /* 原子写入临时文件不存在时忽略 */
      }
    }
    cleanupPaths.length = 0;
  });

  /** 生成唯一的临时注册表路径并追踪以便清理 */
  function makeRegistryPath(): string {
    const p = join(tmpdir(), `registry-crash-test-${randomUUID()}.json`);
    cleanupPaths.push(p);
    return p;
  }

  it("restoreOnStartup 恢复存活进程并清理死亡进程", async () => {
    const registryPath = makeRegistryPath();

    // 阶段 1：向注册表写入存活 + 死亡两条记录并持久化到磁盘
    const reg1 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });

    const aliveRecord = makeRecord("agent-alive", process.pid);
    const deadRecord = makeRecord("agent-dead", DEAD_PID);

    reg1.register(aliveRecord);
    reg1.register(deadRecord);
    expect(reg1.runningCount()).toBe(2);
    await reg1.persist();

    // 阶段 2：新实例从磁盘恢复，仅应载入存活进程
    const reg2 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });

    // 恢复前注册表应为空
    expect(reg2.runningCount()).toBe(0);

    const timer2 = await reg2.restoreOnStartup();

    // 仅存活 PID 应被恢复
    expect(reg2.runningCount()).toBe(1);
    expect(reg2.get("agent-alive")).toBeDefined();
    expect(reg2.get("agent-alive")?.pid).toBe(process.pid);
    // 死亡 PID 不应出现在注册表中
    expect(reg2.get("agent-dead")).toBeUndefined();
    // 存活孤儿应返回监控定时器
    expect(timer2).not.toBeNull();
    if (timer2) clearInterval(timer2);
  });

  it("persist 后仅保存存活记录，第三次实例读取时无死亡记录", async () => {
    const registryPath = makeRegistryPath();

    // 写入存活 + 死亡记录
    const reg1 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });
    reg1.register(makeRecord("agent-alive", process.pid));
    reg1.register(makeRecord("agent-dead", DEAD_PID));
    await reg1.persist();

    // 恢复（过滤死亡）后再次持久化，此时文件中只应含存活记录
    const reg2 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });
    const t2 = await reg2.restoreOnStartup();
    if (t2) clearInterval(t2);
    await reg2.persist();

    // 第三个实例读取文件，只应看到存活记录
    const reg3 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });
    const t3 = await reg3.restoreOnStartup();
    if (t3) clearInterval(t3);
    expect(reg3.runningCount()).toBe(1);
    expect(reg3.get("agent-alive")).toBeDefined();
    expect(reg3.get("agent-dead")).toBeUndefined();
  });

  it("restoreOnStartup 在注册表文件不存在时静默返回", async () => {
    // 使用不存在的路径，不追踪清理（无需清理）
    const registryPath = join(tmpdir(), `nonexistent-${randomUUID()}.json`);

    const reg = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });

    await expect(reg.restoreOnStartup()).resolves.toBeNull();
    expect(reg.runningCount()).toBe(0);
  });

  it("所有进程都已死亡时恢复后注册表为空", async () => {
    const registryPath = makeRegistryPath();

    const reg1 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });
    // 注册两个均已死亡的进程
    reg1.register(makeRecord("agent-dead-1", DEAD_PID));
    reg1.register(makeRecord("agent-dead-2", DEAD_PID - 1));
    await reg1.persist();

    const reg2 = new SubagentRegistry({
      config: makeConfig(),
      notifier: makeFakeNotifier() as never,
      registryPath,
    });
    const timer = await reg2.restoreOnStartup();

    expect(reg2.runningCount()).toBe(0);
    expect(reg2.allRunning()).toHaveLength(0);
    // 无存活孤儿时不应返回定时器
    expect(timer).toBeNull();
  });
});
