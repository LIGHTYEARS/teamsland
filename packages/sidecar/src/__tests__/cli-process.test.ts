import { describe, expect, it, vi } from "vitest";

vi.mock("@teamsland/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { CliProcess, type CliProcessOpts } from "../cli-process.js";

function createMockSpawn(): CliProcessOpts["spawnFn"] {
  return vi.fn().mockImplementation((_args: string[], _opts: unknown) => {
    const stdin = {
      write: vi.fn(),
      flush: vi.fn(),
      end: vi.fn(),
    };
    const initLine = JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "test-session-001",
    });
    const resultLine = JSON.stringify({
      type: "result",
      subtype: "success",
      result: "test output",
      session_id: "test-session-001",
      duration_ms: 100,
      num_turns: 1,
    });
    // Use pull-based stream to ensure data is delivered when read() is called
    const stdout = new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode(`${initLine}\n${resultLine}\n`));
        controller.close();
      },
    });
    const stderr = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    // Resolve exited well after stream data has been consumed
    let resolveExited!: (code: number) => void;
    const exitedPromise = new Promise<number>((resolve) => {
      resolveExited = resolve;
    });
    setTimeout(() => resolveExited(0), 200);
    return {
      pid: 12345,
      stdin,
      stdout,
      stderr,
      exited: exitedPromise,
      killed: false,
      kill: vi.fn(),
    };
  });
}

describe("CliProcess", () => {
  it("sendMessage: 写入 stream-json 格式并等待 result 事件", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "test-session-001",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    const result = await cli.sendMessage("say hello");
    expect(result.type).toBe("result");
    expect(result.result).toBe("test output");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("sendMessage: 超时抛出错误", async () => {
    const spawnFn = vi.fn().mockImplementation(() => {
      const stdin = { write: vi.fn(), flush: vi.fn(), end: vi.fn() };
      const stdout = new ReadableStream({
        start() {
          /* never close */
        },
      });
      const stderr = new ReadableStream({
        start(c) {
          c.close();
        },
      });
      return {
        pid: 12345,
        stdin,
        stdout,
        stderr,
        exited: new Promise<number>(() => {}),
        killed: false,
        kill: vi.fn(),
      };
    });
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
      resultTimeoutMs: 100,
    });
    await cli.start();
    await expect(cli.sendMessage("hello")).rejects.toThrow("timeout");
  });

  it("isAlive: 进程退出后返回 false", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    await cli.sendMessage("hello");
    await vi.waitFor(() => expect(cli.isAlive()).toBe(false));
  });

  it("terminate: 关闭 stdin 并等待进程退出", async () => {
    const spawnFn = createMockSpawn();
    const cli = new CliProcess({
      sessionId: "s-1",
      args: ["--bare"],
      spawnFn,
    });
    await cli.start();
    await cli.terminate();
    expect(cli.isAlive()).toBe(false);
  });
});
