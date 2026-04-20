# @teamsland/lark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/lark` package — a `lark-cli` wrapper (`LarkCli`) and a high-level `LarkNotifier` for sending interactive cards to the team channel.

**Architecture:** `LarkCli` spawns the external `lark-cli` binary via an injected `CommandRunner` interface, passing credentials as environment variables. `LarkNotifier` wraps `LarkCli.sendInteractiveCard` with a simple `sendCard(title, content, level?)` API bound to a configured team channel. The `CommandRunner` abstraction enables full unit testing without a real `lark-cli` binary.

**Tech Stack:** TypeScript (strict), Bun (runtime), Vitest (testing under Node.js with mock CommandRunner), Biome (lint/format)

---

## Context

The `@teamsland/lark` package scaffold exists with an empty `export {}`. Its `package.json` already has a dependency on `@teamsland/types` (for `LarkConfig`, `LarkNotificationConfig`). The tsconfig references `../types`. No additional npm dependencies are needed — all interaction is via shelling out to `lark-cli`.

The spec is at `docs/superpowers/specs/2026-04-20-teamsland-lark-design.md`.

## Critical Files

- **Create:** `packages/lark/src/command-runner.ts` (CommandRunner interface + BunCommandRunner)
- **Create:** `packages/lark/src/types.ts` (LarkMessage, LarkContact, LarkGroup, LarkCard DTOs)
- **Create:** `packages/lark/src/lark-cli.ts` (LarkCli class + LarkCliError)
- **Create:** `packages/lark/src/notifier.ts` (LarkNotifier class)
- **Modify:** `packages/lark/src/index.ts` (barrel exports)
- **Create:** `packages/lark/src/__tests__/lark-cli.test.ts`
- **Create:** `packages/lark/src/__tests__/notifier.test.ts`

## Conventions

- All `import` of types: `import type { X } from "..."`
- JSDoc: Chinese, every exported function/class/interface must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useExportType`, `useImportType`, `noExplicitAny`
- 2-space indent
- Vitest for tests — inject mock `CommandRunner`, no real `lark-cli` needed
- Biome barrel sorting: `export type` before `export` from same module, alphabetical by module path

---

### Task 1: Create command-runner.ts — CommandRunner Interface + BunCommandRunner

**Files:**
- Create: `packages/lark/src/command-runner.ts`

- [ ] **Step 1: Create command-runner.ts**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/command-runner.ts`:

```typescript
/**
 * 命令执行结果
 *
 * @example
 * ```typescript
 * import type { CommandResult } from "@teamsland/lark";
 *
 * const result: CommandResult = { exitCode: 0, stdout: "ok", stderr: "" };
 * ```
 */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 命令运行器接口，用于抽象子进程调用
 *
 * 通过依赖注入实现测试时替换为 mock 实现
 *
 * @example
 * ```typescript
 * import type { CommandRunner } from "@teamsland/lark";
 *
 * const mockRunner: CommandRunner = {
 *   run: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
 * };
 * ```
 */
export interface CommandRunner {
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult>;
}

/**
 * 基于 Bun.spawn 的命令运行器实现
 *
 * 生产环境使用，通过 Bun.spawn 执行外部命令
 *
 * @example
 * ```typescript
 * import { BunCommandRunner } from "@teamsland/lark";
 *
 * const runner = new BunCommandRunner();
 * const result = await runner.run(["echo", "hello"]);
 * console.log(result.stdout); // "hello\n"
 * ```
 */
export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<CommandResult> {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...opts?.env },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/command-runner.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write packages/lark/src/command-runner.ts` and re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/lark/src/command-runner.ts && git commit -m "feat(lark): add CommandRunner interface and BunCommandRunner implementation"
```

---

### Task 2: Create types.ts — DTO Types

**Files:**
- Create: `packages/lark/src/types.ts`

- [ ] **Step 1: Create types.ts**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/types.ts`:

```typescript
/**
 * 飞书消息数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkMessage } from "@teamsland/lark";
 *
 * const msg: LarkMessage = {
 *   messageId: "om_abc123",
 *   sender: "ou_user001",
 *   content: "你好",
 *   timestamp: 1713600000000,
 * };
 * ```
 */
export interface LarkMessage {
  messageId: string;
  sender: string;
  content: string;
  timestamp: number;
}

