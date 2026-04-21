import { describe, expect, it } from "vitest";
import { checkVec0Available } from "../team-memory-store.js";

describe("checkVec0Available", () => {
  it("checkVec0Available 返回结构化检测结果", () => {
    const result = checkVec0Available();
    if (result.ok) {
      expect(result).toEqual({ ok: true });
    } else {
      expect(result.ok).toBe(false);
      expect(typeof result.error).toBe("string");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("返回值的 ok 字段是布尔类型", () => {
    const result = checkVec0Available();
    expect(typeof result.ok).toBe("boolean");
  });

  it("多次调用结果一致", () => {
    const first = checkVec0Available();
    const second = checkVec0Available();
    expect(first.ok).toBe(second.ok);
  });
});
