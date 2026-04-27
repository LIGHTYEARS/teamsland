# teamsland memory CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose OpenViking memory operations as `teamsland memory` CLI sub-commands so the coordinator can actively write, search, browse, and delete long-term memories.

**Architecture:** New `teamsland memory <op>` CLI commands route through the existing teamsland server proxy (`/api/viking/*`) to OpenViking. The server proxy gets six new route handlers. The coordinator learns about the new commands through an injected `memory-management` skill. The `LiveContextLoader` is updated to remove automatic agent memory recall (coordinator now does it on demand).

**Tech Stack:** TypeScript, Bun, Hono (server), vitest (tests)

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `packages/cli/src/commands/memory.ts` | Arg parsing + command dispatch for all `teamsland memory` sub-commands |
| **Create:** `packages/cli/src/__tests__/memory.test.ts` | Unit tests for `parseMemoryArgs` and `resolveScope` |
| **Modify:** `packages/cli/src/http-client.ts` | Add 11 `viking*` methods to `TeamslandClient` |
| **Modify:** `packages/cli/src/index.ts` | Wire `case "memory"` in the command switch |
| **Modify:** `packages/memory/src/viking-memory-client.ts` | Add `mv`, `grep`, `glob` to interface + implementations; add `append` to `WriteOptions.mode` |
| **Modify:** `apps/server/src/viking-routes.ts` | Add 6 new proxy handlers + fix `handleWrite` for `append` mode |
| **Modify:** `apps/server/src/coordinator-init.ts` | Add `memory-management` skill directory + generation function |
| **Modify:** `apps/server/src/coordinator-context.ts` | Remove `agentMemFetch` from `buildFetches()` |
| **Modify:** `apps/server/src/__tests__/coordinator-init.test.ts` | Assert new skill directory is created |

---

### Task 1: Extend IVikingMemoryClient with mv, grep, glob, and append mode

**Files:**
- Modify: `packages/memory/src/viking-memory-client.ts:102-105` (WriteOptions)
- Modify: `packages/memory/src/viking-memory-client.ts:274-291` (IVikingMemoryClient interface)
- Modify: `packages/memory/src/viking-memory-client.ts:380-435` (VikingMemoryClient implementation)
- Modify: `packages/memory/src/viking-memory-client.ts:506-541` (NullVikingMemoryClient)

- [ ] **Step 1: Add `append` to WriteOptions.mode**

In `packages/memory/src/viking-memory-client.ts`, change line 103:

```typescript
// Before:
  mode?: "replace" | "create";
// After:
  mode?: "replace" | "create" | "append";
```

- [ ] **Step 2: Add mv, grep, glob to IVikingMemoryClient interface**

After line 283 (`rm` method), add:

```typescript
  mv(fromUri: string, toUri: string): Promise<void>;
  grep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<GrepResult>;
  glob(pattern: string, uri?: string): Promise<GlobResult>;
```

And add the result types before the interface (around line 270):

```typescript
export interface GrepMatch {
  uri: string;
  line: number;
  content: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  count: number;
}

export interface GlobResult {
  matches: string[];
  count: number;
}
```

- [ ] **Step 3: Implement mv, grep, glob in VikingMemoryClient**

After the `rm` method (around line 435), add:

```typescript
  async mv(fromUri: string, toUri: string): Promise<void> {
    logger.debug({ fromUri, toUri }, "mv 请求");
    await this.request<unknown>("/api/v1/fs/mv", {
      method: "POST",
      body: JSON.stringify({ from_uri: fromUri, to_uri: toUri }),
    });
  }

  async grep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<GrepResult> {
    logger.debug({ uri, pattern, opts }, "grep 请求");
    return this.request<GrepResult>("/api/v1/search/grep", {
      method: "POST",
      body: JSON.stringify({ uri, pattern, case_insensitive: opts?.caseInsensitive }),
    });
  }

  async glob(pattern: string, uri?: string): Promise<GlobResult> {
    logger.debug({ pattern, uri }, "glob 请求");
    return this.request<GlobResult>("/api/v1/search/glob", {
      method: "POST",
      body: JSON.stringify({ pattern, uri }),
    });
  }
```

- [ ] **Step 4: Add null stubs in NullVikingMemoryClient**

After the `rm` null stub (around line 541), add:

```typescript
  async mv(_fromUri: string, _toUri: string): Promise<void> {
    // 空操作
  }

  async grep(_uri: string, _pattern: string, _opts?: { caseInsensitive?: boolean }): Promise<GrepResult> {
    return { matches: [], count: 0 };
  }

  async glob(_pattern: string, _uri?: string): Promise<GlobResult> {
    return { matches: [], count: 0 };
  }
```

- [ ] **Step 5: Export new types from package index**

Check `packages/memory/src/index.ts` and ensure `GrepResult`, `GlobResult`, `GrepMatch` are exported. They should be auto-exported if the index re-exports from `viking-memory-client.ts`.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (no type errors)

- [ ] **Step 7: Commit**

```bash
git add packages/memory/src/viking-memory-client.ts
git commit -m "feat(memory): add mv, grep, glob to IVikingMemoryClient; add append to WriteOptions"
```

---

### Task 2: Add new proxy route handlers to viking-routes.ts

