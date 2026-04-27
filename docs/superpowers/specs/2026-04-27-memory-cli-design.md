# teamsland memory CLI 设计

将 OpenViking 的记忆写入/检索/更新/删除等能力封装为 `teamsland memory` 子命令，让 coordinator 能主动管理长期记忆。

## 背景

当前 coordinator 只能**被动消费**记忆：`LiveContextLoader` 在每个事件到达时从 OpenViking 检索相关记忆注入 prompt。唯一的记忆写入路径是 server 端的 `writebackToViking()`，在 worker 完成任务时自动触发。

coordinator 无法主动记住用户偏好、团队经验、项目事实等信息。本设计通过 `teamsland memory` CLI 子命令打通写入通道，让 coordinator 在对话中主动沉淀有价值的记忆到 OpenViking。

## 设计决策

### 方案选择：扁平子命令（方案 A）

每个 Viking 操作对应一个 `teamsland memory <op>` 子命令，与现有 `teamsland ticket <sub>` 模式一致。

否决的方案：
- **分组嵌套**（`teamsland memory fs write`）：三级嵌套与现有 CLI 风格不符，coordinator 调用更繁琐
- **JSON stdin**（`echo '{"op":"write",...}' | teamsland memory`）：LLM 拼接 JSON pipeline 容易出错

### 请求路由：CLI → teamsland server → Viking

CLI 通过 teamsland server 的 `/api/viking/*` 代理路由转发请求到 OpenViking，复用现有基础设施和认证体系。

### 使用者：coordinator 先行，预留 worker 扩展

当前仅 coordinator 使用（已有 `Bash(teamsland *)` 权限）。worker 继续通过 server 端 `writebackToViking()` 被动写入。后续如需开放给 worker，只需调整 `SidecarDataPlane` 的拦截策略。

### 会话管理不暴露

会话管理（createSession / addMessage / commitSession）不通过 CLI 暴露。已有 dashboard 页面供用户手动选择有价值的会话进行提炼。

## 记忆分层模型

coordinator 有两套记忆系统，各有分工：

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

### 判断标准

| 问自己 | → Claude Code 内置 | → OpenViking |
|--------|-------------------|-------------|
| 几乎每次对话都需要？ | 是 | 否 |
| 是身份/约束/大方向？ | 是 | 否 |
| 是具体事件/案例/事实？ | 否 | 是 |
| 内容会随时间积累变多？ | 否（应精简） | 是（正常积累） |
| 需要语义检索才能找到？ | 否（全量加载） | 是 |

灰色地带：如果一条信息现在高频使用但未来会降频（如"当前正在迁移数据库到 PostgreSQL"），先放 OpenViking，等确认长期有效后再考虑是否提升到 Claude Code 内置记忆。

## 子命令清单

### 文件系统操作

| 命令 | 用途 |
|------|------|
| `memory write <uri> --content <text> [--mode create\|replace\|append] [--wait]` | 写入/创建文件（默认 mode: replace） |
| `memory read <uri>` | 读取完整内容 |
| `memory ls <uri> [--recursive] [--simple]` | 列出目录 |
| `memory mkdir <uri> [--description <text>]` | 创建目录 |
| `memory rm <uri> [--recursive]` | 删除文件/目录 |
| `memory mv <from-uri> <to-uri>` | 移动/重命名 |
| `memory abstract <uri>` | 读取 L0 摘要 |
| `memory overview <uri>` | 读取 L1 概览 |

### 检索操作

| 命令 | 用途 |
|------|------|
| `memory find <query> [--uri <target>] [--limit N] [--since <time>] [--until <time>]` | 语义搜索 |
| `memory grep <uri> <pattern> [--ignore-case]` | 正则搜索 |
| `memory glob <pattern> [--uri <target>]` | Glob 匹配 |

### scope 快捷方式

对于 `find`、`write`、`ls` 等常用操作，支持 `--scope` 快捷参数代替完整 URI：

