# @teamsland/context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/context` package — a dynamic initial prompt assembler that builds a structured 5-section prompt string for injection into Claude Code processes at Agent startup. Provides `DynamicContextAssembler`, `TemplateLoader`, and `AssemblerOptions` as the public API.

**Architecture:** Three source files: `template-loader.ts` (TemplateLoader — role instruction template loader using Bun.file()), `assembler.ts` (DynamicContextAssembler — 5-section §A–§E prompt builder with Promise.all parallelism), and `index.ts` (barrel re-exports). Two test files in `__tests__/`. All dependencies injected via constructor — no global state.

**Tech Stack:** TypeScript (strict), Bun, Vitest (run via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/context` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has dependencies on `@teamsland/types`, `@teamsland/memory`, and `@teamsland/config`. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-context-design.md`.

**Testing approach:** All tests inject fake dependencies (FakeMemoryStore, FakeEmbedder, FakeRepoMapping). No sqlite-vec required. Tests always run without `describe.skipIf`.

**5-section prompt structure:**
- §A — Issue 上下文 (from `task.meegoEvent` + `task.description`)
- §B — 历史记忆 (from `retrieve(memoryStore, embedder, task.description, teamId)`)
- §C — 可用技能 (from `config.skillRouting[task.triggerType]`)
- §D — 仓库信息 (from `repoMapping.resolve(task.meegoProjectId)` + `task.worktreePath`)
- §E — 角色指令 (from `TemplateLoader.load(task.agentRole)`)

**Observability:** Uses `createLogger("context:assembler")` and `createLogger("context:template-loader")` per Observability-First requirement. The `@teamsland/observability` package must be added to `package.json` dependencies.

## Critical Files

- **Modify:** `packages/context/package.json` (add `@teamsland/observability` dependency)
- **Create:** `packages/context/src/template-loader.ts`
- **Create:** `packages/context/src/assembler.ts`
- **Modify:** `packages/context/src/index.ts` (barrel exports)
- **Create:** `packages/context/src/__tests__/template-loader.test.ts`
- **Create:** `packages/context/src/__tests__/assembler.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- `Bun.file()` for file reading (not `node:fs`)
- Run tests with: `bunx --bun vitest run packages/context/`
- Run typecheck with: `bunx tsc --noEmit --project packages/context/tsconfig.json`
- Run lint with: `bunx biome check packages/context/src/`

## Shared Test Helpers

All test files share fake implementations defined inline (not exported). Define these at the top of each test file that needs them:

### FakeMemoryStore

```typescript
import type { MemoryEntry, AbstractMemoryStore } from "@teamsland/types";

/**
 * 用于测试的假记忆存储
 *
 * 返回固定的记忆条目，不依赖真实 SQLite 或 sqlite-vec。
 */
class FakeMemoryStore implements AbstractMemoryStore {
  constructor(private readonly entries: MemoryEntry[] = []) {}

  async vectorSearch(_queryVec: number[], _limit?: number): Promise<MemoryEntry[]> {
    return this.entries;
  }

  async writeEntry(_entry: MemoryEntry): Promise<void> {}

  async exists(_teamId: string, _hash: string): Promise<boolean> {
    return false;
  }

  async listAbstracts(_teamId: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) =>
      ["profile", "preferences", "entities", "soul", "identity"].includes(e.memoryType),
    );
  }

  async ftsSearch(_query: string, _limit?: number): Promise<MemoryEntry[]> {
    return this.entries;
  }
}
```

### FakeEmbedder

```typescript
import type { Embedder } from "@teamsland/memory";

/**
 * 用于测试的假 Embedding 生成器
 *
 * 返回确定性的固定向量，无模型加载开销。
 */
class FakeEmbedder implements Embedder {
  async init(): Promise<void> {}
  async embed(_text: string): Promise<number[]> {
    return new Array(512).fill(0.1);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(512).fill(0.1));
  }
}
```

### FakeRepoMapping

```typescript
/**
 * 用于测试的假仓库映射
 */
