# @teamsland/ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/ingestion` package — a two-stage intent classification pipeline (rule-based fast path + LLM fallback) and a Markdown document structure parser. Provides `IntentClassifier`, `DocumentParser`, `LlmClient`, `ParsedDocument`, and `Section` as the public API.

**Architecture:** Four source files: `types.ts` (local LlmClient/LlmMessage/LlmResponse interfaces — duck-typed to avoid memory dependency), `intent-classifier.ts` (IntentClassifier — keyword rules + LLM fallback), `document-parser.ts` (DocumentParser — ATX heading splitter + regex entity extraction), `index.ts` (barrel re-exports). Two test files. All dependencies injected via constructor for testability.

**Tech Stack:** TypeScript (strict), Bun, Vitest (run under Bun runtime via `bunx --bun vitest`), Biome (lint)

---

## Context

The `@teamsland/ingestion` package scaffold exists with an empty `export {}` in `src/index.ts`. Its `package.json` has `@teamsland/types` as the only dependency. The tsconfig references `../types` only. The design spec is at `docs/superpowers/specs/2026-04-20-teamsland-ingestion-design.md`.

**Testing approach:** Tests use `FakeLlmClient` (vi.fn() mocked) for IntentClassifier. DocumentParser is pure — no mocks needed, just Markdown strings. All tests run under the Bun runtime.

**MeegoEvent.title/description constraint:** `MeegoEvent` type has no `title` or `description` fields — they live in `payload`. The `eventToString()` helper must cast `event.payload.title` and `event.payload.description` as `string | undefined`, not access top-level fields.

**Observability:** Uses `createLogger("ingestion:intent")` and `createLogger("ingestion:parser")` per Observability-First requirement. The `@teamsland/observability` package must be added to `package.json` dependencies.

## Critical Files

- **Modify:** `packages/ingestion/package.json` (add `@teamsland/observability` workspace dependency)
- **Modify:** `packages/ingestion/tsconfig.json` (add observability reference)
- **Create:** `packages/ingestion/src/types.ts`
- **Create:** `packages/ingestion/src/intent-classifier.ts`
- **Create:** `packages/ingestion/src/document-parser.ts`
- **Modify:** `packages/ingestion/src/index.ts` (barrel exports)
- **Create:** `packages/ingestion/src/__tests__/intent-classifier.test.ts`
- **Create:** `packages/ingestion/src/__tests__/document-parser.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`, `useExportType`
- `import type` for type-only imports
- `node:` protocol for Node.js built-ins
- Logger: `createLogger("ingestion:intent")`, `createLogger("ingestion:parser")` — no bare `console.log`
- Run tests with: `bunx --bun vitest run packages/ingestion/`
- Run typecheck with: `bunx tsc --noEmit --project packages/ingestion/tsconfig.json`
- Run lint with: `bunx biome check packages/ingestion/src/`

## Shared Test Helpers

### FakeLlmClient

```typescript
import { vi } from "vitest";
import type { LlmClient } from "../types.js";

function makeFakeLlm(response: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  };
}
```

---

### Task 1: Update package.json and tsconfig.json with observability dependency

**Files:**
- Modify: `packages/ingestion/package.json`
- Modify: `packages/ingestion/tsconfig.json`

- [ ] **Step 1: Update package.json**

Add `@teamsland/observability` to dependencies:

```json
{
  "name": "@teamsland/ingestion",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@teamsland/types": "workspace:*",
    "@teamsland/observability": "workspace:*"
  },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

- [ ] **Step 2: Update tsconfig.json**

Add observability reference:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"],
  "references": [{ "path": "../types" }, { "path": "../observability" }]
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `bunx tsc --noEmit --project packages/ingestion/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add packages/ingestion/package.json packages/ingestion/tsconfig.json
git commit -m "chore(ingestion): add @teamsland/observability dependency"
```

---

### Task 2: Create types.ts — Local LlmClient interfaces

**Files:**
- Create: `packages/ingestion/src/types.ts`

- [ ] **Step 1: Create types.ts with LlmMessage, LlmResponse, LlmClient**

```typescript
/**
 * LLM 单条消息
 *
 * @example
 * ```typescript
 * import type { LlmMessage } from "@teamsland/ingestion";
 *
 * const msg: LlmMessage = { role: "user", content: "分类这段文字" };
 * ```
 */
