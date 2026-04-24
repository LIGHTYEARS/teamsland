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

describe("MeegoClient — 工作项写操作", () => {
  it("createWorkItem 应 POST /{project}/work_item/create", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: 999 });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.createWorkItem("proj_a", "issue", "登录崩溃", {
      fields: [{ fieldKey: "priority", fieldValue: { value: "1" } }],
    });

    expect(calls[0].url).toContain("/work_item/create");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.work_item_type_key).toBe("issue");
    expect(body.name).toBe("登录崩溃");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(999);
  });

  it("updateWorkItem 应 PUT /{project}/work_item/{type}/{id}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.updateWorkItem("proj_a", "issue", 123, [{ fieldKey: "priority", fieldValue: { value: "0" } }]);

    expect(calls[0].url).toContain("/work_item/issue/123");
    expect(calls[0].init?.method).toBe("PUT");
  });

  it("deleteWorkItem 应 DELETE /{project}/work_item/{type}/{id}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.deleteWorkItem("proj_a", "issue", 123);

    expect(calls[0].url).toContain("/work_item/issue/123");
    expect(calls[0].init?.method).toBe("DELETE");
  });
});

describe("MeegoClient — 工作流操作", () => {
  it("getWorkflow 应 POST workflow/query with flowType", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: {
        workflow_nodes: [{ id: "n1", name: "开始" }],
        connections: [],
      },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getWorkflow("proj_a", "story", 123, 0);

    expect(calls[0].url).toContain("/workflow/query");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.flow_type).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("finishNode 应 POST node/{nodeId}/operate with action=confirm", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.finishNode("proj_a", "story", 123, "node-1", {
      owners: ["user_a"],
    });

    expect(calls[0].url).toContain("/node/node-1/operate");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.action).toBe("confirm");
    expect(body.node_owners).toEqual(["user_a"]);
  });

  it("updateNode 应 PUT node/{nodeId}", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.updateNode("proj_a", "story", 123, "node-2", {
      owners: ["user_b"],
      schedule: { estimateStartDate: 1700000000000 },
    });

    expect(calls[0].url).toContain("/node/node-2");
    expect(calls[0].init?.method).toBe("PUT");
  });

  it("transitState 应 POST state_change with transitionId", async () => {
    const { fn, calls } = spyFetch({ err_code: 0, data: null });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    await client.transitState("proj_a", "issue", 123, {
      transitionId: 42,
    });

    expect(calls[0].url).toContain("/state_change");
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.transition_id).toBe(42);
  });

  it("transitState 仅传 toState 时应先查 workflow 再匹配 transitionId", async () => {
    let callIndex = 0;
    const responses = [
      {
        err_code: 0,
        data: {
          state_flow_nodes: [
            { id: "OPEN", status: 2 },
            { id: "RESOLVED", status: 1 },
          ],
          connections: [{ transition_id: 99, source_state_key: "OPEN", target_state_key: "RESOLVED" }],
        },
      },
      { err_code: 0, data: null },
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async (input, init) => {
      calls.push({ url: String(input), init });
      const resp = responses[callIndex++];
      return new Response(JSON.stringify(resp), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.transitState("proj_a", "issue", 123, {
      toState: "RESOLVED",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/workflow/query");
    expect(calls[1].url).toContain("/state_change");
    const body = JSON.parse(calls[1].init?.body as string);
    expect(body.transition_id).toBe(99);
    expect(result.ok).toBe(true);
  });

  it("transitState 仅传 toState 但找不到匹配流转时应返回错误", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: mockFetch({
        err_code: 0,
        data: {
          state_flow_nodes: [{ id: "OPEN", status: 2 }],
          connections: [],
        },
      }),
    });

    const result = await client.transitState("proj_a", "issue", 123, {
      toState: "RESOLVED",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("RESOLVED");
    }
  });

  it("getTransitionFields 应 POST transition_required_info/get", async () => {
    const { fn, calls } = spyFetch({
      err_code: 0,
      data: { form_items: [{ key: "priority", class: "field", finished: false }] },
    });
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const result = await client.getTransitionFields("proj_a", "issue", 123, "RESOLVED");

    expect(calls[0].url).toContain("/transition_required_info/get");
    expect(result.ok).toBe(true);
  });
});

describe("MeegoClient — 文件操作", () => {
  it("uploadFile 应使用 FormData 并 POST /{project}/file/upload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ err_code: 0, data: "file-token-abc" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const file = new Blob(["hello"], { type: "text/plain" });
    const result = await client.uploadFile("proj_a", file, "test.txt");

    expect(calls[0].url).toContain("/file/upload");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeInstanceOf(FormData);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("file-token-abc");
  });

  it("addAttachment 应使用 FormData 并 POST /{project}/work_item/{type}/{id}/file/upload", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ err_code: 0, data: "attach-token-xyz" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: fn,
    });

    const file = new Blob(["pdf content"], { type: "application/pdf" });
    const result = await client.addAttachment("proj_a", "issue", 123, file, "report.pdf", {
      fieldKey: "attachment_field",
    });

    expect(calls[0].url).toContain("/work_item/issue/123/file/upload");
    expect(calls[0].init?.method).toBe("POST");
    const formData = calls[0].init?.body as FormData;
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get("field_key")).toBe("attachment_field");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe("attach-token-xyz");
  });

  it("uploadFile 在 API 返回错误时应返回 ok: false", async () => {
    const client = new MeegoClient({
      baseUrl: "https://meego.test",
      token: "t",
      userKey: "u",
      fetchFn: async () =>
        new Response(JSON.stringify({ err_code: 10001, err_msg: "no permission" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    });

    const file = new Blob(["data"]);
    const result = await client.uploadFile("proj_a", file, "test.txt");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errCode).toBe(10001);
  });
});
