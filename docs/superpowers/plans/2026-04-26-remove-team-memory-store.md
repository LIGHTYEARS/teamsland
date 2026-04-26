# Remove TeamMemoryStore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the deprecated local SQLite memory system (TeamMemoryStore), keeping only OpenViking as the sole memory backend.

**Architecture:** Delete all TeamMemoryStore-related source files, types, config schemas, and config values. Prune all consumer references in server init, event handlers, scheduled tasks, and the context assembler. The Viking path is untouched.

**Tech Stack:** TypeScript, Bun, Vitest

---

### Task 1: Delete TeamMemoryStore source files from packages/memory

**Files:**
- Delete: `packages/memory/src/team-memory-store.ts`
- Delete: `packages/memory/src/null-memory-store.ts`
- Delete: `packages/memory/src/embedder.ts`
- Delete: `packages/memory/src/null-embedder.ts`
- Delete: `packages/memory/src/extract-loop.ts`
- Delete: `packages/memory/src/ingest.ts`
- Delete: `packages/memory/src/memory-reaper.ts`
- Delete: `packages/memory/src/memory-updater.ts`
- Delete: `packages/memory/src/retriever.ts`
- Delete: `packages/memory/src/entity-merge.ts`
- Delete: `packages/memory/src/lifecycle.ts`
- Delete: `packages/memory/src/llm-client.ts`

- [ ] **Step 1: Delete all 12 source files**

```bash
rm packages/memory/src/team-memory-store.ts \
   packages/memory/src/null-memory-store.ts \
   packages/memory/src/embedder.ts \
   packages/memory/src/null-embedder.ts \
   packages/memory/src/extract-loop.ts \
   packages/memory/src/ingest.ts \
   packages/memory/src/memory-reaper.ts \
   packages/memory/src/memory-updater.ts \
   packages/memory/src/retriever.ts \
   packages/memory/src/entity-merge.ts \
   packages/memory/src/lifecycle.ts \
   packages/memory/src/llm-client.ts
```

- [ ] **Step 2: Delete corresponding test files (keep Viking tests)**

```bash
rm packages/memory/src/__tests__/team-memory-store.test.ts \
   packages/memory/src/__tests__/retriever.test.ts \
   packages/memory/src/__tests__/retrieval-precision.test.ts \
   packages/memory/src/__tests__/memory-reaper.test.ts \
   packages/memory/src/__tests__/memory-updater.test.ts \
   packages/memory/src/__tests__/extract-loop.test.ts \
   packages/memory/src/__tests__/ingest.test.ts \
   packages/memory/src/__tests__/entity-merge.test.ts \
   packages/memory/src/__tests__/lifecycle.test.ts \
   packages/memory/src/__tests__/vec0-check.test.ts
```

Keep: `viking-health-monitor.test.ts`, `viking-memory-client.test.ts`

- [ ] **Step 3: Rewrite packages/memory/src/index.ts to Viking-only exports**

Replace entire file content with:

```typescript
// @teamsland/memory — OpenViking memory client
// 团队记忆系统：通过 OpenViking 向量数据库提供语义检索与会话归档

export { VikingHealthMonitor } from "./viking-health-monitor.js";
export type {
  AddResourceOptions,
  CommitResult,
  FindOptions,
  FindResult,
  FindResultItem,
  FsEntry,
  IVikingMemoryClient,
  ResourceResult,
  SessionContext,
  TaskStatus,
  WriteOptions,
} from "./viking-memory-client.js";
export { NullVikingMemoryClient, VikingMemoryClient } from "./viking-memory-client.js";
```

- [ ] **Step 4: Remove deprecated dependencies from packages/memory/package.json**

Remove `node-llama-cpp`, `sqlite-vec`, `sqlite-vec-darwin-arm64`, `yaml`, `@teamsland/session` from dependencies. Result:

```json
{
  "name": "@teamsland/memory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@teamsland/observability": "workspace:*",
    "@teamsland/types": "workspace:*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add -A packages/memory/
git commit -m "refactor(memory): remove TeamMemoryStore, keep Viking-only exports"
```

---

### Task 2: Remove memory types and config types from packages/types

**Files:**
- Modify: `packages/types/src/memory.ts`
- Modify: `packages/types/src/config.ts`
- Modify: `packages/types/src/index.ts`

- [ ] **Step 1: Strip packages/types/src/memory.ts to MemoryType only**

Replace entire file content with:

```typescript
/**
 * 记忆类型枚举
 *
 * 团队记忆系统支持的 12 种记忆分类，覆盖从个体偏好到项目上下文的全部语义域。
 */
export type MemoryType =
  | "profile"
  | "preferences"
  | "entities"
  | "events"
  | "cases"
  | "patterns"
  | "tools"
  | "skills"
  | "decisions"
  | "project_context"
  | "soul"
  | "identity";
```

- [ ] **Step 2: Remove MemoryConfig, StorageConfig and sub-types from packages/types/src/config.ts**

Delete these blocks (lines 270–396, the `MemoryConfig` doc + interface through end of `StorageConfig` interface):
- `MemoryConfig` interface (lines 290–299) and its doc comment above it
- `SqliteVecConfig` interface (lines 313–320) and its doc comment
- `EmbeddingConfig` interface (lines 335–340) and its doc comment
- `EntityMergeConfig` interface (lines 352–355) and its doc comment
- `Fts5Config` interface (lines 367–370) and its doc comment
- `StorageConfig` interface (lines 387–396) and its doc comment
- The `import type { MemoryType } from "./memory.js"` at line 1 (no longer needed)
- The `// ─── storage.yaml ───` comment at line 301

Then in `AppConfig` interface, remove these two lines:
```typescript
  /** 记忆配置 */
  memory: MemoryConfig;
  /** 存储配置 */
  storage: StorageConfig;
```

- [ ] **Step 3: Clean up packages/types/src/index.ts re-exports**

Remove these lines from the config re-exports block:
```typescript
  EmbeddingConfig,
  EntityMergeConfig,
  Fts5Config,
  MemoryConfig,
  SqliteVecConfig,
  StorageConfig,
```

Replace the memory re-export line:
```typescript
export type { AbstractMemoryStore, MemoryEntry, MemoryType } from "./memory.js";
```
with:
```typescript
export type { MemoryType } from "./memory.js";
```

- [ ] **Step 4: Commit**

```bash
git add packages/types/
git commit -m "refactor(types): remove AbstractMemoryStore, MemoryEntry, and storage config types"
```

---

### Task 3: Remove memory/storage config schemas and config.json sections

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `config/config.json`

- [ ] **Step 1: Remove schemas from packages/config/src/schema.ts**

Delete `MemoryTypeSchema` (lines 3–29, the entire doc comment + `z.enum` block).

Delete `MemoryConfigSchema` (lines 103–111).

Delete `SqliteVecSchema` (lines 113–117), `EmbeddingSchema` (lines 119–122), `EntityMergeSchema` (lines 124–126), `Fts5Schema` (lines 128–130), `StorageConfigSchema` (lines 132–137).

In `AppConfigSchema` (line 200+), remove these two lines:
```typescript
  memory: MemoryConfigSchema,
  storage: StorageConfigSchema,
```

- [ ] **Step 2: Remove memory and storage sections from config/config.json**

Delete the `"memory"` block (lines 55–73) and the `"storage"` block (lines 74–90), including their trailing commas.

- [ ] **Step 3: Commit**

```bash
git add packages/config/src/schema.ts config/config.json
git commit -m "refactor(config): remove memory and storage config schemas and values"
```

---

### Task 4: Gut apps/server/src/init/storage.ts

**Files:**
- Modify: `apps/server/src/init/storage.ts`

- [ ] **Step 1: Rewrite init/storage.ts to remove all memory components**

Replace entire file with:

```typescript
// @teamsland/server — 存储层初始化模块

import { Database } from "bun:sqlite";
import type { createLogger } from "@teamsland/observability";
import type { AppConfig } from "@teamsland/types";
import { SessionDB } from "@teamsland/session";

/** 默认团队 ID */
const TEAM_ID = "default";

/**
 * 存储层初始化结果
 */
export interface StorageResult {
  /** 会话数据库 */
  sessionDb: SessionDB;
  /** 事件去重数据库（内存 SQLite） */
  eventDb: Database;
}

/**
 * 初始化存储层组件
 *
 * 按顺序初始化以下组件：
 * 1. SessionDB — SQLite 会话持久化
 * 2. 事件去重数据库 — 内存 SQLite
 *
 * @param config - 应用配置
 * @param logger - 日志记录器
 * @returns 存储层所有组件
 */
export async function initStorage(config: AppConfig, logger: ReturnType<typeof createLogger>): Promise<StorageResult> {
  // SessionDB
  const sessionDb = new SessionDB("data/sessions.sqlite", config.session);
  logger.info("SessionDB 已初始化");

  // 事件去重库（内存 SQLite）
  const eventDb = new Database(":memory:");
  logger.info("事件去重数据库已创建");

  return { sessionDb, eventDb };
}

/** 重导出 TEAM_ID 以供其他初始化模块使用 */
export { TEAM_ID };
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/init/storage.ts
git commit -m "refactor(server): remove memory components from storage init"
```

