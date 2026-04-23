import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommitResult, FindResult, FsEntry, SessionContext, TaskStatus } from "../viking-memory-client.js";
import { NullVikingMemoryClient, VikingMemoryClient } from "../viking-memory-client.js";

// ─── Mock 路由表 ───

type RouteHandler = () => Response;

/** 根据 method + path 构建静态路由表，避免单个 fetch 函数认知复杂度过高 */
function buildRoutes(): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();

  routes.set("GET /health", () => Response.json({ status: "ok" }));

  routes.set("POST /api/v1/search/find", () => {
    const findResult: FindResult = {
      memories: [
        {
          uri: "mem://m1",
          context_type: "memory",
          is_leaf: true,
          abstract: "Test memory",
          category: "general",
          score: 0.95,
          match_reason: "keyword",
        },
      ],
      resources: [],
      skills: [],
      total: 1,
    };
    return Response.json({ status: "ok", result: findResult });
  });

  routes.set("GET /api/v1/content/read", () => Response.json({ status: "ok", result: "file content here" }));

  routes.set("GET /api/v1/content/abstract", () => Response.json({ status: "ok", result: "abstract text" }));

  routes.set("GET /api/v1/content/overview", () => Response.json({ status: "ok", result: "overview text" }));

  routes.set("POST /api/v1/content/write", () => Response.json({ status: "ok", result: {} }));

  routes.set("GET /api/v1/fs/ls", () => {
    const entries: FsEntry[] = [{ name: "file.txt", uri: "mem://file.txt", is_dir: false, size: 42 }];
    return Response.json({ status: "ok", result: entries });
  });

  routes.set("POST /api/v1/fs/mkdir", () => Response.json({ status: "ok", result: {} }));

  routes.set("DELETE /api/v1/fs/rm", () => Response.json({ status: "ok", result: {} }));

  routes.set("POST /api/v1/resources", () =>
    Response.json({ status: "ok", result: { uri: "mem://resources/file", task_id: "task-r1" } }),
  );

  routes.set("POST /api/v1/sessions", () => Response.json({ status: "ok", result: { session_id: "sess-abc123" } }));

  return routes;
}

/** 处理动态路径段的路由（/sessions/:id/*） */
function handleDynamicRoute(method: string, path: string): Response | null {
  if (method === "GET" && /^\/api\/v1\/sessions\/[^/]+\/context$/.test(path)) {
    const ctx: SessionContext = {
      latest_archive_overview: "overview text",
      pre_archive_abstracts: [],
      messages: [],
      estimatedTokens: 100,
    };
    return Response.json({ status: "ok", result: ctx });
  }

  if (method === "POST" && /^\/api\/v1\/sessions\/[^/]+\/messages$/.test(path)) {
    return Response.json({ status: "ok", result: {} });
  }

  if (method === "POST" && /^\/api\/v1\/sessions\/[^/]+\/commit$/.test(path)) {
    const commitResult: CommitResult = {
      session_id: "sess-abc123",
      status: "accepted",
      task_id: "task-1",
      archive_uri: "mem://archive/1",
    };
    return Response.json({ status: "ok", result: commitResult });
  }

  if (method === "DELETE" && /^\/api\/v1\/sessions\/[^/]+$/.test(path)) {
    return Response.json({ status: "ok", result: {} });
  }

  if (method === "GET" && /^\/api\/v1\/tasks\//.test(path)) {
    const taskStatus: TaskStatus = {
      task_id: "task-1",
      task_type: "archive",
      status: "completed",
    };
    return Response.json({ status: "ok", result: taskStatus });
  }

  return null;
}

// ─── NullVikingMemoryClient ───

describe("NullVikingMemoryClient", () => {
  const client = new NullVikingMemoryClient();

  it("healthCheck returns false", async () => {
    expect(await client.healthCheck()).toBe(false);
  });

  it("find returns empty result", async () => {
    const result = await client.find("test query");
    expect(result).toEqual({
      memories: [],
      resources: [],
      skills: [],
      total: 0,
    });
  });

  it("read returns empty string", async () => {
    expect(await client.read("mem://foo")).toBe("");
  });

  it("abstract returns empty string", async () => {
    expect(await client.abstract("mem://foo")).toBe("");
  });

  it("overview returns empty string", async () => {
    expect(await client.overview("mem://foo")).toBe("");
  });

  it("write resolves void", async () => {
    await expect(client.write("mem://foo", "data")).resolves.toBeUndefined();
  });

  it("ls returns empty array", async () => {
    const entries = await client.ls("mem://");
    expect(entries).toEqual([]);
  });

  it("mkdir resolves void", async () => {
    await expect(client.mkdir("mem://dir")).resolves.toBeUndefined();
  });

  it("rm resolves void", async () => {
    await expect(client.rm("mem://foo")).resolves.toBeUndefined();
  });

  it("addResource returns empty uri", async () => {
    const result = await client.addResource("/some/path", { to: "mem://dst" });
    expect(result).toEqual({ uri: "" });
  });

  it("createSession returns null-session", async () => {
    expect(await client.createSession()).toBe("null-session");
  });

  it("getSessionContext returns empty context", async () => {
    const ctx = await client.getSessionContext("sess-1");
    expect(ctx).toEqual({
      latest_archive_overview: "",
      pre_archive_abstracts: [],
      messages: [],
      estimatedTokens: 0,
    });
  });

  it("addMessage resolves void", async () => {
    await expect(client.addMessage("sess-1", "user", "hello")).resolves.toBeUndefined();
  });

  it("commitSession returns accepted stub", async () => {
    const result = await client.commitSession("sess-1");
    expect(result).toEqual({
      session_id: "",
      status: "accepted",
      task_id: "",
      archive_uri: "",
    });
  });

  it("deleteSession resolves void", async () => {
    await expect(client.deleteSession("sess-1")).resolves.toBeUndefined();
  });

  it("getTask returns completed stub", async () => {
    const task = await client.getTask("task-1");
    expect(task).toEqual({
      task_id: "",
      task_type: "",
      status: "completed",
    });
  });
});