class FakeRepoMapping {
  resolve(projectId: string): Array<{ path: string; name: string }> {
    if (projectId === "PROJ-001") {
      return [{ path: "/repos/frontend", name: "前端仓库" }];
    }
    return [];
  }
}
```

---

### Task 1: Add @teamsland/observability to package.json

**Files:**
- Modify: `packages/context/package.json`

- [ ] **Step 1: Add observability dependency**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/context/package.json`:

```json
{
  "name": "@teamsland/context",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/memory": "workspace:*",
    "@teamsland/config": "workspace:*",
    "@teamsland/observability": "workspace:*"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`
Expected: Resolves without errors

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/context/package.json bun.lockb && git commit -m "$(cat <<'EOF'
chore(context): add @teamsland/observability dependency

Required for createLogger usage in template-loader and assembler.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Create template-loader.ts (TDD)

**Files:**
- Create: `packages/context/src/template-loader.ts`
- Create: `packages/context/src/__tests__/template-loader.test.ts`

Pure static class with a single async method — ideal TDD target. Tests use a temporary directory to decouple from the real filesystem.

- [ ] **Step 1: Create template-loader test**

Create `/Users/bytedance/workspace/teamsland/packages/context/src/__tests__/template-loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TemplateLoader } from "../template-loader.js";

describe("TemplateLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "context-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("加载存在的模板文件", async () => {
    const content = "# 前端 Agent 指令\n\n你是一个前端开发 Agent。";
    await writeFile(join(tempDir, "frontend-dev.md"), content);
    const result = await TemplateLoader.load("frontend-dev", tempDir);
    expect(result).toBe(content);
  });

  it("文件不存在时抛出错误", async () => {
    await expect(TemplateLoader.load("non-existent", tempDir)).rejects.toThrow(
      "角色模板文件不存在",
    );
  });

  it("文件内容为空时返回空字符串", async () => {
    await writeFile(join(tempDir, "empty.md"), "");
    const result = await TemplateLoader.load("empty", tempDir);
    expect(result).toBe("");
  });

  it("自定义 basePath 参数从指定目录加载", async () => {
    const content = "# 技术评审 Agent 指令";
    await writeFile(join(tempDir, "tech-spec.md"), content);
    const result = await TemplateLoader.load("tech-spec", tempDir);
    expect(result).toBe(content);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/context/src/__tests__/template-loader.test.ts`
Expected: FAIL — `../template-loader.js` does not exist

- [ ] **Step 3: Create template-loader.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/context/src/template-loader.ts`:

```typescript
import { createLogger } from "@teamsland/observability";

const logger = createLogger("context:template-loader");

/**
 * 角色指令模板加载器
 *
 * 从本地 Markdown 文件读取 Agent 角色的指令模板。
 * 模板路径约定：`{basePath}/{agentRole}.md`
 * 文件不存在时立即抛出，不返回空字符串（fail-fast）。
 *
 * @example
 * const content = await TemplateLoader.load("frontend-dev");
 * // 读取 config/templates/frontend-dev.md 并返回内容
 */
export class TemplateLoader {
  /**
   * 加载指定角色的指令模板
   *
   * @param agentRole - Agent 角色标识符（如 "frontend-dev"、"tech-spec"）
   * @param basePath - 模板目录路径，默认为 "config/templates"
   * @returns 模板文件内容字符串
   * @throws 若文件不存在则抛出 Error
   *
   * @example
   * // 加载前端开发角色模板
   * const template = await TemplateLoader.load("frontend-dev", "config/templates");
   * console.log(template); // "# 前端开发 Agent 指令\n..."
   */
  static async load(agentRole: string, basePath = "config/templates"): Promise<string> {
    const filePath = `${basePath}/${agentRole}.md`;
    logger.debug({ agentRole, filePath }, "加载角色模板");

    const file = Bun.file(filePath);
    const exists = await file.exists();
    if (!exists) {
      throw new Error(`角色模板文件不存在: ${filePath}`);
    }

    const content = await file.text();
    logger.debug({ agentRole, bytes: content.length }, "角色模板加载成功");
    return content;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/context/src/__tests__/template-loader.test.ts`
Expected: All 4 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/context/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/context/src/template-loader.ts packages/context/src/__tests__/template-loader.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/context/src/template-loader.ts packages/context/src/__tests__/template-loader.test.ts && git commit -m "$(cat <<'EOF'
feat(context): add template-loader.ts — TemplateLoader role template reader

TDD: 4 tests covering existing file load, missing file error,
empty file, and custom basePath parameter. Uses Bun.file() per
project conventions; fail-fast on missing template.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Create assembler.ts (TDD)

**Files:**
- Create: `packages/context/src/assembler.ts`
- Create: `packages/context/src/__tests__/assembler.test.ts`

Core assembler. All tests use fake dependencies (FakeMemoryStore, FakeEmbedder, FakeRepoMapping) — no sqlite-vec or real model required. Tests always run without `describe.skipIf`.

- [ ] **Step 1: Create assembler test**

Create `/Users/bytedance/workspace/teamsland/packages/context/src/__tests__/assembler.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamicContextAssembler } from "../assembler.js";
import type { TaskConfig, AppConfig, MemoryEntry, AbstractMemoryStore } from "@teamsland/types";
import type { Embedder } from "@teamsland/memory";

// --- Fake dependencies ---

class FakeMemoryStore implements AbstractMemoryStore {
  constructor(private readonly entries: MemoryEntry[] = []) {}