---

### Task 5: Clean up init/context.ts — remove MemoryUpdater/ExtractLoop

**Files:**
- Modify: `apps/server/src/init/context.ts`

- [ ] **Step 1: Remove memory imports**

Replace line 8:
```typescript
import { ExtractLoop, MemoryUpdater, TeamMemoryStore } from "@teamsland/memory";
```
with nothing (delete the line).

- [ ] **Step 2: Remove memoryUpdater and extractLoop from ContextResult**

In `ContextResult` interface, delete:
```typescript
  /** 记忆更新器（NullMemoryStore 时为 null） */
  memoryUpdater: MemoryUpdater | null;
  /** 记忆提取循环（LLM 未配置或 NullMemoryStore 时为 null） */
  extractLoop: ExtractLoop | null;
```

- [ ] **Step 3: Remove memoryStore/embedder from DynamicContextAssembler creation**

Replace lines 114–119:
```typescript
  const assembler = new DynamicContextAssembler({
    config,
    repoMapping,
    memoryStore: storage.memoryStore,
    embedder: storage.embedder,
  });
```
with:
```typescript
  const assembler = new DynamicContextAssembler({
    config,
    repoMapping,
  });
```

- [ ] **Step 4: Remove memoryUpdater/extractLoop creation and return values**

Delete lines 126–135 (the `memoryUpdater` and `extractLoop` const declarations).

In the return object, delete:
```typescript
    memoryUpdater,
    extractLoop,
```

- [ ] **Step 5: Update the doc comment**

In the function doc comment (lines 77–101), remove the bullet:
```
 * - DocumentParser + MemoryUpdater + ExtractLoop — 文档解析与记忆管线
```
Replace with:
```
 * - DocumentParser — 文档解析
```

Also update the `buildLlmStack` warning message (line 68):
```typescript
  logger.warn("LLM 未配置，ExtractLoop 将不可用");
```
to:
```typescript
  logger.warn("LLM 未配置");
```

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/init/context.ts
git commit -m "refactor(server): remove memory updater and extract loop from context init"
```

---

### Task 6: Clean up init/events.ts — remove memoryStore from deps

**Files:**
- Modify: `apps/server/src/init/events.ts`

- [ ] **Step 1: Remove TeamMemoryStore import**

Delete line 8:
```typescript
import { TeamMemoryStore } from "@teamsland/memory";
```

- [ ] **Step 2: Remove memoryStore/extractLoop/memoryUpdater from deps object**

In the `deps` object (around line 100), delete these three lines:
```typescript
    memoryStore: storage.memoryStore instanceof TeamMemoryStore ? storage.memoryStore : null,
    extractLoop: context.extractLoop,
    memoryUpdater: context.memoryUpdater,
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/init/events.ts
git commit -m "refactor(server): remove memory deps from event pipeline init"
```

---

### Task 7: Clean up event-handlers.ts — remove scheduleMemoryIngestion

**Files:**
- Modify: `apps/server/src/event-handlers.ts`

- [ ] **Step 1: Remove memory imports**

Replace line 7:
```typescript
import type { ExtractLoop, IVikingMemoryClient, MemoryUpdater, TeamMemoryStore } from "@teamsland/memory";
```
with:
```typescript
import type { IVikingMemoryClient } from "@teamsland/memory";
```

Delete line 8:
```typescript
import { ingestDocument } from "@teamsland/memory";
```

- [ ] **Step 2: Remove memory fields from EventHandlerDeps**

In `EventHandlerDeps` interface, delete these 6 lines:
```typescript
  /** 团队记忆存储（仅 TeamMemoryStore 时可用于 ingest） */
  memoryStore: TeamMemoryStore | null;
  /** 记忆提取循环（LLM 未配置时为 null） */
  extractLoop: ExtractLoop | null;
  /** 记忆更新器（NullMemoryStore 时为 null） */
  memoryUpdater: MemoryUpdater | null;
