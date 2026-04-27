# Teamsland 可靠性改进设计

> 日期：2026-04-27
> 范围：启动脚本、Skills 系统、Worker 提示词链路

## 背景

Teamsland 的"大脑（Coordinator）+ 手脚（Worker）"架构已可运行，但在实际运行中暴露了多个可靠性问题：

1. **Worker 被中途截断但无人知晓** — DataPlane 的 `result` 事件处理器没有任何日志，`stop_reason=tool_use`（表示任务未完成）被静默标记为 completed。（已修复，见 commit `e6af61d`）
2. **启动流程脆弱** — 无 `uncaughtException` / `unhandledRejection` 处理，overmind 无重启策略，config 关键字段缺少校验。
3. **Skills 注入断裂** — `skillRouting` 中 12 个条目中有 9 个指向不存在的 skill 文件；`teamsland-report`（唯一的回报机制）不保证被注入；环境变量 `TEAMSLAND_API_BASE` 从未被设为真正的 env var。
4. **Worker 提示词缺失元数据** — ProcessController 向 stdin 写入裸文本 prompt，Worker 不知道自己的 ID、回报渠道、任务来源。
5. **Coordinator workspace 模板永不更新** — `writeFileIfNotExists` 导致代码更新后 skill 和 system prompt 仍停留在初始版本。

本设计覆盖三个领域的改进，目标是**同时提升稳定性和能力**。

---

## Section 1: 启动脚本改进

### 1.1 uncaughtException / unhandledRejection 守护

**文件**：`apps/server/src/main.ts`

在 Phase 0（配置 + 日志）之后、Phase 1 之前注册全局异常处理器：

```typescript
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "未捕获异常，进程即将退出");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "未处理 Promise 拒绝，进程即将退出");
  process.exit(1);
});
```

行为：记录 fatal 日志后 `process.exit(1)`。不尝试恢复 — 让 overmind 重启。

### 1.2 Overmind 重启策略

**文件**：`Procfile.dev`

为 `server` 服务添加 overmind 重启配置。在 `Procfile.dev` 中使用 wrapper 脚本：

```
server: while true; do bun run --filter @teamsland/server dev 2>&1; echo "[overmind] server exited with $?, restarting in 3s..."; sleep 3; done
```

限制：连续崩溃 5 次（15 秒内）时停止重启，避免 crashloop。实现方式：在 wrapper 脚本中维护计数器和时间窗口。

### 1.3 配置校验

**文件**：`packages/config/src/` 下新增 `validate.ts`

在 `initConfigAndLogging()` 阶段增加配置校验层：

- 校验必填字段存在且类型正确：
  - `lark.appId`、`lark.appSecret` — 非空字符串
  - `meego.apiBaseUrl` — 非空字符串
  - `dashboard.port` — 正整数
  - `coordinator.enabled` — boolean
  - `queue.dbPath` — 非空字符串
- 校验环境变量占位符已被解析（不含 `${...}` 残留）
- 校验 `repoMapping` 中每个 `repos[].path` 指向的目录存在（warn 级别，不阻断启动）
- 校验失败时：必填字段缺失 → `logger.fatal` + `process.exit(1)`；推荐字段缺失 → `logger.warn`

### 1.4 Config 关键字段提升

**文件**：`config/config.json`

将以下运行时隐藏的默认值提升为显式配置项：

| 字段 | 默认值 | 位置 |
|------|--------|------|
| `coordinator.maxEventsPerSession` | 20 | `initCoordinator` 硬编码 |
| `coordinator.resultTimeoutMs` | 300000 | `initCoordinator` 硬编码 |
| `sidecar.teamslandApiBase` | 无（缺失） | 新增 |

新增 `sidecar.teamslandApiBase` 字段，值为 `http://localhost:${dashboard.port}`，供 Worker 环境变量注入使用。

### 1.5 启动阶段结构化日志

**文件**：`apps/server/src/main.ts`

为每个 Phase 添加耗时计量和摘要日志：

```typescript
const t0 = performance.now();
const storage = await initStorage(config, logger);
logger.info({ phase: "storage", durationMs: performance.now() - t0 }, "Phase 1 完成");
```

在所有 Phase 完成后输出启动摘要：

```typescript
logger.info({
  phases: phaseTimings,
  coordinatorEnabled: !!coordinator.coordinator,
  workerManagerEnabled: !!coordinator.workerManager,
  hooksEnabled: !!hooks.engine,
  totalDurationMs: performance.now() - startTime,
}, "系统启动完成");
```