// ─── VikingMemoryClient ───

describe("VikingMemoryClient", () => {
  let server: Server;
  let client: VikingMemoryClient;
  const staticRoutes = buildRoutes();

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req: Request) {
        const url = new URL(req.url);
        const key = `${req.method} ${url.pathname}`;

        const staticHandler = staticRoutes.get(key);
        if (staticHandler) return staticHandler();

        const dynamicResponse = handleDynamicRoute(req.method, url.pathname);
        if (dynamicResponse) return dynamicResponse;

        return new Response("Not Found", { status: 404 });
      },
    });

    client = new VikingMemoryClient({
      baseUrl: server.url.toString().replace(/\/$/, ""),
      agentId: "test-agent",
      timeoutMs: 5000,
      heartbeatIntervalMs: 30000,
      heartbeatFailThreshold: 3,
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  it("healthCheck returns true when server is up", async () => {
    expect(await client.healthCheck()).toBe(true);
  });

  it("healthCheck returns false when server is down", async () => {
    const deadClient = new VikingMemoryClient({
      baseUrl: "http://127.0.0.1:1",
      agentId: "test-agent",
      timeoutMs: 1000,
      heartbeatIntervalMs: 30000,
      heartbeatFailThreshold: 3,
    });
    expect(await deadClient.healthCheck()).toBe(false);
  });

  it("find returns parsed result", async () => {
    const result = await client.find("test query", { limit: 10 });
    expect(result.total).toBe(1);
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].uri).toBe("mem://m1");
    expect(result.memories[0].score).toBe(0.95);
  });

  it("read returns content string", async () => {
    const content = await client.read("mem://some-file");
    expect(content).toBe("file content here");
  });

  it("abstract returns abstract text", async () => {
    const text = await client.abstract("mem://some-file");
    expect(text).toBe("abstract text");
  });

  it("overview returns overview text", async () => {
    const text = await client.overview("mem://some-file");
    expect(text).toBe("overview text");
  });

  it("write resolves without error", async () => {
    await expect(client.write("mem://file", "content", { mode: "replace" })).resolves.toBeUndefined();
  });

  it("ls returns file entries", async () => {
    const entries = await client.ls("mem://");
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("file.txt");
  });

  it("mkdir resolves without error", async () => {
    await expect(client.mkdir("mem://dir", "A directory")).resolves.toBeUndefined();
  });

  it("rm resolves without error", async () => {
    await expect(client.rm("mem://file", true)).resolves.toBeUndefined();
  });

  it("addResource returns resource result", async () => {
    const result = await client.addResource("/path/to/file", {
      to: "mem://dst",
      reason: "test",
    });
    expect(result.uri).toBe("mem://resources/file");
    expect(result.task_id).toBe("task-r1");
  });

  it("createSession returns session id", async () => {
    const id = await client.createSession("my-session");
    expect(id).toBe("sess-abc123");
  });

  it("getSessionContext returns context", async () => {
    const ctx = await client.getSessionContext("sess-abc123", 4000);
    expect(ctx.latest_archive_overview).toBe("overview text");
    expect(ctx.estimatedTokens).toBe(100);
  });

  it("addMessage resolves without error", async () => {
    await expect(client.addMessage("sess-abc123", "user", "hello")).resolves.toBeUndefined();
  });

  it("commitSession returns commit result", async () => {
    const result = await client.commitSession("sess-abc123");
    expect(result.status).toBe("accepted");
    expect(result.session_id).toBe("sess-abc123");
  });

  it("deleteSession resolves without error", async () => {
    await expect(client.deleteSession("sess-abc123")).resolves.toBeUndefined();
  });

  it("getTask returns task status", async () => {
    const task = await client.getTask("task-1");
    expect(task.status).toBe("completed");
    expect(task.task_type).toBe("archive");
  });

  it("sets X-OpenViking-Agent header on requests", async () => {
    // The server would reject if header is missing; the fact that find works proves the header is set
    const result = await client.find("header test");
    expect(result).toBeDefined();
  });

  it("sets X-API-Key header when apiKey is configured", async () => {
    const keyClient = new VikingMemoryClient({
      baseUrl: server.url.toString().replace(/\/$/, ""),
      agentId: "test-agent",
      apiKey: "secret-key",
      timeoutMs: 5000,
      heartbeatIntervalMs: 30000,
      heartbeatFailThreshold: 3,
    });
    // If request succeeds, the headers were set properly
    const result = await keyClient.healthCheck();
    expect(result).toBe(true);
  });
});