**Files:**
- Modify: `apps/server/src/viking-routes.ts:94-104` (handleWrite — fix append mode)
- Modify: `apps/server/src/viking-routes.ts:157-188` (handleVikingRoutes — add new route dispatches)

- [ ] **Step 1: Fix handleWrite to support append mode**

In `apps/server/src/viking-routes.ts` line 101, change:

```typescript
// Before:
  const mode = body.mode === "replace" || body.mode === "create" ? body.mode : undefined;
// After:
  const mode = body.mode === "replace" || body.mode === "create" || body.mode === "append" ? body.mode : undefined;
```

- [ ] **Step 2: Add handleMkdir handler**

After `handleRm` (around line 124), add:

```typescript
async function handleMkdir(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const uri = typeof body.uri === "string" ? body.uri : "";
  if (!uri) {
    return Response.json({ error: "缺少 uri 字段" }, { status: 400 });
  }
  const description = typeof body.description === "string" ? body.description : undefined;
  await client.mkdir(uri, description);
  return Response.json({ status: "ok", result: { uri } });
}
```

- [ ] **Step 3: Add handleMv handler**

```typescript
async function handleMv(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const fromUri = typeof body.fromUri === "string" ? body.fromUri : "";
  const toUri = typeof body.toUri === "string" ? body.toUri : "";
  if (!fromUri || !toUri) {
    return Response.json({ error: "缺少 fromUri 或 toUri 字段" }, { status: 400 });
  }
  await client.mv(fromUri, toUri);
  return Response.json({ status: "ok", result: { from: fromUri, to: toUri } });
}
```

- [ ] **Step 4: Add handleAbstract and handleOverview handlers**

```typescript
async function handleAbstract(url: URL, client: IVikingMemoryClient): Promise<Response> {
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "缺少 uri 参数" }, { status: 400 });
  }
  const result = await client.abstract(uri);
  return Response.json({ status: "ok", result });
}

async function handleOverview(url: URL, client: IVikingMemoryClient): Promise<Response> {
  const uri = url.searchParams.get("uri");
  if (!uri) {
    return Response.json({ error: "缺少 uri 参数" }, { status: 400 });
  }
  const result = await client.overview(uri);
  return Response.json({ status: "ok", result });
}
```

- [ ] **Step 5: Add handleGrep and handleGlob handlers**

```typescript
async function handleGrep(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const uri = typeof body.uri === "string" ? body.uri : "";
  const pattern = typeof body.pattern === "string" ? body.pattern : "";
  if (!uri || !pattern) {
    return Response.json({ error: "缺少 uri 或 pattern 字段" }, { status: 400 });
  }
  const caseInsensitive = body.caseInsensitive === true ? true : undefined;
  const result = await client.grep(uri, pattern, { caseInsensitive });
  return Response.json({ status: "ok", result });
}

async function handleGlob(req: Request, client: IVikingMemoryClient): Promise<Response> {
  const body = (await req.json()) as Record<string, unknown>;
  const pattern = typeof body.pattern === "string" ? body.pattern : "";
  if (!pattern) {
    return Response.json({ error: "缺少 pattern 字段" }, { status: 400 });
  }
  const uri = typeof body.uri === "string" ? body.uri : undefined;
  const result = await client.glob(pattern, uri);
  return Response.json({ status: "ok", result });
}
```

- [ ] **Step 6: Wire new routes in handleVikingRoutes**

In `handleVikingRoutes`, before the `return null;` at line 183, add:

```typescript
    if (req.method === "POST" && url.pathname === "/api/viking/mkdir") {
      return await handleMkdir(req, vikingClient);
    }
    if (req.method === "POST" && url.pathname === "/api/viking/mv") {
      return await handleMv(req, vikingClient);
    }
    if (req.method === "GET" && url.pathname === "/api/viking/abstract") {
      return await handleAbstract(url, vikingClient);
    }
    if (req.method === "GET" && url.pathname === "/api/viking/overview") {
      return await handleOverview(url, vikingClient);
    }
    if (req.method === "POST" && url.pathname === "/api/viking/grep") {
      return await handleGrep(req, vikingClient);
    }
    if (req.method === "POST" && url.pathname === "/api/viking/glob") {
      return await handleGlob(req, vikingClient);
    }
```

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/viking-routes.ts
git commit -m "feat(server): add mkdir, mv, abstract, overview, grep, glob proxy routes; support append mode in write"
```

---

### Task 3: Add Viking methods to TeamslandClient (http-client.ts)

**Files:**
- Modify: `packages/cli/src/http-client.ts:335-377` (after `ask` method, before `private request`)

- [ ] **Step 1: Add all viking proxy methods**

After the `ask` method (line 335) and before the `private request` method (line 340), add:

```typescript
  // ─── Viking Memory API ───

  async vikingWrite(uri: string, content: string, opts?: { mode?: string; wait?: boolean }): Promise<unknown> {
    return this.request("POST", "/api/viking/write", { uri, content, ...opts });
  }

  async vikingRead(uri: string): Promise<{ status: string; result: string }> {
    return this.request("GET", `/api/viking/read?uri=${encodeURIComponent(uri)}`);
  }

  async vikingLs(uri: string, opts?: { recursive?: boolean; simple?: boolean }): Promise<{ status: string; result: unknown[] }> {
    const params = new URLSearchParams({ uri });
    if (opts?.recursive) params.set("recursive", "true");
    if (opts?.simple) params.set("simple", "true");
    return this.request("GET", `/api/viking/ls?${params.toString()}`);
  }

  async vikingMkdir(uri: string, description?: string): Promise<unknown> {
    return this.request("POST", "/api/viking/mkdir", { uri, description });
  }

  async vikingRm(uri: string, recursive?: boolean): Promise<unknown> {
    const params = new URLSearchParams({ uri });
    if (recursive) params.set("recursive", "true");
    return this.request("DELETE", `/api/viking/fs?${params.toString()}`);
  }

  async vikingMv(fromUri: string, toUri: string): Promise<unknown> {
    return this.request("POST", "/api/viking/mv", { fromUri, toUri });
  }

  async vikingAbstract(uri: string): Promise<{ status: string; result: string }> {
    return this.request("GET", `/api/viking/abstract?uri=${encodeURIComponent(uri)}`);
  }

  async vikingOverview(uri: string): Promise<{ status: string; result: string }> {
    return this.request("GET", `/api/viking/overview?uri=${encodeURIComponent(uri)}`);
  }

  async vikingFind(query: string, opts?: { targetUri?: string; limit?: number; since?: string; until?: string }): Promise<unknown> {
    return this.request("POST", "/api/viking/find", { query, ...opts });
  }

  async vikingGrep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<unknown> {
    return this.request("POST", "/api/viking/grep", { uri, pattern, ...opts });
  }

  async vikingGlob(pattern: string, uri?: string): Promise<unknown> {
    return this.request("POST", "/api/viking/glob", { pattern, uri });
  }
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/http-client.ts
git commit -m "feat(cli): add viking proxy methods to TeamslandClient"
```

---

### Task 4: Implement memory.ts — arg parsing and scope resolution

**Files:**
- Create: `packages/cli/src/commands/memory.ts`
- Test: `packages/cli/src/__tests__/memory.test.ts`

- [ ] **Step 1: Write failing tests for parseMemoryArgs**

Create `packages/cli/src/__tests__/memory.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseMemoryArgs, resolveScope } from "../commands/memory.js";

describe("parseMemoryArgs", () => {
  it("parses 'write <uri> --content <text> --mode create'", () => {
    const result = parseMemoryArgs([
      "write", "viking://agent/teamsland/memories/note.md",
      "--content", "hello world",
      "--mode", "create",
    ]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://agent/teamsland/memories/note.md",
      content: "hello world",
      mode: "create",
    });
  });

  it("parses 'write <uri> --content <text>' with default mode", () => {
    const result = parseMemoryArgs([
      "write", "viking://agent/teamsland/memories/note.md",
      "--content", "hello",
    ]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://agent/teamsland/memories/note.md",
      content: "hello",
    });
  });

  it("parses 'write' with --wait flag", () => {
    const result = parseMemoryArgs([
      "write", "viking://resources/doc.md",
      "--content", "text",
      "--wait",
    ]);
    expect(result).toEqual({
      op: "write",
      uri: "viking://resources/doc.md",
      content: "text",
      wait: true,
    });
  });

  it("returns error when write has no --content or --content-file", () => {
    const result = parseMemoryArgs(["write", "viking://resources/doc.md"]);
    expect(result).toHaveProperty("error");
  });

  it("parses 'read <uri>'", () => {
    const result = parseMemoryArgs(["read", "viking://agent/teamsland/memories/note.md"]);
    expect(result).toEqual({ op: "read", uri: "viking://agent/teamsland/memories/note.md" });
  });

  it("parses 'ls <uri> --recursive'", () => {
    const result = parseMemoryArgs(["ls", "viking://resources/", "--recursive"]);
    expect(result).toEqual({ op: "ls", uri: "viking://resources/", recursive: true });
  });

  it("parses 'mkdir <uri> --description <text>'", () => {
    const result = parseMemoryArgs(["mkdir", "viking://resources/new/", "--description", "project docs"]);
    expect(result).toEqual({ op: "mkdir", uri: "viking://resources/new/", description: "project docs" });
  });

  it("parses 'rm <uri> --recursive'", () => {
    const result = parseMemoryArgs(["rm", "viking://resources/old/", "--recursive"]);
    expect(result).toEqual({ op: "rm", uri: "viking://resources/old/", recursive: true });
  });

  it("parses 'mv <from> <to>'", () => {
    const result = parseMemoryArgs(["mv", "viking://resources/old/", "viking://resources/new/"]);
    expect(result).toEqual({ op: "mv", fromUri: "viking://resources/old/", toUri: "viking://resources/new/" });
  });

  it("parses 'abstract <uri>'", () => {
    const result = parseMemoryArgs(["abstract", "viking://resources/docs/"]);
    expect(result).toEqual({ op: "abstract", uri: "viking://resources/docs/" });
  });

  it("parses 'overview <uri>'", () => {
    const result = parseMemoryArgs(["overview", "viking://resources/docs/"]);
    expect(result).toEqual({ op: "overview", uri: "viking://resources/docs/" });
  });

  it("parses 'find <query> --uri <target> --limit 5'", () => {
    const result = parseMemoryArgs(["find", "部署流程", "--uri", "viking://agent/teamsland/memories/", "--limit", "5"]);
    expect(result).toEqual({
      op: "find",
      query: "部署流程",
      uri: "viking://agent/teamsland/memories/",
      limit: 5,
    });
  });

  it("parses 'find' with --scope agent", () => {
    const result = parseMemoryArgs(["find", "部署", "--scope", "agent", "--limit", "3"]);
    expect(result).toEqual({
      op: "find",
      query: "部署",
      uri: "viking://agent/teamsland/memories/",
      limit: 3,
    });
  });

  it("parses 'find' with --since and --until", () => {
    const result = parseMemoryArgs(["find", "invoice", "--since", "7d", "--until", "1d"]);
    expect(result).toEqual({
      op: "find",
      query: "invoice",
      since: "7d",
      until: "1d",
    });
  });

  it("parses 'grep <uri> <pattern> --ignore-case'", () => {
    const result = parseMemoryArgs(["grep", "viking://resources/", "auth", "--ignore-case"]);
    expect(result).toEqual({
      op: "grep",
      uri: "viking://resources/",
      pattern: "auth",
      ignoreCase: true,
    });
  });

  it("parses 'glob <pattern> --uri <target>'", () => {
    const result = parseMemoryArgs(["glob", "**/*.md", "--uri", "viking://resources/"]);
    expect(result).toEqual({
      op: "glob",
      pattern: "**/*.md",
      uri: "viking://resources/",
    });
  });

  it("returns error for missing subcommand", () => {
    const result = parseMemoryArgs([]);
    expect(result).toHaveProperty("error");
  });

  it("returns error for unknown subcommand", () => {
    const result = parseMemoryArgs(["unknown"]);
    expect(result).toHaveProperty("error");
  });
});

