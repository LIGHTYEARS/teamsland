# @teamsland/context — DynamicContextAssembler 设计

> 日期：2026-04-20
> 状态：已批准
> 依赖：`@teamsland/types`（TaskConfig、AppConfig、MeegoEvent），`@teamsland/memory`（retrieve、TeamMemoryStore、Embedder），`@teamsland/config`（RepoMapping），`@teamsland/observability`（createLogger）
> 范围：动态初始提示词组装器 — 5 段结构化 Prompt + 角色模板加载器

## 概述

`@teamsland/context` 负责在每次 Claude Code 进程启动时组装注入的初始提示词（initial prompt）。它从多个数据源（Meego 事件、团队记忆、技能路由、仓库映射、角色模板）收集信息，合并为一个结构化的 5 段提示词字符串，传递给 Sidecar 在 spawn 时注入。

**核心能力：**
- 从 `task.meegoEvent` 渲染 Issue 上下文（§A）
- 调用记忆检索 Pipeline 获取 L0 全量 + L1 向量 Top-10（§B）
- 从配置的技能路由表查找当前触发类型对应的技能列表（§C）
- 通过 `RepoMapping` 解析 Meego 项目对应的 Git 仓库路径（§D）
- 从本地 Markdown 模板文件加载 Agent 角色指令（§E）

---

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| Prompt 结构 | 5 段固定 §A–§E | 让 Claude Code 在启动时能预期每段内容的位置，减少解析歧义 |
| 记忆检索 | 直接调用 `@teamsland/memory` 的 `retrieve()` 函数 | 复用已有 L0+向量+FTS5 Pipeline，避免重复实现 |
| 角色模板 | 本地 Markdown 文件（`config/templates/{agentRole}.md`） | 模板与代码分离，支持非开发人员修改角色指令 |
| 模板未找到 | 抛出错误 | fail-fast，防止使用空提示词启动 Agent |
| 依赖注入 | 构造函数注入所有依赖 | 测试时可注入 fake，无全局状态 |
| 日志 | `createLogger("context:assembler")` 和 `createLogger("context:template-loader")` | 按照 Observability-First 原则，记录关键操作 |

---

## 文件结构

```
packages/context/src/
├── template-loader.ts    # TemplateLoader — 角色指令模板加载器
├── assembler.ts          # DynamicContextAssembler — 5 段提示词组装器
├── index.ts              # Barrel re-exports
└── __tests__/
    ├── template-loader.test.ts
    └── assembler.test.ts
```

---

## 依赖

```
@teamsland/types        — TaskConfig, AppConfig, MeegoEvent
@teamsland/memory       — retrieve 函数, TeamMemoryStore, Embedder（记忆召回）
@teamsland/config       — RepoMapping（仓库路径解析）
@teamsland/observability — createLogger
```

---

## TemplateLoader

```typescript
// packages/context/src/template-loader.ts

import { createLogger } from "@teamsland/observability";

const logger = createLogger("context:template-loader");

/**
 * 角色指令模板加载器
 *
 * 从本地 Markdown 文件读取 Agent 角色的指令模板。
 * 模板路径约定：`{basePath}/{agentRole}.md`
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

**关键约束：**
- 使用 `Bun.file()` 读取，遵循项目约定
- 文件不存在时立即抛出，不返回空字符串（fail-fast）
- `basePath` 参数允许测试时传入临时目录，解耦文件系统

---

## DynamicContextAssembler

```typescript
// packages/context/src/assembler.ts

import type { AppConfig, TaskConfig } from "@teamsland/types";
import type { TeamMemoryStore, Embedder } from "@teamsland/memory";
import type { RepoMapping } from "@teamsland/config";
import { retrieve } from "@teamsland/memory";
import { createLogger } from "@teamsland/observability";
import { TemplateLoader } from "./template-loader.js";

const logger = createLogger("context:assembler");

/**
 * DynamicContextAssembler 构造参数
 */