| `--scope` | 展开为 |
|-----------|--------|
| `agent` | `viking://agent/teamsland/memories/` |
| `user` (需配合 `--user <id>`) | `viking://user/<id>/memories/` |
| `tasks` | `viking://resources/tasks/` |
| `resources` | `viking://resources/` |

当同时传入 `--scope` 和显式 URI 时，显式 URI 优先。`--scope user` 必须配合 `--user`，缺失时返回错误。

### content 传入方式

`memory write` 的 `--content` 参数支持两种方式：
1. `--content "inline text"` — 直接传入
2. `--content-file <path>` — 从本地文件读取内容

coordinator 写入短记忆通常用 `--content`，批量导入可以用 `--content-file`。

## 代码结构与变更范围

### 新增文件

| 文件 | 作用 |
|------|------|
| `packages/cli/src/commands/memory.ts` | `teamsland memory` 子命令入口 + arg 解析 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/cli/src/index.ts` | switch 中增加 `case "memory"` 分发到 `runMemory` |
| `packages/cli/src/http-client.ts` | `TeamslandClient` 增加 Viking 代理方法 |
| `apps/server/src/viking-routes.ts` | 补全缺失的代理路由 |
| `apps/server/src/coordinator-init.ts` | 注入 `memory-management` skill |
| `apps/server/src/coordinator-context.ts` | 从 `buildFetches()` 中移除 `agentMemFetch` |

## Server 代理路由

### 现有路由（无需变更）

| 方法 | 路径 | Viking 操作 |
|------|------|------------|
| `POST` | `/api/viking/find` | `find()` |
| `POST` | `/api/viking/resource` | `addResource()` |
| `GET` | `/api/viking/read` | `read()` |
| `GET` | `/api/viking/ls` | `ls()` |
| `POST` | `/api/viking/write` | `write()` |
| `DELETE` | `/api/viking/fs` | `rm()` |

### 需要新增的路由

| 方法 | 路径 | Viking 操作 | 参数 |
|------|------|------------|------|
| `POST` | `/api/viking/mkdir` | `mkdir(uri, description?)` | body: `{ uri, description? }` |
| `POST` | `/api/viking/mv` | `mv(fromUri, toUri)` | body: `{ fromUri, toUri }` |
| `GET` | `/api/viking/abstract` | `abstract(uri)` | query: `?uri=...` |
| `GET` | `/api/viking/overview` | `overview(uri)` | query: `?uri=...` |
| `POST` | `/api/viking/grep` | `grep(uri, pattern, ...)` | body: `{ uri, pattern, caseInsensitive? }` |
| `POST` | `/api/viking/glob` | `glob(pattern, uri?)` | body: `{ pattern, uri? }` |

### 现有路由调整

`handleWrite` 补充 `append` mode 支持：

```typescript
// 当前
const mode = body.mode === "replace" || body.mode === "create" ? body.mode : undefined;
// 改为
const mode = body.mode === "replace" || body.mode === "create" || body.mode === "append" ? body.mode : undefined;
```

`IVikingMemoryClient` 的 `WriteOptions.mode` 类型如果缺少 `append`，需在 `packages/memory/src/viking-memory-client.ts` 中补上。

## CLI 命令实现（memory.ts）

### arg 解析结构

与 `ticket.ts` 同构，`parseMemoryArgs` 根据 `args[0]` 分发：

```typescript
type ParsedMemoryArgs =
  // 文件系统
  | { op: "write"; uri: string; content: string; mode?: string; wait?: boolean }
  | { op: "read"; uri: string }
  | { op: "ls"; uri: string; recursive?: boolean; simple?: boolean }
  | { op: "mkdir"; uri: string; description?: string }
  | { op: "rm"; uri: string; recursive?: boolean }
  | { op: "mv"; fromUri: string; toUri: string }
  | { op: "abstract"; uri: string }
  | { op: "overview"; uri: string }
  // 检索
  | { op: "find"; query: string; uri?: string; limit?: number; since?: string; until?: string }
  | { op: "grep"; uri: string; pattern: string; ignoreCase?: boolean }
  | { op: "glob"; pattern: string; uri?: string }
  // 错误
  | { error: string };