  async vectorSearch(_queryVec: number[], _limit?: number): Promise<MemoryEntry[]> {
    return this.entries;
  }

  async writeEntry(_entry: MemoryEntry): Promise<void> {}

  async exists(_teamId: string, _hash: string): Promise<boolean> {
    return false;
  }

  async listAbstracts(_teamId: string): Promise<MemoryEntry[]> {
    return this.entries.filter((e) =>
      ["profile", "preferences", "entities", "soul", "identity"].includes(e.memoryType),
    );
  }

  async ftsSearch(_query: string, _limit?: number): Promise<MemoryEntry[]> {
    return this.entries;
  }
}

class FakeEmbedder implements Embedder {
  async init(): Promise<void> {}
  async embed(_text: string): Promise<number[]> {
    return new Array(512).fill(0.1);
  }
  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => new Array(512).fill(0.1));
  }
}

class FakeRepoMapping {
  resolve(projectId: string): Array<{ path: string; name: string }> {
    if (projectId === "PROJ-001") {
      return [{ path: "/repos/frontend", name: "前端仓库" }];
    }
    return [];
  }
}

// --- Test config ---

const mockConfig: AppConfig = {
  skillRouting: {
    frontend: ["frontend-scaffold", "component-generator", "oauth-integration"],
    backend: ["api-generator", "db-migration"],
  },
} as unknown as AppConfig;

const mockTask: TaskConfig = {
  issueId: "ISSUE-001",
  meegoEvent: {
    eventId: "evt-1",
    issueId: "ISSUE-001",
    projectKey: "PROJ-ALPHA",
    type: "issue.created",
    payload: {},
    timestamp: Date.now(),
  },
  meegoProjectId: "PROJ-001",
  description: "实现用户登录功能",
  triggerType: "frontend",
  agentRole: "frontend-dev",
  worktreePath: "/repos/frontend/.worktrees/req-ISSUE-001",
  assigneeId: "user-001",
};

// --- Tests ---

