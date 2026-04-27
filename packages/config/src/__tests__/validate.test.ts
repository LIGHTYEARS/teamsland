import { describe, expect, it } from "vitest";
import { validateConfig } from "../validate.js";

function makeValidConfig() {
  return {
    lark: { appId: "cli_xxx", appSecret: "secret_yyy" },
    meego: { apiBaseUrl: "https://project.feishu.cn/open_api" },
    dashboard: { port: 3001 },
    coordinator: { enabled: true },
    queue: { dbPath: "data/queue.sqlite" },
    repoMapping: [{ meegoProjectId: "p1", repos: [{ path: "/tmp", name: "test" }] }],
  };
}

describe("validateConfig", () => {
  it("returns ok for valid config", () => {
    const result = validateConfig(makeValidConfig() as never);
    expect(result.fatal).toEqual([]);
  });

  it("reports fatal when lark.appId is empty", () => {
    const cfg = makeValidConfig();
    cfg.lark.appId = "";
    const result = validateConfig(cfg as never);
    expect(result.fatal).toContain("lark.appId 不能为空");
  });

  it("reports fatal when lark.appId contains unresolved placeholder", () => {
    const cfg = makeValidConfig();
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentionally testing literal placeholder string
    cfg.lark.appId = "${LARK_APP_ID}";
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("lark.appId"))).toBe(true);
  });

  it("reports fatal when dashboard.port is not a positive integer", () => {
    const cfg = makeValidConfig();
    cfg.dashboard.port = -1;
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("dashboard.port"))).toBe(true);
  });

  it("reports warn when repo path does not exist", () => {
    const cfg = makeValidConfig();
    cfg.repoMapping[0].repos[0].path = "/nonexistent/path/xyz";
    const result = validateConfig(cfg as never);
    expect(result.warnings.some((m) => m.includes("/nonexistent/path/xyz"))).toBe(true);
  });

  it("reports fatal when queue.dbPath is empty", () => {
    const cfg = makeValidConfig();
    // biome-ignore lint/style/noNonNullAssertion: test fixture is known-non-null
    cfg.queue!.dbPath = "";
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("queue.dbPath"))).toBe(true);
  });
});
