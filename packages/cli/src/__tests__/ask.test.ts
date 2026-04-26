import { describe, expect, it } from "vitest";
import { parseAskArgs } from "../commands/ask.js";

describe("parseAskArgs", () => {
  it("parses --to --ticket --text", () => {
    const result = parseAskArgs(["--to", "ou_abc", "--ticket", "ISSUE-1", "--text", "请提供更多信息"]);
    expect(result).toEqual({ to: "ou_abc", ticketId: "ISSUE-1", text: "请提供更多信息" });
  });

  it("parses args in different order", () => {
    const result = parseAskArgs(["--ticket", "ISSUE-2", "--text", "hello", "--to", "ou_xyz"]);
    expect(result).toEqual({ to: "ou_xyz", ticketId: "ISSUE-2", text: "hello" });
  });

  it("returns error when --to is missing", () => {
    const result = parseAskArgs(["--ticket", "ISSUE-1", "--text", "hello"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--to/);
  });

  it("returns error when --ticket is missing", () => {
    const result = parseAskArgs(["--to", "ou_abc", "--text", "hello"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--ticket/);
  });

  it("returns error when --text is missing", () => {
    const result = parseAskArgs(["--to", "ou_abc", "--ticket", "ISSUE-1"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toMatch(/--text/);
  });

  it("returns error for empty args", () => {
    const result = parseAskArgs([]);
    expect(result).toHaveProperty("error");
  });
});
