import { describe, expect, it, vi } from "vitest";
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

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--user-id",
        "ou_user001",
        "--text",
        "你好",
      ]);
    });
  });

  describe("getUserInfo", () => {
    it("构造正确的 lark-cli contact +get-user 命令", async () => {
      const userResponse = { ok: true, data: { user: { name: "张三", department_ids: ["dept_001"] } } };
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(userResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.getUserInfo("ou_user001");

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "contact",
        "+get-user",
        "--as",
        "bot",
        "--user-id",
        "ou_user001",
        "--user-id-type",
        "open_id",
        "--format",
        "json",
      ]);
      expect(result).toEqual({ userId: "ou_user001", name: "张三", department: "" });
    });

    it("解析包含 department 的响应", async () => {
      const userResponse = {
        ok: true,
        data: { user: { name: "李四", department_ids: ["dept_002"] } },
        department_name: "工程部",
      };
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(userResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.getUserInfo("ou_user002");

      expect(result.name).toBe("李四");
    });

    it("命令失败时抛出 LarkCliError", async () => {
      const runner = createMockRunner({ exitCode: 1, stdout: "", stderr: "not found" });
      const cli = new LarkCli(testConfig, runner);

      await expect(cli.getUserInfo("ou_unknown")).rejects.toThrow(LarkCliError);
    });
  });

  describe("sendGroupMessage", () => {
    it("构造正确的群消息命令", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendGroupMessage("oc_chat001", "测试消息");

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        "oc_chat001",
        "--text",
        "测试消息",
      ]);
    });

    it("带 replyToMessageId 时使用 +messages-reply 命令", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendGroupMessage("oc_chat001", "回复内容", { replyToMessageId: "om_msg123" });

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+messages-reply",
        "--as",
        "bot",
        "--message-id",
        "om_msg123",
        "--text",
        "回复内容",
      ]);
    });
  });

  describe("sendInteractiveCard", () => {
    it("将 LarkCard 序列化为 JSON 并发送", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.sendInteractiveCard("oc_chat001", { title: "标题", content: "内容", level: "warning" });

      const expectedJson = JSON.stringify({ title: "标题", content: "内容", level: "warning" });
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        "oc_chat001",
        "--msg-type",
        "interactive",
        "--content",
        expectedJson,
      ]);
    });
  });

  describe("imHistory", () => {
    it("解析 LarkCliResponse 格式为 LarkMessage[]", async () => {
      const cliResponse = {
        ok: true,
        data: {
          messages: [
            {
              message_id: "om_1",
              content: "hello",
              create_time: "2024-04-20T16:00:00.000Z",
              sender: { id: "ou_a", name: "Alice" },
            },
            {
              message_id: "om_2",
              content: "world",
              create_time: "2024-04-20T16:00:01.000Z",
              sender: { id: "ou_b", name: "Bob" },
            },
          ],
        },
      };
      const expected = [
        {
          messageId: "om_1",
          sender: "Alice",
          content: "hello",
          timestamp: new Date("2024-04-20T16:00:00.000Z").getTime(),
        },
        {
          messageId: "om_2",
          sender: "Bob",
          content: "world",
          timestamp: new Date("2024-04-20T16:00:01.000Z").getTime(),
        },
      ];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(cliResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.imHistory("oc_chat001");

      expect(result).toEqual(expected);
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+chat-messages-list",
        "--as",
        "bot",
        "--chat-id",
        "oc_chat001",
        "--page-size",
        "10",
        "--format",
        "json",
      ]);
    });

    it("使用自定义 count 覆盖默认值", async () => {
      const emptyResponse = { ok: true, data: { messages: [] } };
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(emptyResponse), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.imHistory("oc_chat001", 5);

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+chat-messages-list",
        "--as",
        "bot",
        "--chat-id",
        "oc_chat001",
        "--page-size",
        "5",
        "--format",
        "json",
      ]);
    });
  });

  describe("docRead", () => {
    it("返回 stdout 作为文档内容", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "# 文档标题\n\n正文内容", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const content = await cli.docRead("https://docs.feishu.cn/wiki/abc123");

      expect(content).toBe("# 文档标题\n\n正文内容");
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "docs",
        "+fetch",
        "--doc",
        "https://docs.feishu.cn/wiki/abc123",
        "--format",
        "json",
      ]);
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
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "docs",
        "+create",
        "--title",
        "新文档",
        "--markdown",
        "文档内容",
      ]);
    });
  });

  describe("contactSearch", () => {
    it("解析 stdout JSON 数组为 LarkContact[]", async () => {
      const contacts = [{ userId: "ou_a", name: "张三", department: "工程部" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(contacts), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.contactSearch("张三", 5);

      expect(result).toEqual(contacts);
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "contact",
        "+search-user",
        "--query",
        "张三",
        "--format",
        "json",
        "--page-size",
        "5",
      ]);
    });
  });

  describe("groupSearch", () => {
    it("解析 stdout JSON 数组为 LarkGroup[]", async () => {
      const groups = [{ chatId: "oc_g1", name: "前端", description: "前端群" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(groups), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.groupSearch("前端", 10);

      expect(result).toEqual(groups);
      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+chat-search",
        "--query",
        "前端",
        "--format",
        "json",
        "--page-size",
        "10",
      ]);
    });
  });

  describe("groupListJoined", () => {
    it("无 filter 时使用 im chats list", async () => {
      const groups = [{ chatId: "oc_g1", name: "团队群", description: "主群" }];
      const runner = createMockRunner({ exitCode: 0, stdout: JSON.stringify(groups), stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      const result = await cli.groupListJoined();

      expect(result).toEqual(groups);
      expect(runner.run).toHaveBeenCalledWith(["lark-cli", "im", "chats", "list", "--format", "json"]);
    });

    it("有 filter 时使用 im +chat-search", async () => {
      const runner = createMockRunner({ exitCode: 0, stdout: "[]", stderr: "" });
      const cli = new LarkCli(testConfig, runner);

      await cli.groupListJoined("前端");

      expect(runner.run).toHaveBeenCalledWith([
        "lark-cli",
        "im",
        "+chat-search",
        "--query",
        "前端",
        "--format",
        "json",
      ]);
    });
  });

  describe("错误处理", () => {
    it("exitCode 127 时抛出 LarkCliError 并包含安装提示", async () => {
      const runner = createMockRunner({ exitCode: 127, stdout: "", stderr: "command not found" });
      const cli = new LarkCli(testConfig, runner);

      const promise = cli.sendDm("ou_user001", "test");
      await expect(promise).rejects.toThrow(LarkCliError);
      await expect(promise).rejects.toThrow(/lark-cli.*not installed/i);
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

      const promise = cli.imHistory("oc_chat001");
      await expect(promise).rejects.toThrow(LarkCliError);
      await expect(promise).rejects.toThrow(/parse|format/i);
    });
  });
});
