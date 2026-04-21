# @teamsland/config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `@teamsland/config` package — a zero-dependency JSON config loader with environment variable substitution and a `RepoMapping` convenience class.

**Architecture:** Single JSON config file (`config/config.json`) replaces 11 YAML files. `loadConfig()` reads JSON via `Bun.file().json()`, runs recursive `${VAR_NAME}` env-var substitution, returns typed `AppConfig`. `RepoMapping` wraps `Map<string, RepoEntry[]>` for project→repo lookup. All tests use Vitest with TDD.

**Tech Stack:** TypeScript (strict), Bun (native JSON), Vitest (testing), Biome (lint/format)

---

## Context

The `@teamsland/types` package is complete with 41 exported types including `AppConfig`, `RepoMappingConfig`, `RepoEntry`, and all sub-config types. The `@teamsland/config` package scaffold exists (`export {}`) with a dependency on `@teamsland/types`. There are 11 YAML config files in `config/` that need to be consolidated into a single `config/config.json`.

The spec is at `docs/superpowers/specs/2026-04-19-teamsland-config-design.md`.

## Critical Files

- **Create:** `config/config.json` (consolidated config from 11 YAML files, camelCase keys)
- **Create:** `packages/config/src/env.ts` (resolveEnvVars recursive substitution)
- **Create:** `packages/config/src/loader.ts` (loadConfig main function)
- **Create:** `packages/config/src/repo-mapping.ts` (RepoMapping class)
- **Modify:** `packages/config/src/index.ts` (barrel exports, replace `export {}`)
- **Create:** `packages/config/src/__tests__/env.test.ts`
- **Create:** `packages/config/src/__tests__/loader.test.ts`
- **Create:** `packages/config/src/__tests__/repo-mapping.test.ts`
- **Delete:** `config/confirmation.yaml`, `config/dashboard.yaml`, `config/lark.yaml`, `config/meego.yaml`, `config/memory.yaml`, `config/repo_mapping.yaml`, `config/session.yaml`, `config/sidecar.yaml`, `config/skill_routing.yaml`, `config/storage.yaml` (10 files; keep `config/test.yaml`)
- **Reference:** `docs/superpowers/specs/2026-04-19-teamsland-config-design.md`
- **Reference:** `packages/types/src/config.ts` (AppConfig and all sub-config types)

## Conventions

- All `import` of types: `import type { X } from "..."`
- JSDoc: Chinese, every exported function/class must have `@example`
- No `any`, no `!` non-null assertions
- Biome line width: 120, enforces `useExportType`, `useImportType`
- Vitest for tests, use `describe`/`it`/`expect`
- `Bun.file()` for file I/O (not `node:fs`)
- Env var pattern: `${VAR_NAME}` where VAR_NAME matches `[A-Z0-9_]+`

---

### Task 1: Create config/config.json — Consolidated Configuration File

**Files:**
- Create: `config/config.json`

This file merges all 11 YAML config files into a single JSON file with camelCase keys. Values are converted from snake_case YAML keys to camelCase. Environment variable placeholders (`${VAR_NAME}`) are preserved as-is — they'll be resolved at load time.

- [ ] **Step 1: Create config/config.json**