---

## Section 2: Skills 改进

### 2.1 环境变量注入补全

**文件**：`apps/server/src/worker-routes.ts` (`handleCreateWorker` → `processController.spawn` 的 `env` 参数)

**现状**：ProcessController.spawn 的 `env` 字段已传入 `WORKER_ID`、`MEEGO_API_BASE`、`MEEGO_PLUGIN_TOKEN`，但缺少 `TEAMSLAND_API_BASE`、`LARK_CHAT_ID`、`LARK_MESSAGE_ID`、`LARK_USER_ID`。

**改进**：在 `handleCreateWorker` 中扩展传入 `spawn()` 的 `env` 对象：

```typescript
env: {
  WORKER_ID: agentId,
  MEEGO_API_BASE: deps.meegoApiBase ?? "",
  MEEGO_PLUGIN_TOKEN: deps.meegoPluginToken ?? "",
  // 新增：
  TEAMSLAND_API_BASE: deps.teamslandApiBase ?? `http://localhost:3001`,
  LARK_CHAT_ID: body.origin?.chatId ?? "",
  LARK_MESSAGE_ID: body.origin?.messageId ?? "",
  LARK_USER_ID: body.origin?.senderId ?? "",
},
```

`WorkerRouteDeps` 接口新增 `teamslandApiBase?: string` 字段，从 `config.sidecar.teamslandApiBase`（Section 1.4 新增）中传入。

### 2.2 清理 skillRouting 幽灵条目

**文件**：`config/config.json`

当前 `skillRouting`：

```json
{
  "frontend_dev":  ["figma-reader", "lark-docs", "git-tools", "architect-template"],
  "tech_spec":     ["lark-docs", "git-tools", "architect-template"],
  "design":        ["figma-reader", "lark-docs", "architect-template"],
  "code_review":   ["git-diff", "lark-comment"],
  "bot_query":     ["lark-docs", "lark-base"],
  "confirm":       ["lark-docs"],
  "status_sync":   ["lark-docs", "lark-base"],
  "query":         ["lark-docs", "lark-base"],
  "coding":        ["lark-reply", "meego-update", "teamsland-report"],
  "research":      ["lark-reply", "teamsland-report"],
  "review":        ["lark-reply", "meego-update", "teamsland-report"],
  "observer":      ["teamsland-report"]
}
```

实际存在的 worker skill 文件：`lark-reply`、`meego-update`、`teamsland-report`（位于 `config/worker-skills/`）。

**改进后**：

```json
{
  "coding":   ["lark-reply", "meego-update", "teamsland-report"],
  "research": ["lark-reply", "teamsland-report"],
  "review":   ["lark-reply", "meego-update", "teamsland-report"],
  "observer": ["teamsland-report"]
}
```

删除所有引用不存在 skill 的条目。保留 4 个有效路由。

**同时**，修改 `SkillInjector.inject()`：当 `skillMap` 中找不到某个 skill 名称时，将现有的 `warn` 日志保留（已有），不做额外改动。

### 2.3 Coordinator skill 版本化更新

**文件**：`apps/server/src/coordinator-init.ts`

**现状**：`writeFileIfNotExists` — 文件存在则跳过。代码更新后 Coordinator workspace 的 CLAUDE.md、SKILL.md 等永不更新。

**改进**：

1. 在每个生成文件的开头嵌入 content hash：
   ```
   <!-- teamsland-content-hash: a1b2c3d4 -->
   ```
   hash = SHA-256(content).substring(0, 8)

2. 将 `writeFileIfNotExists` 替换为 `writeFileIfChanged`：
   ```typescript
   async function writeFileIfChanged(filePath: string, content: string): Promise<void> {
     const HASH_PREFIX = "<!-- teamsland-content-hash: ";
     const hash = new Bun.CryptoHasher("sha256")
       .update(content)
       .digest("hex")
       .slice(0, 8);
     const taggedContent = `${HASH_PREFIX}${hash} -->\n${content}`;

     if (existsSync(filePath)) {
       const existing = await Bun.file(filePath).text();
       const match = existing.match(/<!-- teamsland-content-hash: (\w+) -->/);
       if (match && match[1] === hash) {
         logger.debug({ file: filePath }, "文件内容未变更，跳过");
         return;
       }
       // 备份旧文件
       const backupDir = join(dirname(filePath), ".backup");
       mkdirSync(backupDir, { recursive: true });
       const ts = new Date().toISOString().replace(/[:.]/g, "-");
       await Bun.write(join(backupDir, `${basename(filePath)}.${ts}`), existing);
       logger.info({ file: filePath }, "旧文件已备份");
     }

     await Bun.write(filePath, taggedContent);
     logger.info({ file: filePath, hash }, "文件已写入（版本化）");
   }
   ```

3. JSON 文件（`evolution-config.json`、card templates）继续使用 `writeFileIfNotExists`，因为这些文件可能被用户修改。仅对 `.md` 类模板文件使用 `writeFileIfChanged`。

### 2.4 修复 ticket-lifecycle 的 allowed-tools

**文件**：`apps/server/src/coordinator-init-workflows.ts`（`generateTicketLifecycleSkill()` 函数）

**现状**：`allowed-tools` 写在了 frontmatter `---` 之外。

**改进**：将 `allowed-tools` 移入 frontmatter：

```yaml
---
name: ticket-lifecycle
description: ...
allowed-tools:
  - Bash(teamsland *)
  - Bash(lark-cli *)
  - Bash(curl *)
  - Read