describe("DynamicContextAssembler", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "assembler-test-"));
    await writeFile(
      join(tempDir, "frontend-dev.md"),
      "# 前端开发 Agent 指令\n\n你是前端开发 Agent。",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function buildAssembler(templateBasePath: string) {
    return new DynamicContextAssembler({
      config: mockConfig,
      repoMapping: new FakeRepoMapping() as unknown as import("@teamsland/config").RepoMapping,
      memoryStore: new FakeMemoryStore(),
      embedder: new FakeEmbedder(),
      templateBasePath,
    });
  }

  it("输出包含全部 5 段标题", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("§A — Issue 上下文");
    expect(prompt).toContain("§B — 历史记忆");
    expect(prompt).toContain("§C — 可用技能");
    expect(prompt).toContain("§D — 仓库信息");
    expect(prompt).toContain("§E — 角色指令");
  });

  it("§A 正确渲染 Meego 事件字段", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("ISSUE-001");
    expect(prompt).toContain("PROJ-ALPHA");
    expect(prompt).toContain("issue.created");
  });

  it("§A 包含任务描述", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("实现用户登录功能");
  });

  it("§B 包含 FakeMemoryStore 返回的记忆条目", async () => {
    const entry: MemoryEntry = {
      id: "mem-1",
      teamId: "team-001",
      agentId: "agent-fe",
      memoryType: "patterns",
      content: "团队使用 shadcn/ui 组件库",
      accessCount: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
      toDict: () => ({}),
      toVectorPoint: () => ({ id: "mem-1", vector: [], payload: {} }),
    };
    const assembler = new DynamicContextAssembler({
      config: mockConfig,
      repoMapping: new FakeRepoMapping() as unknown as import("@teamsland/config").RepoMapping,
      memoryStore: new FakeMemoryStore([entry]),
      embedder: new FakeEmbedder(),
      templateBasePath: tempDir,
    });
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("团队使用 shadcn/ui 组件库");
  });

  it("§C 包含 skillRouting 对应的技能列表", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("frontend-scaffold");
    expect(prompt).toContain("component-generator");
    expect(prompt).toContain("oauth-integration");
  });

  it("§C triggerType 无对应路由时段落仍存在但技能列表为空", async () => {
    const taskWithUnknownTrigger = { ...mockTask, triggerType: "unknown-type" };
    const assembler = buildAssembler(tempDir);
    await writeFile(join(tempDir, "frontend-dev.md"), "# 角色指令");
    const prompt = await assembler.buildInitialPrompt(taskWithUnknownTrigger, "team-001");
    expect(prompt).toContain("§C — 可用技能");
    // 技能列表为空，不包含任何具体技能名
    expect(prompt).not.toContain("frontend-scaffold");
  });

  it("§D 包含 FakeRepoMapping 返回的仓库路径", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("/repos/frontend");
    expect(prompt).toContain("前端仓库");
  });

  it("§D 包含工作树路径", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain(mockTask.worktreePath);
  });

  it("§E 包含角色模板内容", async () => {
    const assembler = buildAssembler(tempDir);
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("你是前端开发 Agent。");
  });

  it("模板文件不存在时抛出错误", async () => {
    const assembler = buildAssembler(tempDir);
    const badTask = { ...mockTask, agentRole: "non-existent-role" };
    await expect(assembler.buildInitialPrompt(badTask, "team-001")).rejects.toThrow(
      "角色模板文件不存在",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/context/src/__tests__/assembler.test.ts`
Expected: FAIL — `../assembler.js` does not exist

- [ ] **Step 3: Create assembler.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/context/src/assembler.ts`:

```typescript
import type { AppConfig, TaskConfig } from "@teamsland/types";
import type { AbstractMemoryStore } from "@teamsland/types";
import type { Embedder } from "@teamsland/memory";
import type { RepoMapping } from "@teamsland/config";
import { retrieve } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import { TemplateLoader } from "./template-loader.js";

const logger = createLogger("context:assembler");

/**
 * DynamicContextAssembler 构造参数
 *
 * @example
 * ```typescript
 * import type { AssemblerOptions } from "@teamsland/context";
 *
 * const opts: AssemblerOptions = {
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 *   memoryStore,
 *   embedder,
 *   templateBasePath: "config/templates",
 * };
 * ```
 */
export interface AssemblerOptions {
  /** 全局应用配置（含技能路由） */
  config: AppConfig;
  /** Meego 项目到 Git 仓库的映射 */
  repoMapping: RepoMapping;
  /** 团队记忆存储（用于记忆检索） */
  memoryStore: AbstractMemoryStore;
  /** Embedding 生成器（用于向量检索） */
  embedder: Embedder;
  /** 角色模板目录路径，默认为 "config/templates" */
  templateBasePath?: string;
}

/**
 * 动态初始提示词组装器
 *
 * 在每次 Claude Code 进程启动前调用，将 5 个信息段组装为结构化提示词。
 * 由 Sidecar 在 spawn Agent 进程时注入为初始上下文。
 *
 * 5 段结构：
 * - §A — Issue 上下文（task.meegoEvent + task.description）
 * - §B — 历史记忆（retrieve 检索结果）
 * - §C — 可用技能（config.skillRouting 路由表）
 * - §D — 仓库信息（repoMapping.resolve + task.worktreePath）
 * - §E — 角色指令（TemplateLoader 加载的 Markdown 模板）
 *
 * @example
 * ```typescript
 * import { DynamicContextAssembler } from "@teamsland/context";
 *
 * const assembler = new DynamicContextAssembler({
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 *   memoryStore,
 *   embedder,
 * });
 * const prompt = await assembler.buildInitialPrompt(task, "team-001");
 * // 返回包含 §A–§E 五段的完整提示词字符串
 * ```
 */
export class DynamicContextAssembler {
  private readonly config: AppConfig;
  private readonly repoMapping: RepoMapping;
  private readonly memoryStore: AbstractMemoryStore;
  private readonly embedder: Embedder;
  private readonly templateBasePath: string;

  constructor(opts: AssemblerOptions) {
    this.config = opts.config;
    this.repoMapping = opts.repoMapping;
    this.memoryStore = opts.memoryStore;
    this.embedder = opts.embedder;
    this.templateBasePath = opts.templateBasePath ?? "config/templates";
  }

  /**
   * 组装 Agent 启动时的初始提示词
   *
   * 并发执行 5 段内容构建（Promise.all），总延迟由最慢的一段决定。
   * 通常 §B（向量检索）耗时最长。
   *
   * @param task - 当前任务配置
   * @param teamId - 团队 ID，用于记忆检索作用域隔离
   * @returns 组装完成的提示词字符串
   *
   * @example
   * ```typescript
   * const prompt = await assembler.buildInitialPrompt(task, "team-alpha");
   * // prompt 示例：
   * // ## §A — Issue 上下文
   * // Issue ID: ISSUE-123
   * // ...
   * // ## §E — 角色指令
   * // # 前端开发 Agent 指令
   * // ...
   * ```
   */
  async buildInitialPrompt(task: TaskConfig, teamId: string): Promise<string> {
    logger.info({ issueId: task.issueId, teamId, agentRole: task.agentRole }, "开始组装初始提示词");

    const [sectionA, sectionB, sectionC, sectionD, sectionE] = await Promise.all([
      this.buildSectionA(task),
      this.buildSectionB(task, teamId),
      this.buildSectionC(task),
      this.buildSectionD(task),
      this.buildSectionE(task),
    ]);

    const prompt = [sectionA, sectionB, sectionC, sectionD, sectionE].join("\n\n");
    logger.info({ issueId: task.issueId, promptLength: prompt.length }, "初始提示词组装完成");
    return prompt;
  }

  /** §A — Issue 上下文 */
  private buildSectionA(task: TaskConfig): Promise<string> {
    const event = task.meegoEvent;
    const lines = [
      "## §A — Issue 上下文",
      `Issue ID: ${event.issueId}`,
      `项目 Key: ${event.projectKey}`,
      `事件类型: ${event.type}`,
      `任务描述: ${task.description}`,
    ];
    return Promise.resolve(lines.join("\n"));
  }

  /** §B — 历史记忆 */
  private async buildSectionB(task: TaskConfig, teamId: string): Promise<string> {
    logger.debug({ teamId, query: task.description }, "检索历史记忆");
    const memories = await retrieve(this.memoryStore, this.embedder, task.description, teamId);
    const memoryLines = memories.map((m) => `- [${m.memoryType}] ${m.content}`);
    return ["## §B — 历史记忆", ...memoryLines].join("\n");
  }

  /** §C — 可用技能 */
  private buildSectionC(task: TaskConfig): Promise<string> {
    const skills = this.config.skillRouting[task.triggerType] ?? [];
    logger.debug({ triggerType: task.triggerType, skillCount: skills.length }, "查询技能路由");
    const skillLines = skills.map((s) => `- ${s}`);
    return Promise.resolve(["## §C — 可用技能", ...skillLines].join("\n"));
  }

  /** §D — 仓库信息 */
  private buildSectionD(task: TaskConfig): Promise<string> {
    const repos = this.repoMapping.resolve(task.meegoProjectId);
    logger.debug({ meegoProjectId: task.meegoProjectId, repoCount: repos.length }, "解析仓库路径");
    const repoLines = repos.map((r) => `- ${r.name}: ${r.path}`);
    const lines = [
      "## §D — 仓库信息",
      ...repoLines,
      `工作树路径: ${task.worktreePath}`,
    ];
    return Promise.resolve(lines.join("\n"));
  }

  /** §E — 角色指令 */
  private async buildSectionE(task: TaskConfig): Promise<string> {
    logger.debug({ agentRole: task.agentRole, basePath: this.templateBasePath }, "加载角色模板");
    const template = await TemplateLoader.load(task.agentRole, this.templateBasePath);
    return `## §E — 角色指令\n\n${template}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/context/src/__tests__/assembler.test.ts`
Expected: All 10 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/context/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/context/src/assembler.ts packages/context/src/__tests__/assembler.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/context/src/assembler.ts packages/context/src/__tests__/assembler.test.ts && git commit -m "$(cat <<'EOF'
feat(context): add assembler.ts — DynamicContextAssembler 5-section prompt builder

TDD: 10 tests covering all 5 sections (§A–§E), Meego event field rendering,
memory result inclusion, skill routing (including unknown triggerType),
repo path resolution, worktree path, template content, and error propagation.
All tests use fakes — no sqlite-vec or real model required.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update barrel exports in index.ts

**Files:**
- Modify: `packages/context/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/context/src/index.ts`:

```typescript
// @teamsland/context — DynamicContextAssembler + TemplateLoader
// 动态初始提示词组装器：5 段结构化 Prompt + 角色模板加载器

export { DynamicContextAssembler } from "./assembler.js";
export type { AssemblerOptions } from "./assembler.js";
export { TemplateLoader } from "./template-loader.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/context/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/context/src/index.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/context/src/index.ts && git commit -m "$(cat <<'EOF'
feat(context): add barrel exports — DynamicContextAssembler, AssemblerOptions, TemplateLoader

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Full Verification

- [ ] **Step 1: Run all context tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx --bun vitest run packages/context/`
Expected: All tests pass (template-loader: 4, assembler: 10 — total 14 tests, no skips)

- [ ] **Step 2: Run typecheck for context package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/context/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on entire context package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/context/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "
import {
  DynamicContextAssembler,
  TemplateLoader,
} from './packages/context/src/index.ts';
console.log('DynamicContextAssembler:', typeof DynamicContextAssembler);
console.log('TemplateLoader:', typeof TemplateLoader);
"`
Expected:
```
DynamicContextAssembler: function
TemplateLoader: function
```

- [ ] **Step 5: Verify no any or non-null assertions in source**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/context/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '!\.' packages/context/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No non-null assertions

- [ ] **Step 6: Verify file count**

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/context/src/*.ts | wc -l`
Expected: 3 (template-loader.ts, assembler.ts, index.ts)

Run: `cd /Users/bytedance/workspace/teamsland && ls packages/context/src/__tests__/*.test.ts | wc -l`
Expected: 2 (template-loader.test.ts, assembler.test.ts)

- [ ] **Step 7: Verify no describe.skipIf in tests**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn 'skipIf\|describe.skip' packages/context/src/__tests__/ --include='*.ts'`
Expected: No output (all tests always run — no sqlite-vec dependency)

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx --bun vitest run packages/context/` — all 14 tests pass, zero skips
2. `bunx tsc --noEmit --project packages/context/tsconfig.json` — exits 0
3. `bunx biome check packages/context/src/` — no errors
4. All exported functions/classes have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. All 3 exports from barrel: `DynamicContextAssembler`, `AssemblerOptions` (type), `TemplateLoader`
7. `assembler.ts` uses `createLogger("context:assembler")` for structured logging
8. `template-loader.ts` uses `createLogger("context:template-loader")` for structured logging
9. `TemplateLoader.load()` throws `Error("角色模板文件不存在: {path}")` when file missing
10. `DynamicContextAssembler.buildInitialPrompt()` uses `Promise.all` for concurrent section building
11. `templateBasePath` parameter on `AssemblerOptions` enables test isolation (no CWD dependency)
12. No `describe.skipIf` — all tests use fake dependencies and always run
13. `@teamsland/observability` added to `packages/context/package.json` dependencies
