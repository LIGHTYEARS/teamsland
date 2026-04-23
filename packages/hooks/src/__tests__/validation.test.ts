import { describe, expect, it } from "vitest";
import { isValidHookModule } from "../validation.js";

describe("isValidHookModule", () => {
  it("有效模块（含 match + handle）应返回 true", () => {
    const mod = {
      match: () => true,
      handle: async () => {},
    };
    expect(isValidHookModule(mod)).toBe(true);
  });

  it("含 priority 和 description 的完整模块应返回 true", () => {
    const mod = {
      match: () => true,
      handle: async () => {},
      priority: 10,
      description: "测试 hook",
    };
    expect(isValidHookModule(mod)).toBe(true);
  });

  it("缺少 match 应返回 false", () => {
    const mod = {
      handle: async () => {},
    };
    expect(isValidHookModule(mod)).toBe(false);
  });

  it("缺少 handle 应返回 false", () => {
    const mod = {
      match: () => true,
    };
    expect(isValidHookModule(mod)).toBe(false);
  });

  it("match 不是函数应返回 false", () => {
    const mod = {
      match: "not-a-function",
      handle: async () => {},
    };
    expect(isValidHookModule(mod)).toBe(false);
  });

  it("priority 不是数字应返回 false", () => {
    const mod = {
      match: () => true,
      handle: async () => {},
      priority: "high",
    };
    expect(isValidHookModule(mod)).toBe(false);
  });

  it("description 不是字符串应返回 false", () => {
    const mod = {
      match: () => true,
      handle: async () => {},
      description: 42,
    };
    expect(isValidHookModule(mod)).toBe(false);
  });

  it("null 输入应返回 false", () => {
    expect(isValidHookModule(null)).toBe(false);
  });

  it("undefined 输入应返回 false", () => {
    expect(isValidHookModule(undefined)).toBe(false);
  });

  it("字符串输入应返回 false", () => {
    expect(isValidHookModule("string")).toBe(false);
  });

  it("数字输入应返回 false", () => {
    expect(isValidHookModule(123)).toBe(false);
  });

  it("含额外属性的有效模块应返回 true", () => {
    const mod = {
      match: () => true,
      handle: async () => {},
      priority: 5,
      description: "extra props hook",
      customField: "should be OK",
      anotherField: [1, 2, 3],
    };
    expect(isValidHookModule(mod)).toBe(true);
  });
});