/**
 * 飞书联系人数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkContact } from "@teamsland/lark";
 *
 * const contact: LarkContact = {
 *   userId: "ou_user001",
 *   name: "张三",
 *   department: "工程部",
 * };
 * ```
 */
export interface LarkContact {
  userId: string;
  name: string;
  department: string;
}

/**
 * 飞书群组数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkGroup } from "@teamsland/lark";
 *
 * const group: LarkGroup = {
 *   chatId: "oc_chat001",
 *   name: "前端团队",
 *   description: "前端开发讨论群",
 * };
 * ```
 */
export interface LarkGroup {
  chatId: string;
  name: string;
  description: string;
}

/**
 * 飞书互动卡片数据传输对象
 *
 * @example
 * ```typescript
 * import type { LarkCard } from "@teamsland/lark";
 *
 * const card: LarkCard = {
 *   title: "部署通知",
 *   content: "v1.2.0 已发布到生产环境",
 *   level: "info",
 * };
 * ```
 */
export interface LarkCard {
  title: string;
  content: string;
  level: "info" | "warning" | "error";
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/types.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/lark/src/types.ts && git commit -m "feat(lark): add DTO types — LarkMessage, LarkContact, LarkGroup, LarkCard"
```

---

### Task 3: Create lark-cli.ts — LarkCli Class + LarkCliError (TDD)

**Files:**
- Create: `packages/lark/src/__tests__/lark-cli.test.ts`
- Create: `packages/lark/src/lark-cli.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Create the __tests__ directory**

Run: `mkdir -p /Users/bytedance/workspace/teamsland/packages/lark/src/__tests__`

- [ ] **Step 2: Write lark-cli.test.ts**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/__tests__/lark-cli.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult, CommandRunner } from "../command-runner.js";
import { LarkCli, LarkCliError } from "../lark-cli.js";

function createMockRunner(result: CommandResult): CommandRunner {
  return {
    run: vi.fn().mockResolvedValue(result),
  };
}

const testConfig = {
  appId: "cli_test_app_id",
  appSecret: "test_secret_value",
  bot: { historyContextCount: 10 },
  notification: { teamChannelId: "oc_team_channel" },
};