```

- [ ] **Step 3: Delete scheduleMemoryIngestion function**

Delete the entire function `scheduleMemoryIngestion` (lines 284–319, including its doc comment).

- [ ] **Step 4: Remove scheduleMemoryIngestion call from spawnAgent**

In `spawnAgent`, replace lines 419–422:
```typescript
  // 4. 文档解析 + 记忆注入（fire-and-forget, 不阻塞 Agent 启动）
  const rawDescription = extractDescription(event);
  const parsedDocument = rawDescription ? deps.documentParser.parseMarkdown(rawDescription) : null;
  scheduleMemoryIngestion(deps, event, agentId, parsedDocument);
```
with nothing (delete these 4 lines). Update the step numbering comments in `spawnAgent`:
- Step 4 becomes the old step 5 ("组装初始提示词")
- Step 5 becomes the old step 6 ("启动 Agent 子进程")
- Step 6 becomes the old step 7 ("注册到注册表")

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/event-handlers.ts
git commit -m "refactor(server): remove scheduleMemoryIngestion and memory deps from event handlers"
```

---

### Task 8: Inline LLM types into apps/server/src/llm-client.ts

**Files:**
- Modify: `apps/server/src/llm-client.ts`

- [ ] **Step 1: Replace the import with inline type definitions**

Replace line 1:
```typescript
import type { LlmClient, LlmMessage, LlmResponse, LlmToolDef } from "@teamsland/memory";
```
with:
```typescript
/** LLM 消息 */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

/** LLM 工具定义 */
export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** LLM 工具调用 */
interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** LLM 响应 */
export interface LlmResponse {
  content: string;
  toolCalls?: LlmToolCall[];
}

/** LLM 客户端接口 */
export interface LlmClient {
  chat(messages: LlmMessage[], tools?: LlmToolDef[]): Promise<LlmResponse>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/llm-client.ts
git commit -m "refactor(server): inline LLM types previously imported from memory package"
```

---

### Task 9: Remove scheduled-tasks.ts memory functions and test

**Files:**
- Modify: `apps/server/src/scheduled-tasks.ts`
- Delete: `apps/server/src/__tests__/scheduled-tasks.test.ts` (partial — remove memory tests)
- Modify: `apps/server/src/init/scheduled-tasks.ts`

- [ ] **Step 1: Remove memory imports and functions from scheduled-tasks.ts**

Delete line 4:
```typescript
import type { MemoryReaper, TeamMemoryStore } from "@teamsland/memory";
```

Delete the `startMemoryReaper` function (lines 61–90, including doc comment).

Delete the `startFts5Optimize` function (lines 123–152, including doc comment).

- [ ] **Step 2: Remove memory fields from init/scheduled-tasks.ts**

Delete the import of `TeamMemoryStore` (line 4):
```typescript
import { TeamMemoryStore } from "@teamsland/memory";
```

Remove `startFts5Optimize` and `startMemoryReaper` from the import on line 9:
```typescript
import {
  createAlerter,
  startFts5Optimize,
  startHealthCheck,
  startMemoryReaper,
  startSeenEventsSweep,
  startWorktreeReaper,
} from "../scheduled-tasks.js";
```
becomes:
```typescript
import {
  createAlerter,
  startHealthCheck,
  startSeenEventsSweep,
  startWorktreeReaper,
} from "../scheduled-tasks.js";
```

In `ScheduledTasksResult` interface, delete:
```typescript
  /** 记忆回收定时器（可能为 null） */
  memoryReaperTimer: ReturnType<typeof setInterval> | null;
  /** FTS5 索引优化定时器（可能为 null） */
  fts5OptimizeTimer: ReturnType<typeof setInterval> | null;
```

Delete the `memoryReaperTimer` assignment (line 95):
```typescript
  const memoryReaperTimer = storage.memoryReaper ? startMemoryReaper(storage.memoryReaper, 86_400_000) : null;
```

Delete the `fts5OptimizeTimer` block (lines 99–102):
```typescript
  const fts5OptimizeTimer =
    storage.memoryStore instanceof TeamMemoryStore
      ? startFts5Optimize(storage.memoryStore, config.storage.fts5.optimizeIntervalHours * 3_600_000)
      : null;
```

In `clearAll`, remove:
```typescript
    if (memoryReaperTimer) clearInterval(memoryReaperTimer);
    if (fts5OptimizeTimer) clearInterval(fts5OptimizeTimer);
```

In the return object, remove:
```typescript
    memoryReaperTimer,
    fts5OptimizeTimer,
```

