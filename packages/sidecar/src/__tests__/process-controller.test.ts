import type { Logger } from "@teamsland/observability";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessController } from "../process-controller.js";

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

function makeNdjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const text = lines.map((l) => `${l}\n`).join("");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProcessController", () => {
  it("spawn: 向 stdin 写入 JSON 信封后关闭", async () => {
    const writtenData: string[] = [];
    const fakeProc = {
      pid: 12345,
      stdin: {
        write: (data: string) => writtenData.push(data),
        end: vi.fn(),
      },
      stdout: makeNdjsonStream([JSON.stringify({ type: "system", session_id: "sess-abc" })]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    const result = await controller.spawn({
      issueId: "42",
      worktreePath: "/tmp",
      initialPrompt: "hello",
    });

    expect(result.pid).toBe(12345);
    expect(result.sessionId).toBe("sess-abc");
    expect(fakeProc.stdin.end).toHaveBeenCalledOnce();
    expect(JSON.parse(writtenData[0])).toMatchObject({ prompt: "hello" });
  });

  it("spawn: 返回的 stdout 是 ReadableStream", async () => {
    const fakeProc = {
      pid: 99,
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: makeNdjsonStream([JSON.stringify({ type: "system", session_id: "sess-xyz" })]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    const result = await controller.spawn({
      issueId: "99",
      worktreePath: "/tmp",
      initialPrompt: "test",
    });

    expect(result.stdout).toBeInstanceOf(ReadableStream);
  });

  it("interrupt: hard=false 发送 SIGINT", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    controller.interrupt(9999);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGINT");
  });

  it("interrupt: hard=true 发送 SIGKILL", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    controller.interrupt(9999, true);
    expect(killSpy).toHaveBeenCalledWith(9999, "SIGKILL");
  });

  it("isAlive: 进程存在时返回 true", () => {
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const controller = new ProcessController({ logger: fakeLogger });
    expect(controller.isAlive(12345)).toBe(true);
  });

  it("isAlive: 进程不存在时返回 false", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const controller = new ProcessController({ logger: fakeLogger });
    expect(controller.isAlive(99999)).toBe(false);
  });
});
