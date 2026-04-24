import { describe, expect, it } from "vitest";
import { MeegoClient } from "../client.js";

/** 创建返回固定响应的 mock fetch */
function mockFetch(
  response: unknown,
  status = 200,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

/** 创建记录请求参数的 mock fetch */
function spyFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(response), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fn, calls };
}

describe("MeegoClient — 构造与 request()", () => {
  it("应发送正确的 headers（X-PLUGIN-TOKEN + X-USER-KEY）", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: [] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "tok-123",
      userKey: "user-abc",
      fetchFn: fn,
    });

    await client.searchUsers("test");

    expect(calls).toHaveLength(1);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["X-PLUGIN-TOKEN"]).toBe("tok-123");
    expect(headers["X-USER-KEY"]).toBe("user-abc");
  });

  it("应拼接正确的 URL（baseUrl + /open_api + path）", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: [] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.listFields("proj_a");

    expect(calls[0].url).toBe("https://meego.test/open_api/proj_a/field/all");
  });

  it("格式 A 成功响应（err_code: 0）应返回 ok: true", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 0, data: [{ user_key: "u1" }] }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(1);
    }
  });

  it("格式 A 错误响应（err_code: 30005）应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 30005, err_msg: "not found" }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(30005);
      expect(result.message).toBe("not found");
    }
  });

  it("格式 B 成功响应（error.code: 0）应返回 ok: true", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ error: { code: 0, msg: "" }, data: [] }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(true);
  });

  it("格式 B 错误响应（error.code: 10001）应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ error: { code: 10001, msg: "no permission" } }),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(10001);
      expect(result.message).toBe("no permission");
    }
  });

  it("HTTP 非 200 应尝试解析响应体并返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 30005, err_msg: "not found" }, 404),
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(30005);
    }
  });

  it("网络错误应返回 ok: false, errCode: -1", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: async () => {
        throw new Error("network error");
      },
    });

    const result = await client.searchUsers("test");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errCode).toBe(-1);
      expect(result.message).toContain("network error");
    }
  });
});

describe("MeegoClient — 工作项查询", () => {
  it("getWorkItem 应 POST /{project}/work_item/{type}/query", async () => {
    const rawItem = {
      id: 123,
      name: "登录页面",
      work_item_type_key: "story",
      fields: [{ field_key: "priority", field_value: { value: "1" } }],
    };
    const { fn, calls } = spyFetch({ err_code: 0, data: [rawItem] });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getWorkItem("proj_a", "story", 123);

    expect(calls[0].url).toBe("https://meego.test/open_api/proj_a/work_item/story/query");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(123);
      expect(result.data.workItemTypeKey).toBe("story");
    }
  });

  it("getWorkItemBrief 应返回格式化摘要", async () => {
    const rawItem = {
      id: 456,
      name: "修复登录崩溃",
      work_item_type_key: "issue",
      pattern: "State",
      work_item_status: { state_key: "OPEN" },
      fields: [{ field_key: "priority", field_value: { value: "0" } }],
      created_at: 1700000000,
      updated_at: 1700001000,
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({ err_code: 0, data: [rawItem] }),
    });

    const result = await client.getWorkItemBrief("proj_a", "issue", 456);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.mode).toBe("状态流");
      expect(result.data.status).toBe("OPEN");
    }
  });

  it("searchWorkItems 应传递 filters 和分页参数", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { work_item_list: [], total_count: 0 },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.searchWorkItems("proj_a", "story", {
      filters: [{ fieldKey: "name", fieldValue: "登录", operator: "LIKE" }],
      limit: 5,
      pageNum: 2,
    });

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.work_item_type_keys).toEqual(["story"]);
    expect(body.limit).toBe(5);
    expect(body.page_num).toBe(2);
    expect(body.filters).toHaveLength(1);
    expect(body.filters[0].field_key).toBe("name");
  });

  it("searchWorkItems 无 filters 时不传 filters 字段", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { work_item_list: [] },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.searchWorkItems("proj_a", "issue");

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.filters).toBeUndefined();
    expect(body.limit).toBe(20);
  });
});
