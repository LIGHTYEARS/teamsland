import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../loader.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "fixtures");

describe("loadConfig", () => {
  afterEach(() => {
    delete process.env.TEST_LARK_ID;
    delete process.env.TEST_LARK_SECRET;
  });

  beforeEach(() => {
    delete process.env.TEST_LARK_ID;
    delete process.env.TEST_LARK_SECRET;
  });

  it("加载有效 JSON 配置并返回 AppConfig", async () => {
    process.env.TEST_LARK_ID = "cli_test";
    process.env.TEST_LARK_SECRET = "secret_test";

    const config = await loadConfig(resolve(FIXTURES_DIR, "valid-config.json"));

    expect(config.meego.spaces).toHaveLength(1);
    expect(config.meego.spaces[0].spaceId).toBe("space-1");
    expect(config.lark.appId).toBe("cli_test");
    expect(config.lark.appSecret).toBe("secret_test");
    expect(config.sidecar.maxConcurrentSessions).toBe(10);
  });

  it("配置文件不存在时抛出错误", async () => {
    await expect(loadConfig("/nonexistent/path/config.json")).rejects.toThrow("配置文件不存在");
  });

  it("环境变量替换在加载流程中正确执行", async () => {
    process.env.TEST_LARK_ID = "resolved_id";
    process.env.TEST_LARK_SECRET = "resolved_secret";

    const config = await loadConfig(resolve(FIXTURES_DIR, "valid-config.json"));

    expect(config.lark.appId).toBe("resolved_id");
    expect(config.lark.appSecret).toBe("resolved_secret");
  });

  it("无参数时使用默认路径，环境变量缺失则抛出错误", async () => {
    const savedAppId = process.env.LARK_APP_ID;
    const savedAppSecret = process.env.LARK_APP_SECRET;
    delete process.env.LARK_APP_ID;
    delete process.env.LARK_APP_SECRET;
    try {
      await expect(loadConfig()).rejects.toThrow("环境变量未定义");
    } finally {
      if (savedAppId !== undefined) process.env.LARK_APP_ID = savedAppId;
      if (savedAppSecret !== undefined) process.env.LARK_APP_SECRET = savedAppSecret;
    }
  });

  it("JSON 格式错误时抛出 SyntaxError", async () => {
    await expect(loadConfig(resolve(FIXTURES_DIR, "malformed-config.txt"))).rejects.toThrow(SyntaxError);
  });

  it("环境变量缺失时通过 loadConfig 完整流程抛出错误（集成）", async () => {
    await expect(loadConfig(resolve(FIXTURES_DIR, "valid-config.json"))).rejects.toThrow(
      "环境变量未定义: TEST_LARK_ID",
    );
  });
});