```json
{
  "meego": {
    "spaces": [
      { "spaceId": "xxx", "name": "开放平台前端" },
      { "spaceId": "yyy", "name": "开放平台基础" }
    ],
    "eventMode": "both",
    "webhook": {
      "host": "0.0.0.0",
      "port": 8080,
      "path": "/meego/webhook"
    },
    "poll": {
      "intervalSeconds": 60,
      "lookbackMinutes": 5
    },
    "longConnection": {
      "enabled": true,
      "reconnectIntervalSeconds": 10
    }
  },
  "lark": {
    "appId": "${LARK_APP_ID}",
    "appSecret": "${LARK_APP_SECRET}",
    "bot": {
      "historyContextCount": 20
    },
    "notification": {
      "teamChannelId": ""
    }
  },
  "session": {
    "compactionTokenThreshold": 80000,
    "sqliteJitterRangeMs": [20, 150],
    "busyTimeoutMs": 5000
  },
  "sidecar": {
    "maxConcurrentSessions": 20,
    "maxRetryCount": 3,
    "maxDelegateDepth": 2,
    "workerTimeoutSeconds": 300,
    "healthCheckTimeoutMs": 30000,
    "minSwarmSuccessRatio": 0.5
  },
  "memory": {
    "decayHalfLifeDays": 30,
    "extractLoopMaxIterations": 3
  },
  "storage": {
    "sqliteVec": {
      "dbPath": "./data/memory.sqlite",
      "busyTimeoutMs": 5000,
      "vectorDimensions": 512
    },
    "embedding": {
      "model": "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf",
      "contextSize": 2048
    },
    "entityMerge": {
      "cosineThreshold": 0.95
    },
    "fts5": {
      "optimizeIntervalHours": 24
    }
  },
  "confirmation": {
    "reminderIntervalMin": 30,
    "maxReminders": 3,
    "pollIntervalMs": 60000
  },
  "dashboard": {
    "port": 3000,
    "auth": {
      "provider": "lark_oauth",
      "sessionTtlHours": 8,
      "allowedDepartments": []
    }
  },
  "repoMapping": [
    {
      "meegoProjectId": "project_xxx",
      "repos": [
        { "path": "/home/user/repos/frontend-main", "name": "前端主仓库" },
        { "path": "/home/user/repos/frontend-components", "name": "组件库" }
      ]
    },
    {
      "meegoProjectId": "project_yyy",
      "repos": [
        { "path": "/home/user/repos/admin-portal", "name": "管理后台" }
      ]
    }
  ],
  "skillRouting": {
    "frontend_dev": ["figma-reader", "lark-docs", "git-tools", "architect-template"],
    "code_review": ["git-diff", "lark-comment"],
    "bot_query": ["lark-docs", "lark-base"]
  }
}
```

- [ ] **Step 2: Validate JSON is well-formed**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "const c = await Bun.file('config/config.json').json(); console.log(Object.keys(c).join(', '))"`
Expected output: `meego, lark, session, sidecar, memory, storage, confirmation, dashboard, repoMapping, skillRouting`

- [ ] **Step 3: Commit**

```bash
git add config/config.json
git commit -m "feat(config): add consolidated config.json replacing 11 YAML files"
```

---

### Task 2: Create env.ts — Environment Variable Substitution

**Files:**
- Create: `packages/config/src/env.ts`
- Create: `packages/config/src/__tests__/env.test.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write env.test.ts with all test cases**

```typescript
import { describe, expect, it } from "vitest";
import { resolveEnvVars } from "../env.js";

describe("resolveEnvVars", () => {
  it("替换单个环境变量", () => {
    process.env.TEST_VAR_A = "hello";
    const result = resolveEnvVars("${TEST_VAR_A}");
    expect(result).toBe("hello");
    delete process.env.TEST_VAR_A;
  });

  it("替换字符串中混合多个环境变量", () => {
    process.env.TEST_PREFIX = "abc";
    process.env.TEST_SUFFIX = "xyz";
    const result = resolveEnvVars("start-${TEST_PREFIX}-middle-${TEST_SUFFIX}-end");
    expect(result).toBe("start-abc-middle-xyz-end");
    delete process.env.TEST_PREFIX;
    delete process.env.TEST_SUFFIX;
  });

  it("递归替换嵌套对象中的变量", () => {
    process.env.TEST_NESTED = "nested_value";
    const input = { level1: { level2: "${TEST_NESTED}" } };
    const result = resolveEnvVars(input);
    expect(result).toEqual({ level1: { level2: "nested_value" } });
    delete process.env.TEST_NESTED;
  });

  it("递归替换数组中的变量", () => {
    process.env.TEST_ARR = "arr_value";
    const input = ["${TEST_ARR}", "literal"];
    const result = resolveEnvVars(input);
    expect(result).toEqual(["arr_value", "literal"]);
    delete process.env.TEST_ARR;
  });

  it("未定义的环境变量抛出错误", () => {
    delete process.env.NONEXISTENT_VAR_XYZ;
    expect(() => resolveEnvVars("${NONEXISTENT_VAR_XYZ}")).toThrow("环境变量未定义: NONEXISTENT_VAR_XYZ");
  });

  it("非 string 值原样返回", () => {
    expect(resolveEnvVars(42)).toBe(42);
    expect(resolveEnvVars(true)).toBe(true);
    expect(resolveEnvVars(null)).toBeNull();
  });

  it("不含变量占位符的字符串原样返回", () => {
    expect(resolveEnvVars("plain text")).toBe("plain text");
  });

  it("嵌套对象和数组混合场景", () => {
    process.env.TEST_MIX = "mixed";
    const input = {
      arr: [{ key: "${TEST_MIX}" }, 123],
      num: 456,
      flag: false,
    };
    const result = resolveEnvVars(input);
    expect(result).toEqual({
      arr: [{ key: "mixed" }, 123],
      num: 456,
      flag: false,
    });
    delete process.env.TEST_MIX;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/env.test.ts`