describe("LarkCli", () => {
  describe("sendDm", () => {
    it("构造正确的 lark-cli 命令发送私聊消息", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendDm("ou_user001", "你好");

      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "send-message", "--chat-type", "p2p", "--receiver-id", "ou_user001", "--content", "你好"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("sendGroupMessage", () => {
    it("构造正确的群消息命令", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendGroupMessage("oc_chat001", "测试消息");

      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "send-message", "--chat-id", "oc_chat001", "--content", "测试消息"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });

    it("带 replyToMessageId 时附加 --reply-to 参数", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendGroupMessage("oc_chat001", "回复内容", { replyToMessageId: "om_msg123" });

      expect(runner.run).toHaveBeenCalledWith(
        [
          "lark-cli", "im", "send-message", "--chat-id", "oc_chat001",
          "--content", "回复内容", "--reply-to", "om_msg123",
        ],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("sendInteractiveCard", () => {
    it("将 LarkCard 序列化为 JSON 并发送", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendInteractiveCard("oc_chat001", { title: "标题", content: "内容", level: "warning" });

      const expectedJson = JSON.stringify({ title: "标题", content: "内容", level: "warning" });
      expect(runner.run).toHaveBeenCalledWith(
        [
          "lark-cli", "im", "send-message", "--chat-id", "oc_chat001",
          "--msg-type", "interactive", "--content", expectedJson,
        ],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("imHistory", () => {
    it("解析 stdout JSON 数组为 LarkMessage[]", async () => {
      const messages = [
        { messageId: "om_1", sender: "ou_a", content: "hello", timestamp: 1713600000000 },
        { messageId: "om_2", sender: "ou_b", content: "world", timestamp: 1713600001000 },
      ];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(messages), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.imHistory("oc_chat001");

      expect(result).toEqual(messages);
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "history", "--chat-id", "oc_chat001", "--count", "10"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });

    it("使用自定义 count 覆盖默认值", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "[]", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.imHistory("oc_chat001", 5);

      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "history", "--chat-id", "oc_chat001", "--count", "5"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("docRead", () => {
    it("返回 stdout 作为文档内容", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "# 文档标题\n\n正文内容", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const content = await cli.docRead("https://docs.feishu.cn/wiki/abc123");

      expect(content).toBe("# 文档标题\n\n正文内容");
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "doc", "read", "https://docs.feishu.cn/wiki/abc123"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("docCreate", () => {
    it("返回 stdout 中的文档 URL", async () => {
      const runner = createMockRunner({
        exitCode: 0,
        stdout: "https://docs.feishu.cn/wiki/new_doc_123",
        stderr: "",
      });
      const cli = new LarkCli(testConfig, runner);

      const url = await cli.docCreate("新文档", "文档内容");

      expect(url).toBe("https://docs.feishu.cn/wiki/new_doc_123");
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "doc", "create", "--title", "新文档", "--content", "文档内容"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("contactSearch", () => {
    it("解析 stdout JSON 数组为 LarkContact[]", async () => {
      const contacts = [{ userId: "ou_a", name: "张三", department: "工程部" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(contacts), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.contactSearch("张三", 5);

      expect(result).toEqual(contacts);
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "contact", "search", "--query", "张三", "--limit", "5"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("groupSearch", () => {
    it("解析 stdout JSON 数组为 LarkGroup[]", async () => {
      const groups = [{ chatId: "oc_g1", name: "前端", description: "前端群" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(groups), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.groupSearch("前端", 10);

      expect(result).toEqual(groups);
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "group", "search", "--query", "前端", "--limit", "10"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("groupListJoined", () => {
    it("无 filter 时不附加 --filter 参数", async () => {
      const groups = [{ chatId: "oc_g1", name: "团队群", description: "主群" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(groups), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.groupListJoined();

      expect(result).toEqual(groups);
      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "group", "list-joined"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });

    it("有 filter 时附加 --filter 参数", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "[]", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.groupListJoined("前端");

      expect(runner.run).toHaveBeenCalledWith(
        ["lark-cli", "im", "group", "list-joined", "--filter", "前端"],
        { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
      );
    });
  });

  describe("错误处理", () => {
    it("exitCode 127 时抛出 LarkCliError 并包含安装提示", async () => {
      const runner = createMockRunner({ exitCode: 127, stdout: "", stderr: "command not found" });
      const cli = new LarkCli(testConfig, runner);

      await expect(cli.sendDm("ou_user001", "test")).rejects.toThrow(LarkCliError);
      await expect(cli.sendDm("ou_user001", "test")).rejects.toThrow(/lark-cli.*not installed/i);
    });

    it("exitCode 非 0 时抛出 LarkCliError 包含 stderr", async () => {
      const runner = createMockRunner({ exitCode: 1, stdout: "", stderr: "authentication failed" });
      const cli = new LarkCli(testConfig, runner);

      try {
        await cli.sendDm("ou_user001", "test");
        expect.fail("应当抛出错误");
      } catch (err) {
        expect(err).toBeInstanceOf(LarkCliError);
        const cliErr = err as LarkCliError;
        expect(cliErr.exitCode).toBe(1);
        expect(cliErr.stderr).toBe("authentication failed");
        expect(cliErr.command).toContain("lark-cli");
      }
    });

    it("stdout JSON 解析失败时抛出 LarkCliError", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "not valid json", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await expect(cli.imHistory("oc_chat001")).rejects.toThrow(LarkCliError);
      await expect(cli.imHistory("oc_chat001")).rejects.toThrow(/parse|format/i);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/lark/src/__tests__/lark-cli.test.ts`
Expected: FAIL — cannot import `LarkCli` / `LarkCliError` from `../lark-cli.js`

- [ ] **Step 4: Create lark-cli.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/lark-cli.ts`:

```typescript
import type { LarkConfig } from "@teamsland/types";
import type { CommandRunner } from "./command-runner.js";
import type { LarkCard, LarkContact, LarkGroup, LarkMessage } from "./types.js";

/**
 * lark-cli 命令执行错误
 *
 * 当 lark-cli 命令执行失败时抛出，包含命令、退出码和标准错误输出
 *
 * @example
 * ```typescript
 * import { LarkCliError } from "@teamsland/lark";
 *
 * try {
 *   await cli.sendDm("ou_user001", "hello");
 * } catch (err) {
 *   if (err instanceof LarkCliError) {
 *     console.error(`命令失败: ${err.command.join(" ")}, 退出码: ${err.exitCode}`);
 *   }
 * }
 * ```
 */
export class LarkCliError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "LarkCliError";
  }
}

/**
 * 飞书 lark-cli 命令行工具封装
 *
 * 通过注入 CommandRunner 调用外部 lark-cli 二进制文件，
 * 提供消息发送、文档操作、联系人和群组查询等功能
 *
 * @example
 * ```typescript
 * import { BunCommandRunner, LarkCli } from "@teamsland/lark";
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const config: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret_xxx",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "oc_xxx" },
 * };
 * const cli = new LarkCli(config, new BunCommandRunner());
 * await cli.sendDm("ou_user001", "你好");
 * ```
 */
export class LarkCli {
  private readonly env: Record<string, string>;
  private readonly historyContextCount: number;

  constructor(
    config: LarkConfig,
    private readonly runner: CommandRunner,
  ) {
    this.env = {
      LARK_APP_ID: config.appId,
      LARK_APP_SECRET: config.appSecret,
    };
    this.historyContextCount = config.bot.historyContextCount;
  }

  /**
   * 发送私聊消息
   *
   * @param userId - 接收人的用户 ID
   * @param text - 消息文本内容
   *
   * @example
   * ```typescript
   * await cli.sendDm("ou_user001", "你好，这是一条私聊消息");
   * ```
   */
  async sendDm(userId: string, text: string): Promise<void> {
    const cmd = ["lark-cli", "im", "send-message", "--chat-type", "p2p", "--receiver-id", userId, "--content", text];
    await this.exec(cmd);
  }

  /**
   * 发送群消息
   *
   * @param chatId - 群聊 ID
   * @param content - 消息内容
   * @param opts - 可选参数，支持回复指定消息
   *
   * @example
   * ```typescript
   * await cli.sendGroupMessage("oc_chat001", "大家好");
   * await cli.sendGroupMessage("oc_chat001", "收到", { replyToMessageId: "om_msg123" });
   * ```
   */
  async sendGroupMessage(chatId: string, content: string, opts?: { replyToMessageId?: string }): Promise<void> {
    const cmd = ["lark-cli", "im", "send-message", "--chat-id", chatId, "--content", content];
    if (opts?.replyToMessageId) {
      cmd.push("--reply-to", opts.replyToMessageId);
    }
    await this.exec(cmd);
  }

  /**
   * 发送互动卡片消息
   *
   * @param chatId - 群聊 ID
   * @param card - 卡片数据对象
   *
   * @example
   * ```typescript
   * await cli.sendInteractiveCard("oc_chat001", {
   *   title: "部署通知",
   *   content: "v1.0.0 已上线",
   *   level: "info",
   * });
   * ```
   */
  async sendInteractiveCard(chatId: string, card: LarkCard): Promise<void> {
    const cmd = [
      "lark-cli", "im", "send-message", "--chat-id", chatId,
      "--msg-type", "interactive", "--content", JSON.stringify(card),
    ];
    await this.exec(cmd);
  }

  /**
   * 获取群聊历史消息
   *
   * @param chatId - 群聊 ID
   * @param count - 获取条数，默认使用配置中的 historyContextCount
   * @returns 消息数组
   *
   * @example
   * ```typescript
   * const messages = await cli.imHistory("oc_chat001", 20);
   * for (const msg of messages) {
   *   console.log(`${msg.sender}: ${msg.content}`);
   * }
   * ```
   */
  async imHistory(chatId: string, count?: number): Promise<LarkMessage[]> {
    const effectiveCount = count ?? this.historyContextCount;
    const cmd = ["lark-cli", "im", "history", "--chat-id", chatId, "--count", String(effectiveCount)];
    const result = await this.exec(cmd);
    return this.parseJson<LarkMessage[]>(result.stdout, cmd);
  }

  /**
   * 读取飞书文档内容
   *
   * @param url - 文档 URL
   * @returns 文档内容字符串
   *
   * @example
   * ```typescript
   * const content = await cli.docRead("https://docs.feishu.cn/wiki/abc123");
   * console.log(content);
   * ```
   */
  async docRead(url: string): Promise<string> {
    const cmd = ["lark-cli", "doc", "read", url];
    const result = await this.exec(cmd);
    return result.stdout;
  }

  /**
   * 创建飞书文档
   *
   * @param title - 文档标题
   * @param content - 文档内容
   * @returns 新文档的 URL
   *
   * @example
   * ```typescript
   * const url = await cli.docCreate("会议纪要", "# 2026-04-20 周会\n\n...");
   * console.log(`文档已创建: ${url}`);
   * ```
   */
  async docCreate(title: string, content: string): Promise<string> {
    const cmd = ["lark-cli", "doc", "create", "--title", title, "--content", content];
    const result = await this.exec(cmd);
    return result.stdout.trim();
  }

  /**
   * 搜索飞书联系人
   *
   * @param query - 搜索关键词
   * @param limit - 返回结果数量限制
   * @returns 联系人数组
   *
   * @example
   * ```typescript
   * const contacts = await cli.contactSearch("张三", 5);
   * for (const c of contacts) {
   *   console.log(`${c.name} (${c.department})`);
   * }
   * ```
   */
  async contactSearch(query: string, limit?: number): Promise<LarkContact[]> {
    const cmd = ["lark-cli", "contact", "search", "--query", query];
    if (limit !== undefined) {
      cmd.push("--limit", String(limit));
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkContact[]>(result.stdout, cmd);
  }

  /**
   * 搜索飞书群组
   *
   * @param query - 搜索关键词
   * @param limit - 返回结果数量限制
   * @returns 群组数组
   *
   * @example
   * ```typescript
   * const groups = await cli.groupSearch("前端", 10);
   * for (const g of groups) {
   *   console.log(`${g.name}: ${g.description}`);
   * }
   * ```
   */
  async groupSearch(query: string, limit?: number): Promise<LarkGroup[]> {
    const cmd = ["lark-cli", "im", "group", "search", "--query", query];
    if (limit !== undefined) {
      cmd.push("--limit", String(limit));
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkGroup[]>(result.stdout, cmd);
  }

  /**
   * 列出已加入的群组
   *
   * @param filter - 可选的过滤关键词
   * @returns 群组数组
   *
   * @example
   * ```typescript
   * const allGroups = await cli.groupListJoined();
   * const filtered = await cli.groupListJoined("前端");
   * ```
   */
  async groupListJoined(filter?: string): Promise<LarkGroup[]> {
    const cmd = ["lark-cli", "im", "group", "list-joined"];
    if (filter !== undefined) {
      cmd.push("--filter", filter);
    }
    const result = await this.exec(cmd);
    return this.parseJson<LarkGroup[]>(result.stdout, cmd);
  }

  private async exec(cmd: string[]): Promise<{ stdout: string; stderr: string }> {
    const result = await this.runner.run(cmd, { env: this.env });

    if (result.exitCode === 127) {
      throw new LarkCliError(
        "lark-cli is not installed. Please install it first: https://github.com/nicognaW/lark-cli",
        cmd,
        result.exitCode,
        result.stderr,
      );
    }

    if (result.exitCode !== 0) {
      throw new LarkCliError(
        `lark-cli command failed with exit code ${result.exitCode}: ${result.stderr}`,
        cmd,
        result.exitCode,
        result.stderr,
      );
    }

    return { stdout: result.stdout, stderr: result.stderr };
  }

  private parseJson<T>(stdout: string, cmd: string[]): T {
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new LarkCliError(
        `Failed to parse lark-cli output as JSON (format error): ${stdout.slice(0, 200)}`,
        cmd,
        0,
        "",
      );
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/lark/src/__tests__/lark-cli.test.ts`
Expected: All 14 tests pass

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 7: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/lark-cli.ts packages/lark/src/__tests__/lark-cli.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 8: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/lark/src/lark-cli.ts packages/lark/src/__tests__/lark-cli.test.ts && git commit -m "$(cat <<'EOF'
feat(lark): add LarkCli class wrapping lark-cli binary

TDD: 14 tests covering all CLI command mappings and error handling
EOF
)"
```

---

### Task 4: Create notifier.ts — LarkNotifier Class (TDD)

**Files:**
- Create: `packages/lark/src/__tests__/notifier.test.ts`
- Create: `packages/lark/src/notifier.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write notifier.test.ts**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/__tests__/notifier.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { CommandRunner } from "../command-runner.js";
import { LarkCli } from "../lark-cli.js";
import { LarkNotifier } from "../notifier.js";

function createMockRunner(): CommandRunner {
  return {
    run: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
  };
}

const testConfig = {
  appId: "cli_test_app_id",
  appSecret: "test_secret_value",
  bot: { historyContextCount: 10 },
  notification: { teamChannelId: "oc_team_channel_001" },
};

describe("LarkNotifier", () => {
  it("sendCard 使用默认 level info 发送卡片到团队频道", async () => {
    const runner = createMockRunner();
    const cli = new LarkCli(testConfig, runner);
    const notifier = new LarkNotifier(cli, testConfig.notification);

    await notifier.sendCard("部署完成", "v1.2.0 已发布");

    const expectedJson = JSON.stringify({ title: "部署完成", content: "v1.2.0 已发布", level: "info" });
    expect(runner.run).toHaveBeenCalledWith(
      [
        "lark-cli", "im", "send-message", "--chat-id", "oc_team_channel_001",
        "--msg-type", "interactive", "--content", expectedJson,
      ],
      { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
    );
  });

  it("sendCard 使用指定 level", async () => {
    const runner = createMockRunner();
    const cli = new LarkCli(testConfig, runner);
    const notifier = new LarkNotifier(cli, testConfig.notification);

    await notifier.sendCard("错误告警", "数据库连接失败", "error");

    const expectedJson = JSON.stringify({ title: "错误告警", content: "数据库连接失败", level: "error" });
    expect(runner.run).toHaveBeenCalledWith(
      [
        "lark-cli", "im", "send-message", "--chat-id", "oc_team_channel_001",
        "--msg-type", "interactive", "--content", expectedJson,
      ],
      { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
    );
  });

  it("sendCard 使用 warning level", async () => {
    const runner = createMockRunner();
    const cli = new LarkCli(testConfig, runner);
    const notifier = new LarkNotifier(cli, testConfig.notification);

    await notifier.sendCard("性能警告", "P99 延迟超过 500ms", "warning");

    const expectedJson = JSON.stringify({ title: "性能警告", content: "P99 延迟超过 500ms", level: "warning" });
    expect(runner.run).toHaveBeenCalledWith(
      [
        "lark-cli", "im", "send-message", "--chat-id", "oc_team_channel_001",
        "--msg-type", "interactive", "--content", expectedJson,
      ],
      { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/lark/src/__tests__/notifier.test.ts`
Expected: FAIL — cannot import `LarkNotifier` from `../notifier.js`

- [ ] **Step 3: Create notifier.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/lark/src/notifier.ts`:

```typescript
import type { LarkNotificationConfig } from "@teamsland/types";
import type { LarkCli } from "./lark-cli.js";
import type { LarkCard } from "./types.js";

/**
 * 飞书团队频道通知器
 *
 * 封装 LarkCli 的互动卡片发送能力，绑定到配置中的团队频道，
 * 提供简化的 sendCard API 用于发送不同级别的通知卡片
 *
 * @example
 * ```typescript
 * import { BunCommandRunner, LarkCli, LarkNotifier } from "@teamsland/lark";
 * import type { LarkConfig } from "@teamsland/types";
 *
 * const config: LarkConfig = {
 *   appId: "cli_xxx",
 *   appSecret: "secret_xxx",
 *   bot: { historyContextCount: 20 },
 *   notification: { teamChannelId: "oc_team" },
 * };
 * const cli = new LarkCli(config, new BunCommandRunner());
 * const notifier = new LarkNotifier(cli, config.notification);
 * await notifier.sendCard("部署完成", "v1.0.0 已上线", "info");
 * ```
 */
export class LarkNotifier {
  private readonly channelId: string;

  constructor(
    private readonly cli: LarkCli,
    notificationConfig: LarkNotificationConfig,
  ) {
    this.channelId = notificationConfig.teamChannelId;
  }

  /**
   * 发送互动卡片到团队频道
   *
   * @param title - 卡片标题
   * @param content - 卡片内容
   * @param level - 通知级别，默认 "info"
   *
   * @example
   * ```typescript
   * await notifier.sendCard("构建成功", "main 分支构建通过");
   * await notifier.sendCard("构建失败", "lint 检查未通过", "error");
   * ```
   */
  async sendCard(title: string, content: string, level?: "info" | "warning" | "error"): Promise<void> {
    const card: LarkCard = { title, content, level: level ?? "info" };
    await this.cli.sendInteractiveCard(this.channelId, card);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/lark/src/__tests__/notifier.test.ts`
Expected: All 3 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/notifier.ts packages/lark/src/__tests__/notifier.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/lark/src/notifier.ts packages/lark/src/__tests__/notifier.test.ts && git commit -m "$(cat <<'EOF'
feat(lark): add LarkNotifier for team channel card notifications

TDD: 3 tests verifying card construction with info/warning/error levels
EOF
)"
```

---

### Task 5: Update index.ts — Barrel Exports

**Files:**
- Modify: `packages/lark/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/lark/src/index.ts` with:

```typescript
// @teamsland/lark — lark-cli wrapper, LarkNotifier
// 通过 CommandRunner 抽象调用外部 lark-cli 二进制，提供消息、文档、群组操作

export type { CommandResult, CommandRunner } from "./command-runner.js";
export { BunCommandRunner } from "./command-runner.js";
export { LarkCli, LarkCliError } from "./lark-cli.js";
export { LarkNotifier } from "./notifier.js";
export type { LarkCard, LarkContact, LarkGroup, LarkMessage } from "./types.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/index.ts`
Expected: No errors. If Biome reports issues (e.g., export ordering), fix with `bunx biome check --write packages/lark/src/index.ts` and verify the result matches the expected sorting (type exports before value exports from same module, alphabetical by path).

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/lark/src/index.ts && git commit -m "feat(lark): add barrel exports — LarkCli, LarkNotifier, CommandRunner, DTO types"
```

---

### Task 6: Full Verification

- [ ] **Step 1: Run all lark tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/lark/`
Expected: All 17 tests pass (14 from lark-cli.test.ts + 3 from notifier.test.ts)

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/lark/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on entire package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/lark/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import { LarkCli, LarkCliError, LarkNotifier, BunCommandRunner } from './packages/lark/src/index.ts'; console.log('LarkCli:', typeof LarkCli); console.log('LarkCliError:', typeof LarkCliError); console.log('LarkNotifier:', typeof LarkNotifier); console.log('BunCommandRunner:', typeof BunCommandRunner);"`
Expected:
```
LarkCli: function
LarkCliError: function
LarkNotifier: function
BunCommandRunner: function
```

- [ ] **Step 5: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/lark/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\!' packages/lark/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules' | grep -v '!==' | grep -v '// '`
Expected: No non-null assertion matches (only `!==` comparisons and comments are acceptable)

- [ ] **Step 6: Verify all exported items have JSDoc**

Run: `cd /Users/bytedance/workspace/teamsland && grep -c '\/\*\*' packages/lark/src/command-runner.ts packages/lark/src/types.ts packages/lark/src/lark-cli.ts packages/lark/src/notifier.ts`
Expected:
- `command-runner.ts`: 3 (CommandResult, CommandRunner, BunCommandRunner)
- `types.ts`: 4 (LarkMessage, LarkContact, LarkGroup, LarkCard)
- `lark-cli.ts`: 10 (LarkCliError, LarkCli, sendDm, sendGroupMessage, sendInteractiveCard, imHistory, docRead, docCreate, contactSearch, groupSearch, groupListJoined — but groupListJoined shares with the class doc so 10 total `/**` blocks)
- `notifier.ts`: 2 (LarkNotifier, sendCard)

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx vitest run packages/lark/` — 17 tests pass
2. `bunx tsc --noEmit --project packages/lark/tsconfig.json` — exits 0
3. `bunx biome check packages/lark/src/` — no errors
4. All exported functions/classes/interfaces have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. `LarkCli`, `LarkCliError`, `LarkNotifier`, `BunCommandRunner` exported as values
7. `CommandResult`, `CommandRunner`, `LarkMessage`, `LarkContact`, `LarkGroup`, `LarkCard` exported as types
8. Dependency: only `@teamsland/types` (workspace) — no npm runtime dependencies needed
9. Tests inject mock `CommandRunner` — no real `lark-cli` binary required