```

### scope 展开

`resolveScope(args)` 函数扫描 `--scope <name>` 和可选的 `--user <id>`，返回展开后的 URI。映射表：

| scope | URI |
|-------|-----|
| `agent` | `viking://agent/teamsland/memories/` |
| `user` | `viking://user/<--user value>/memories/` |
| `tasks` | `viking://resources/tasks/` |
| `resources` | `viking://resources/` |

### 输出格式

- 无 `--json`：人类可读格式（find 结果逐行打印摘要和分数，ls 打印目录树）
- 有 `--json`：原样输出 server 返回的 JSON

## http-client 扩展

在 `TeamslandClient` 中增加以下方法：

```typescript
// 文件系统
async vikingWrite(uri: string, content: string, opts?: { mode?: string; wait?: boolean }): Promise<unknown>
async vikingRead(uri: string): Promise<{ status: string; result: string }>
async vikingLs(uri: string, opts?: { recursive?: boolean; simple?: boolean }): Promise<{ status: string; result: unknown[] }>
async vikingMkdir(uri: string, description?: string): Promise<unknown>
async vikingRm(uri: string, recursive?: boolean): Promise<unknown>
async vikingMv(fromUri: string, toUri: string): Promise<unknown>
async vikingAbstract(uri: string): Promise<{ status: string; result: string }>
async vikingOverview(uri: string): Promise<{ status: string; result: string }>

// 检索
async vikingFind(query: string, opts?: { targetUri?: string; limit?: number; since?: string; until?: string }): Promise<unknown>
async vikingGrep(uri: string, pattern: string, opts?: { caseInsensitive?: boolean }): Promise<unknown>
async vikingGlob(pattern: string, uri?: string): Promise<unknown>
```

GET 请求在方法内直接拼接 query string 传入 path（如 `/api/viking/read?uri=${encodeURIComponent(uri)}`），与现有代码风格一致，最小改动。

## Coordinator memory-management Skill

注入位置：`coordinator-init.ts` 的 skill 生成区域，写入 coordinator workspace 的 `.claude/skills/memory-management/SKILL.md`。

### Skill 完整内容

```markdown
---
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

Agent 记忆**不会自动注入你的上下文**。当你认为历史经验可能对当前任务有帮助时，主动使用 `teamsland memory find` 检索。典型场景：
- 处理一个类似之前解决过的问题
- 用户提到了某个你可能记录过的项目或技术细节
- 需要回忆某个团队约定或流程

## URI 命名空间

| 类型 | URI 前缀 | 何时使用 |
|------|---------|---------|
| Agent 记忆 | `viking://agent/teamsland/memories/` | 团队级知识、工作模式、技术决策 |
| 用户记忆 | `viking://user/<userId>/memories/` | 特定用户的偏好和背景 |
| 资源 | `viking://resources/` | 文档、任务记录等结构化资源 |

## 常用操作

### 记住新知识
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "## 热修复部署流程\n\n1. 从 main 拉分支 ..." \
  --mode create

### 检索相关记忆
teamsland memory find "部署流程" --scope agent --limit 5

### 更新已有记忆
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "更新后的内容..." --mode replace

### 浏览记忆结构
teamsland memory ls viking://agent/teamsland/memories/ --recursive

### 删除过时记忆
teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md

### 查看摘要
teamsland memory abstract viking://agent/teamsland/memories/cases/

## scope 快捷方式

--scope agent  → viking://agent/teamsland/memories/
--scope user --user <id>  → viking://user/<id>/memories/
--scope tasks  → viking://resources/tasks/
--scope resources  → viking://resources/

## 记忆文件规范

