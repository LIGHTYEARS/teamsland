# Teamsland 可靠性改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the reliability of Teamsland's startup, skill injection, and worker prompt delivery across the Coordinator→Worker pipeline.

**Architecture:** Three parallel tracks — (1) harden server startup with crash guards, restart policy, config validation, and phase timing; (2) fix skill injection gaps including env var passthrough, phantom routing cleanup, versioned coordinator templates, and core skill fallback; (3) restructure worker prompt delivery with a structured stdin envelope, enhanced work rules in CLAUDE.md, and coordinator prompt guidelines.

**Tech Stack:** Bun, TypeScript, vitest, overmind, Zod (existing schema validation)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/server/src/main.ts` | Modify | Add uncaughtException/unhandledRejection handlers, phase timing |
| `Procfile.dev` | Modify | Add restart wrapper for server |
| `packages/config/src/validate.ts` | Create | Post-load semantic config validation |
| `packages/config/src/index.ts` | Modify | Re-export validate |
| `config/config.json` | Modify | Add new fields, clean skillRouting |
| `packages/types/src/config.ts` | Modify | Add new fields to SidecarConfig, CoordinatorConfig |
| `packages/config/src/schema.ts` | Modify | Add new Zod fields |
| `packages/sidecar/src/skill-injector.ts` | Modify | Add coreSkills fallback |
| `packages/sidecar/src/claude-md-injector.ts` | Modify | Restructure context block, add new fields |
| `packages/sidecar/src/process-controller.ts` | Modify | Add buildEnvelope, extend SpawnParams |
| `apps/server/src/worker-routes.ts` | Modify | Pass new env vars + SpawnParams fields |
| `apps/server/src/coordinator-init.ts` | Modify | writeFileIfChanged, spawn prompt guidelines |
| `apps/server/src/coordinator-init-workflows.ts` | Modify | Fix ticket-lifecycle frontmatter |
| `apps/server/src/init/dashboard.ts` | Modify | Thread teamslandApiBase |
| `apps/server/src/dashboard.ts` | Modify | Thread teamslandApiBase |

---

## Task 1: Server Crash Guards (uncaughtException + unhandledRejection)

**Files:**
- Modify: `apps/server/src/main.ts:23-27`

- [ ] **Step 1: Add crash guard handlers after Phase 0**

In `apps/server/src/main.ts`, insert after line 27 (`const { config, logger, controller } = await initConfigAndLogging();`):

```typescript
    // ── Crash Guards ──
    process.on("uncaughtException", (err) => {
      logger.fatal({ err }, "未捕获异常，进程即将退出");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      logger.fatal({ reason }, "未处理 Promise 拒绝，进程即将退出");
      process.exit(1);
    });
```

- [ ] **Step 2: Verify no duplicate handlers exist**

Run: `grep -n "uncaughtException\|unhandledRejection" apps/server/src/main.ts`
Expected: Only the two lines you just added.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): add uncaughtException/unhandledRejection crash guards"
```

---

## Task 2: Overmind Restart Wrapper

**Files:**
- Modify: `Procfile.dev`

- [ ] **Step 1: Replace server line with restart wrapper**

Current content of `Procfile.dev` line 2:
```
server:    cd apps/server && bun run --env-file ../../.env --watch src/main.ts
```

Replace with:
```
server:    FAIL_COUNT=0; WINDOW_START=$(date +%s); while true; do cd apps/server && bun run --env-file ../../.env --watch src/main.ts; EXIT_CODE=$?; NOW=$(date +%s); ELAPSED=$((NOW - WINDOW_START)); if [ "$ELAPSED" -gt 60 ]; then FAIL_COUNT=0; WINDOW_START=$NOW; fi; FAIL_COUNT=$((FAIL_COUNT + 1)); if [ "$FAIL_COUNT" -ge 5 ]; then echo "[overmind] server crashed $FAIL_COUNT times in ${ELAPSED}s, stopping"; break; fi; echo "[overmind] server exited ($EXIT_CODE), restarting in 3s... ($FAIL_COUNT/5)"; sleep 3; cd ../..; done
```

- [ ] **Step 2: Verify Procfile.dev is valid**

Run: `cat Procfile.dev`
Expected: Three lines (viking, server, dashboard), server line has the while-loop wrapper.

- [ ] **Step 3: Commit**

```bash
git add Procfile.dev
git commit -m "feat(infra): add overmind restart wrapper with crashloop protection"
```

---

## Task 3: Config Validation

**Files:**
- Create: `packages/config/src/validate.ts`
- Modify: `packages/config/src/index.ts`
- Test: `packages/config/src/__tests__/validate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/config/src/__tests__/validate.test.ts`:

```typescript
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validateConfig, type ValidationResult } from "../validate.js";

function makeValidConfig() {
  return {
    lark: { appId: "cli_xxx", appSecret: "secret_yyy" },
    meego: { apiBaseUrl: "https://project.feishu.cn/open_api" },
    dashboard: { port: 3001 },
    coordinator: { enabled: true },
    queue: { dbPath: "data/queue.sqlite" },
    repoMapping: [
      { meegoProjectId: "p1", repos: [{ path: "/tmp", name: "test" }] },
    ],
  };
}

describe("validateConfig", () => {
  it("returns ok for valid config", () => {
    const result = validateConfig(makeValidConfig() as never);
    expect(result.fatal).toEqual([]);
  });

  it("reports fatal when lark.appId is empty", () => {
    const cfg = makeValidConfig();
    cfg.lark.appId = "";
    const result = validateConfig(cfg as never);
    expect(result.fatal).toContain("lark.appId 不能为空");
  });

  it("reports fatal when lark.appId contains unresolved placeholder", () => {
    const cfg = makeValidConfig();
    cfg.lark.appId = "${LARK_APP_ID}";
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("lark.appId"))).toBe(true);
  });

  it("reports fatal when dashboard.port is not a positive integer", () => {
    const cfg = makeValidConfig();
    cfg.dashboard.port = -1;
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("dashboard.port"))).toBe(true);
  });

  it("reports warn when repo path does not exist", () => {
    const cfg = makeValidConfig();
    cfg.repoMapping[0].repos[0].path = "/nonexistent/path/xyz";
    const result = validateConfig(cfg as never);
    expect(result.warnings.some((m) => m.includes("/nonexistent/path/xyz"))).toBe(true);
  });

  it("reports fatal when queue.dbPath is empty", () => {
    const cfg = makeValidConfig();
    cfg.queue!.dbPath = "";
    const result = validateConfig(cfg as never);
    expect(result.fatal.some((m) => m.includes("queue.dbPath"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/config/src/__tests__/validate.test.ts`
Expected: FAIL — module `../validate.js` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/config/src/validate.ts`:

```typescript
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { AppConfig } from "@teamsland/types";

export interface ValidationResult {
  fatal: string[];
  warnings: string[];
}

const PLACEHOLDER_RE = /\$\{[A-Z0-9_]+\}/;

function checkRequired(value: unknown, path: string, fatal: string[]): void {
  if (typeof value === "string") {
    if (!value) {
      fatal.push(`${path} 不能为空`);
    } else if (PLACEHOLDER_RE.test(value)) {
      fatal.push(`${path} 含未解析的环境变量占位符: ${value}`);
    }
  }
}