describe("resolveScope", () => {
  it("resolves --scope agent", () => {
    expect(resolveScope(["--scope", "agent"])).toEqual({ uri: "viking://agent/teamsland/memories/", consumed: ["--scope", "agent"] });
  });

  it("resolves --scope user --user alice", () => {
    expect(resolveScope(["--scope", "user", "--user", "alice"])).toEqual({ uri: "viking://user/alice/memories/", consumed: ["--scope", "user", "--user", "alice"] });
  });

  it("resolves --scope tasks", () => {
    expect(resolveScope(["--scope", "tasks"])).toEqual({ uri: "viking://resources/tasks/", consumed: ["--scope", "tasks"] });
  });

  it("resolves --scope resources", () => {
    expect(resolveScope(["--scope", "resources"])).toEqual({ uri: "viking://resources/", consumed: ["--scope", "resources"] });
  });

  it("returns error for --scope user without --user", () => {
    const result = resolveScope(["--scope", "user"]);
    expect(result).toHaveProperty("error");
  });

  it("returns null when no --scope present", () => {
    expect(resolveScope(["--limit", "5"])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx --bun vitest run packages/cli/src/__tests__/memory.test.ts`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement resolveScope**

Create `packages/cli/src/commands/memory.ts`:

```typescript
import { readFileSync } from "node:fs";
import type { TeamslandClient } from "../http-client.js";
import { printError, printJson, printLine } from "../output.js";

// ─── Types ───

type ParsedMemoryArgs =
  | { op: "write"; uri: string; content: string; mode?: string; wait?: boolean }
  | { op: "read"; uri: string }
  | { op: "ls"; uri: string; recursive?: boolean; simple?: boolean }
  | { op: "mkdir"; uri: string; description?: string }
  | { op: "rm"; uri: string; recursive?: boolean }
  | { op: "mv"; fromUri: string; toUri: string }
  | { op: "abstract"; uri: string }
  | { op: "overview"; uri: string }
  | { op: "find"; query: string; uri?: string; limit?: number; since?: string; until?: string }
  | { op: "grep"; uri: string; pattern: string; ignoreCase?: boolean }
  | { op: "glob"; pattern: string; uri?: string }
  | { error: string };

// ─── Scope Resolution ───

const SCOPE_MAP: Record<string, string> = {
  agent: "viking://agent/teamsland/memories/",
  tasks: "viking://resources/tasks/",
  resources: "viking://resources/",
};

export function resolveScope(
  args: string[],
): { uri: string; consumed: string[] } | { error: string } | null {
  const scopeIdx = args.indexOf("--scope");
  if (scopeIdx === -1) return null;

  const scopeName = args[scopeIdx + 1];
  if (!scopeName) return { error: "Missing value for --scope" };

  if (scopeName === "user") {
    const userIdx = args.indexOf("--user");
    const userId = userIdx >= 0 ? args[userIdx + 1] : undefined;
    if (!userId) return { error: "--scope user requires --user <id>" };
    return {
      uri: `viking://user/${userId}/memories/`,
      consumed: ["--scope", scopeName, "--user", userId],
    };
  }

  const uri = SCOPE_MAP[scopeName];
  if (!uri) return { error: `Unknown scope: ${scopeName}. Available: agent, user, tasks, resources` };
  return { uri, consumed: ["--scope", scopeName] };
}

// ─── Arg Parsing Helpers ───

function extractFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function extractOption(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function stripFlags(args: string[], flags: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (flags.includes(args[i])) {
      // flags with values: skip next arg too
      if (args[i] !== "--recursive" && args[i] !== "--simple" && args[i] !== "--wait" && args[i] !== "--ignore-case") {
        i += 2;
      } else {
        i += 1;
      }
    } else {
      result.push(args[i]);
      i += 1;
    }
  }
  return result;
}

// ─── Main Parser ───

export function parseMemoryArgs(args: string[]): ParsedMemoryArgs {
  const op = args[0];
  if (!op) {
    return { error: "Missing subcommand. Usage: teamsland memory <write|read|ls|mkdir|rm|mv|abstract|overview|find|grep|glob> ..." };
  }

  const rest = args.slice(1);

  // Resolve --scope into --uri if present
  const scope = resolveScope(rest);
  let effectiveArgs = rest;
  let scopeUri: string | undefined;
  if (scope && "error" in scope) return { error: scope.error };
  if (scope && "uri" in scope) {
    scopeUri = scope.uri;
    effectiveArgs = rest.filter((a) => !scope.consumed.includes(a));
  }

  switch (op) {
    case "write": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory write <uri> --content <text>" };
      const content = extractOption(effectiveArgs, "--content");
      const contentFile = extractOption(effectiveArgs, "--content-file");
      let finalContent: string | undefined;
      if (content !== undefined) {
        finalContent = content;
      } else if (contentFile !== undefined) {
        try {
          finalContent = readFileSync(contentFile, "utf-8");
        } catch {
          return { error: `Cannot read file: ${contentFile}` };
        }
      }
      if (finalContent === undefined) {
        return { error: "Missing --content or --content-file. Usage: teamsland memory write <uri> --content <text>" };
      }
      const mode = extractOption(effectiveArgs, "--mode");
      const wait = extractFlag(effectiveArgs, "--wait");
      const result: ParsedMemoryArgs = { op: "write", uri, content: finalContent };
      if (mode) (result as { mode?: string }).mode = mode;
      if (wait) (result as { wait?: boolean }).wait = true;
      return result;
    }
    case "read": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory read <uri>" };
      return { op: "read", uri };
    }
    case "ls": {
      const uri = effectiveArgs[0] ?? scopeUri;
      if (!uri) return { error: "Missing URI. Usage: teamsland memory ls <uri>" };
      const recursive = extractFlag(effectiveArgs, "--recursive");
      const simple = extractFlag(effectiveArgs, "--simple");
      const result: ParsedMemoryArgs = { op: "ls", uri };
      if (recursive) (result as { recursive?: boolean }).recursive = true;
      if (simple) (result as { simple?: boolean }).simple = true;
      return result;
    }
    case "mkdir": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory mkdir <uri>" };
      const description = extractOption(effectiveArgs, "--description");
      const result: ParsedMemoryArgs = { op: "mkdir", uri };
      if (description) (result as { description?: string }).description = description;
      return result;
    }
    case "rm": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory rm <uri>" };
      const recursive = extractFlag(effectiveArgs, "--recursive");
      const result: ParsedMemoryArgs = { op: "rm", uri };
      if (recursive) (result as { recursive?: boolean }).recursive = true;
      return result;
    }
    case "mv": {
      const fromUri = effectiveArgs[0];
      const toUri = effectiveArgs[1];
      if (!fromUri || !toUri) return { error: "Missing URIs. Usage: teamsland memory mv <from-uri> <to-uri>" };
      return { op: "mv", fromUri, toUri };
    }
    case "abstract": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory abstract <uri>" };
      return { op: "abstract", uri };
    }
    case "overview": {
      const uri = effectiveArgs[0];
      if (!uri) return { error: "Missing URI. Usage: teamsland memory overview <uri>" };
      return { op: "overview", uri };
    }
    case "find": {
      const query = effectiveArgs[0];
      if (!query) return { error: "Missing query. Usage: teamsland memory find <query>" };
      const uri = extractOption(effectiveArgs, "--uri") ?? scopeUri;
      const limitStr = extractOption(effectiveArgs, "--limit");
      const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined;
      const since = extractOption(effectiveArgs, "--since");
      const until = extractOption(effectiveArgs, "--until");
      const result: ParsedMemoryArgs = { op: "find", query };
      if (uri) (result as { uri?: string }).uri = uri;
      if (limit) (result as { limit?: number }).limit = limit;
      if (since) (result as { since?: string }).since = since;
      if (until) (result as { until?: string }).until = until;
      return result;
    }
    case "grep": {
      const uri = effectiveArgs[0];
      const pattern = effectiveArgs[1];
      if (!uri || !pattern) return { error: "Missing URI or pattern. Usage: teamsland memory grep <uri> <pattern>" };
      const ignoreCase = extractFlag(effectiveArgs, "--ignore-case");
      const result: ParsedMemoryArgs = { op: "grep", uri, pattern };
      if (ignoreCase) (result as { ignoreCase?: boolean }).ignoreCase = true;
      return result;
    }
    case "glob": {
      const pattern = effectiveArgs[0];
      if (!pattern) return { error: "Missing pattern. Usage: teamsland memory glob <pattern>" };
      const uri = extractOption(effectiveArgs, "--uri") ?? scopeUri;
      const result: ParsedMemoryArgs = { op: "glob", pattern };
      if (uri) (result as { uri?: string }).uri = uri;
      return result;
    }
    default:
      return { error: `Unknown subcommand: ${op}. Available: write, read, ls, mkdir, rm, mv, abstract, overview, find, grep, glob` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx --bun vitest run packages/cli/src/__tests__/memory.test.ts`
Expected: PASS (all 21 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/memory.ts packages/cli/src/__tests__/memory.test.ts
git commit -m "feat(cli): add memory arg parsing with scope resolution and tests"
```

---

### Task 5: Implement runMemory command execution and wire into index.ts

**Files:**
- Modify: `packages/cli/src/commands/memory.ts` (add `runMemory` function)
- Modify: `packages/cli/src/index.ts:1-10` (add import) and `packages/cli/src/index.ts:130-158` (add case)

- [ ] **Step 1: Add runMemory to memory.ts**

Append to the end of `packages/cli/src/commands/memory.ts`:

```typescript
// ─── Command Execution ───

export async function runMemory(client: TeamslandClient, args: string[], jsonOutput: boolean): Promise<void> {
  const parsed = parseMemoryArgs(args);
  if ("error" in parsed) {
    printError(parsed.error);
    process.exit(1);
  }

  switch (parsed.op) {
    case "write": {
      const result = await client.vikingWrite(parsed.uri, parsed.content, {
        mode: parsed.mode,
        wait: parsed.wait,
      });
      if (jsonOutput) {
        printJson(result);
      } else {
        const mode = parsed.mode ?? "replace";
        printLine(`Written: ${parsed.uri} (${mode}, ${parsed.content.length} bytes)`);
      }
      break;
    }
    case "read": {
      const result = await client.vikingRead(parsed.uri);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(result.result);
      }
      break;
    }
    case "ls": {
      const result = await client.vikingLs(parsed.uri, {
        recursive: parsed.recursive,
        simple: parsed.simple,
      });
      if (jsonOutput) {
        printJson(result);
      } else {
        const entries = result.result as Array<{ name: string; isDir?: boolean; uri?: string }>;
        for (const entry of entries) {
          const type = entry.isDir ? "dir " : "file";
          printLine(`  ${type}  ${entry.name}`);
        }
        printLine(`\n${entries.length} entries`);
      }
      break;
    }
    case "mkdir": {
      const result = await client.vikingMkdir(parsed.uri, parsed.description);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(`Created: ${parsed.uri}`);
      }
      break;
    }
    case "rm": {
      const result = await client.vikingRm(parsed.uri, parsed.recursive);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(`Deleted: ${parsed.uri}`);
      }
      break;
    }
    case "mv": {
      const result = await client.vikingMv(parsed.fromUri, parsed.toUri);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(`Moved: ${parsed.fromUri} → ${parsed.toUri}`);
      }
      break;
    }
    case "abstract": {
      const result = await client.vikingAbstract(parsed.uri);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(result.result);
      }
      break;
    }
    case "overview": {
      const result = await client.vikingOverview(parsed.uri);
      if (jsonOutput) {
        printJson(result);
      } else {
        printLine(result.result);
      }
      break;
    }
    case "find": {
      const result = await client.vikingFind(parsed.query, {
        targetUri: parsed.uri,
        limit: parsed.limit,
        since: parsed.since,
        until: parsed.until,
      }) as { memories: Array<{ uri: string; abstract: string; score: number }>; resources: Array<{ uri: string; abstract: string; score: number }>; skills: Array<{ uri: string; abstract: string; score: number }>; total: number };
      if (jsonOutput) {
        printJson(result);
      } else {
        const items = [...(result.memories ?? []), ...(result.resources ?? []), ...(result.skills ?? [])];
        if (items.length === 0) {
          printLine("No results found.");
        } else {
          for (const item of items) {
            printLine(`  [${item.score?.toFixed(2) ?? "?"}] ${item.uri}`);
            printLine(`         ${item.abstract?.slice(0, 120) ?? ""}`);
          }
          printLine(`\n${items.length} results`);
        }
      }
      break;
    }
    case "grep": {
      const result = await client.vikingGrep(parsed.uri, parsed.pattern, {
        caseInsensitive: parsed.ignoreCase,
      }) as { matches: Array<{ uri: string; line: number; content: string }>; count: number };
      if (jsonOutput) {
        printJson(result);
      } else {
        if (result.count === 0) {
          printLine("No matches found.");
        } else {
          for (const m of result.matches) {
            printLine(`  ${m.uri}:${m.line}: ${m.content}`);
          }
          printLine(`\n${result.count} matches`);
        }
      }
      break;
    }
    case "glob": {
      const result = await client.vikingGlob(parsed.pattern, parsed.uri) as { matches: string[]; count: number };
      if (jsonOutput) {
        printJson(result);
      } else {
        if (result.count === 0) {
          printLine("No matches found.");
        } else {
          for (const uri of result.matches) {
            printLine(`  ${uri}`);
          }
          printLine(`\n${result.count} matches`);
        }
      }
      break;
    }
  }
}
```

- [ ] **Step 2: Wire into index.ts — add import**

At the top of `packages/cli/src/index.ts`, add import:

```typescript
import { runMemory } from "./commands/memory.js";
```

- [ ] **Step 3: Wire into index.ts — add case**

In the switch statement (around line 130), add before `default:`:

```typescript
      case "memory":
        await runMemory(client, commandArgs, jsonOutput);
        break;
```

- [ ] **Step 4: Update HELP_TEXT**

In the `HELP_TEXT` constant, add to the Commands section:

```
  memory <op>  Manage OpenViking memories (write, read, ls, find, ...)
```

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/memory.ts packages/cli/src/index.ts
git commit -m "feat(cli): add teamsland memory command with all sub-commands"
```

---

### Task 6: Add memory-management skill to coordinator-init.ts

**Files:**
- Modify: `apps/server/src/coordinator-init.ts:11-21` (WORKSPACE_DIRS)
- Modify: `apps/server/src/coordinator-init.ts:83-140` (writeWorkspaceFiles)
- Modify: `apps/server/src/coordinator-init.ts:781-787` (validateWorkspace required files)

- [ ] **Step 1: Add memoryManagement to WORKSPACE_DIRS**

In `apps/server/src/coordinator-init.ts`, add to the `WORKSPACE_DIRS` constant (around line 20):

```typescript
  memoryManagement: ".claude/skills/memory-management",
```

- [ ] **Step 2: Add generateMemoryManagementSkill function**

Add a new function (near the other `generate*Skill` functions):

```typescript
function generateMemoryManagementSkill(): string {
  return `---
name: memory-management
description: 管理 OpenViking 长期记忆 — 与 Claude Code 内置记忆互补，用于存储事实、经历、经验等低频访问的被动记忆
allowed-tools: Bash(teamsland memory *)
---

# 记忆管理

你有两套记忆系统，各有分工：

## 记忆分层

### Claude Code 内置记忆（CLAUDE.md / .claude/memory/）
**定位：主动记忆 — 人格与约束层**

每次对话都会加载，适合存放：
- 身份与角色定义（"你是团队的 AI 大管家"）
- 行为约束与决策规则（"不主动推送到 main 分支"）
- 团队背景与组织结构（"前端用 React，后端用 Go"）
- 协作偏好（"用中文回复"、"回复要简洁"）

特点：**高频访问、小体量、每次对话都需要**

### OpenViking 记忆（teamsland memory 命令）
**定位：被动记忆 — 事实与经验层**

按需语义检索，适合存放：
- 具体事件和经历（"2026-03-15 部署 Project X 时遇到端口冲突，改了 nginx 配置解决"）
- 问题-方案案例（"仓库 A 的 CI 经常因为 lint timeout 失败，需要先本地跑一遍"）
- 用户的具体偏好细节（"alice 习惯用 rebase 而不是 merge"、"bob 的代码审查关注性能"）
- 项目事实（"项目 X 的 API 限流是 100 QPS"、"staging 环境的数据库是只读副本"）
- 工作流经验（"这个团队的 PR 需要两个人 approve"）

特点：**低频访问、可能大体量、需要时语义检索召回**

## 判断标准

| 问自己 | → Claude Code 内置 | → OpenViking |
|--------|-------------------|-------------|
| 几乎每次对话都需要？ | 是 | 否 |
| 是身份/约束/大方向？ | 是 | 否 |
| 是具体事件/案例/事实？ | 否 | 是 |
| 内容会随时间积累变多？ | 否（应精简） | 是（正常积累） |
| 需要语义检索才能找到？ | 否（全量加载） | 是 |

灰色地带：如果一条信息现在高频使用但未来会降频（如"当前正在迁移数据库到 PostgreSQL"），先放 OpenViking，等确认长期有效后再考虑是否提升到 Claude Code 内置记忆。

## 何时主动记忆

- 任务执行中发现的可复用经验（踩坑、解法、最佳实践）
- 用户明确表达但不属于"每次对话都要知道"的偏好细节
- 重要的项目事实和技术决策的背景原因
- **不要记忆**：可以从代码或 git 历史直接获取的信息
- **不要记忆**：临时的、仅当前对话有用的上下文

## 何时主动检索

Agent 记忆**不会自动注入你的上下文**。当你认为历史经验可能对当前任务有帮助时，主动使用 \`teamsland memory find\` 检索。典型场景：
- 处理一个类似之前解决过的问题
- 用户提到了某个你可能记录过的项目或技术细节
- 需要回忆某个团队约定或流程

## URI 命名空间

| 类型 | URI 前缀 | 何时使用 |
|------|---------|---------|
| Agent 记忆 | \`viking://agent/teamsland/memories/\` | 团队级知识、工作模式、技术决策 |
| 用户记忆 | \`viking://user/<userId>/memories/\` | 特定用户的偏好和背景 |
| 资源 | \`viking://resources/\` | 文档、任务记录等结构化资源 |

## 常用操作

### 记住新知识
\`\`\`bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \\
  --content "## 热修复部署流程\\n\\n1. 从 main 拉分支 ..." \\
  --mode create
\`\`\`

### 检索相关记忆
\`\`\`bash
teamsland memory find "部署流程" --scope agent --limit 5
\`\`\`

### 更新已有记忆
\`\`\`bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \\
  --content "更新后的内容..." --mode replace
\`\`\`

### 浏览记忆结构
\`\`\`bash
teamsland memory ls viking://agent/teamsland/memories/ --recursive
\`\`\`

### 删除过时记忆
\`\`\`bash
teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md
\`\`\`

### 查看摘要
\`\`\`bash
teamsland memory abstract viking://agent/teamsland/memories/cases/
\`\`\`

## scope 快捷方式

\`--scope agent\`  → \`viking://agent/teamsland/memories/\`
\`--scope user --user <id>\`  → \`viking://user/<id>/memories/\`
\`--scope tasks\`  → \`viking://resources/tasks/\`
\`--scope resources\`  → \`viking://resources/\`

## 记忆文件规范

- 使用 Markdown 格式，文件名语义化（如 \`deploy-hotfix.md\`、\`alice-preferences.md\`）
- cases/ 下存问题-方案案例
- patterns/ 下存交互模式和工作流
- preferences/ 下存用户偏好（放在对应用户的 URI 下）
- 记忆内容简洁，聚焦"为什么"和"怎么做"，避免冗余
`;
}
```

- [ ] **Step 3: Add skill to writeWorkspaceFiles array**

In the `files` array (around line 128), add:

```typescript
    {
      path: join(basePath, WORKSPACE_DIRS.memoryManagement, "SKILL.md"),
      content: generateMemoryManagementSkill(),
    },
```

- [ ] **Step 4: Add to validateWorkspace required files**

In the `required` array (around line 786), add:

```typescript
    join(WORKSPACE_DIRS.memoryManagement, "SKILL.md"),
```

- [ ] **Step 5: Update coordinator-init test**

In `apps/server/src/__tests__/coordinator-init.test.ts`, add assertion to the "创建完整的工作区目录结构" test:

```typescript
    expect(existsSync(join(workspacePath, ".claude", "skills", "memory-management", "SKILL.md"))).toBe(true);
```

- [ ] **Step 6: Run tests**

Run: `bunx --bun vitest run apps/server/src/__tests__/coordinator-init.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/coordinator-init.ts apps/server/src/__tests__/coordinator-init.test.ts
git commit -m "feat(coordinator): add memory-management skill with memory layering guidance"
```

---

### Task 7: Remove agent memory passive recall from LiveContextLoader

**Files:**
- Modify: `apps/server/src/coordinator-context.ts:75-99` (load method)
- Modify: `apps/server/src/coordinator-context.ts:104-131` (buildFetches method)

- [ ] **Step 1: Update buildFetches return type and remove agentMemFetch**

In `apps/server/src/coordinator-context.ts`, replace the `buildFetches` method (lines 104-131):

```typescript
  private buildFetches(
    query: string,
    requesterId: string | undefined,
    coordSessionId: string,
  ): [Promise<string>, Promise<FindResult>, Promise<FindResult>, Promise<SessionContext>] {
    const empty: FindResult = { memories: [], resources: [], skills: [], total: 0 };

    const tasksFetch = query
      ? this.vikingClient.find(query, { targetUri: "viking://resources/tasks/active/", limit: 5 })
      : Promise.resolve(empty);

    const userMemFetch =
      query && requesterId
        ? this.vikingClient.find(query, { targetUri: `viking://user/${requesterId}/memories/`, limit: 3 })
        : Promise.resolve(empty);

    return [
      this.loadTaskStateSummary(),
      tasksFetch,
      userMemFetch,
      this.vikingClient.getSessionContext(coordSessionId, 8000),
    ];
  }
```

- [ ] **Step 2: Update load method to match new 4-element tuple**

Replace the destructuring and processing in `load()` (lines 81-97):

```typescript
      const fetches = this.buildFetches(query, requesterId, coordSessionId);
      const [taskResult, vikingTasksResult, userMemResult, sessionResult] =
        await Promise.allSettled(fetches);

      const taskSummary = taskResult.status === "fulfilled" ? taskResult.value : "";
      const vikingTasks =
        vikingTasksResult.status === "fulfilled" ? formatFindResult(vikingTasksResult.value, "活跃任务") : "";
      const userMem = userMemResult.status === "fulfilled" ? formatFindResult(userMemResult.value, "用户记忆") : "";
      const sessionCtx = sessionResult.status === "fulfilled" ? formatSessionContext(sessionResult.value) : "";

      return {
        taskStateSummary: [taskSummary, vikingTasks].filter(Boolean).join("\n"),
        recentMessages: sessionCtx,
        relevantMemories: userMem,
      };
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run all tests**

Run: `bun run test:run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/coordinator-context.ts
git commit -m "refactor(coordinator): remove agent memory passive recall from LiveContextLoader

Coordinator now retrieves agent memories on demand via teamsland memory find,
reducing prompt noise. User memory passive recall is retained."
```

---

### Task 8: Final verification

- [ ] **Step 1: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `bun run test:run`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Verify CLI help text**

Run: `bun run packages/cli/src/index.ts --help`
Expected: Shows `memory <op>` in the Commands section

- [ ] **Step 5: Verify memory subcommand help**

Run: `bun run packages/cli/src/index.ts memory`
Expected: Shows error with usage listing all sub-commands