---
```

### 2.5 核心 skill 兜底注入

**文件**：`packages/sidecar/src/skill-injector.ts`

**现状**：`inject()` 仅注入 `routing[taskType]` 和 `extraSkills` 的并集。如果 taskType 不在路由表中且没传 extraSkills，Worker 不会获得任何 skill。

**改进**：

1. 在 `SkillInjectorOpts` 接口新增可选字段：
   ```typescript
   coreSkills?: string[];
   ```

2. 在 `inject()` 末尾追加兜底逻辑：
   ```typescript
   // 兜底：确保 core skills 始终被注入
   const coreSkills = this.coreSkills ?? [];
   for (const name of coreSkills) {
     if (injected.includes(name)) continue; // 已注入，跳过
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

3. 初始化时传入：
   ```typescript
   coreSkills: ["teamsland-report"]
   ```

---

## Section 3: Worker 提示词改进

### 3.1 结构化任务信封

**文件**：`packages/sidecar/src/process-controller.ts`（`spawnInternal` 方法）

**现状**：`opts.prompt` 裸文本直接写入 stdin。Worker 收到的只是用户原始指令，没有元数据。

**改进**：在 `ProcessController` 中新增 `buildEnvelope` 方法，由 `spawn()` 调用方（`worker-routes.ts`）传入结构化参数：

1. 扩展 `SpawnParams` 接口：
   ```typescript
   export interface SpawnParams {
     issueId: string;
     worktreePath: string;
     initialPrompt: string;
     env?: Record<string, string>;
     // 新增（均为可选，向后兼容）：
     workerId?: string;
     senderName?: string;
     senderId?: string;
   }
   ```

2. 在 `spawnInternal` 中，将 `opts.prompt` 包装为结构化信封：
   ```typescript
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

3. `worker-routes.ts` 的 `handleCreateWorker` 中传入新字段：
   ```typescript
   const spawnResult = await deps.processController.spawn({
     issueId,
     worktreePath,
     initialPrompt: bodyResult.task,
     workerId: agentId,
     senderName: bodyResult.origin?.senderName,
     senderId: bodyResult.origin?.senderId,
     env: { ... },
   });
   ```

### 3.2 Worker System Prompt 增强

**文件**：`apps/server/src/coordinator-init.ts`（目前不生成 `worker-system.md`）
**实际生效文件**：Worker 的 CLAUDE.md（通过 ClaudeMdInjector 注入的"工作约定"段落）

**现状**：ClaudeMdInjector 的"工作约定"段落只有 5 行规则，缺少身份定义和异常处理指导。

**改进**：扩充 `buildBlock()` 中的"工作约定"段落：

```markdown
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
```

移除旧版 5 行规则，替换为上述完整版本。

### 3.3 Coordinator 下发提示词规范化

**文件**：`apps/server/src/coordinator-init.ts`（`generateClaudeMd` 函数，Coordinator 的 CLAUDE.md）

**现状**：Coordinator 的 CLAUDE.md 中"工作规范"段落指导 Coordinator spawn worker，但没有具体的 prompt 模板。

**改进**：在 Coordinator CLAUDE.md 的"工作规范"段落后追加：

```markdown
## Spawn Worker 提示词规范

Spawn Worker 时，task prompt 必须包含以下结构：

1. **任务目标**（必填）— 明确说明需要完成什么
2. **验收标准**（必填）— 怎样算完成，预期产出是什么
3. **已知上下文**（如有）— 相关 issue 信息、之前的讨论、已知约束
4. **产出物要求**（如有）— 输出文件路径、格式要求

示例：
```
请在 novel-admin-monorepo 中 explore 项目结构，建立 repository profile。

验收标准：
- 生成 REPO_PROFILE.md，包含目录结构、技术栈、构建系统、核心模块说明
- 文件放在仓库根目录

已知上下文：
- 这是一个 monorepo，使用 pnpm workspace
- 主要技术栈是 React + TypeScript
```

注意：不要在 prompt 中重复 Worker 已通过 CLAUDE.md 获得的信息（如 Worker ID、回报方式等）。
```

### 3.4 ClaudeMdInjector context block 精简

**文件**：`packages/sidecar/src/claude-md-injector.ts`（`buildBlock` 方法）

**现状**：context block 是散文式段落，与 3.1 的 stdin 任务信封有重叠（Worker ID、Issue ID、task prompt 出现两次）。

**改进后的 `buildBlock()` 输出**：

```markdown
<!-- teamsland-task-context: DO NOT EDIT BELOW -->

## teamsland 任务上下文

| 字段 | 值 |
|------|-----|
| 任务类型 | {taskType} |
| 发起人 | {requester} |
| 关联工单 | {issueId} |
| Worktree | {worktreePath} |

### 工作约定

（Section 3.2 中定义的完整版工作约定）

### 环境变量

| 变量 | 值 |
|------|-----|
| WORKER_ID | {workerId} |
| TEAMSLAND_API_BASE | {teamslandApiBase} |
| MEEGO_API_BASE | {meegoApiBase} |
| MEEGO_PLUGIN_TOKEN | {meegoPluginToken} |
| LARK_CHAT_ID | {chatId} |
| LARK_MESSAGE_ID | {messageId} |
| LARK_USER_ID | {senderId} |
```

变更要点：
- 移除"任务指令"段落（已在 stdin 信封中传递）
- 元数据改为 key-value 表格格式
- 新增完整版工作约定（替换旧版 5 行规则）
- 环境变量表格补全 `TEAMSLAND_API_BASE`、`LARK_CHAT_ID`、`LARK_MESSAGE_ID`、`LARK_USER_ID`
- 移除 Worker ID 和 Issue ID 的单独显示（已在 stdin 信封和环境变量表中）

`ClaudeMdContext` 接口相应新增 `teamslandApiBase` 和 `worktreePath` 字段。

---

## 文件影响清单

| 文件 | 改动类型 | Section |
|------|----------|---------|
| `apps/server/src/main.ts` | 修改 | 1.1, 1.5 |
| `Procfile.dev` | 修改 | 1.2 |
| `packages/config/src/validate.ts` | 新增 | 1.3 |
| `config/config.json` | 修改 | 1.4, 2.2 |
| `apps/server/src/coordinator-init.ts` | 修改 | 2.3, 3.3 |
| `apps/server/src/coordinator-init-workflows.ts` | 修改 | 2.4 |
| `packages/sidecar/src/skill-injector.ts` | 修改 | 2.5 |
| `apps/server/src/worker-routes.ts` | 修改 | 2.1, 3.1 |
| `packages/sidecar/src/process-controller.ts` | 修改 | 3.1 |
| `packages/sidecar/src/claude-md-injector.ts` | 修改 | 3.2, 3.4 |
| `apps/server/src/init/sidecar.ts` | 修改 | 2.5 (传入 coreSkills) |
| `apps/server/src/init/coordinator.ts` | 修改 | 1.4 (传入新 config 字段) |

---

## Acceptance Scenarios

### Scenario 1: Worker 完成任务并回报结果，用户收到通知

```
Given coordinator 处于 idle 状态，skillRouting 已清理，teamsland-report 为 core skill
When 用户通过 Lark 发送任务消息
  And coordinator 收到 lark_dm 事件，spawn worker 并传入结构化 prompt
  And ProcessController.spawn 注入完整 env（含 TEAMSLAND_API_BASE、LARK_CHAT_ID 等）
  And SkillInjector 注入 routing skills + core skill（teamsland-report）
  And ClaudeMdInjector 注入精简版 context block（含完整工作约定）
  And Worker 通过 stdin 收到结构化任务信封（含任务元数据和工作规范）
  And Worker 完成任务，调用 teamsland-report 回报 success
  And worker_completed 事件到达 coordinator
Then 用户收到 Lark 消息，包含任务结果摘要
  And DataPlane 记录 result 事件（含 stopReason、numTurns、costUsd）
```

### Scenario 2: Worker 遇到阻塞，回报 blocked 状态

```
Given worker 正在执行任务，已通过 stdin 信封得知回报方式
When worker 遇到权限不足或资源缺失
  And worker 根据工作约定中的异常处理流程调用 teamsland-report（status: blocked）
  And worker 在 summary 中说明阻塞原因
Then coordinator 收到 blocked 状态
  And 用户收到 Lark 通知，说明阻塞原因
```

### Scenario 3: 未知 taskType 的 Worker 仍能获得 teamsland-report

```
Given coordinator spawn worker 时指定 taskType = "unknown_type"
When SkillInjector.inject 查找 routing["unknown_type"]，返回空数组
  And SkillInjector 执行 core skill 兜底逻辑
Then worker 的 .claude/skills/teamsland-report/ 目录存在
  And worker 能够调用 teamsland-report 回报结果
```

### Scenario 4: 代码更新后 Coordinator skill 自动更新

```
Given coordinator workspace 已存在旧版 CLAUDE.md（hash: abc12345）
When server 重启，coordinator-init 生成新版 CLAUDE.md（hash: def67890）
  And writeFileIfChanged 检测到 hash 不匹配
Then 旧文件备份到 .backup/ 目录（带时间戳）
  And 新版 CLAUDE.md 写入 workspace
  And 日志记录文件更新
```

### Scenario 5: 代码未更新时 Coordinator skill 不被覆盖

```
Given coordinator workspace 已存在当前版本 CLAUDE.md（hash: abc12345）
When server 重启，coordinator-init 生成的 CLAUDE.md hash 仍为 abc12345
Then writeFileIfChanged 跳过写入
  And 无备份文件生成
  And 日志记录"文件内容未变更，跳过"
```

### Scenario 6: 服务崩溃后 overmind 自动重启

```
Given server 进程因 unhandledRejection 退出（exit code 1）
When overmind 的 restart wrapper 检测到进程退出
  And 3 秒后重新启动 server
Then server 正常完成所有 Phase 初始化
  And 启动摘要日志包含各 Phase 耗时
```

### Scenario 7: 服务 crashloop 时停止重启

```
Given server 在 15 秒内连续崩溃 5 次
When restart wrapper 检测到崩溃频率超限
Then wrapper 停止重启并输出错误信息
  And overmind 中 server 服务标记为 stopped
```

### Scenario 8: 配置校验阻断启动

```
Given config.json 中 lark.appId 的环境变量占位符 ${LARK_APP_ID} 未被解析（.env 缺失该项）
When initConfigAndLogging 调用配置校验
  And 校验器检测到 lark.appId 值仍为 "${LARK_APP_ID}"
Then logger.fatal 记录具体的缺失字段
  And 进程以 exit code 1 退出
  And 用户看到明确的错误信息，知道需要设置哪个环境变量
```

### Scenario 9: Worker 的 env 中包含完整的 Lark 上下文

```
Given 用户在群聊 oc_xxx 中发送消息 om_yyy，触发 worker spawn
When handleCreateWorker 调用 processController.spawn
Then Worker 进程的环境变量包含：
  - WORKER_ID = worker-xxxxxxxx
  - TEAMSLAND_API_BASE = http://localhost:3001
  - LARK_CHAT_ID = oc_xxx
  - LARK_MESSAGE_ID = om_yyy
  - LARK_USER_ID = ou_zzz
  And Worker 的 lark-reply skill 可直接使用 $LARK_CHAT_ID 回复消息
```

### Scenario 10: ticket-lifecycle skill 的 allowed-tools 生效

```
Given coordinator-init 生成的 ticket-lifecycle SKILL.md 中 allowed-tools 位于 frontmatter 内
When coordinator 加载 ticket-lifecycle skill
Then Claude Code 正确解析 allowed-tools
  And coordinator 可使用 Bash(teamsland *)、Bash(lark-cli *)、Bash(curl *)、Read 工具
```
