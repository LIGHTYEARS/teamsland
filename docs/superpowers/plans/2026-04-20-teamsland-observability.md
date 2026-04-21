# @teamsland/observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a structured logging API based on pino, exported as `createLogger(name)` + `Logger` type, for use by all monorepo packages.

**Architecture:** Single `logger.ts` file wraps pino with a factory function. Reads `LOG_LEVEL` and `LOG_PRETTY` env vars. Exports a `Logger` type alias so downstream packages can `import type` without depending on pino directly. Barrel `index.ts` re-exports both.

**Tech Stack:** TypeScript (strict), pino (NDJSON logger), pino-pretty (dev only), Vitest (testing), Biome (lint)

---

## Context

The `@teamsland/observability` package scaffold exists with an empty `export {}`. Its current `package.json` has dependencies on `@teamsland/types` and `@teamsland/lark` — both need to be removed (types isn't needed for logger, lark is for the future Alerter). The tsconfig references both packages — also needs cleanup.

The spec is at `docs/superpowers/specs/2026-04-20-teamsland-observability-design.md`.

## Critical Files

- **Modify:** `packages/observability/package.json` (add pino, remove unused deps)
- **Modify:** `packages/observability/tsconfig.json` (remove unnecessary references)
- **Create:** `packages/observability/src/logger.ts` (createLogger factory + Logger type)
- **Modify:** `packages/observability/src/index.ts` (barrel exports)
- **Create:** `packages/observability/src/__tests__/logger.test.ts`

## Conventions

- JSDoc: Chinese, every exported function/type must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useImportType`
- Vitest for tests
- `import type` for type-only imports

---

### Task 1: Update package.json and tsconfig.json

**Files:**
- Modify: `packages/observability/package.json`
- Modify: `packages/observability/tsconfig.json`

- [ ] **Step 1: Update package.json**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/observability/package.json` with:

```json
{
  "name": "@teamsland/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "pino": "^9.0"
  },
  "devDependencies": {
    "pino-pretty": "^13.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Update tsconfig.json**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/observability/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { "rootDir": "./src", "outDir": "./dist" },
  "include": ["src"]
}
```

No `references` needed — the logger has no workspace dependencies.

- [ ] **Step 3: Install dependencies**

Run: `cd /Users/bytedance/workspace/teamsland && bun install`
Expected: pino and pino-pretty installed, lockfile updated

- [ ] **Step 4: Verify pino is importable**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import pino from 'pino'; console.log(typeof pino)"`
Expected: `function`

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/observability/package.json packages/observability/tsconfig.json bun.lock && git commit -m "chore(observability): configure pino dependency, remove unused deps"
```

---

### Task 2: Create logger.ts — createLogger Factory + Logger Type

**Files:**
- Create: `packages/observability/src/logger.ts`
- Create: `packages/observability/src/__tests__/logger.test.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write logger.test.ts**

Create `/Users/bytedance/workspace/teamsland/packages/observability/src/__tests__/logger.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";

describe("createLogger", () => {
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalLogPretty = process.env.LOG_PRETTY;

  beforeEach(() => {
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_PRETTY;
  });

  afterEach(() => {
    if (originalLogLevel !== undefined) process.env.LOG_LEVEL = originalLogLevel;
    else delete process.env.LOG_LEVEL;
    if (originalLogPretty !== undefined) process.env.LOG_PRETTY = originalLogPretty;
    else delete process.env.LOG_PRETTY;
  });

  it("返回带正确 name 的 logger 实例", () => {
    const logger = createLogger("test-module");
    expect(logger).toBeDefined();
    expect(logger).toHaveProperty("info");
    expect(logger).toHaveProperty("error");
    expect(logger).toHaveProperty("warn");
    expect(logger).toHaveProperty("debug");
  });

  it("logger 具有标准日志方法且可调用", () => {
    const logger = createLogger("methods");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.trace).toBe("function");
  });

  it("LOG_LEVEL 环境变量控制日志级别", () => {
    process.env.LOG_LEVEL = "silent";
    const logger = createLogger("silent-test");
    expect(logger.level).toBe("silent");
  });

  it("默认日志级别为 info", () => {
    const logger = createLogger("default-level");
    expect(logger.level).toBe("info");
  });

  it("child logger 继承 name 并附加字段", () => {
    const logger = createLogger("parent");
    const child = logger.child({ requestId: "req-123" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
    // child 保持可调用性（不抛错即通过）
    child.info("test message");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/observability/src/__tests__/logger.test.ts`
Expected: FAIL — `createLogger` not found / cannot import

- [ ] **Step 3: Create logger.ts implementation**

Create `/Users/bytedance/workspace/teamsland/packages/observability/src/logger.ts`:

```typescript
import pino from "pino";

/**
 * Logger 类型别名，基于 pino.Logger
 *
 * 下游包通过 `import type { Logger }` 声明日志依赖，无需直接依赖 pino 包
 *
 * @example
 * ```typescript
 * import type { Logger } from "@teamsland/observability";
 *
 * function initService(logger: Logger): void {
 *   logger.info("服务启动");
 * }
 * ```
 */
export type Logger = pino.Logger;

/**
 * 创建带名称的结构化 logger 实例
 *
 * 输出 NDJSON 到 stdout。日志级别由 `LOG_LEVEL` 环境变量控制（默认 `info`）。
 * 设置 `LOG_PRETTY=true` 启用开发模式美化输出。
 *
 * @param name - logger 名称，标识日志来源模块
 * @returns pino Logger 实例
 *
 * @example
 * ```typescript
 * import { createLogger } from "@teamsland/observability";
 *
 * const logger = createLogger("config");
 * logger.info({ path: "config.json" }, "配置加载完成");
 * logger.error({ err: new Error("fail") }, "加载失败");
 *
 * const child = logger.child({ requestId: "req-001" });
 * child.info("处理请求");
 * ```
 */
export function createLogger(name: string): Logger {
  const level = process.env.LOG_LEVEL ?? "info";

  if (process.env.LOG_PRETTY === "true") {
    return pino({
      name,
      level,
      transport: { target: "pino-pretty" },
    });
  }

  return pino({ name, level });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/observability/src/__tests__/logger.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/observability/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/observability/src/logger.ts packages/observability/src/__tests__/logger.test.ts`
Expected: No errors. If Biome reports issues, fix with `bunx biome check --write` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/observability/src/logger.ts packages/observability/src/__tests__/logger.test.ts && git commit -m "$(cat <<'EOF'
feat(observability): add createLogger factory with pino backend

TDD: 5 tests covering name, log methods, LOG_LEVEL control, default level, child logger
EOF
)"
```

---

### Task 3: Update index.ts — Barrel Exports

**Files:**
- Modify: `packages/observability/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel exports**