export interface LlmMessage {
  /** 消息角色 */
  role: "system" | "user" | "assistant";
  /** 消息内容 */
  content: string;
}

/**
 * LLM 调用返回值
 *
 * @example
 * ```typescript
 * import type { LlmResponse } from "@teamsland/ingestion";
 *
 * const res: LlmResponse = { content: '{"type":"tech_spec","confidence":0.9}' };
 * ```
 */
export interface LlmResponse {
  /** 文本回复内容 */
  content: string;
}

/**
 * LLM 客户端接口（本地 duck-typed 定义）
 *
 * 与 @teamsland/memory 的 LlmClient 接口结构兼容，但独立声明以保持叶子包地位。
 * 真实实现由应用层在启动时注入。
 *
 * @example
 * ```typescript
 * import type { LlmClient } from "@teamsland/ingestion";
 *
 * const fakeLlm: LlmClient = {
 *   async chat(messages) {
 *     return { content: '{"type":"tech_spec","confidence":0.92,"entities":{}}' };
 *   },
 * };
 * ```
 */
export interface LlmClient {
  /** 发送对话消息并获取回复 */
  chat(messages: LlmMessage[]): Promise<LlmResponse>;
}
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit --project packages/ingestion/tsconfig.json
bunx biome check packages/ingestion/src/types.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/ingestion/src/types.ts
git commit -m "feat(ingestion): add local LlmClient, LlmMessage, LlmResponse interfaces"
```

---

### Task 3: Create intent-classifier.ts — Two-stage intent classification

**Files:**
- Create: `packages/ingestion/src/intent-classifier.ts`
- Create: `packages/ingestion/src/__tests__/intent-classifier.test.ts`

- [ ] **Step 1: Create intent-classifier.ts**

Key implementation details:
- `RULES` array: keyword groups → IntentType + confidence, checked top-to-bottom
- `eventToString(event: MeegoEvent)` — extracts `payload.title` and `payload.description` (cast as `string | undefined`) since MeegoEvent has no top-level title/description
- `applyRules(text: string)` — lowercase + `includes()` matching, returns first hit or null
- `classify(input: string | MeegoEvent)` — rule path if confidence >= 0.8, else LLM fallback, then query fallback if confidence < 0.5
- `classifyWithLlm(text: string)` — system prompt + JSON parse + try/catch fallback

Rule table:
| Keywords | IntentType | Confidence |
|----------|-----------|------------|
| 技术方案, 技术设计, 架构设计, 系统设计 | tech_spec | 0.9 |
| 设计, 原型, ui, 交互 | design | 0.9 |
| 评审, review, code review | tech_spec | 0.9 |
| 前端, frontend, 页面, 组件 | frontend_dev | 0.9 |
| 确认, confirm, approve, 批准 | confirm | 0.9 |
| 状态, 进度, 同步, 更新 | status_sync | 0.85 |

See design spec `docs/superpowers/specs/2026-04-20-teamsland-ingestion-design.md` lines 118-312 for full implementation.

- [ ] **Step 2: Create intent-classifier.test.ts**

Test cases:
1. Rule fast path: "帮我评审一下这个技术方案" → type=tech_spec, confidence>=0.9, LLM NOT called
2. Rule fast path: "前端开发这个需求" → type=frontend_dev
3. Rule fast path: "确认这个设计" → type=confirm
4. LLM fallback: unmatched input → LLM called, result parsed
5. LLM low confidence: confidence < 0.5 → type=query, original confidence preserved
6. LLM parse failure: non-JSON response → type=query, confidence=0, no throw
7. MeegoEvent input: event with payload.title containing keyword → correct classification
8. MeegoEvent input without keywords → falls through to LLM

- [ ] **Step 3: Run tests**

```bash
bunx --bun vitest run packages/ingestion/src/__tests__/intent-classifier.test.ts
```

- [ ] **Step 4: Run typecheck and lint**

```bash
bunx tsc --noEmit --project packages/ingestion/tsconfig.json
bunx biome check packages/ingestion/src/intent-classifier.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/ingestion/src/intent-classifier.ts packages/ingestion/src/__tests__/intent-classifier.test.ts
git commit -m "feat(ingestion): add IntentClassifier — rule fast path + LLM fallback"
```

---

### Task 4: Create document-parser.ts — Markdown structure parser

**Files:**
- Create: `packages/ingestion/src/document-parser.ts`
- Create: `packages/ingestion/src/__tests__/document-parser.test.ts`

- [ ] **Step 1: Create document-parser.ts**

Key implementation details:
- `Section` interface: `{ heading: string; level: number; content: string }`
- `ParsedDocument` interface: `{ title: string; sections: Section[]; entities: string[] }`
- `DocumentParser.parseMarkdown(content: string)` — split by ATX headings, extract entities
- `splitSections(lines: string[])` — iterate lines, detect `^(#{1,6})\s+(.+)$`, flush sections
- `extractEntities(sections: Section[])` — 3 regex patterns:
  - API paths: `/((?:GET|POST|PUT|DELETE|PATCH)\s+)?\/[a-zA-Z0-9/_:.-]{2,}/g`
  - PascalCase modules: `/\b[A-Z][a-zA-Z0-9]{2,}(?:Service|Module|Controller|Store|Model|Handler|Manager|Client|Adapter)\b/g`
  - Type declarations: `/(?:interface|type|class)\s+([A-Z][a-zA-Z0-9]+)/g` (capture group 1)
- Dedupe via `Set`

See design spec lines 320-523 for full implementation.

- [ ] **Step 2: Create document-parser.test.ts**

Test cases:
1. Standard Markdown: correct title, section count, heading text, levels
2. API path extraction: `/api/users/:id`, `POST /api/users/login` in entities
3. PascalCase module extraction: `UserService`, `AuthModule` in entities
4. interface/type extraction: `UserRecord` in entities
5. Empty document: title="", sections=[], entities=[]
6. No H1: title="", other sections present
7. Entity dedup: same entity appears once
8. Multi-level headings: H1, H2, H3 all extracted correctly

- [ ] **Step 3: Run tests**

```bash
bunx --bun vitest run packages/ingestion/src/__tests__/document-parser.test.ts
```

- [ ] **Step 4: Run typecheck and lint**

```bash
bunx tsc --noEmit --project packages/ingestion/tsconfig.json
bunx biome check packages/ingestion/src/document-parser.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/ingestion/src/document-parser.ts packages/ingestion/src/__tests__/document-parser.test.ts
git commit -m "feat(ingestion): add DocumentParser — Markdown section splitter + entity extraction"
```

---

### Task 5: Update index.ts — Barrel re-exports + final verification

**Files:**
- Modify: `packages/ingestion/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

```typescript
// @teamsland/ingestion — 意图识别与文档解析
// 两阶段意图分类（规则 + LLM）+ Markdown 结构化提取

export { IntentClassifier } from "./intent-classifier.js";
export { DocumentParser } from "./document-parser.js";
export type { ParsedDocument, Section } from "./document-parser.js";
export type { LlmClient, LlmMessage, LlmResponse } from "./types.js";
```

- [ ] **Step 2: Run full test suite**

```bash
bunx --bun vitest run packages/ingestion/
```

- [ ] **Step 3: Run typecheck and lint on full package**

```bash
bunx tsc --noEmit --project packages/ingestion/tsconfig.json
bunx biome check packages/ingestion/src/
```

- [ ] **Step 4: Commit**

```bash
git add packages/ingestion/src/index.ts
git commit -m "feat(ingestion): add barrel exports — IntentClassifier, DocumentParser, LlmClient"
```

## Verification

After all tasks are complete:

1. `bunx --bun vitest run packages/ingestion/` — all tests pass
2. `bunx tsc --noEmit --project packages/ingestion/tsconfig.json` — exits 0
3. `bunx biome check packages/ingestion/src/` — no errors
4. Every `import type` / `export type` uses the `type` keyword
5. No `any`, no `!` non-null assertions
6. Every exported type/class has Chinese JSDoc with `@example`
7. No bare `console.log` — all logging via `createLogger()`
