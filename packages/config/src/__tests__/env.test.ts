import { afterEach, describe, expect, it } from "vitest";
import { resolveEnvVars } from "../env.js";

describe("resolveEnvVars", () => {
  it("替换单个环境变量", () => {
    process.env.TEST_VAR_A = "hello";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const result = resolveEnvVars("${TEST_VAR_A}");
    expect(result).toBe("hello");
    delete process.env.TEST_VAR_A;
  });

  it("替换字符串中混合多个环境变量", () => {
    process.env.TEST_PREFIX = "abc";
    process.env.TEST_SUFFIX = "xyz";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const result = resolveEnvVars("start-${TEST_PREFIX}-middle-${TEST_SUFFIX}-end");
    expect(result).toBe("start-abc-middle-xyz-end");
    delete process.env.TEST_PREFIX;
    delete process.env.TEST_SUFFIX;
  });

  it("递归替换嵌套对象中的变量", () => {
    process.env.TEST_NESTED = "nested_value";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const input = { level1: { level2: "${TEST_NESTED}" } };
    const result = resolveEnvVars(input);
    expect(result).toEqual({ level1: { level2: "nested_value" } });
    delete process.env.TEST_NESTED;
  });

  it("递归替换数组中的变量", () => {
    process.env.TEST_ARR = "arr_value";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const input = ["${TEST_ARR}", "literal"];
    const result = resolveEnvVars(input);
    expect(result).toEqual(["arr_value", "literal"]);
    delete process.env.TEST_ARR;
  });

  it("未定义的环境变量抛出错误", () => {
    delete process.env.NONEXISTENT_VAR_XYZ;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    expect(() => resolveEnvVars("${NONEXISTENT_VAR_XYZ}")).toThrow("环境变量未定义: NONEXISTENT_VAR_XYZ");
  });

  it("非 string 值原样返回", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(null)).toBeNull();
  });

  it("不含变量占位符的字符串原样返回", () => {
    expect(resolveEnvVars("plain text")).toBe("plain text");
  });

  it("嵌套对象和数组混合场景", () => {
    process.env.TEST_MIX = "mixed";
    const input = {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
      arr: [{ key: "${TEST_MIX}" }, 123],
      num: 456,
      flag: false,
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({
      arr: [{ key: "mixed" }, 123],
      num: 456,
      flag: false,
    });
    delete process.env.TEST_MIX;
  });

  it("空字符串环境变量返回空字符串", () => {
    process.env.TEST_EMPTY = "";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const result = resolveEnvVars("${TEST_EMPTY}");
    expect(result).toBe("");
    delete process.env.TEST_EMPTY;
  });

  it("小写变量名不被匹配，原样返回", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const result = resolveEnvVars("${lowercase}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    expect(result).toBe("${lowercase}");
  });

  it("未闭合占位符原样返回", () => {
    const result = resolveEnvVars("${UNCLOSED");
    expect(result).toBe("${UNCLOSED");
  });

  it("同一变量被引用两次均被替换", () => {
    process.env.TEST_DUP = "dup";
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    const result = resolveEnvVars("${TEST_DUP}-${TEST_DUP}");
    expect(result).toBe("dup-dup");
    delete process.env.TEST_DUP;
  });

  it("嵌套对象中缺失变量向上抛出错误", () => {
    delete process.env.MISSING_NESTED;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: 测试占位符字符串，非模板字面量
    expect(() => resolveEnvVars({ a: { b: "${MISSING_NESTED}" } })).toThrow("环境变量未定义: MISSING_NESTED");
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("TEST_")) {
        delete process.env[key];
      }
    }
  });
});
