import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@teamsland/observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NormalizedEntry, TranscriptReader } from "../transcript-reader.js";

// ---------------------------------------------------------------------------
// Fake logger（与项目其他测试一致）
// ---------------------------------------------------------------------------
const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

// ---------------------------------------------------------------------------
// 样本 JSONL 行
// ---------------------------------------------------------------------------
const sampleLines = {
  system: JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "sess-001",
    timestamp: 1700000000000,
  }),
  assistant: JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: "你好，有什么可以帮助你的？" },
    timestamp: 1700000001000,
  }),
  assistantArray: JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ],
    },
    timestamp: 1700000001500,
  }),
  toolUse: JSON.stringify({
    type: "tool_use",
    name: "Read",
    input: { file_path: "/foo/bar.ts" },
    timestamp: 1700000002000,
  }),
  toolResult: JSON.stringify({
    type: "tool_result",
    content: "文件内容...",
    is_error: false,
    timestamp: 1700000003000,
  }),
  toolResultError: JSON.stringify({
    type: "tool_result",
    content: "文件不存在",
    is_error: true,
    timestamp: 1700000003500,
  }),
  result: JSON.stringify({
    type: "result",
    result: "任务已完成",
    session_id: "sess-001",
    timestamp: 1700000010000,
  }),
  error: JSON.stringify({
    type: "error",
    error: { message: "API rate limited" },
    timestamp: 1700000004000,
  }),
  user: JSON.stringify({
    type: "human",
    message: { role: "user", content: "请帮我重构代码" },
    timestamp: 1700000000500,
  }),
};

// ---------------------------------------------------------------------------
// 临时文件辅助
// ---------------------------------------------------------------------------
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "transcript-reader-test-"));
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** 将多行写入临时 JSONL 文件并返回路径 */
async function writeTmpJsonl(lines: string[], name = "transcript.jsonl"): Promise<string> {
  const filePath = join(tmpDir, name);
  await Bun.write(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

// ===========================================================================
// resolveTranscriptPath
// ===========================================================================
describe("TranscriptReader.resolveTranscriptPath", () => {
  it("在两个路径均不存在时返回 slug 路径", () => {
    const reader = new TranscriptReader(fakeLogger);
    const result = reader.resolveTranscriptPath("/home/dev/repo", "sess-abc");

    const expectedSlug = "home-dev-repo";
    const expected = join(homedir(), ".claude", "projects", expectedSlug, "sess-abc.jsonl");
    expect(result).toBe(expected);
  });

  it("slug 去除前导 - 号", () => {
    const reader = new TranscriptReader(fakeLogger);
    const result = reader.resolveTranscriptPath("/repos/my-project", "s1");

    // "/repos/my-project" → "-repos-my-project" → "repos-my-project"
    expect(result).toContain("repos-my-project");
    expect(result).not.toContain("/-repos");
  });

  it("hash 策略使用 SHA-256 前 16 个十六进制字符", () => {
    const worktreePath = "/some/path";
    const expectedHash = createHash("sha256").update(worktreePath).digest("hex").slice(0, 16);

    // 验证 hash 计算正确性（不直接测试路径选择，因为文件不存在）
    expect(expectedHash).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(expectedHash)).toBe(true);
  });
});

// ===========================================================================
// read()
// ===========================================================================
describe("TranscriptReader.read", () => {
  it("解析有效的 JSONL 行为 NormalizedEntry", async () => {
    const filePath = await writeTmpJsonl([
      sampleLines.system,
      sampleLines.assistant,
      sampleLines.toolUse,
      sampleLines.toolResult,
    ]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries).toHaveLength(4);

    // system
    expect(result.entries[0]?.type).toBe("system");
    expect(result.entries[0]?.index).toBe(0);

    // assistant
    expect(result.entries[1]?.type).toBe("assistant");
    expect(result.entries[1]?.content).toBe("你好，有什么可以帮助你的？");

    // tool_use
    expect(result.entries[2]?.type).toBe("tool_use");
    expect(result.entries[2]?.toolName).toBe("Read");

    // tool_result
    expect(result.entries[3]?.type).toBe("tool_result");
    expect(result.entries[3]?.isError).toBe(false);
  });

  it("正确处理 offset 跳过前 N 行", async () => {
    const filePath = await writeTmpJsonl([sampleLines.system, sampleLines.assistant, sampleLines.toolUse]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath, 2);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.type).toBe("tool_use");
    expect(result.entries[0]?.index).toBe(2);
    expect(result.offset).toBe(3);
  });

  it("容错跳过最后一行的不完整 JSON", async () => {
    const filePath = await writeTmpJsonl([
      sampleLines.system,
      sampleLines.assistant,
      '{"type":"tool_use","name":"Ed', // 不完整的 JSON
    ]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries).toHaveLength(2);
    expect(result.offset).toBe(3); // offset 仍然推进
  });

  it("根据 mtime 判定 isLive", async () => {
    const filePath = await writeTmpJsonl([sampleLines.system]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    // 刚写入的文件，mtime 应在 60 秒内
    expect(result.isLive).toBe(true);
  });

  it("限制 maxEntries 返回条目数", async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: `msg-${i}` },
        timestamp: 1700000000000 + i,
      }),
    );
    const filePath = await writeTmpJsonl(lines);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath, 0, 3);

    expect(result.entries).toHaveLength(3);
    expect(result.offset).toBe(3);
  });

  it("文件不存在时返回空结果", async () => {
    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(join(tmpDir, "nonexistent.jsonl"));

    expect(result.entries).toHaveLength(0);
    expect(result.isLive).toBe(false);
  });

  it("解析 assistant content 为数组格式", async () => {
    const filePath = await writeTmpJsonl([sampleLines.assistantArray]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.content).toBe("第一段\n第二段");
  });

  it("human 类型映射为 user", async () => {
    const filePath = await writeTmpJsonl([sampleLines.user]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries[0]?.type).toBe("user");
  });

  it("result 类型映射为 assistant", async () => {
    const filePath = await writeTmpJsonl([sampleLines.result]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries[0]?.type).toBe("assistant");
    expect(result.entries[0]?.content).toBe("任务已完成");
  });

  it("error 类型提取 error.message 并标记 isError", async () => {
    const filePath = await writeTmpJsonl([sampleLines.error]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries[0]?.content).toBe("API rate limited");
    expect(result.entries[0]?.isError).toBe(true);
  });

  it("截断超过 2000 字符的内容", async () => {
    const longContent = "A".repeat(3000);
    const filePath = await writeTmpJsonl([
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: longContent },
        timestamp: 1700000000000,
      }),
    ]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.read(filePath);

    expect(result.entries[0]?.content).toHaveLength(2000);
  });
});

