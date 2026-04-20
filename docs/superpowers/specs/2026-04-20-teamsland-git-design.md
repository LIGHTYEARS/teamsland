# @teamsland/git — WorktreeManager 设计

> 日期：2026-04-20
> 状态：已批准
> 依赖：`Bun.spawnSync` / `Bun.spawn`（运行时），`@teamsland/types`（类型）
> 范围：完整 WorktreeManager — create + reap + 错误处理

## 概述

`@teamsland/git` 提供 Git worktree 生命周期管理。每个 Agent 任务在独立 worktree 中执行代码操作，完成后由 `reap()` 清理过期 worktree。所有 git 操作通过注入的 `CommandRunner` 接口执行，支持单元测试时 mock。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| Git 调用方式 | 注入 `CommandRunner`，默认实现用 `Bun.spawn` | 可测试性：测试时注入 mock runner |
| Worktree 路径 | `{repoPath}/.worktrees/req-{issueId}` | 固定约定，Sidecar 可按 issueId 查找 |
| 分支命名 | `feat/req-{issueId}` | 固定约定，可追溯到 Meego Issue |
| reap 输入 | `Pick<AgentRecord, "worktreePath" \| "status" \| "createdAt" \| "issueId">[]` | 解耦：不依赖 SubagentRegistry，避免循环依赖 |
| 异步 | 全部 async（文件 I/O + 子进程） | `Bun.spawn` 返回 Promise，exclude 文件用 `Bun.write` |
| 错误类型 | `WorktreeError` 包含 command + exitCode + stderr | 明确失败原因 |

## 文件结构

```
packages/git/src/
├── index.ts                # barrel 导出
├── worktree-manager.ts     # WorktreeManager 类
├── command-runner.ts       # CommandRunner 接口 + 默认 BunCommandRunner
└── __tests__/
    └── worktree-manager.test.ts
```

## 依赖

- 运行时：无 npm 依赖（`Bun.spawn` / `Bun.file` / `Bun.write` 内建）
- Workspace：`@teamsland/types`（`AgentRecord` 用于 `Pick` 类型）
- 外部工具：`git` CLI（系统已安装）

## 类型定义

### CommandRunner 接口（定义在本包内）

```typescript
/** 命令执行结果 */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * 命令执行器接口，抽象子进程调用
 *
 * 生产环境使用 BunCommandRunner（基于 Bun.spawn），
 * 测试环境注入 mock 实现。
 */
export interface CommandRunner {
  run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult>;
}
```

### BunCommandRunner（默认实现）

```typescript
export class BunCommandRunner implements CommandRunner {
  async run(cmd: string[], opts?: { cwd?: string }): Promise<CommandResult> {
    const proc = Bun.spawn(cmd, { cwd: opts?.cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }
}
```

### ReapableAgent（本包内定义）

```typescript
import type { AgentRecord } from "@teamsland/types";

/** reap() 输入：从 AgentRecord Pick 必要字段 */
export type ReapableAgent = Pick<AgentRecord, "worktreePath" | "status" | "createdAt" | "issueId">;
```

### ReapResult

```typescript
export type ReapAction =
  | "removed"
  | "auto-committed-and-removed"
  | "skipped-running"
  | "error";

export interface ReapResult {
  worktreePath: string;
  action: ReapAction;
  /** 仅 action === "error" 时存在 */
  error?: string;
}
```

### WorktreeError

```typescript
export class WorktreeError extends Error {
  constructor(
    message: string,
    public readonly command: string[],
    public readonly exitCode: number,
    public readonly stderr: string
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}
```

## API

### WorktreeManager 类

```typescript
class WorktreeManager {
  constructor(runner?: CommandRunner)  // 默认 new BunCommandRunner()

  async create(repoPath: string, issueId: string, baseBranch?: string): Promise<string>

  async reap(agents: ReapableAgent[], maxAgeDays?: number): Promise<ReapResult[]>
}
```

### `create(repoPath, issueId, baseBranch = "main")`

**行为：**
1. 计算 `branchName = feat/req-${issueId}`
2. 计算 `worktreePath = ${repoPath}/.worktrees/req-${issueId}`
3. 运行 `git -C {repoPath} worktree add -b {branchName} {worktreePath} {baseBranch}`
4. 若 exitCode !== 0，抛出 `WorktreeError`
5. 读取 `{repoPath}/.git/info/exclude`
6. 追加排除模式（`.agent_context`、`CLAUDE.md`、`.claude`）— 仅追加尚未存在的行
7. 写回 exclude 文件
8. 返回 `worktreePath`

### `reap(agents, maxAgeDays = 7)`

**行为：**
1. 计算过期阈值 `cutoff = Date.now() - maxAgeDays * 86400_000`
2. 过滤 agents：`status !== "running"` && `createdAt < cutoff`
3. 对每个过期 agent：
   - 运行 `git -C {worktreePath} status --porcelain`
   - 若有未提交变更：`git -C {worktreePath} add -A` + `git -C {worktreePath} commit -m "auto-save before worktree cleanup (req-{issueId})"`
   - 运行 `git worktree remove --force {worktreePath}`
   - 若任何步骤失败，记录 `{ action: "error", error: stderr }` 而非抛出
4. 返回所有 `ReapResult[]`

## 测试策略

通过注入 mock `CommandRunner` 进行纯单元测试，无需真实 git 仓库：

- `create` 正确调用 git worktree add 命令
- `create` 成功后追加 exclude 模式（需 mock 文件 I/O 或使用临时目录）
- `create` 在 git 返回非零时抛出 `WorktreeError`
- `create` 使用默认 baseBranch "main"
- `reap` 过滤掉 running 状态的 agent
- `reap` 过滤掉未过期的 agent
- `reap` 对 dirty worktree 执行 auto-commit
- `reap` 对 clean worktree 直接 remove
- `reap` 单个 agent 失败不影响其他 agent 的清理

可选集成测试（需真实 git）：
- 在临时目录初始化 git repo，调用 `create` 验证 worktree 确实创建

## 验证标准

- `bunx tsc --noEmit --project packages/git/tsconfig.json` 零错误
- `bunx biome check packages/git/src/` 零错误
- `bunx vitest run packages/git/` 全部通过
- 导出的函数/类型有中文 JSDoc + `@example`
- 无 `any`、无 `!` 非空断言
- `CommandRunner` 接口可注入 mock（无真实 git 依赖即可测试）