Expected: FAIL — `resolveEnvVars` not found / cannot import

- [ ] **Step 3: Create env.ts with resolveEnvVars implementation**

```typescript
/**
 * 环境变量占位符正则，匹配 `${VAR_NAME}` 格式
 * 变量名仅包含大写字母、数字和下划线
 */
const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

/**
 * 递归遍历对象/数组，将字符串中的 `${VAR_NAME}` 替换为对应环境变量值
 *
 * @example
 * ```typescript
 * import { resolveEnvVars } from "@teamsland/config";
 *
 * process.env.DB_HOST = "localhost";
 * const result = resolveEnvVars({ host: "${DB_HOST}", port: 5432 });
 * // result: { host: "localhost", port: 5432 }
 * ```
 */
export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(ENV_VAR_PATTERN, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`环境变量未定义: ${varName}`);
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }

  return obj;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/env.test.ts`
Expected: All 8 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/config/src/env.ts packages/config/src/__tests__/env.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/env.ts packages/config/src/__tests__/env.test.ts
git commit -m "feat(config): add resolveEnvVars with recursive env-var substitution

TDD: 8 tests covering single/multi/nested/array substitution, missing var errors, non-string passthrough"
```

---

### Task 3: Create loader.ts — loadConfig Main Function

**Files:**
- Create: `packages/config/src/loader.ts`
- Create: `packages/config/src/__tests__/loader.test.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write loader.test.ts with all test cases**

```typescript
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../loader.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "__tests__", "fixtures");

describe("loadConfig", () => {
  afterEach(() => {
    delete process.env.TEST_LARK_ID;
    delete process.env.TEST_LARK_SECRET;
  });

  it("加载有效 JSON 配置并返回 AppConfig", async () => {
    process.env.TEST_LARK_ID = "cli_test";
    process.env.TEST_LARK_SECRET = "secret_test";

    const config = await loadConfig(resolve(FIXTURES_DIR, "valid-config.json"));

    expect(config.meego.spaces).toHaveLength(1);
    expect(config.meego.spaces[0].spaceId).toBe("space-1");
    expect(config.lark.appId).toBe("cli_test");
    expect(config.lark.appSecret).toBe("secret_test");
    expect(config.sidecar.maxConcurrentSessions).toBe(10);
  });

  it("配置文件不存在时抛出错误", async () => {
    await expect(loadConfig("/nonexistent/path/config.json")).rejects.toThrow("配置文件不存在");
  });

  it("环境变量替换在加载流程中正确执行", async () => {
    process.env.TEST_LARK_ID = "resolved_id";
    process.env.TEST_LARK_SECRET = "resolved_secret";

    const config = await loadConfig(resolve(FIXTURES_DIR, "valid-config.json"));

    expect(config.lark.appId).toBe("resolved_id");
    expect(config.lark.appSecret).toBe("resolved_secret");
  });
});
```

