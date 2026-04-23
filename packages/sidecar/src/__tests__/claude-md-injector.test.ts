import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaudeMdContext } from "../claude-md-injector.js";
import { ClaudeMdInjector } from "../claude-md-injector.js";

function makeContext(overrides?: Partial<ClaudeMdContext>): ClaudeMdContext {
  return {
    workerId: "worker-01",
    taskType: "bugfix",
    requester: "张三",
    issueId: "BUG-1234",
    chatId: "oc_abc123",
    messageId: "om_def456",
    taskPrompt: "修复登录页面的 CSRF 漏洞",
    meegoApiBase: "https://meego.example.com",
    meegoPluginToken: "token_xxx",
    ...overrides,
  };
}

describe("ClaudeMdInjector", () => {
  let tempDir: string;
  const injector = new ClaudeMdInjector();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "claude-md-injector-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("inject() 在 CLAUDE.md 不存在时创建文件", async () => {
    const ctx = makeContext();
    await injector.inject(tempDir, ctx);

    const file = Bun.file(join(tempDir, "CLAUDE.md"));
    expect(await file.exists()).toBe(true);

    const content = await file.text();
    expect(content).toContain("<!-- teamsland-task-context: DO NOT EDIT BELOW -->");
    expect(content).toContain("## teamsland 任务上下文");
  });

  it("inject() 追加到已有 CLAUDE.md 而不覆盖原内容", async () => {
    const originalContent = "# My Project\n\nSome existing docs.\n";
    await Bun.write(join(tempDir, "CLAUDE.md"), originalContent);

    await injector.inject(tempDir, makeContext());

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content.startsWith("# My Project\n\nSome existing docs.\n")).toBe(true);
    expect(content).toContain("<!-- teamsland-task-context: DO NOT EDIT BELOW -->");
    expect(content).toContain("## teamsland 任务上下文");
  });

  it("inject() 替换已有注入块（幂等操作）", async () => {
    const originalContent = "# My Project\n";
    await Bun.write(join(tempDir, "CLAUDE.md"), originalContent);

    // 第一次注入
    await injector.inject(tempDir, makeContext({ workerId: "worker-01" }));
    // 第二次注入（不同参数）
    await injector.inject(tempDir, makeContext({ workerId: "worker-02" }));

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    // 旧 worker ID 不应存在
    expect(content).not.toContain("worker-01");
    // 新 worker ID 应存在
    expect(content).toContain("worker-02");
    // 原始内容保留
    expect(content.startsWith("# My Project\n")).toBe(true);
    // MARKER 只出现一次
    const markerCount = content.split("<!-- teamsland-task-context: DO NOT EDIT BELOW -->").length - 1;
    expect(markerCount).toBe(1);
  });

  it("cleanup() 移除注入块", async () => {
    const originalContent = "# My Project\n\nSome docs.\n";
    await Bun.write(join(tempDir, "CLAUDE.md"), originalContent);

    await injector.inject(tempDir, makeContext());
    await injector.cleanup(tempDir);

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).not.toContain("<!-- teamsland-task-context: DO NOT EDIT BELOW -->");
    expect(content).not.toContain("## teamsland 任务上下文");
  });

  it("cleanup() 在无 MARKER 时不做修改", async () => {
    const originalContent = "# My Project\n\nNo injected block here.\n";
    await Bun.write(join(tempDir, "CLAUDE.md"), originalContent);

    await injector.cleanup(tempDir);

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).toBe(originalContent);
  });

  it("cleanup() 保留 MARKER 之上的内容", async () => {
    const originalContent = "# My Project\n\n## Section A\n\nImportant content.\n";
    await Bun.write(join(tempDir, "CLAUDE.md"), originalContent);

    await injector.inject(tempDir, makeContext());
    await injector.cleanup(tempDir);

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).toBe("# My Project\n\n## Section A\n\nImportant content.\n");
  });

  it("所有上下文字段均出现在注入块中", async () => {
    const ctx = makeContext({
      workerId: "wk-unique-id",
      taskType: "code-review",
      requester: "李四",
      issueId: "CR-9999",
      chatId: "oc_chat_id",
      messageId: "om_msg_id",
      taskPrompt: "请审查这段代码的安全性",
      meegoApiBase: "https://meego.test.com",
      meegoPluginToken: "plugin_token_abc",
    });
    await injector.inject(tempDir, ctx);

    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).toContain("wk-unique-id");
    expect(content).toContain("code-review");
    expect(content).toContain("李四");
    expect(content).toContain("CR-9999");
    expect(content).toContain("oc_chat_id");
    expect(content).toContain("om_msg_id");
    expect(content).toContain("请审查这段代码的安全性");
    expect(content).toContain("https://meego.test.com");
    expect(content).toContain("plugin_token_abc");
    // 环境变量部分
    expect(content).toContain("WORKER_ID=wk-unique-id");
    expect(content).toContain("MEEGO_API_BASE=https://meego.test.com");
    expect(content).toContain("MEEGO_PLUGIN_TOKEN=plugin_token_abc");
  });
});