- 使用 Markdown 格式，文件名语义化（如 `deploy-hotfix.md`、`alice-preferences.md`）
- cases/ 下存问题-方案案例
- patterns/ 下存交互模式和工作流
- preferences/ 下存用户偏好（放在对应用户的 URI 下）
- 记忆内容简洁，聚焦"为什么"和"怎么做"，避免冗余
```

## 端到端数据流

### 记忆写入流程

```
Coordinator (Claude CLI 进程)
  │  执行 Bash: teamsland memory write viking://agent/teamsland/memories/cases/deploy-fix.md \
  │               --content "## 热修复流程\n..." --mode create
  ▼
packages/cli/src/index.ts
  │  switch("memory") → runMemory(client, args, jsonOutput)
  ▼
packages/cli/src/commands/memory.ts
  │  parseMemoryArgs(args) → { op: "write", uri: "viking://...", content: "...", mode: "create" }
  │  client.vikingWrite(uri, content, { mode: "create" })
  ▼
packages/cli/src/http-client.ts
  │  POST http://localhost:3001/api/viking/write
  │  body: { uri, content, mode: "create" }
  ▼
apps/server/src/viking-routes.ts
  │  handleWrite(req, vikingClient)
  │  vikingClient.write(uri, content, { mode: "create" })
  ▼
packages/memory/src/viking-memory-client.ts
  │  POST http://localhost:1933/api/v1/content/write
  ▼
OpenViking Server (port 1933)
  │  写入文件 + 自动刷新语义向量
  ▼
响应沿原路返回 → Coordinator 收到输出:
  "Written: viking://agent/teamsland/memories/cases/deploy-fix.md (create, 128 bytes)"
```

### LiveContextLoader 调整：移除 agent 记忆被动召回

当前 `LiveContextLoader.buildFetches()` 会自动从 `viking://agent/teamsland/memories/` 召回 agent 记忆注入 prompt。现在 coordinator 有了 `teamsland memory find` 的主动检索能力，被动召回的 agent 记忆可能是噪音，反而干扰 coordinator 判断。

**变更**：从 `buildFetches()` 中移除 `agentMemFetch`，仅保留 `userMemFetch`（用户偏好通常低噪音且有价值）。Coordinator 需要 agent 记忆时，通过 skill 指导自主调用 `teamsland memory find`。

变更后的 5 个数据源变为 4 个：

```
新事件到达 → LiveContextLoader.load(event)
  ├── SubagentRegistry.allRunning()           [运行中 Worker 列表]
  ├── vikingClient.find(query, "active tasks") [活跃任务]
  ├── vikingClient.find(query, "user memories") [用户记忆 — 保留]
  └── vikingClient.getSessionContext()          [近期对话]
```

### 关键确认

1. **写入后立即可检索**：OpenViking 的 write 会自动触发语义向量化。不传 `--wait` 时向量化异步执行，通常秒级完成。
2. **无需改动 allowedTools**：`Bash(teamsland *)` 已覆盖 `teamsland memory *`。
3. **agent 记忆从被动召回转为主动检索**：coordinator 通过 `teamsland memory find` 按需检索，精准度更高。

## Acceptance Scenarios

### Scenario 1: Coordinator 写入新的 agent 记忆

  Given coordinator 正在处理一个事件，发现了可复用的经验
  When coordinator 执行 `teamsland memory write viking://agent/teamsland/memories/cases/ci-lint-timeout.md --content "## CI lint 超时\n\n仓库 A 的 lint 阶段经常超时..." --mode create`
  And CLI 解析参数，调用 `client.vikingWrite()` 发送 POST 到 teamsland server
  And server 的 `handleWrite` 将请求转发到 OpenViking
  And OpenViking 写入文件并自动触发语义向量化
  Then coordinator 在 stdout 看到写入成功的确认信息（URI、mode、字节数）

### Scenario 2: Coordinator 检索相关记忆

  Given coordinator 之前已通过 `teamsland memory write` 写入了一些 agent 记忆
  When coordinator 执行 `teamsland memory find "CI 超时" --scope agent --limit 5`
  And CLI 将 `--scope agent` 展开为 `--uri viking://agent/teamsland/memories/`
  And CLI 调用 `client.vikingFind()` 发送 POST 到 teamsland server
  And server 的 `handleFind` 将请求转发到 OpenViking 进行语义搜索
  Then coordinator 在 stdout 看到匹配结果列表，每条包含 URI、摘要和相关性分数