- [ ] **Step 2: Create test fixture file**

Create `packages/config/src/__tests__/fixtures/valid-config.json`:

```json
{
  "meego": {
    "spaces": [{ "spaceId": "space-1", "name": "测试空间" }],
    "eventMode": "webhook",
    "webhook": { "host": "0.0.0.0", "port": 8080, "path": "/webhook" },
    "poll": { "intervalSeconds": 30, "lookbackMinutes": 5 },
    "longConnection": { "enabled": false, "reconnectIntervalSeconds": 10 }
  },
  "lark": {
    "appId": "${TEST_LARK_ID}",
    "appSecret": "${TEST_LARK_SECRET}",
    "bot": { "historyContextCount": 10 },
    "notification": { "teamChannelId": "oc_test" }
  },
  "session": {
    "compactionTokenThreshold": 50000,
    "sqliteJitterRangeMs": [10, 100],
    "busyTimeoutMs": 3000
  },
  "sidecar": {
    "maxConcurrentSessions": 10,
    "maxRetryCount": 2,
    "maxDelegateDepth": 1,
    "workerTimeoutSeconds": 120,
    "healthCheckTimeoutMs": 10000,
    "minSwarmSuccessRatio": 0.6
  },
  "memory": {
    "decayHalfLifeDays": 15,
    "extractLoopMaxIterations": 2
  },
  "storage": {
    "sqliteVec": { "dbPath": "./test.sqlite", "busyTimeoutMs": 3000, "vectorDimensions": 256 },
    "embedding": { "model": "test-model", "contextSize": 1024 },
    "entityMerge": { "cosineThreshold": 0.9 },
    "fts5": { "optimizeIntervalHours": 12 }
  },
  "confirmation": {
    "reminderIntervalMin": 15,
    "maxReminders": 2,
    "pollIntervalMs": 30000
  },
  "dashboard": {
    "port": 4000,
    "auth": { "provider": "test_auth", "sessionTtlHours": 4, "allowedDepartments": ["eng"] }
  },
  "repoMapping": [
    {
      "meegoProjectId": "proj_test",
      "repos": [{ "path": "/tmp/repo", "name": "测试仓库" }]
    }
  ],
  "skillRouting": {
    "test_skill": ["tool-a", "tool-b"]
  }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/loader.test.ts`
Expected: FAIL — `loadConfig` not found / cannot import

- [ ] **Step 4: Create loader.ts with loadConfig implementation**

```typescript
import type { AppConfig } from "@teamsland/types";
import { resolveEnvVars } from "./env.js";

/**
 * 从 JSON 文件加载全局配置，执行环境变量替换，返回类型安全的 AppConfig
 *
 * @param configPath - 配置文件路径，默认为 `config/config.json`（相对于 cwd）
 * @returns 解析后的 AppConfig 对象
 *
 * @example
 * ```typescript
 * import { loadConfig } from "@teamsland/config";
 *
 * const config = await loadConfig();
 * console.log(config.meego.spaces[0].name);
 * ```
 */
export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const path = configPath ?? "config/config.json";
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`配置文件不存在: ${path}`);
  }

  const raw: unknown = await file.json();
  return resolveEnvVars(raw) as AppConfig;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/loader.test.ts`
Expected: All 3 tests pass

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 7: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/config/src/loader.ts packages/config/src/__tests__/loader.test.ts`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/config/src/loader.ts packages/config/src/__tests__/loader.test.ts packages/config/src/__tests__/fixtures/valid-config.json
git commit -m "feat(config): add loadConfig with JSON parsing and env-var substitution

TDD: 3 tests covering valid load, missing file error, env-var resolution"
```

---

### Task 4: Create repo-mapping.ts — RepoMapping Class

**Files:**
- Create: `packages/config/src/repo-mapping.ts`
- Create: `packages/config/src/__tests__/repo-mapping.test.ts`

TDD: write failing tests first, then implement.

- [ ] **Step 1: Write repo-mapping.test.ts with all test cases**

