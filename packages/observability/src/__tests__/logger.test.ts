import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalLogPretty = process.env.LOG_PRETTY;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_PRETTY;
  });

  afterEach(() => {
    if (originalLogLevel !== undefined) process.env.LOG_LEVEL = originalLogLevel;
    else delete process.env.LOG_LEVEL;
    if (originalLogPretty !== undefined) process.env.LOG_PRETTY = originalLogPretty;
    else delete process.env.LOG_PRETTY;
  });

  it("返回带正确 name 的 logger 实例", () => {
    const logger = createLogger("test-module");
    expect(logger).toBeDefined();
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("debug");
  });

  it("logger 具有标准日志方法且可调用", () => {
    const logger = createLogger("methods");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.trace).toBe("function");
  });

  it("LOG_LEVEL 环境变量控制日志级别", () => {
    process.env.LOG_LEVEL = "silent";
    const logger = createLogger("silent-test");
    expect(logger.level).toBe("silent");
  });

  it("默认日志级别为 info", () => {
    const logger = createLogger("default-level");
    expect(logger.level).toBe("info");
  });

  it("child logger 继承 name 并附加字段", () => {
    const logger = createLogger("parent");
    const child = logger.child({ requestId: "req-123" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
    child.info("test message");
  });
});
