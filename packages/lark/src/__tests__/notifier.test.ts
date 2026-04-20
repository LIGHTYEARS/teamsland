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
        "lark-cli",
        "im",
        "send-message",
        "--chat-id",
        "oc_team_channel_001",
        "--msg-type",
        "interactive",
        "--content",
        expectedJson,
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
        "lark-cli",
        "im",
        "send-message",
        "--chat-id",
        "oc_team_channel_001",
        "--msg-type",
        "interactive",
        "--content",
        expectedJson,
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
        "lark-cli",
        "im",
        "send-message",
        "--chat-id",
        "oc_team_channel_001",
        "--msg-type",
        "interactive",
        "--content",
        expectedJson,
      ],
      { env: { LARK_APP_ID: "cli_test_app_id", LARK_APP_SECRET: "test_secret_value" } },
    );
  });
});