```typescript
import { describe, expect, it } from "vitest";
import { RepoMapping } from "../repo-mapping.js";

const TEST_CONFIG = [
  {
    meegoProjectId: "project_xxx",
    repos: [
      { path: "/repos/frontend-main", name: "前端主仓库" },
      { path: "/repos/frontend-components", name: "组件库" },
    ],
  },
  {
    meegoProjectId: "project_yyy",
    repos: [{ path: "/repos/admin-portal", name: "管理后台" }],
  },
];

describe("RepoMapping", () => {
  it("fromConfig 正确构造映射", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    expect(mapping).toBeInstanceOf(RepoMapping);
  });

  it("resolve 匹配已知 projectId 返回 repos", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("project_xxx");
    expect(repos).toHaveLength(2);
    expect(repos[0].path).toBe("/repos/frontend-main");
    expect(repos[0].name).toBe("前端主仓库");
    expect(repos[1].path).toBe("/repos/frontend-components");
  });

  it("resolve 匹配单仓库项目", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("project_yyy");
    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("管理后台");
  });

  it("resolve 未知 projectId 返回空数组", () => {
    const mapping = RepoMapping.fromConfig(TEST_CONFIG);
    const repos = mapping.resolve("unknown_project");
    expect(repos).toEqual([]);
  });

  it("fromConfig 空数组构造空映射", () => {
    const mapping = RepoMapping.fromConfig([]);
    expect(mapping.resolve("anything")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/repo-mapping.test.ts`
Expected: FAIL — `RepoMapping` not found / cannot import

- [ ] **Step 3: Create repo-mapping.ts with RepoMapping class**

```typescript
import type { RepoEntry, RepoMappingConfig } from "@teamsland/types";

/**
 * Meego 项目到 Git 仓库的映射查找器
 *
 * @example
 * ```typescript
 * import { RepoMapping } from "@teamsland/config";
 * import type { RepoMappingConfig } from "@teamsland/types";
 *
 * const cfg: RepoMappingConfig = [
 *   { meegoProjectId: "proj_a", repos: [{ path: "/repos/fe", name: "前端" }] },
 * ];
 * const mapping = RepoMapping.fromConfig(cfg);
 * const repos = mapping.resolve("proj_a");
 * // repos: [{ path: "/repos/fe", name: "前端" }]
 * ```
 */
export class RepoMapping {
  private readonly map: Map<string, RepoEntry[]>;

  private constructor(map: Map<string, RepoEntry[]>) {
    this.map = map;
  }

  /**
   * 从配置数组构造 RepoMapping 实例
   *
   * @param config - 仓库映射配置数组
   * @returns RepoMapping 实例
   *
   * @example
   * ```typescript
   * import { RepoMapping } from "@teamsland/config";
   *
   * const mapping = RepoMapping.fromConfig([
   *   { meegoProjectId: "proj_a", repos: [{ path: "/repos/fe", name: "前端" }] },
   * ]);
   * ```
   */
  static fromConfig(config: RepoMappingConfig): RepoMapping {
    const map = new Map<string, RepoEntry[]>();
    for (const entry of config) {
      map.set(entry.meegoProjectId, entry.repos);
    }
    return new RepoMapping(map);
  }

  /**
   * 根据 Meego 项目 ID 查找关联的仓库列表
   *
   * @param meegoProjectId - Meego 项目 ID
   * @returns 关联的仓库条目数组，未找到时返回空数组
   *
   * @example
   * ```typescript
   * const repos = mapping.resolve("project_xxx");
   * // repos: [{ path: "/repos/fe", name: "前端主仓库" }, ...]
   * ```
   */
  resolve(meegoProjectId: string): RepoEntry[] {
    return this.map.get(meegoProjectId) ?? [];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/src/__tests__/repo-mapping.test.ts`
Expected: All 5 tests pass

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Run lint**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/config/src/repo-mapping.ts packages/config/src/__tests__/repo-mapping.test.ts`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/repo-mapping.ts packages/config/src/__tests__/repo-mapping.test.ts
git commit -m "feat(config): add RepoMapping class for project→repo lookup

TDD: 5 tests covering fromConfig construction, resolve hit/miss, empty config"
```