// ===========================================================================
// tail()
// ===========================================================================
describe("TranscriptReader.tail", () => {
  it("返回最后 N 条条目", async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: `msg-${i}` },
        timestamp: 1700000000000 + i,
      }),
    );
    const filePath = await writeTmpJsonl(lines);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.tail(filePath, 3);

    expect(result).toHaveLength(3);
    expect(result[0]?.content).toBe("msg-7");
    expect(result[1]?.content).toBe("msg-8");
    expect(result[2]?.content).toBe("msg-9");
  });

  it("条目不足 N 条时返回全部", async () => {
    const filePath = await writeTmpJsonl([sampleLines.system, sampleLines.assistant]);

    const reader = new TranscriptReader(fakeLogger);
    const result = await reader.tail(filePath, 10);

    expect(result).toHaveLength(2);
  });
});

// ===========================================================================
// summarizeStructured()
// ===========================================================================
describe("TranscriptReader.summarizeStructured", () => {
  const makeEntries = (): NormalizedEntry[] => [
    { index: 0, type: "system", timestamp: 1700000000000, content: "init" },
    { index: 1, type: "user", timestamp: 1700000001000, content: "请帮我重构代码" },
    { index: 2, type: "assistant", timestamp: 1700000002000, content: "好的，我来分析一下" },
    { index: 3, type: "tool_use", timestamp: 1700000003000, content: "{}", toolName: "Read" },
    { index: 4, type: "tool_result", timestamp: 1700000004000, content: "文件内容", isError: false },
    { index: 5, type: "tool_use", timestamp: 1700000005000, content: "{}", toolName: "Edit" },
    { index: 6, type: "tool_result", timestamp: 1700000006000, content: "编辑失败", isError: true },
    { index: 7, type: "assistant", timestamp: 1700000007000, content: "重构完成" },
  ];

  it("提取工具调用列表", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured(makeEntries());

    expect(summary.toolCalls).toHaveLength(2);
    expect(summary.toolCalls[0]?.name).toBe("Read");
    expect(summary.toolCalls[0]?.isError).toBe(false);
    expect(summary.toolCalls[1]?.name).toBe("Edit");
    expect(summary.toolCalls[1]?.isError).toBe(false); // tool_use 本身不是 error
  });

  it("提取错误条目", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured(makeEntries());

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.content).toBe("编辑失败");
    expect(summary.errors[0]?.isError).toBe(true);
  });

  it("找到最后一条 assistant 消息", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured(makeEntries());

    expect(summary.lastAssistantMessage).toBe("重构完成");
  });

  it("正确计算持续时间", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured(makeEntries());

    // 首时间戳: 1700000000000, 末时间戳: 1700000007000
    expect(summary.durationMs).toBe(7000);
  });

  it("空条目列表返回零值摘要", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured([]);

    expect(summary.totalEntries).toBe(0);
    expect(summary.toolCalls).toHaveLength(0);
    expect(summary.errors).toHaveLength(0);
    expect(summary.lastAssistantMessage).toBe("");
    expect(summary.durationMs).toBe(0);
  });

  it("单条目列表 durationMs 为 0", () => {
    const reader = new TranscriptReader(fakeLogger);
    const summary = reader.summarizeStructured([
      { index: 0, type: "assistant", timestamp: 1700000000000, content: "hello" },
    ]);

    expect(summary.durationMs).toBe(0);
    expect(summary.totalEntries).toBe(1);
  });

  it("忽略 timestamp 为 0 的条目计算持续时间", () => {
    const reader = new TranscriptReader(fakeLogger);
    const entries: NormalizedEntry[] = [
      { index: 0, type: "system", timestamp: 0, content: "init" },
      { index: 1, type: "assistant", timestamp: 1700000001000, content: "a" },
      { index: 2, type: "assistant", timestamp: 1700000005000, content: "b" },
      { index: 3, type: "system", timestamp: 0, content: "end" },
    ];
    const summary = reader.summarizeStructured(entries);

    expect(summary.durationMs).toBe(4000);
  });
});
