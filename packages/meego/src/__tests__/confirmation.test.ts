import type { ConfirmationConfig } from "@teamsland/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmationWatcher } from "../confirmation.js";

const makeConfig = (): ConfirmationConfig => ({
  reminderIntervalMin: 1,
  maxReminders: 2,
  pollIntervalMs: 100,
});

describe("ConfirmationWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fetchConfirmationStatus 首次返回 approved 时立即返回 approved，不发送提醒", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("approved");

    const result = await watcher.watch("task-001", "user_001");
    expect(result).toBe("approved");
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("fetchConfirmationStatus 首次返回 rejected 时立即返回 rejected", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("rejected");

    const result = await watcher.watch("task-002", "user_002");
    expect(result).toBe("rejected");
    expect(sendDm).not.toHaveBeenCalled();
  });

  it("达到 maxReminders 次提醒后仍为 pending 时返回 timeout", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("pending");

    const watchPromise = watcher.watch("task-003", "user_003");
    await vi.runAllTimersAsync();
    const result = await watchPromise;
    expect(result).toBe("timeout");
    expect(sendDm).toHaveBeenCalledTimes(2); // maxReminders=2
  });

  it("提醒消息包含任务 ID 和提醒次数", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const watcher = new ConfirmationWatcher({ notifier, config: makeConfig() });

    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockResolvedValue("pending");

    const watchPromise = watcher.watch("task-004", "user_004");
    await vi.runAllTimersAsync();
    await watchPromise;

    // 第一次提醒应包含任务 ID
    const firstCall = sendDm.mock.calls[0];
    expect(firstCall[0]).toBe("user_004");
    expect(firstCall[1]).toContain("task-004");
    expect(firstCall[1]).toContain("1");
  });

  it("在第 2 次提醒后 poll 到 approved 时正常返回 approved", async () => {
    const sendDm = vi.fn().mockResolvedValue(undefined);
    const notifier = { sendDm } as never;
    const config: ConfirmationConfig = {
      reminderIntervalMin: 1,
      maxReminders: 3, // 3 次提醒机会
      pollIntervalMs: 100,
    };
    const watcher = new ConfirmationWatcher({ notifier, config });

    // pending → pending → ... → approved（在若干 poll 后）
    let callCount = 0;
    vi.spyOn(watcher as never, "fetchConfirmationStatus").mockImplementation(async () => {
      callCount++;
      // pollsPerReminder = ceil(1 * 60 * 1000 / 100) = 600
      // 在第 601 次 poll（第 1 次提醒后第 1 次 poll）返回 approved
      if (callCount > 601) return "approved";
      return "pending";
    });

    const watchPromise = watcher.watch("task-005", "user_005");
    await vi.runAllTimersAsync();
    const result = await watchPromise;
    expect(result).toBe("approved");
    expect(sendDm).toHaveBeenCalledTimes(1); // 只发了 1 次提醒
  });
});