export function validateConfig(config: AppConfig): ValidationResult {
  const fatal: string[] = [];
  const warnings: string[] = [];

  // Required string fields
  checkRequired(config.lark?.appId, "lark.appId", fatal);
  checkRequired(config.lark?.appSecret, "lark.appSecret", fatal);
  checkRequired(config.meego?.apiBaseUrl, "meego.apiBaseUrl", fatal);
  checkRequired(config.queue?.dbPath, "queue.dbPath", fatal);

  // Required numeric fields
  if (!config.dashboard?.port || config.dashboard.port <= 0 || !Number.isInteger(config.dashboard.port)) {
    fatal.push("dashboard.port 必须为正整数");
  }

  // coordinator.enabled must be boolean
  if (config.coordinator && typeof config.coordinator.enabled !== "boolean") {
    fatal.push("coordinator.enabled 必须为 boolean");
  }

  // Repo path existence checks (warn only)
  for (const entry of config.repoMapping ?? []) {
    for (const repo of entry.repos) {
      const resolved = repo.path.replace(/^~/, homedir());
      if (!existsSync(resolved)) {
        warnings.push(`repoMapping 路径不存在: ${repo.path} (resolved: ${resolved})`);
      }
    }
  }

  return { fatal, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/bytedance/workspace/teamsland && bun test packages/config/src/__tests__/validate.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Re-export from index**

In `packages/config/src/index.ts`, add:
```typescript
export { validateConfig, type ValidationResult } from "./validate.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/validate.ts packages/config/src/__tests__/validate.test.ts packages/config/src/index.ts
git commit -m "feat(config): add post-load semantic config validation"
```

---

## Task 4: Config Field Promotion + Schema Updates

**Files:**
- Modify: `packages/types/src/config.ts:256-269` (SidecarConfig)
- Modify: `packages/config/src/schema.ts:66-73` (SidecarConfigSchema)
- Modify: `config/config.json`
- Modify: `apps/server/src/init/coordinator.ts:84-86`

- [ ] **Step 1: Add `teamslandApiBase` to SidecarConfig type**

In `packages/types/src/config.ts`, inside `SidecarConfig` interface (after line 268 `minSwarmSuccessRatio: number;`), add:

```typescript
  /** teamsland 主服务 API 基础地址，供 Worker 环境变量注入 */
  teamslandApiBase?: string;
```

- [ ] **Step 2: Add `maxEventsPerSession` and `resultTimeoutMs` to CoordinatorConfig Zod schema**

In `packages/config/src/schema.ts`, inside the `coordinator` object (after `enabled: z.boolean().default(false),` at line 174), add:

```typescript
      maxEventsPerSession: z.number().int().positive().default(20),
      resultTimeoutMs: z.number().int().positive().default(300_000),
```

- [ ] **Step 3: Add `teamslandApiBase` to SidecarConfigSchema**

In `packages/config/src/schema.ts`, inside `SidecarConfigSchema` (after `minSwarmSuccessRatio` at line 72), add:

```typescript
  teamslandApiBase: z.string().default("http://localhost:3001"),
```

- [ ] **Step 4: Update config.json**

In `config/config.json`, inside `"sidecar"` object, add:
```json
    "teamslandApiBase": "http://localhost:3001"
```

Inside `"coordinator"` object, add:
```json
    "maxEventsPerSession": 20,
    "resultTimeoutMs": 300000
```

- [ ] **Step 5: Use config values in initCoordinator**

In `apps/server/src/init/coordinator.ts`, replace the hardcoded values at lines 84-86:

Current:
```typescript
      sessionMaxLifetimeMs: coordConfig.sessionMaxLifetimeMs ?? 30 * 60 * 1000,
      maxEventsPerSession: coordConfig.maxEventsPerSession ?? 20,
      resultTimeoutMs: coordConfig.inferenceTimeoutMs ?? 5 * 60 * 1000,
```

Replace with:
```typescript
      sessionMaxLifetimeMs: coordConfig.sessionMaxLifetimeMs ?? 30 * 60 * 1000,
      maxEventsPerSession: coordConfig.maxEventsPerSession ?? 20,
      resultTimeoutMs: coordConfig.resultTimeoutMs ?? coordConfig.inferenceTimeoutMs ?? 5 * 60 * 1000,
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: No new errors.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/config.ts packages/config/src/schema.ts config/config.json apps/server/src/init/coordinator.ts
git commit -m "feat(config): promote coordinator/sidecar hidden defaults to config"
```

---

## Task 5: Startup Phase Timing + Validation Integration

**Files:**
- Modify: `apps/server/src/main.ts`

- [ ] **Step 1: Add phase timing and validation to main.ts**

In `apps/server/src/main.ts`, after the crash guards (from Task 1) and before Phase 1, add config validation call:

```typescript
    // ── Config Validation ──
    const { validateConfig } = await import("@teamsland/config");
    const validation = validateConfig(config);
    for (const w of validation.warnings) logger.warn(w);
    if (validation.fatal.length > 0) {
      for (const f of validation.fatal) logger.fatal(f);
      logger.fatal({ fatalCount: validation.fatal.length }, "配置校验失败，进程退出");
      process.exit(1);
    }
```

Then wrap each Phase with timing. Replace the current Phase 1 through "系统启动完成" with timed versions. Add at the top of the try block (after crash guards and validation):

```typescript
    const startTime = performance.now();
    const phaseTimings: Record<string, number> = {};
    function timePhase(name: string, t0: number): void {
      const ms = Math.round(performance.now() - t0);
      phaseTimings[name] = ms;
      logger.info({ phase: name, durationMs: ms }, `${name} 完成`);
    }
```

Then wrap each existing phase:
```typescript
    // ── Phase 1: 存储层 ──
    let t0 = performance.now();
    const storage = await initStorage(config, logger);
    // ... (ticket store lines stay the same)
    timePhase("storage", t0);
```

Apply the same pattern to each phase. At the end, replace the bare `logger.info("系统启动完成")` with:

```typescript
    logger.info({
      phases: phaseTimings,
      coordinatorEnabled: !!coordinator.coordinator,
      workerManagerEnabled: !!coordinator.workerManager,
      hooksEnabled: !!hooks.engine,
      totalDurationMs: Math.round(performance.now() - startTime),
    }, "系统启动完成");
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat(server): add config validation and startup phase timing"
```

---

## Task 6: Clean skillRouting Phantom Entries

**Files:**
- Modify: `config/config.json:84-97`

- [ ] **Step 1: Replace skillRouting with cleaned version**

In `config/config.json`, replace the entire `"skillRouting"` object:

Current (lines 84-97):
```json
  "skillRouting": {
    "frontend_dev": ["figma-reader", "lark-docs", "git-tools", "architect-template"],
    "tech_spec":    ["lark-docs", "git-tools", "architect-template"],
    "design":       ["figma-reader", "lark-docs", "architect-template"],
    "code_review":  ["git-diff", "lark-comment"],
    "bot_query":    ["lark-docs", "lark-base"],
    "confirm":      ["lark-docs"],
    "status_sync":  ["lark-docs", "lark-base"],
    "query":        ["lark-docs", "lark-base"],
    "coding":       ["lark-reply", "meego-update", "teamsland-report"],
    "research":     ["lark-reply", "teamsland-report"],
    "review":       ["lark-reply", "meego-update", "teamsland-report"],
    "observer":     ["teamsland-report"]
  },
```

Replace with:
```json
  "skillRouting": {
    "coding":   ["lark-reply", "meego-update", "teamsland-report"],
    "research": ["lark-reply", "teamsland-report"],
    "review":   ["lark-reply", "meego-update", "teamsland-report"],
    "observer": ["teamsland-report"]
  },
```

- [ ] **Step 2: Verify JSON is valid**

Run: `cat config/config.json | python3 -m json.tool > /dev/null && echo "valid JSON"`
Expected: "valid JSON"

- [ ] **Step 3: Commit**

```bash
git add config/config.json
git commit -m "fix(config): remove phantom skillRouting entries pointing to nonexistent skills"
```

---

## Task 7: Core Skill Fallback Injection

**Files:**
- Modify: `packages/sidecar/src/skill-injector.ts:58-66,142-206`
- Test: `packages/sidecar/src/__tests__/skill-injector.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/sidecar/src/__tests__/skill-injector.test.ts`, add a new test at the end of the `describe` block (before the closing `});`):

```typescript
  it("inject: core skills 在 taskType 无路由时仍被注入", async () => {
    const teamslandReportDir = join(skillSourceDir, "teamsland-report");
    await mkdir(teamslandReportDir, { recursive: true });
    await Bun.write(join(teamslandReportDir, "SKILL.md"), "# teamsland-report\n汇报结果");

    const injector = new SkillInjector({
      skills: [
        { name: "lark-reply", sourcePath: join(skillSourceDir, "lark-reply") },
        { name: "meego-update", sourcePath: join(skillSourceDir, "meego-update") },
        { name: "teamsland-report", sourcePath: join(skillSourceDir, "teamsland-report") },
      ],
      routing: {
        frontend_dev: ["lark-reply", "meego-update"],
      },
      coreSkills: ["teamsland-report"],
      logger: makeFakeLogger() as never,
    });

    const result = await injector.inject({
      worktreePath,
      taskType: "unknown_task",
    });

    expect(result.injected).toContain("teamsland-report");
    const skillMd = Bun.file(join(worktreePath, ".claude", "skills", "teamsland-report", "SKILL.md"));
    expect(await skillMd.exists()).toBe(true);
  });

  it("inject: core skills 不重复注入已在路由中的 skill", async () => {
    const teamslandReportDir = join(skillSourceDir, "teamsland-report");
    await mkdir(teamslandReportDir, { recursive: true });
    await Bun.write(join(teamslandReportDir, "SKILL.md"), "# teamsland-report\n汇报结果");

    const injector = new SkillInjector({
      skills: [
        { name: "lark-reply", sourcePath: join(skillSourceDir, "lark-reply") },
        { name: "teamsland-report", sourcePath: join(skillSourceDir, "teamsland-report") },
      ],
      routing: {
        coding: ["lark-reply", "teamsland-report"],
      },
      coreSkills: ["teamsland-report"],
      logger: makeFakeLogger() as never,
    });

    const result = await injector.inject({
      worktreePath,
      taskType: "coding",
    });

    // teamsland-report appears exactly once
    const count = result.injected.filter((n) => n === "teamsland-report").length;
    expect(count).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/sidecar/src/__tests__/skill-injector.test.ts`
Expected: FAIL — `coreSkills` not a known property.

- [ ] **Step 3: Add coreSkills to SkillInjectorOpts and inject logic**

In `packages/sidecar/src/skill-injector.ts`:

Add `coreSkills` to the `SkillInjectorOpts` interface (after `logger` at line 65):
```typescript
  /** 始终注入的核心 Skill 名称列表 */
  coreSkills?: string[];
```

Add a class field (after `private readonly logger: Logger;` at line 146):
```typescript
  private readonly coreSkills: string[];
```

In the constructor (after `this.logger = opts.logger;` at line 149), add:
```typescript
    this.coreSkills = opts.coreSkills ?? [];
```

In the `inject()` method, before the final log line (`this.logger.info({ taskType: req.taskType, injected, skipped }, ...)`), insert:

```typescript
    // Core skill fallback: ensure core skills are always injected
    for (const name of this.coreSkills) {
      if (injected.includes(name)) continue;
      const manifest = this.skillMap.get(name);
      if (!manifest) {
        this.logger.warn({ skill: name }, "Core skill 不在清单中");
        continue;
      }
      const targetDir = join(skillsDir, name);
      await this.copySkillDir(manifest.sourcePath, targetDir);
      await this.writeMarker(targetDir);
      injected.push(name);
      this.logger.info({ skill: name, target: targetDir }, "Core skill 兜底注入");
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/sidecar/src/__tests__/skill-injector.test.ts`
Expected: All tests PASS (including the 2 new ones).

- [ ] **Step 5: Thread coreSkills from init/dashboard.ts**

In `apps/server/src/init/dashboard.ts`, find the SkillInjector construction (around line 120-130). It should look like:
```typescript
const skillInjector = new SkillInjector({ skills, routing, logger });
```
Add `coreSkills`:
```typescript
const skillInjector = new SkillInjector({ skills, routing, coreSkills: ["teamsland-report"], logger });
```

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/skill-injector.ts packages/sidecar/src/__tests__/skill-injector.test.ts apps/server/src/init/dashboard.ts
git commit -m "feat(sidecar): add core skill fallback to ensure teamsland-report is always injected"
```

---

## Task 8: Coordinator Skill Versioned Updates

**Files:**
- Modify: `apps/server/src/coordinator-init.ts:163-186`

- [ ] **Step 1: Add `writeFileIfChanged` function**

In `apps/server/src/coordinator-init.ts`, add a new import at the top (after existing imports):
```typescript
import { basename, dirname } from "node:path";
```

Replace the `writeFileIfNotExists` function (lines 179-186) with two functions:

```typescript
async function writeFileIfNotExists(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) {
    logger.debug({ file: filePath }, "文件已存在，跳过写入");
    return;
  }
  await Bun.write(filePath, content);
  logger.info({ file: filePath }, "文件已创建");
}

async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
  const HASH_PREFIX = "<!-- teamsland-content-hash: ";
  const hash = new Bun.CryptoHasher("sha256").update(content).digest("hex").slice(0, 8);
  const taggedContent = `${HASH_PREFIX}${hash} -->\n${content}`;

  if (existsSync(filePath)) {
    const existing = await Bun.file(filePath).text();
    const match = existing.match(/<!-- teamsland-content-hash: (\w+) -->/);
    if (match?.[1] === hash) {
      logger.debug({ file: filePath }, "文件内容未变更，跳过");
      return;
    }
    const backupDir = join(dirname(filePath), ".backup");
    mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    await Bun.write(join(backupDir, `${basename(filePath)}.${ts}`), existing);
    logger.info({ file: filePath }, "旧文件已备份，写入新版本");
  }

  await Bun.write(filePath, taggedContent);
  logger.info({ file: filePath, hash }, "文件已写入（版本化）");
}
```

- [ ] **Step 2: Update writeWorkspaceFiles to use writeFileIfChanged for .md files**

In the `writeWorkspaceFiles` function, change the loop to use `writeFileIfChanged` for `.md` files and `writeFileIfNotExists` for `.json` files:

Replace the simple loop:
```typescript
  for (const file of files) {
    await writeFileIfNotExists(file.path, file.content);
  }
