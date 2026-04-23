import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MeegoEvent } from "@teamsland/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HookEngine } from "../engine.js";
import type { HookContext } from "../types.js";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ─── 辅助函数 ───

function makeEvent(overrides: Partial<MeegoEvent> = {}): MeegoEvent {
  return {
    eventId: `test-${Date.now()}`,
    issueId: "issue-001",
    projectKey: "TEST",
    type: "issue.created",
    payload: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeCtx(): HookContext {
  return {
    lark: { sendGroupMessage: vi.fn(), sendDm: vi.fn(), imHistory: vi.fn() },
    notifier: { sendDm: vi.fn(), sendGroupMessage: vi.fn() },
    spawn: vi.fn(),
    queue: { enqueue: vi.fn() },
    registry: { allRunning: vi.fn().mockReturnValue([]), findByIssueId: vi.fn().mockReturnValue([]) },
    config: {},
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    metrics: {
      recordHookHit: vi.fn(),
      recordHookError: vi.fn(),
      recordMatchDuration: vi.fn(),
      recordHandleDuration: vi.fn(),
    },
  };
}

// ─── Hook 文件内容模板 ───

const VALID_HOOK_CONTENT = `
export const description = "测试用 hook";
export const priority = 10;

export const match = (event) => event.type === "issue.created";

export const handle = async (_event, ctx) => {
  ctx.log.info({ hookId: "valid-hook" }, "valid hook executed");
};
`;

const INVALID_HOOK_CONTENT = `
// Missing match and handle exports — should fail validation
export const description = "this hook is invalid";
`;

const SLOW_HOOK_CONTENT = `
export const description = "超时测试 hook";
export const priority = 50;

export const match = (_event) => true;

export const handle = async (_event, _ctx) => {
  await new Promise((resolve) => setTimeout(resolve, 10000));
};
`;

function makeHighPriorityHook(priority: number, eventType: string): string {
  return `
export const description = "priority ${priority} hook";
export const priority = ${priority};

export const match = (event) => event.type === "${eventType}";

export const handle = async (_event, ctx) => {
  ctx.log.info({ hookId: "priority-${priority}" }, "hook executed");
};
`;
}

describe("HookEngine", () => {
  let tempDir: string;
  let engine: HookEngine;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hook-engine-test-"));
  });

  afterEach(() => {
    if (engine) {
      engine.stop();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loadHook: 有效 hook 文件加载成功", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    expect(engine.size).toBe(1);
  });

  it("loadHook: 无效 hook 文件被静默跳过", async () => {
    writeFileSync(join(tempDir, "invalid.ts"), INVALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    expect(engine.size).toBe(0);
  });

  it("loadHook: 有效和无效 hook 混合加载时只保留有效的", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);
    writeFileSync(join(tempDir, "invalid.ts"), INVALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    expect(engine.size).toBe(1);
  });

  it("processEvent: 匹配的事件返回 true", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const ctx = makeCtx();
    const consumed = await engine.processEvent(makeEvent({ type: "issue.created" }), ctx);
    expect(consumed).toBe(true);
  });

  it("processEvent: 不匹配的事件返回 false", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const ctx = makeCtx();
    const consumed = await engine.processEvent(makeEvent({ type: "issue.assigned" }), ctx);
    expect(consumed).toBe(false);
  });

  it("processEvent: 无已加载 hook 时返回 false", async () => {
    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const ctx = makeCtx();
    const consumed = await engine.processEvent(makeEvent(), ctx);
    expect(consumed).toBe(false);
  });

  it("processEvent: hook 超时仍视为已消费，并记录错误指标", async () => {
    writeFileSync(join(tempDir, "slow.ts"), SLOW_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 100, // 100ms 超时
      multiMatch: false,
    });
    await engine.start();
    expect(engine.size).toBe(1);

    const ctx = makeCtx();
    const consumed = await engine.processEvent(makeEvent(), ctx);

    // 事件一旦被匹配即视为已消费，即使执行出错
    expect(consumed).toBe(true);
    expect(ctx.metrics.recordHookError).toHaveBeenCalled();
  });

  it("processEvent: 按 priority 升序执行 hook", async () => {
    // priority 20 的 hook
    writeFileSync(join(tempDir, "low-priority.ts"), makeHighPriorityHook(20, "issue.created"));
    // priority 5 的 hook
    writeFileSync(join(tempDir, "high-priority.ts"), makeHighPriorityHook(5, "issue.created"));

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();
    expect(engine.size).toBe(2);

    const ctx = makeCtx();
    await engine.processEvent(makeEvent({ type: "issue.created" }), ctx);

    // 单匹配模式下，只有第一个匹配的 hook 被执行（priority 5）
    // recordHookHit 应被调用一次（单匹配模式，第一个匹配后返回）
    expect(ctx.metrics.recordHookHit).toHaveBeenCalledTimes(1);
    // 验证是 priority=5 的 hook 先执行（通过 hookId 确认）
    const hitCall = vi.mocked(ctx.metrics.recordHookHit).mock.calls[0];
    expect(hitCall[0]).toBe("high-priority");
  });

  it("processEvent: multiMatch 模式下所有匹配的 hook 都执行", async () => {
    writeFileSync(join(tempDir, "hook-a.ts"), makeHighPriorityHook(10, "issue.created"));
    writeFileSync(join(tempDir, "hook-b.ts"), makeHighPriorityHook(20, "issue.created"));

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: true,
    });
    await engine.start();
    expect(engine.size).toBe(2);

    const ctx = makeCtx();
    const consumed = await engine.processEvent(makeEvent({ type: "issue.created" }), ctx);

    expect(consumed).toBe(true);
    expect(ctx.metrics.recordHookHit).toHaveBeenCalledTimes(2);
  });

  it("processEvent: 记录 match 和 handle 的延迟指标", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const ctx = makeCtx();
    await engine.processEvent(makeEvent({ type: "issue.created" }), ctx);

    expect(ctx.metrics.recordMatchDuration).toHaveBeenCalled();
    expect(ctx.metrics.recordHandleDuration).toHaveBeenCalled();
  });

  it("getStatus: 返回正确的状态结构", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const status = engine.getStatus();
    expect(status.hooksDir).toBe(tempDir);
    expect(status.totalLoaded).toBe(1);
    expect(status.loadedHooks).toHaveLength(1);
    expect(status.lastReloadAt).toBeGreaterThan(0);

    const hookStatus = status.loadedHooks[0];
    expect(hookStatus.id).toBe("valid");
    expect(hookStatus.filePath).toBe(join(tempDir, "valid.ts"));
    expect(hookStatus.priority).toBe(10);
    expect(hookStatus.description).toBe("测试用 hook");
    expect(hookStatus.loadedAt).toBeGreaterThan(0);
  });

  it("getStatus: 无 hook 时返回空列表", async () => {
    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    const status = engine.getStatus();
    expect(status.totalLoaded).toBe(0);
    expect(status.loadedHooks).toHaveLength(0);
  });

  it("stop: 清空已加载的 hook", async () => {
    writeFileSync(join(tempDir, "valid.ts"), VALID_HOOK_CONTENT);

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();
    expect(engine.size).toBe(1);

    engine.stop();
    expect(engine.size).toBe(0);
  });

  it("size: 反映当前加载的 hook 数量", async () => {
    writeFileSync(join(tempDir, "hook-a.ts"), VALID_HOOK_CONTENT);
    writeFileSync(join(tempDir, "hook-b.ts"), makeHighPriorityHook(20, "issue.assigned"));

    engine = new HookEngine({
      hooksDir: tempDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });
    await engine.start();

    expect(engine.size).toBe(2);
  });

  it("start: hooks 目录不存在时 watch 抛出 ENOENT", async () => {
    const nonExistentDir = join(tempDir, "does-not-exist");

    engine = new HookEngine({
      hooksDir: nonExistentDir,
      defaultTimeoutMs: 30_000,
      multiMatch: false,
    });

    // watch() 对不存在的目录会抛出 ENOENT
    await expect(engine.start()).rejects.toThrow();
    expect(engine.size).toBe(0);
  });
});