Update the doc comment to remove bullets 3 and 5:
```
 * 3. 记忆回收（每天，仅 TeamMemoryStore 可用时）
 * 5. FTS5 索引优化（按配置间隔，仅 TeamMemoryStore 可用时）
```
Renumber remaining items.

- [ ] **Step 3: Remove memory-related tests from scheduled-tasks.test.ts**

Delete the `startMemoryReaper` and `startFts5Optimize` test blocks from the test file.

Remove their imports at line 3:
```typescript
import type { MemoryReaper, TeamMemoryStore } from "@teamsland/memory";
```

Remove `startFts5Optimize` and `startMemoryReaper` from the import at line 6:
```typescript
import { startFts5Optimize, startMemoryReaper, startSeenEventsSweep, startWorktreeReaper } from "../scheduled-tasks.js";
```
becomes:
```typescript
import { startSeenEventsSweep, startWorktreeReaper } from "../scheduled-tasks.js";
```

Delete the `// ─── startMemoryReaper ───` section (lines 70–107) and the `// ─── startFts5Optimize ───` section (lines 151–191).

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/scheduled-tasks.ts apps/server/src/init/scheduled-tasks.ts apps/server/src/__tests__/scheduled-tasks.test.ts
git commit -m "refactor(server): remove memory reaper and FTS5 scheduled tasks"
```

---

### Task 10: Clean up main.ts shutdown

**Files:**
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Remove storage.memoryStore.close() from shutdown**

Delete line 145:
```typescript
      storage.memoryStore.close();
```

- [ ] **Step 2: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "refactor(server): remove memoryStore.close from shutdown"
```

---

### Task 11: Remove §B from DynamicContextAssembler

**Files:**
- Modify: `packages/context/src/assembler.ts`
- Modify: `packages/context/src/__tests__/assembler.test.ts`

- [ ] **Step 1: Remove memory imports from assembler.ts**

Replace lines 1–5:
```typescript
import type { RepoMapping } from "@teamsland/config";
import type { Embedder, TeamMemoryStore } from "@teamsland/memory";
import { retrieve } from "@teamsland/memory";
import { createLogger, withSpan } from "@teamsland/observability";
import type { AbstractMemoryStore, AppConfig, TaskConfig } from "@teamsland/types";
```
with:
```typescript
import type { RepoMapping } from "@teamsland/config";
import { createLogger, withSpan } from "@teamsland/observability";
import type { AppConfig, TaskConfig } from "@teamsland/types";
```

- [ ] **Step 2: Remove memoryStore/embedder from AssemblerOptions and constructor**

In `AssemblerOptions` interface, delete:
```typescript
  /** 团队记忆存储（用于记忆检索） */
  memoryStore: AbstractMemoryStore;
  /** Embedding 生成器（用于向量检索） */
  embedder: Embedder;
```

In the `DynamicContextAssembler` class, delete the two private fields:
```typescript
  private readonly memoryStore: AbstractMemoryStore;
  private readonly embedder: Embedder;
```

In the constructor, delete:
```typescript
    this.memoryStore = opts.memoryStore;
    this.embedder = opts.embedder;
```

- [ ] **Step 3: Remove buildSectionB and adjust buildInitialPrompt**

Delete the entire `buildSectionB` method (lines 131–142).

In `buildInitialPrompt`, replace:
```typescript
      const [sectionA, sectionB, sectionD] = await Promise.all([
        this.buildSectionA(task),
        this.buildSectionB(task, teamId),
        this.buildSectionD(task),
      ]);

      const prompt = [sectionA, sectionB, sectionD].join("\n\n");
      span.setAttribute("prompt.length", prompt.length);
      span.setAttribute("prompt.sections", 3);
```
with:
```typescript
      const [sectionA, sectionD] = await Promise.all([
        this.buildSectionA(task),
        this.buildSectionD(task),
      ]);

      const prompt = [sectionA, sectionD].join("\n\n");
      span.setAttribute("prompt.length", prompt.length);
      span.setAttribute("prompt.sections", 2);
```

Update the class doc comment to describe 2 sections (§A, §D) instead of 3 and remove §B references.

Update `buildInitialPrompt` doc comment similarly — replace references to "3 段" with "2 段", remove §B.

- [ ] **Step 4: Rewrite assembler.test.ts — remove FakeMemoryStore/FakeEmbedder**