```

With:
```typescript
  for (const file of files) {
    if (file.path.endsWith(".md")) {
      await writeFileIfChanged(file.path, file.content);
    } else {
      await writeFileIfNotExists(file.path, file.content);
    }
  }
```

- [ ] **Step 3: Verify import of basename and dirname**

Confirm `basename` and `dirname` are imported from `node:path`. The existing import is:
```typescript
import { join } from "node:path";
```
Update to:
```typescript
import { basename, dirname, join } from "node:path";
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/coordinator-init.ts
git commit -m "feat(coordinator): versioned skill/prompt updates with content hash and backup"
```

---

## Task 9: Fix ticket-lifecycle Frontmatter

**Files:**
- Modify: `apps/server/src/coordinator-init-workflows.ts:56-102`

- [ ] **Step 1: Fix the frontmatter**

In `apps/server/src/coordinator-init-workflows.ts`, the `generateTicketLifecycleSkill()` function returns a string that starts without frontmatter. The `allowed-tools` line is at the bottom (line 100) outside any frontmatter block.

Replace the entire return value of `generateTicketLifecycleSkill()` — from line 57 (`return \`# 工单生命周期管理`) through line 101 (closing backtick `` ` ``):

The new return value should wrap the content in proper frontmatter:

```typescript
  return `---
name: ticket-lifecycle
description: 管理 Meego 工单的处理流程，包括深度采集、智能分诊、异步追问和状态推进。
allowed-tools:
  - Bash(teamsland ticket *)
  - Bash(teamsland ask *)
---

# 工单生命周期管理

通过 \`teamsland ticket\` 和 \`teamsland ask\` 管理 Meego 工单的处理流程。

## 查看工单状态
teamsland ticket state <issue-id>
# 返回 JSON: {issueId, state, context, updatedAt}

## 推进工单状态
teamsland ticket status <issue-id> --set <state>
# 合法转换由工具层校验，非法转换返回错误

## 深度采集
teamsland ticket enrich <issue-id>
# 纯数据采集：Meego 回查 + 飞书文档 URL 提取 + 文档读取
# 返回原始数据 JSON（不做摘要/实体提取/异常吞没）
# 你需要自己阅读返回内容，理解需求、提取实体、判断信息充分度
# 文档读取失败时 ok=false + error 字段说明原因，由你决定如何处理

## 异步追问
teamsland ask --to <user> --ticket <issue-id> --text <问题>
# 发送 Lark DM + 自动推进状态到 awaiting_clarification + 注册 30min 超时
# 回复到达时你会收到普通的 Lark DM 事件，需要自己判断是否是追问的回复
# 判断方法：查询 ticket state，看是否有 awaiting_clarification 的工单匹配发送者
# 30min 超时后你会收到 clarification_timeout 系统事件

## 仓库推断
不需要专用命令。直接读取 \`.claude/rules/repo-mapping.md\` 对照 projectKey，
结合 enriching 上下文（模块路径、文件路径）自行推理。不确定时用 \`ask\` 追问。

## 状态流转速查
received → enriching → triaging → ready → executing → completed
                          ↓ 信息不足
                    awaiting_clarification → triaging（回复后）
                    awaiting_clarification → suspended（超时）
                    triaging → skipped（无需处理）
                    executing → failed（异常）

## 常见用法
- 收到 meego issue.created → 先 \`ticket enrich\`，再 \`ticket status --set triaging\`
- triaging 判定模糊 → \`ask\` 追问，等待 DM 事件
- ready 后 → \`worker spawn\`，同时 \`ticket status --set executing\`
`;
```

- [ ] **Step 2: Verify the change**

Run: `grep -A3 "^---$" apps/server/src/coordinator-init-workflows.ts | head -10`
Expected: Shows frontmatter with `name: ticket-lifecycle`, `description:`, `allowed-tools:` inside the `---` delimiters.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/coordinator-init-workflows.ts
git commit -m "fix(coordinator): move ticket-lifecycle allowed-tools into frontmatter"
```

---

## Task 10: Env Var Injection + teamslandApiBase Threading

**Files:**
- Modify: `apps/server/src/worker-routes.ts:43-66,214-225`
- Modify: `apps/server/src/dashboard.ts:72,353,383-392`
- Modify: `apps/server/src/init/dashboard.ts:133-155`

- [ ] **Step 1: Add `teamslandApiBase` to WorkerRouteDeps**

In `apps/server/src/worker-routes.ts`, inside the `WorkerRouteDeps` interface (after `meegoPluginToken` at line 59), add:

```typescript
  /** teamsland 主服务 API 基础地址 */
  teamslandApiBase?: string;
```

- [ ] **Step 2: Expand env vars in handleCreateWorker spawn call**

In `apps/server/src/worker-routes.ts`, replace the `env` object in the `processController.spawn()` call (lines 221-225):

Current:
```typescript
      env: {
        WORKER_ID: agentId,
        MEEGO_API_BASE: deps.meegoApiBase ?? "",
        MEEGO_PLUGIN_TOKEN: deps.meegoPluginToken ?? "",
      },
```

Replace with:
```typescript
      env: {
        WORKER_ID: agentId,
        MEEGO_API_BASE: deps.meegoApiBase ?? "",
        MEEGO_PLUGIN_TOKEN: deps.meegoPluginToken ?? "",
        TEAMSLAND_API_BASE: deps.teamslandApiBase ?? "http://localhost:3001",
        LARK_CHAT_ID: bodyResult.origin?.chatId ?? "",
        LARK_MESSAGE_ID: bodyResult.origin?.messageId ?? "",
        LARK_USER_ID: bodyResult.origin?.senderId ?? "",
      },
```

- [ ] **Step 3: Thread teamslandApiBase through dashboard**

In `apps/server/src/dashboard.ts`, add `teamslandApiBase` to the dashboard options interface (around line 72, after `meegoPluginToken`):
```typescript
  teamslandApiBase?: string;
```

And in the place where it constructs the WorkerRouteDeps object (around line 383-392), add after `meegoPluginToken`:
```typescript
    teamslandApiBase: ctx.teamslandApiBase,
```

In `apps/server/src/init/dashboard.ts`, add after `meegoPluginToken` line (around line 145):
```typescript
      teamslandApiBase: config.sidecar.teamslandApiBase ?? `http://localhost:${config.dashboard.port}`,
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/worker-routes.ts apps/server/src/dashboard.ts apps/server/src/init/dashboard.ts
git commit -m "feat(worker): inject TEAMSLAND_API_BASE, LARK_CHAT_ID, LARK_MESSAGE_ID, LARK_USER_ID env vars"
```

---

## Task 11: Structured Stdin Envelope (ProcessController)

**Files:**
- Modify: `packages/sidecar/src/process-controller.ts:19-28,272-298`
- Test: `packages/sidecar/src/__tests__/process-controller.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/sidecar/src/__tests__/process-controller.test.ts`, add a new test after the existing `spawn` tests:

```typescript
  it("spawn: 包含 workerId 时生成结构化任务信封", async () => {
    const writtenData: string[] = [];
    const fakeProc = {
      pid: 12345,
      stdin: {
        write: (data: string) => writtenData.push(data),
        end: vi.fn(),
      },
      stdout: makeNdjsonStream([JSON.stringify({ type: "system", session_id: "sess-abc" })]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    await controller.spawn({
      issueId: "42",
      worktreePath: "/tmp",
      initialPrompt: "请修复登录页面",
      workerId: "worker-abc",
      senderName: "张三",
      senderId: "ou_xxx",
    });

    const envelope = writtenData[0];
    expect(envelope).toContain("## 任务指令");
    expect(envelope).toContain("请修复登录页面");
    expect(envelope).toContain("## 任务元数据");
    expect(envelope).toContain("Worker ID: worker-abc");
    expect(envelope).toContain("Issue ID: 42");
    expect(envelope).toContain("张三 (ou_xxx)");
    expect(envelope).toContain("teamsland-report");
    expect(envelope).toContain("## 工作规范");
  });

  it("spawn: 不含 workerId 时回退到裸文本", async () => {
    const writtenData: string[] = [];
    const fakeProc = {
      pid: 12345,
      stdin: {
        write: (data: string) => writtenData.push(data),
        end: vi.fn(),
      },
      stdout: makeNdjsonStream([JSON.stringify({ type: "system", session_id: "sess-abc" })]),
      stderr: makeNdjsonStream([]),
    };
    vi.spyOn(Bun, "spawn").mockReturnValue(fakeProc as never);

    const controller = new ProcessController({ logger: fakeLogger });
    await controller.spawn({
      issueId: "42",
      worktreePath: "/tmp",
      initialPrompt: "hello",
    });

    const envelope = writtenData[0];
    // Without workerId, still wraps in envelope structure
    expect(envelope).toContain("## 任务指令");
    expect(envelope).toContain("hello");
    expect(envelope).toContain("## 工作规范");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: FAIL — `workerId` not recognized, or envelope content not matching.

- [ ] **Step 3: Extend SpawnParams and add buildEnvelope**

In `packages/sidecar/src/process-controller.ts`, extend the `SpawnParams` interface (after `env` at line 27):

```typescript
  /** Worker ID（可选，用于生成结构化任务信封） */
  workerId?: string;
  /** 发起人名称（可选） */
  senderName?: string;
  /** 发起人 ID（可选） */
  senderId?: string;
```

Add the `buildEnvelope` private method to the `ProcessController` class (before `spawnInternal`):

```typescript
  /** 将原始 prompt 包装为结构化任务信封 */
  private buildEnvelope(opts: {
    prompt: string;
    workerId?: string;
    issueId: string;
    senderName?: string;
    senderId?: string;
  }): string {
    const sections: string[] = [];

    sections.push("## 任务指令\n");
    sections.push(opts.prompt);

    if (opts.workerId || opts.issueId) {
      sections.push("\n\n## 任务元数据\n");
      if (opts.workerId) sections.push(`- Worker ID: ${opts.workerId}`);
      sections.push(`- Issue ID: ${opts.issueId}`);
      if (opts.senderName) sections.push(`- 发起人: ${opts.senderName} (${opts.senderId ?? "unknown"})`);
      sections.push("- 回报方式: 完成后使用 teamsland-report skill 回报结果");
      sections.push("- 超时: 此任务没有硬性超时，但请在合理时间内完成");
    }

    sections.push("\n\n## 工作规范\n");
    sections.push("1. 在 worktree 中工作，不要切换到其他目录");
    sections.push("2. 遇到阻塞性问题时，使用 teamsland-report 回报当前进展和阻塞原因，不要静默失败");
    sections.push("3. 完成后必须使用 teamsland-report 回报最终结果");

    return sections.join("\n");
  }
```

In `spawnInternal`, replace the raw prompt assignment:

Current (line 287-288):
```typescript
    const envelope = opts.prompt;
    proc.stdin.write(`${envelope}\n`);
```

Replace with:
```typescript
    const envelope = this.buildEnvelope({
      prompt: opts.prompt,
      workerId: opts.workerId,
      issueId: opts.issueId,
      senderName: opts.senderName,
      senderId: opts.senderId,
    });
    proc.stdin.write(`${envelope}\n`);
```

Also update the `spawnInternal` method signature to accept the new fields. The `opts` parameter type needs `workerId?`, `senderName?`, `senderId?`, `issueId`. Since `spawnInternal` is called by both `spawn()` and `spawnResume()`, update the internal opts interface:

```typescript
  private async spawnInternal(opts: {
    args: string[];
    cwd: string;
    prompt: string;
    debugPath: string;
    env?: Record<string, string>;
    issueId: string;
    workerId?: string;
    senderName?: string;
    senderId?: string;
  }): Promise<SpawnResult> {
```

Update the `spawn()` method call to `spawnInternal` to pass these fields:
```typescript
      const result = await this.spawnInternal({
        args: baseArgs,
        cwd: params.worktreePath,
        prompt: params.initialPrompt,
        debugPath: `/tmp/req-${params.issueId}.jsonl`,
        env: params.env,
        issueId: params.issueId,
        workerId: params.workerId,
        senderName: params.senderName,
        senderId: params.senderId,
      });
```

Update the `spawnResume()` method call to `spawnInternal` — pass empty issueId since resume doesn't have one:
```typescript
      const result = await this.spawnInternal({
        args,
        cwd: params.worktreePath,
        prompt: params.prompt,
        debugPath: `/tmp/resume-${params.sessionId}.jsonl`,
        env: params.env,
        issueId: "",
      });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: All tests PASS. Note: the existing test `writtenData[0]` will now be `"hello\n"` → will contain the envelope. Update the existing assertion:

The existing test at line 53 expects `writtenData[0]` to be `"hello\n"`. Now it will be an envelope. Update:
```typescript
    expect(writtenData[0]).toContain("hello");
    expect(writtenData[0]).toContain("## 任务指令");
```

- [ ] **Step 5: Thread new SpawnParams in worker-routes**

In `apps/server/src/worker-routes.ts`, update the `processController.spawn()` call to pass new fields:

```typescript
    const spawnResult = await deps.processController.spawn({
      issueId,
      worktreePath,
      initialPrompt: bodyResult.task,
      workerId: agentId,
      senderName: bodyResult.origin?.senderName,
      senderId: bodyResult.origin?.senderId,
      env: {
        WORKER_ID: agentId,
        MEEGO_API_BASE: deps.meegoApiBase ?? "",
        MEEGO_PLUGIN_TOKEN: deps.meegoPluginToken ?? "",
        TEAMSLAND_API_BASE: deps.teamslandApiBase ?? "http://localhost:3001",
        LARK_CHAT_ID: bodyResult.origin?.chatId ?? "",
        LARK_MESSAGE_ID: bodyResult.origin?.messageId ?? "",
        LARK_USER_ID: bodyResult.origin?.senderId ?? "",
      },
    });
```

- [ ] **Step 6: Run full test suite**

Run: `bun test packages/sidecar/src/__tests__/process-controller.test.ts`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/process-controller.ts packages/sidecar/src/__tests__/process-controller.test.ts apps/server/src/worker-routes.ts
git commit -m "feat(sidecar): structured stdin task envelope with metadata and work rules"
```

---

## Task 12: ClaudeMdInjector Context Block Restructure

**Files:**
- Modify: `packages/sidecar/src/claude-md-injector.ts:26-45,170-201`
- Test: `packages/sidecar/src/__tests__/claude-md-injector.test.ts`

- [ ] **Step 1: Write the failing test for new fields**

In `packages/sidecar/src/__tests__/claude-md-injector.test.ts`, update `makeContext` to include new fields, and add a test for the new format:

Update the `makeContext` function:
```typescript
function makeContext(overrides?: Partial<ClaudeMdContext>): ClaudeMdContext {
  return {
    workerId: "worker-01",
    taskType: "bugfix",
    requester: "张三",
    issueId: "BUG-1234",
    chatId: "oc_abc123",
    messageId: "om_def456",
    taskPrompt: "修复登录页面的 CSRF 漏洞",
    meegoApiBase: "https://meego.example.com",
    meegoPluginToken: "token_xxx",
    teamslandApiBase: "http://localhost:3001",
    worktreePath: "/tmp/worktree-test",
    ...overrides,
  };
}
```

Add new tests:
```typescript
  it("新格式: context block 使用表格格式", async () => {
    await injector.inject(tempDir, makeContext());
    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    // 元数据表格
    expect(content).toContain("| 任务类型 | bugfix |");
    expect(content).toContain("| 发起人 | 张三 |");
    expect(content).toContain("| 关联工单 | BUG-1234 |");
  });

  it("新格式: 不再包含任务指令段落", async () => {
    await injector.inject(tempDir, makeContext({ taskPrompt: "请审查代码" }));
    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    // taskPrompt 不应在 context block 中出现（已移至 stdin envelope）
    expect(content).not.toContain("### 任务指令");
    expect(content).not.toContain("请审查代码");
  });

  it("新格式: 包含完整环境变量表", async () => {
    await injector.inject(tempDir, makeContext());
    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).toContain("TEAMSLAND_API_BASE");
    expect(content).toContain("http://localhost:3001");
    expect(content).toContain("LARK_CHAT_ID");
    expect(content).toContain("LARK_USER_ID");
  });

  it("新格式: 包含增强版工作约定", async () => {
    await injector.inject(tempDir, makeContext());
    const content = await Bun.file(join(tempDir, "CLAUDE.md")).text();
    expect(content).toContain("你是 Teamsland 平台的 Worker 执行单元");
    expect(content).toContain("回报纪律");
    expect(content).toContain("工具约束");
    expect(content).toContain("异常处理");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/sidecar/src/__tests__/claude-md-injector.test.ts`
Expected: FAIL — `teamslandApiBase` and `worktreePath` not in ClaudeMdContext type, and content assertions fail.

- [ ] **Step 3: Update ClaudeMdContext interface**

In `packages/sidecar/src/claude-md-injector.ts`, add new fields to `ClaudeMdContext` (after `meegoPluginToken` at line 44):

```typescript
  /** teamsland 主服务 API 基础地址 */
  teamslandApiBase: string;
  /** Worker worktree 路径 */
  worktreePath: string;
```

- [ ] **Step 4: Rewrite buildBlock method**

Replace the `buildBlock` method (lines 173-201) with:

```typescript
  private buildBlock(ctx: ClaudeMdContext): string {
    const marker = ClaudeMdInjector.MARKER;
    return `${marker}

## teamsland 任务上下文

| 字段 | 值 |
|------|-----|
| 任务类型 | ${ctx.taskType} |
| 发起人 | ${ctx.requester} |
| 关联工单 | ${ctx.issueId} |
| Worktree | ${ctx.worktreePath} |

### 工作约定

**身份**：你是 Teamsland 平台的 Worker 执行单元，负责完成分配的任务并回报结果。

**回报纪律**：
- 任务完成 → 必须调用 teamsland-report 回报（status: success）
- 遇到阻塞 → 必须调用 teamsland-report 说明阻塞原因（status: blocked），不得静默退出
- 部分完成 → 回报已完成的部分和剩余待做的部分（status: partial）
- 如需回复群聊，使用 lark-reply skill
- 如关联了 Meego 工单，完成后通过 meego-update skill 更新状态

**工具约束**：
- 禁止调用 delegate、spawn_agent、memory_write
- 优先使用 skill 提供的 CLI 工具（teamsland、lark-cli）

**异常处理**：
- 权限不足 → 回报 blocked，说明需要的权限
- 文件/路径不存在 → 回报 blocked，说明缺失的资源
- 网络错误 → 重试一次，仍失败则回报 blocked
- 不要自行 spawn 子进程或委派任务

### 环境变量

| 变量 | 值 |
|------|-----|
| WORKER_ID | ${ctx.workerId} |
| TEAMSLAND_API_BASE | ${ctx.teamslandApiBase} |
| MEEGO_API_BASE | ${ctx.meegoApiBase} |
| MEEGO_PLUGIN_TOKEN | ${ctx.meegoPluginToken} |
| LARK_CHAT_ID | ${ctx.chatId} |
| LARK_MESSAGE_ID | ${ctx.messageId} |
| LARK_USER_ID | ${ctx.requester} |
`;
  }
```

- [ ] **Step 5: Update inject call sites to pass new fields**

In `apps/server/src/worker-routes.ts`, update the `claudeMdInjector.inject()` call (around line 173-185) to pass the new fields:

```typescript
    await deps.claudeMdInjector.inject(worktreePath, {
      workerId: agentId,
      taskType,
      requester: body.origin?.senderName ?? body.origin?.senderId ?? "unknown",
      issueId,
      chatId: body.origin?.chatId ?? "",
      messageId: body.origin?.messageId ?? "",
      taskPrompt: body.task,
      meegoApiBase: deps.meegoApiBase ?? "",
      meegoPluginToken: deps.meegoPluginToken ?? "",
      teamslandApiBase: deps.teamslandApiBase ?? "http://localhost:3001",
      worktreePath,
    });
```

- [ ] **Step 6: Run tests**

Run: `bun test packages/sidecar/src/__tests__/claude-md-injector.test.ts`
Expected: All tests PASS.

Note: Some existing tests check for specific content strings that have changed. Update these:
- The test `"所有上下文字段均出现在注入块中"` — update to match new table format instead of old `**Worker ID**: ...` format. The key assertions about field values being present should still pass since the values are in the table.
- The test `"inject() 替换已有注入块（幂等操作）"` — checks for worker IDs, should still work since the table contains worker IDs.

If existing tests fail on format changes, update their assertions to match the new table format.

- [ ] **Step 7: Run full typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/src/claude-md-injector.ts packages/sidecar/src/__tests__/claude-md-injector.test.ts apps/server/src/worker-routes.ts
git commit -m "feat(sidecar): restructure ClaudeMdInjector with table format, enhanced work rules, full env vars"
```

---

## Task 13: Coordinator Spawn Prompt Guidelines

**Files:**
- Modify: `apps/server/src/coordinator-init.ts` (inside `generateClaudeMd` function)

- [ ] **Step 1: Add spawn prompt guidelines to generateClaudeMd**

In `apps/server/src/coordinator-init.ts`, inside the `generateClaudeMd` function, append the following section before the closing backtick of the template literal (before line 308's `` `; ``):

```typescript

## Spawn Worker 提示词规范

Spawn Worker 时，task prompt 必须包含以下结构：

1. **任务目标**（必填）— 明确说明需要完成什么
2. **验收标准**（必填）— 怎样算完成，预期产出是什么
3. **已知上下文**（如有）— 相关 issue 信息、之前的讨论、已知约束
4. **产出物要求**（如有）— 输出文件路径、格式要求

示例：

请在 novel-admin-monorepo 中 explore 项目结构，建立 repository profile。

验收标准：
- 生成 REPO_PROFILE.md，包含目录结构、技术栈、构建系统、核心模块说明
- 文件放在仓库根目录

已知上下文：
- 这是一个 monorepo，使用 pnpm workspace
- 主要技术栈是 React + TypeScript

注意：不要在 prompt 中重复 Worker 已通过 CLAUDE.md 获得的信息（如 Worker ID、回报方式等）。
```

- [ ] **Step 2: Verify the change compiles**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/coordinator-init.ts
git commit -m "feat(coordinator): add spawn prompt guidelines to coordinator CLAUDE.md"
```

---

## Task 14: Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun run test:run`
Expected: All tests pass. If any tests fail due to the changes, fix them.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 4: Verify config.json is valid after all changes**

Run: `cat config/config.json | python3 -m json.tool > /dev/null && echo "valid"`
Expected: "valid"

- [ ] **Step 5: Final commit (if any fixes needed)**

If any fixes were made during verification:
```bash
git add -A
git commit -m "fix: address integration issues from reliability improvements"
```