Replace the entire content of `/Users/bytedance/workspace/teamsland/packages/observability/src/index.ts` with:

```typescript
// @teamsland/observability — 结构化日志
// 基于 pino 的 NDJSON logger，所有包通过 createLogger(name) 获取实例

export { createLogger } from "./logger.js";
export type { Logger } from "./logger.js";
```

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/observability/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/observability/src/`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /Users/bytedance/workspace/teamsland && git add packages/observability/src/index.ts && git commit -m "feat(observability): add barrel exports — createLogger, Logger type"
```

---

### Task 4: Full Verification

- [ ] **Step 1: Run all observability tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/observability/`
Expected: All 5 tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/observability/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/observability/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import { createLogger } from './packages/observability/src/index.ts'; const log = createLogger('verify'); log.info('hello'); console.log('OK:', typeof createLogger)"`
Expected: A JSON log line for "hello", then `OK: function`

- [ ] **Step 5: Verify no any or non-null assertions**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b' packages/observability/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules'`
Expected: No output

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx vitest run packages/observability/` — 5 tests pass
2. `bunx tsc --noEmit --project packages/observability/tsconfig.json` — exits 0
3. `bunx biome check packages/observability/src/` — no errors
4. All exported functions/types have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions
6. `createLogger` and `Logger` type exported from package
7. `pino` in dependencies, `pino-pretty` in devDependencies
8. No reference to `@teamsland/types` or `@teamsland/lark` (removed)