Replace imports (lines 1–5):
```typescript
import type { RepoMapping } from "@teamsland/config";
import type { Embedder } from "@teamsland/memory";
import type { AbstractMemoryStore, AppConfig, MemoryEntry, TaskConfig } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { DynamicContextAssembler } from "../assembler.js";
```
with:
```typescript
import type { RepoMapping } from "@teamsland/config";
import type { AppConfig, TaskConfig } from "@teamsland/types";
import { describe, expect, it } from "vitest";
import { DynamicContextAssembler } from "../assembler.js";
```

Delete `FakeMemoryStore` class (lines 9–35) and `FakeEmbedder` class (lines 37–45).

Update `buildAssembler` helper:
```typescript
  function buildAssembler() {
    return new DynamicContextAssembler({
      config: mockConfig,
      repoMapping: new FakeRepoMapping() as unknown as RepoMapping,
    });
  }
```

Update the section title test to check for 2 sections:
```typescript
  it("输出包含全部 2 段标题（§A/§D）", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).toContain("§A — Issue 上下文");
    expect(prompt).toContain("§D — 仓库信息");
  });
```

Update the "不再包含" test to also exclude §B:
```typescript
  it("不再包含 §B、§C 和 §E 段", async () => {
    const assembler = buildAssembler();
    const prompt = await assembler.buildInitialPrompt(mockTask, "team-001");
    expect(prompt).not.toContain("§B");
    expect(prompt).not.toContain("§C");
    expect(prompt).not.toContain("§E");
  });
```

Delete the §B memory entry test (lines 124–140, "§B 包含 FakeMemoryStore 返回的记忆条目").

- [ ] **Step 5: Commit**

```bash
git add packages/context/
git commit -m "refactor(context): remove §B historical memory from assembler"
```

---

### Task 12: Clean up server test mock configs

**Files:**
- Modify: `apps/server/src/__tests__/event-pipeline.test.ts`
- Modify: `apps/server/src/__tests__/worker-event-handlers.test.ts`
- Modify: `apps/server/src/__tests__/coordinator-init.test.ts`

- [ ] **Step 1: Remove memory/storage from testConfig in event-pipeline.test.ts**

In `testConfig`, delete:
```typescript
  memory: { decayHalfLifeDays: 30, extractLoopMaxIterations: 3, exemptTypes: [], perTypeTtl: {} },
  storage: {
    sqliteVec: { dbPath: ":memory:", busyTimeoutMs: 5000, vectorDimensions: 512 },
    embedding: { model: "test-model", contextSize: 512 },
    entityMerge: { cosineThreshold: 0.95 },
    fts5: { optimizeIntervalHours: 24 },
  },
```

In both deps objects, delete:
```typescript
      memoryStore: null,
      extractLoop: null,
      memoryUpdater: null,
```

- [ ] **Step 2: Remove memory/storage from testConfig in worker-event-handlers.test.ts**

Same pattern — delete `memory` and `storage` from `testConfig`, and remove `memoryStore`, `extractLoop`, `memoryUpdater` from all deps objects.

- [ ] **Step 3: Remove memory/storage from testConfig in coordinator-init.test.ts**

Delete the `memory` and `storage` blocks from the test config object.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/__tests__/
git commit -m "refactor(server): remove memory fields from test mock configs"
```

---

### Task 13: Run bun install and verify

**Files:** None (verification only)

- [ ] **Step 1: Run bun install to update lockfile**

```bash
cd /Users/bytedance/workspace/teamsland && bun install
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: passes with no errors.

- [ ] **Step 3: Run tests**

```bash
bun run test:run
```

Expected: all remaining tests pass. The deleted test files should not cause failures.

- [ ] **Step 4: Run build**

```bash
bun run build
```

Expected: succeeds.

- [ ] **Step 5: Verify no stale imports remain**

```bash
cd /Users/bytedance/workspace/teamsland && grep -r "TeamMemoryStore\|NullMemoryStore\|AbstractMemoryStore\|MemoryEntry\|LocalEmbedder\|NullEmbedder\|MemoryReaper\|MemoryUpdater\|ExtractLoop\|ingestDocument\|scheduleMemoryIngestion\|checkVec0Available" --include="*.ts" --exclude-dir=node_modules --exclude-dir=.git | grep -v "\.test\." | grep -v "docs/"
```

Expected: no matches (or only in deleted files if git hasn't cleaned up).

- [ ] **Step 6: Commit lockfile if changed**

```bash
git add bun.lockb && git commit -m "chore: update lockfile after removing sqlite-vec deps"
```
