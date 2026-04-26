import { describe, expect, it, vi } from "vitest";
import { enrichTicket, extractFeishuUrls } from "../enrich.js";

describe("extractFeishuUrls", () => {
  it("extracts docx URLs from field values", () => {
    const fields: Record<string, unknown> = {
      prd_link: "https://bytedance.feishu.cn/docx/abc123",
      tech_design: "https://bytedance.feishu.cn/wiki/def456",
      unrelated: "hello world",
      nested: "See https://bytedance.feishu.cn/docx/ghi789 for details",
    };
    const urls = extractFeishuUrls(fields);
    expect(urls).toEqual([
      { fieldKey: "prd_link", url: "https://bytedance.feishu.cn/docx/abc123" },
      { fieldKey: "tech_design", url: "https://bytedance.feishu.cn/wiki/def456" },
      { fieldKey: "nested", url: "https://bytedance.feishu.cn/docx/ghi789" },
    ]);
  });

  it("returns empty array when no URLs found", () => {
    const fields: Record<string, unknown> = { title: "no links here" };
    expect(extractFeishuUrls(fields)).toEqual([]);
  });

  it("handles null/undefined field values", () => {
    const fields: Record<string, unknown> = { a: null, b: undefined, c: 42 };
    expect(extractFeishuUrls(fields)).toEqual([]);
  });
});

describe("enrichTicket", () => {
  it("calls meego get and lark doc-read, returns raw data", async () => {
    const meegoGet = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: 789,
        name: "优化首页性能",
        type: "story",
        status: "open",
        fields: { priority: "P1", prd_link: "https://bytedance.feishu.cn/docx/abc" },
        createdBy: "lisi",
        updatedBy: "zhangsan",
      },
    });
    const docRead = vi.fn().mockResolvedValue("# PRD\n## Background\nPerformance optimization");

    const result = await enrichTicket({
      issueId: "ISSUE-789",
      projectKey: "FRONTEND",
      workItemType: "story",
      meegoGet,
      docRead,
    });

    expect(result.issueId).toBe("ISSUE-789");
    expect(result.basic.title).toBe("优化首页性能");
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].ok).toBe(true);
    expect(result.documents[0].content).toContain("PRD");
    expect(meegoGet).toHaveBeenCalledOnce();
    expect(docRead).toHaveBeenCalledWith("https://bytedance.feishu.cn/docx/abc");
  });

  it("reports doc-read failures without throwing", async () => {
    const meegoGet = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: 789,
        name: "Test",
        type: "story",
        status: "open",
        fields: { doc_link: "https://bytedance.feishu.cn/docx/bad" },
      },
    });
    const docRead = vi.fn().mockRejectedValue(new Error("permission_denied"));

    const result = await enrichTicket({
      issueId: "ISSUE-789",
      projectKey: "P",
      workItemType: "story",
      meegoGet,
      docRead,
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].ok).toBe(false);
    expect(result.documents[0].error).toContain("permission_denied");
    expect(result.documents[0].content).toBeNull();
  });

  it("propagates meego get failure", async () => {
    const meegoGet = vi.fn().mockResolvedValue({ ok: false, errCode: 30005, message: "not found" });
    const docRead = vi.fn();

    await expect(
      enrichTicket({ issueId: "X", projectKey: "P", workItemType: "story", meegoGet, docRead }),
    ).rejects.toThrow("not found");
    expect(docRead).not.toHaveBeenCalled();
  });
});