export interface AssemblerOptions {
  /** 全局应用配置（含技能路由） */
  config: AppConfig;
  /** Meego 项目到 Git 仓库的映射 */
  repoMapping: RepoMapping;
  /** 团队记忆存储（用于记忆检索） */
  memoryStore: TeamMemoryStore;
  /** Embedding 生成器（用于向量检索） */
  embedder: Embedder;
}

/**
 * 动态初始提示词组装器
 *
 * 在每次 Claude Code 进程启动前调用，将 5 个信息段组装为结构化提示词。
 * 由 Sidecar 在 spawn Agent 进程时注入为初始上下文。
 *
 * @example
 * const assembler = new DynamicContextAssembler({
 *   config,
 *   repoMapping: RepoMapping.fromConfig(config.repoMapping),
 *   memoryStore,
 *   embedder,
 * });
 * const prompt = await assembler.buildInitialPrompt(task, "team-001");
 * // 返回包含 §A–§E 五段的完整提示词字符串
 */
export class DynamicContextAssembler {
  private readonly config: AppConfig;
  private readonly repoMapping: RepoMapping;
  private readonly memoryStore: TeamMemoryStore;
  private readonly embedder: Embedder;

  constructor(opts: AssemblerOptions) {
    this.config = opts.config;
    this.repoMapping = opts.repoMapping;
    this.memoryStore = opts.memoryStore;
    this.embedder = opts.embedder;
  }

  /**
   * 组装 Agent 启动时的初始提示词
   *
   * 包含 5 段结构化内容（§A–§E），覆盖任务上下文、历史记忆、
   * 可用技能、仓库信息和角色指令。
   *
   * @param task - 当前任务配置
   * @param teamId - 团队 ID，用于记忆检索作用域隔离
   * @returns 组装完成的提示词字符串
   *
   * @example
   * const prompt = await assembler.buildInitialPrompt(task, "team-alpha");
   * // prompt 内容示例：
   * // ## §A — Issue 上下文
   * // Issue ID: ISSUE-123
   * // ...
   * // ## §B — 历史记忆
   * // ...
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
    const template = await this.loadTemplate(task.agentRole);
    return `## §E — 角色指令\n\n${template}`;
  }

  /**
   * 加载角色指令模板
   *
   * 从 `config/templates/{agentRole}.md` 加载模板内容。
   *
   * @param agentRole - Agent 角色标识符
   * @returns 模板文件内容字符串
   *
   * @example
   * const tpl = await assembler["loadTemplate"]("frontend-dev");
   */
  private async loadTemplate(agentRole: string): Promise<string> {
    const basePath = "config/templates";
    logger.debug({ agentRole, basePath }, "加载角色模板");
    return TemplateLoader.load(agentRole, basePath);
  }
}
```

---

## 5 段 Prompt 结构说明

| 段落 | 标题 | 数据来源 | 备注 |
|------|------|----------|------|
| §A | Issue 上下文 | `task.meegoEvent`（issueId、projectKey、type）+ `task.description` | 固定字段渲染，无异步 I/O |
| §B | 历史记忆 | `retrieve(memoryStore, embedder, task.description, teamId)` | L0 全量 + L1 向量 Top-10；结果按 `hotnessScore` 降序排列 |
| §C | 可用技能 | `config.skillRouting[task.triggerType]` | 若 triggerType 无对应路由，返回空列表 |
| §D | 仓库信息 | `repoMapping.resolve(task.meegoProjectId)` + `task.worktreePath` | 多仓库场景返回多行 |
| §E | 角色指令 | `TemplateLoader.load(task.agentRole)` | 从 `config/templates/{agentRole}.md` 读取 |

5 段并发执行（`Promise.all`），总延迟由最慢的一段决定（通常是 §B 的向量检索）。

---

## Prompt 输出示例

```
## §A — Issue 上下文
Issue ID: ISSUE-123
项目 Key: PROJ-ALPHA
事件类型: issue.created
任务描述: 实现用户登录页面，支持飞书 OAuth

