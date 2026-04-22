import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../loader.js";
import { AppConfigSchema } from "../schema.js";

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

  it("Zod 校验失败时抛出包含字段路径的错误", async () => {
    process.env.TEST_LARK_ID = "cli_test";
    process.env.TEST_LARK_SECRET = "secret_test";

    await expect(loadConfig(resolve(FIXTURES_DIR, "invalid-schema-config.json"))).rejects.toThrow();
  });

  it("环境变量缺失时通过 loadConfig 完整流程抛出错误（集成）", async () => {
    await expect(loadConfig(resolve(FIXTURES_DIR, "valid-config.json"))).rejects.toThrow(
      "环境变量未定义: TEST_LARK_ID",
    );
  });
});

describe("AppConfigSchema llm block", () => {
  const baseConfig = {
    meego: {
      spaces: [{ spaceId: "s1", name: "test" }],
      eventMode: "webhook",
      webhook: { host: "127.0.0.1", port: 8080, path: "/hook" },
      poll: { intervalSeconds: 60, lookbackMinutes: 5 },
      longConnection: { enabled: false, reconnectIntervalSeconds: 10 },
    },
    lark: {
      appId: "test-id",
      appSecret: "test-secret",
      bot: { historyContextCount: 20 },
      notification: { teamChannelId: "" },
    },
    session: { compactionTokenThreshold: 80000, sqliteJitterRangeMs: [20, 150], busyTimeoutMs: 5000 },
    sidecar: {
      maxConcurrentSessions: 20,
      maxRetryCount: 3,
      maxDelegateDepth: 2,
      workerTimeoutSeconds: 300,
      healthCheckTimeoutMs: 30000,
      minSwarmSuccessRatio: 0.5,
    },
    memory: { decayHalfLifeDays: 30, extractLoopMaxIterations: 3 },
    storage: {
      sqliteVec: { dbPath: "./data/test.sqlite", busyTimeoutMs: 5000, vectorDimensions: 512 },
      embedding: { model: "test-model", contextSize: 2048 },
      entityMerge: { cosineThreshold: 0.95 },
      fts5: { optimizeIntervalHours: 24 },
    },
    confirmation: { reminderIntervalMin: 30, maxReminders: 3, pollIntervalMs: 60000 },
    dashboard: { port: 3000, auth: { provider: "none", sessionTtlHours: 8, allowedDepartments: [] } },
    repoMapping: [],
  };

  it("accepts config without llm block (optional)", () => {
    const result = AppConfigSchema.parse(baseConfig);
    expect(result.llm).toBeUndefined();
  });

  it("accepts config with valid llm block", () => {
    const result = AppConfigSchema.parse({
      ...baseConfig,
      llm: { provider: "anthropic", apiKey: "sk-test", model: "claude-sonnet-4-20250514", maxTokens: 4096 },
    });
    expect(result.llm?.provider).toBe("anthropic");
    expect(result.llm?.model).toBe("claude-sonnet-4-20250514");
  });

  it("rejects llm block with empty apiKey", () => {
    expect(() =>
      AppConfigSchema.parse({
        ...baseConfig,
        llm: { provider: "anthropic", apiKey: "", model: "test", maxTokens: 4096 },
      }),
    ).toThrow();
  });

  it("defaults maxTokens to 4096 when omitted", () => {
    const result = AppConfigSchema.parse({
      ...baseConfig,
      llm: { provider: "anthropic", apiKey: "sk-test", model: "test" },
    });
    expect(result.llm?.maxTokens).toBe(4096);
  });
});
