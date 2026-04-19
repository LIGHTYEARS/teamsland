# Sidecar 控制面与 Session 持久化（Sidecar & Session Persistence）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.7–§2.8

> **TL;DR**
> - Sidecar 采用控制面/数据面分离：控制面通过 Bun.spawn 管理 Claude Code 进程，数据面走 stream-json 协议（NDJSON stdin/stdout）
> - SubagentRegistry 提供 spawn/kill/health_check 能力，支持 WebSocket Dashboard 实时展示
> - Session 持久化基于 SQLite WAL 模式，包含 sessions/messages/tool_calls 三表，支持 FTS5 全文检索
> - 内置 compaction 机制：消息超 200 条时自动摘要压缩，保留最近 50 条原始记录

## 目录

- [Sidecar：控制面与数据面分离](#sidecar控制面与数据面分离)
  - [进程控制面：Bun.spawn + stream-json](#进程控制面bunspawn--stream-json)
- [Session 持久化](#session-持久化)

---

## Sidecar：控制面与数据面分离

**核心设计原则（借鉴 openclaw Gateway Protocol）**：

```text
控制面 (Process Controller)            数据面 (Claude Code Process)
────────────────────────────           ────────────────────────────
SubagentRegistry                        Bun.spawn 子进程
  ├── spawn(task_config)                 ├── Claude Code (stream-json)
  ├── kill(agent_id)                     ├── stdout: NDJSON 事件流
  ├── health_check()                     ├── stdin: 初始 prompt JSON
  └── persist_to_disk()                  └── 进程退出 → exited Promise

控制方式: Bun.spawn 异步进程管理
通信协议: stdin/stdout (stream-json NDJSON)
消息格式: {type, agent_id, payload, trace_id}
```

### 进程控制面：Bun.spawn + stream-json

**为什么选 Bun.spawn 而非 tmux**：

| 能力 | Bun.spawn + stream-json | tmux |
|------|------------------------|------|
| Dashboard 集成 | WebSocket 推送结构化事件（tool_use 卡片、代码高亮） | 需要 wterm 终端模拟器 |
| 数据格式 | 结构化 JSON（可编程解析） | 原始终端流（含 ANSI 转义码） |
| 打断 | `process.kill(SIGINT/SIGKILL)`（OS 级） | `send-keys C-c`（需 pane 可接收） |
| 进程管理 | Bun 原生 API，事件驱动 | 子进程调用 tmux CLI |
| 单点风险 | 无（每个进程独立） | tmux server 崩溃影响所有实例 |
| 输出捕获 | stdout 直接可读 | 需 pipe-pane + 日志文件 |
| 调试 | Dashboard + jsonl 日志文件 | tmux attach |

**结论：Bun.spawn + stream-json 是首选方案。** 参考 multica (`server/pkg/agent/claude.go`) 的生产实践验证。

```typescript
// src/sidecar/process-controller.ts
// 参考 multica claude.go：Bun.spawn 管理 Claude Code 进程，stdin/stdout 走 stream-json 协议

export class ProcessController {
  /**
   * 启动 Claude Code 实例。
   * 使用 stream-json 协议：stdin 写入初始 prompt JSON 后关闭，stdout 输出 NDJSON 事件流。
   * 参考 multica 实践：-p + --output-format stream-json + --input-format stream-json
   */
  async spawnCc(params: {
    issueId: string;
    worktree: string;
    initialPrompt?: string;
  }): Promise<{ proc: Subprocess; sessionName: string }> {
    const sessionName = `req-${params.issueId}`;

    const proc = Bun.spawn(
      [
        "claude",
        "-p",
        "--output-format", "stream-json",
        "--input-format", "stream-json",
        "--verbose",
        "--permission-mode", "bypassPermissions",
      ],
      {
        cwd: params.worktree,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    // stdin: 写入初始 prompt JSON 后立即关闭（multica 模式）
    if (params.initialPrompt) {
      const promptJson = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: params.initialPrompt }],
        },
      });
      proc.stdin.write(promptJson + "\n");
    }
    proc.stdin.end();

    // tee stdout 到 jsonl 文件（供回看和 Dashboard WebSocket 推送）
    const logPath = `/tmp/${sessionName}.jsonl`;
    this.teeToFile(proc, logPath);

    return { proc, sessionName };
  }

  /** 软打断（SIGINT）或强制终止（SIGKILL） */
  interrupt(pid: number, hard = false): void {
    try {
      process.kill(pid, hard ? "SIGKILL" : "SIGINT");
    } catch {
      // 进程可能已退出
    }
  }

  /** 检查进程是否存活（kill(pid, 0) 不发信号，只检查存在性） */
  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 将 stdout tee 到 jsonl 文件（供 Dashboard 回看） */
  private async teeToFile(proc: Subprocess, logPath: string): Promise<void> {
    const file = Bun.file(logPath);
    const writer = file.writer();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      writer.end();
    }
  }
}
```

**WebSocket Dashboard 集成**：
```text
Claude Code stdout (NDJSON)
  │
  ▼
SidecarDataPlane 解析 stream-json 事件
  ├── 路由给 Orchestrator（tool_use / result / error）
  ├── tee 到 /tmp/req-{id}.jsonl（供回看）
  └── 推送给 Dashboard WebSocket（实时流）
        ↓
  React 组件渲染结构化事件
  ├── tool_use → 折叠卡片
  ├── 代码块 → 语法高亮
  ├── result → 完成状态
  └── 用户可发送中断指令 → ProcessController.interrupt(pid)
```

**注意事项**：
- 进程组管理：spawn 时应创建新进程组，确保 kill 父进程时子进程（git、npm 等）也被清理
- jsonl 日志含完整 stream-json 事件，可用于 post-mortem 调试
- 每个进程的 stdout 是独立的 ReadableStream，不存在跨进程的单点故障
- Dashboard WebSocket 连接断开不影响进程运行（进程输出持续 tee 到文件）

**multica 并发/打断关键结论（源码核实）**：
- multica `claude.go`：进程通过 `exec.CommandContext` 管理，context cancel 触发 stdout 关闭 → 进程退出
- 打断三级：`SIGINT`（软）→ `SIGTERM`（硬）→ `SIGKILL`（10s WaitDelay 后强制），OS 级信号保证响应
- `--permission-mode bypassPermissions` 避免 tool use 确认阻塞
- 进程崩溃恢复：任务级重试（心跳 + sweeper 检测离线 → 重置任务 → 重新分派），不依赖进程级 reattach
- **worktree 保留 7 天**（需求完成/关闭后），供 hotfix 场景直接 `cd` 到 worktree 手动执行 `claude`

**持久化与 orphan 恢复（借鉴 openclaw subagent-registry.ts）**：

```typescript
// src/sidecar/subagent-registry.ts
const STATE_FILE = "/var/run/team-ai/registry.json";
const MAX_CONCURRENT_SESSIONS = 20; // from config/sidecar.yaml → sidecar.max_concurrent_sessions

export class SubagentRegistry {
  async spawn(task: TaskConfig): Promise<string> {
    if (this.runningCount() >= MAX_CONCURRENT_SESSIONS) {
      // 拒绝 spawn：通知负责人 + 回滚 Meego 状态
      await larkCli.sendDm(
        task.assigneeId,
        `[容量已满] 当前运行 ${this.runningCount()}/${MAX_CONCURRENT_SESSIONS} 个实例，无法启动新任务。请稍后重试。`,
      );
      await meego.rollbackStatus(task.issueId, "READY_FOR_DEV");
      throw new Error(`MAX_CONCURRENT_SESSIONS (${MAX_CONCURRENT_SESSIONS}) reached`);
    }
    const { proc, sessionName } = await this.processController.spawnCc(task);
    await this.persist();
    return sessionName;
  }

  async restoreOnStartup(): Promise<void> {
    const stateFile = Bun.file(STATE_FILE);
    if (!(await stateFile.exists())) return;

    const state: RegistryState = await stateFile.json();
    for (const agent of state.agents) {
      if (agent.status !== "running") continue;
      if (this.processController.isAlive(agent.pid)) {
        // 进程仍活着 (kill(pid,0)) → 重新监听 stdout
        await this.reattach(agent);
      } else {
        // 进程已退出 → 尝试 claude --resume {session_id}
        if ((agent.retryCount ?? 0) < 3) {
          await this.reAnnounce(agent);
        } else {
          await this.markFailed(agent);
          // 写入 Memory cases 层 + 飞书通知负责人
          await this.memoryStore.write("cases", { agentId: agent.agentId, issueId: agent.issueId, reason: "max_retries_exceeded" });
          await larkCli.sendDm(agent.assigneeId ?? "", `[任务失败] req-${agent.issueId} 已达最大重试次数，请人工介入`);
        }
      }
    }
  }

  async persist(): Promise<void> {
    // 原子写入：先写临时文件，再 rename（POSIX 原子操作）
    const tmpFile = `${STATE_FILE}.tmp`;
    await Bun.write(tmpFile, JSON.stringify(this.toDict(), null, 2));
    const { renameSync } = await import("fs");
    renameSync(tmpFile, STATE_FILE);
  }
}
```

**stream-json 事件处理**（直接从 Bun.spawn stdout ReadableStream 读取，纯 JSON 无需 strip-ansi）：

```typescript
// src/sidecar/sidecar-data-plane.ts
// stream-json 协议输出纯 JSON，无需 strip-ansi

const INTERCEPTED_TOOLS = new Set(["delegate", "spawn_agent", "memory_write"]);

export class SidecarDataPlane {
  /**
   * 直接从 Bun.spawn 的 stdout ReadableStream 读取 NDJSON 事件流。
   * stream-json 协议保证每行一个 JSON 对象，无 ANSI 转义码。
   * 使用 AbortSignal 优雅关闭。
   */
  async processStream(
    agentId: string,
    stdout: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        if (signal?.aborted) return;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("{")) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          switch (event.type) {
            case "tool_use":
              if (INTERCEPTED_TOOLS.has(event.name as string)) {
                this.routeToOrchestrator(event);
              } else {
                this.forwardToAgent(agentId, event);
              }
              break;
            case "result":
              this.completeTask(agentId, event.output as string);
              break;
            case "error":
              this.handleError(agentId, event);
              break;
            case "system":
              this.logSystemEvent(agentId, event);
              break;
            case "assistant":
              this.forwardToAgent(agentId, event);
              break;
            case "log":
              this.logDebugEvent(agentId, event);
              break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

**worktree 生命周期**：任务完成/关闭后 worktree 保留 7 天，到期清理流程不变（git status → auto-commit → git worktree remove）。

## Session 持久化

**Schema 设计（基于 hermes-agent hermes_state.py v6 扩展）**：

```sql
-- 会话主表
CREATE TABLE sessions (
    session_id      TEXT PRIMARY KEY,
    parent_session_id TEXT,           -- 会话链支持压缩分裂
    team_id         TEXT NOT NULL,
    project_id      TEXT,
    agent_id        TEXT,
    status          TEXT DEFAULT 'active',   -- active/compacted/archived
    created_at      INTEGER,
    updated_at      INTEGER,
    context_hash    TEXT,             -- 快速判断上下文是否变化
    metadata        JSON
);

-- 消息表（带 FTS5 全文索引）
CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    role            TEXT,             -- user/assistant/tool
    content         TEXT,
    tool_name       TEXT,
    trace_id        TEXT,             -- W3C TraceContext
    created_at      INTEGER
);
CREATE VIRTUAL TABLE messages_fts USING fts5(
    content, session_id UNINDEXED
);

-- 任务状态表
CREATE TABLE tasks (
    task_id         TEXT PRIMARY KEY,
    session_id      TEXT,
    team_id         TEXT,
    meego_issue_id  TEXT,
    status          TEXT,
    subtask_dag     JSON,
    created_at      INTEGER,
    completed_at    INTEGER
);
```

**compaction 机制（借鉴 openclaw compaction.ts）**：

- Session token 数超过 `session.compaction_token_threshold`（可配置，推荐初始值 80,000）时触发 compaction
- `MUST PRESERVE` 清单：`issue_id`、worktree 路径、方案要点、关键决策、用户确认状态
- 压缩后 `parent_session_id` 指向原始 session，保留溯源

> **相关文档**：Sidecar 的通讯与可观测性集成见 [07-通讯、可观测与关键数据流](07-communication-observability-dataflows.md)；技术选型详情见 [08-技术选型与参考代码](08-tech-stack-and-references.md)。

---
[← 上一篇: Swarm 方案设计与执行](05-swarm-design.md) | [目录](README.md) | [下一篇: 通讯、可观测与关键数据流 →](07-communication-observability-dataflows.md)