## §B — 历史记忆
- [patterns] 前端统一使用 shadcn/ui 组件库，禁止引入新 UI 框架
- [decisions] OAuth 回调路由约定：/auth/callback/{provider}
- [preferences] 团队偏好 Tailwind CSS utility-first 写法

## §C — 可用技能
- frontend-scaffold
- component-generator
- oauth-integration

## §D — 仓库信息
- 前端主仓库: /home/runner/repos/frontend-main
- 设计系统仓库: /home/runner/repos/design-system
工作树路径: /home/runner/repos/frontend-main/.worktrees/req-ISSUE-123

## §E — 角色指令

# 前端开发 Agent 指令

你是团队的前端开发 Agent，专注于 React + TypeScript 技术栈...
```

---

## Barrel Exports

```typescript
// packages/context/src/index.ts

export { DynamicContextAssembler } from "./assembler.js";
export type { AssemblerOptions } from "./assembler.js";
export { TemplateLoader } from "./template-loader.js";
```

---

## 测试策略

### 测试原则

所有测试均注入 fake 依赖，**不使用真实 TeamMemoryStore**（无 sqlite-vec 依赖），测试始终可运行，无 `describe.skipIf`。

### FakeMemoryStore

```typescript
// __tests__/fakes.ts（测试辅助，不导出）

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

### template-loader.test.ts

| 测试用例 | 期望结果 |
|---------|---------|
| 传入临时目录下的 `.md` 文件路径 | 正确返回文件内容 |
| 文件不存在 | 抛出含文件路径信息的 Error |
| 文件内容为空 | 返回空字符串（不抛出） |
| 自定义 `basePath` 参数 | 从指定目录加载（不依赖 CWD） |

```typescript
// packages/context/src/__tests__/template-loader.test.ts

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
});
```

### assembler.test.ts

| 测试用例 | 期望结果 |
|---------|---------|
| `buildInitialPrompt` 返回包含 §A–§E 所有段落标题的字符串 | 5 个标题全部出现 |
| §A 包含 `task.meegoEvent` 中的 issueId、projectKey、eventType | 字段值正确渲染 |
| §B 包含 FakeMemoryStore 返回的记忆条目内容 | 记忆条目出现在输出中 |
| §C 包含 `config.skillRouting` 对应 triggerType 的技能列表 | 技能名称出现在输出中 |
| §C triggerType 无对应路由时 | §C 段落存在但技能列表为空 |
| §D 包含 FakeRepoMapping 返回的仓库路径和 `task.worktreePath` | 仓库路径和工作树路径均出现 |
| §E 包含角色模板文件的内容 | 模板内容出现在输出中 |
| 模板文件不存在时 `buildInitialPrompt` 抛出错误 | 错误向上传播，不静默吞咽 |

```typescript
// packages/context/src/__tests__/assembler.test.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamicContextAssembler } from "../assembler.js";
import type { TaskConfig, AppConfig } from "@teamsland/types";

// 测试用 TaskConfig
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

---

## 错误处理

| 场景 | 行为 |
|------|------|
| 角色模板文件不存在 | `TemplateLoader.load()` 抛出 `Error("角色模板文件不存在: {path}")`，由调用方决定处理策略 |
| `repoMapping.resolve()` 返回空数组 | §D 中仅保留工作树路径行，不抛出错误 |
| `config.skillRouting[triggerType]` 不存在 | `??` 操作符返回空数组，§C 段落内容为空列表 |
| 记忆检索 `retrieve()` 失败 | 错误向上传播，由 Sidecar 层决定重试或降级（不在本包内静默吞咽） |

---

## 验证标准

- `bunx tsc --noEmit --project packages/context/tsconfig.json` 零错误
- `bunx biome check packages/context/src/` 零错误
- `bunx vitest run packages/context/` 全部通过
- 所有导出的类/方法有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
- 测试不依赖真实 sqlite-vec，始终可运行（无 `describe.skipIf`）
- `TemplateLoader` 和 `DynamicContextAssembler` 均通过构造函数/参数注入依赖，无全局状态