### Scenario 3: Coordinator 浏览记忆目录结构

  Given OpenViking 中已有 agent 记忆目录结构
  When coordinator 执行 `teamsland memory ls viking://agent/teamsland/memories/ --recursive`
  And CLI 调用 `client.vikingLs()` 发送 GET 到 teamsland server
  And server 的 `handleLs` 将请求转发到 OpenViking
  Then coordinator 看到树状目录列表，包含 cases/、patterns/ 等子目录和其中的文件

### Scenario 4: Coordinator 更新已有记忆

  Given `viking://agent/teamsland/memories/cases/ci-lint-timeout.md` 已存在
  When coordinator 执行 `teamsland memory write viking://agent/teamsland/memories/cases/ci-lint-timeout.md --content "更新后的内容..." --mode replace`
  And 请求经 CLI → server → OpenViking 转发
  And OpenViking 用新内容替换原文件并刷新语义向量
  Then coordinator 看到更新成功确认
  And 后续 `teamsland memory find` 能基于新内容检索到该记忆

### Scenario 5: Coordinator 删除过时记忆

  Given `viking://agent/teamsland/memories/cases/outdated.md` 存在
  When coordinator 执行 `teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md`
  And 请求经 CLI → server → OpenViking 转发
  And OpenViking 删除文件及其语义向量
  Then coordinator 看到删除成功确认
  And 后续 `teamsland memory find` 不再检索到该记忆

### Scenario 6: Coordinator 主动检索记忆辅助决策

  Given coordinator 之前写入了 `viking://agent/teamsland/memories/cases/deploy-fix.md`
  When 一个新事件到达，coordinator 判断可能需要历史部署经验
  And coordinator 主动执行 `teamsland memory find "部署热修复" --scope agent --limit 3`
  And find 返回包含 deploy-fix.md 摘要的结果列表
  Then coordinator 根据检索结果辅助当前事件的决策
  And agent 记忆不会被 LiveContextLoader 自动注入 prompt（仅用户记忆保留被动召回）

### Scenario 7: scope 快捷方式正确展开

  Given coordinator 需要查看某用户的记忆
  When coordinator 执行 `teamsland memory ls --scope user --user alice`
  And CLI 将 `--scope user --user alice` 展开为 URI `viking://user/alice/memories/`
  Then 等价于执行 `teamsland memory ls viking://user/alice/memories/`

### Scenario 8: scope user 缺少 --user 参数时报错

  Given coordinator 执行 `teamsland memory find "偏好" --scope user`（未提供 --user）
  When CLI 解析参数
  Then CLI 输出错误信息："--scope user requires --user <id>"
  And 进程以非零退出码退出

### Scenario 9: OpenViking 不可用时的错误反馈

  Given OpenViking server 未启动或不可达
  When coordinator 执行 `teamsland memory find "test"`
  And CLI 发送请求到 teamsland server
  And server 尝试转发到 OpenViking 但连接失败
  Then teamsland server 返回 503 错误
  And CLI 输出错误信息 "OpenViking request failed"
  And coordinator 看到明确的错误信息（不是静默失败）

### Scenario 10: --content-file 从文件读取内容写入

  Given 本地存在文件 `/tmp/memory-note.md`，内容为长文本
  When coordinator 执行 `teamsland memory write viking://resources/docs/guide.md --content-file /tmp/memory-note.md --mode create`
  And CLI 读取 `/tmp/memory-note.md` 的内容
  And 将文件内容作为 content 发送到 server
  Then OpenViking 收到完整的文件内容并写入成功

### Scenario 11: --json 输出结构化结果

  Given coordinator 需要程序化解析检索结果
  When coordinator 执行 `teamsland memory find "部署" --scope agent --json`
  Then CLI 输出 server 返回的原始 JSON（包含 memories、resources、skills 数组）
  And 不输出人类可读的格式化文本