---

### Task 5: Update index.ts — Barrel Exports

**Files:**
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Replace index.ts with barrel re-exports**

Replace the entire content of `packages/config/src/index.ts` with:

```typescript
// @teamsland/config — JSON 配置加载器 + RepoMapping
// 从单一 config.json 加载全局配置，执行环境变量替换

export { loadConfig } from "./loader.js";
export { resolveEnvVars } from "./env.js";
export { RepoMapping } from "./repo-mapping.js";
```

- [ ] **Step 2: Run typecheck on the full config package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on the full config package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/config/src/`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/config/src/index.ts
git commit -m "feat(config): add barrel exports — loadConfig, resolveEnvVars, RepoMapping"
```

---

### Task 6: Delete Old YAML Config Files

**Files:**
- Delete: `config/confirmation.yaml`
- Delete: `config/dashboard.yaml`
- Delete: `config/lark.yaml`
- Delete: `config/meego.yaml`
- Delete: `config/memory.yaml`
- Delete: `config/repo_mapping.yaml`
- Delete: `config/session.yaml`
- Delete: `config/sidecar.yaml`
- Delete: `config/skill_routing.yaml`
- Delete: `config/storage.yaml`
- Keep: `config/test.yaml` (not part of AppConfig)

- [ ] **Step 1: Delete the 10 YAML files**

```bash
cd /Users/bytedance/workspace/teamsland
git rm config/confirmation.yaml config/dashboard.yaml config/lark.yaml config/meego.yaml config/memory.yaml config/repo_mapping.yaml config/session.yaml config/sidecar.yaml config/skill_routing.yaml config/storage.yaml
```

- [ ] **Step 2: Verify test.yaml is preserved**

Run: `ls config/`
Expected: `config.json  test.yaml` (only these two files remain)

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(config): remove 10 YAML config files replaced by config.json

Kept config/test.yaml (test fixture config, not part of AppConfig)"
```

---

### Task 7: Full Verification

- [ ] **Step 1: Run all config tests**

Run: `cd /Users/bytedance/workspace/teamsland && bunx vitest run packages/config/`
Expected: All 16 tests pass (8 env + 3 loader + 5 repo-mapping)

- [ ] **Step 2: Run typecheck on config package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx tsc --noEmit --project packages/config/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Run lint on config package**

Run: `cd /Users/bytedance/workspace/teamsland && bunx biome check packages/config/src/`
Expected: No errors

- [ ] **Step 4: Verify exported API surface**

Run: `cd /Users/bytedance/workspace/teamsland && bun -e "import { loadConfig, resolveEnvVars, RepoMapping } from './packages/config/src/index.ts'; console.log('loadConfig:', typeof loadConfig); console.log('resolveEnvVars:', typeof resolveEnvVars); console.log('RepoMapping:', typeof RepoMapping)"`
Expected:
```
loadConfig: function
resolveEnvVars: function
RepoMapping: function
```

- [ ] **Step 5: Verify no any or non-null assertions**

Run: `cd /Users/bytedance/workspace/teamsland && grep -rn '\bany\b\|!' packages/config/src/ --include='*.ts' | grep -v '__tests__' | grep -v 'node_modules' | grep -v '\.d\.ts'`
Expected: No output (no `any` or `!` in source files; test files and .d.ts excluded)

---

## Verification

After all tasks are complete, the following must be true:

1. `bunx vitest run packages/config/` — 16 tests pass (0 fail)
2. `bunx tsc --noEmit --project packages/config/tsconfig.json` — exits 0
3. `bunx biome check packages/config/src/` — no errors
4. All exported functions/classes have Chinese JSDoc with `@example`
5. No `any`, no `!` non-null assertions in source files
6. `config/config.json` exists with all 10 top-level keys
7. 10 YAML files deleted, `config/test.yaml` preserved
8. Package exports: `loadConfig`, `resolveEnvVars`, `RepoMapping`
