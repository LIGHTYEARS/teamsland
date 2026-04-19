# 技术选型与参考代码（Tech Stack & Reference Code）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§4–§5

> **TL;DR**
> - 技术栈以 TypeScript + Bun 为核心，含 17 项选型（SQLite WAL、sqlite-vec、Claude Opus/Haiku、Bun.spawn + stream-json 等）
> - 定义 6 个配置 YAML 文件：teams、repos、skills、meego-spaces、prompts、deploy
> - 整理 9 项参考代码迁移清单（含优先级），从 OpenViking Memory、hermes-agent、multica 等项目移植核心逻辑

---

## 技术选型

| 组件 | 选型 | 版本/备注 |
|---|---|---|
| **实现语言** | TypeScript | 全栈统一语言，严格类型安全 |
| **运行时** | Bun | 原生 SQLite (`bun:sqlite`)、`Bun.file`/`Bun.write`、`Bun.spawn`/`Bun.spawnSync`；零额外依赖 |
| **Lint & 格式化** | Biome | 替代 ESLint + Prettier，单工具链，速度快 10x+ |
| **Session DB** | SQLite WAL + FTS5 (`bun:sqlite` 内置) | 零依赖，hermes-agent 验证 |
| **向量存储** | sqlite-vec (SQLite 扩展) | 嵌入同一 SQLite 文件，零额外进程，cosine ANN |
| **LLM** | Claude Opus (`claude-opus-4-5`) | Orchestrator；Worker 用 Claude Haiku (`claude-haiku-4-5`) 降本 |
| **记忆框架** | OpenViking Memory（移植核心逻辑为 TypeScript） | 移植 `ExtractLoop`、`MemoryUpdater`、`hotness_score()` 等核心算法；编写 `TeamMemoryStore`（sqlite-vec + 本地 FS）适配器；`RequestContext` 增加 `team_id` |
| **实体索引** | mem0 upsert_entity 逻辑（移植为 TypeScript） | cosine 阈值 0.95，可调 |
| **飞书操作** | lark-cli (官方) | 二进制调用，`Bun.spawnSync` 封装，AI-friendly 输出 |
| **可观测** | `@opentelemetry/api` + 本地 Jaeger + 本地日志 | 不对接外部 APM；Jaeger self-hosted；同时输出结构化本地日志 |
| **消息队列** | Redis Stream (多机) / SQLite queue (单机) | 按部署规模选 |
| **Agent 通讯** | Claude Code SendMessage/TeammateTool | 直接复用，不重造 |
| **Dashboard 前端** | rspack + swc + React + shadcn/ui + TailwindCSS | 现代前端工具链；shadcn 提供开箱即用组件；TailwindCSS 原子化样式 |
| **Dashboard 终端** | WebSocket + React 结构化事件渲染 | stream-json NDJSON → WebSocket → React 组件 |
| **进程控制面** | Bun.spawn + stream-json 协议 | stdin/stdout 编程控制，进程组管理 |
| **Git 隔离** | git worktree | 每个需求独立 worktree，避免分支冲突 |
| **Embedding 模型** | Qwen3-Embedding-0.6B (GGUF Q8_0) | node-llama-cpp 本地推理，~630MB，30-100ms/query |
| **向量扩展** | sqlite-vec v0.1.9+ | SQLite 向量相似度扩展，cosine 距离，暴力 KNN |

### 配置文件清单（Config File Registry）

> 以下配置文件补充 [§2 各模块](02-core-types-and-memory.md) 中各模块代码块中散落的 YAML 片段，集中定义所有可配置参数及默认值。

```yaml
# config/session.yaml
session:
  compaction_token_threshold: 80000   # 触发 compaction 的 token 数
  sqlite_jitter_range_ms: [20, 150]   # 并发写入随机延迟范围
  busy_timeout_ms: 5000               # SQLite busy_timeout（防 SQLITE_BUSY）
```

```yaml
# config/lark.yaml
lark:
  app_id: "${LARK_APP_ID}"
  app_secret: "${LARK_APP_SECRET}"
  bot:
    history_context_count: 20         # @Bot 时读取的历史消息条数
  notification:
    team_channel_id: ""               # 系统告警推送的飞书群 chat_id
```

```yaml
# config/sidecar.yaml
sidecar:
  max_concurrent_sessions: 20         # 最大并发 Claude Code 实例数
  max_retry_count: 3                  # orphan 恢复最大重试次数
  max_delegate_depth: 2               # Worker 最大委派深度
  worker_timeout_seconds: 300         # 单个 Worker 超时
  health_check_timeout_ms: 30000      # 无响应触发健康检查的阈值
  min_swarm_success_ratio: 0.5        # Swarm 最低成功率（低于则拒绝合并）
```

```yaml
# config/confirmation.yaml
confirmation:
  reminder_interval_min: 30           # 提醒间隔（分钟）
  max_reminders: 3                    # 最大提醒次数
  poll_interval_ms: 60000             # 确认状态轮询间隔
```

```yaml
# config/storage.yaml
storage:
  sqlite_vec:
    db_path: "./data/memory.sqlite"
    busy_timeout_ms: 5000
    vector_dimensions: 512
  embedding:
    model: "hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
    context_size: 2048
  entity_merge:
    cosine_threshold: 0.95
  fts5:
    optimize_interval_hours: 24
```

```yaml
# config/repo_mapping.yaml
# 人工维护：Meego 项目 ID → Git 仓库路径映射
repo_mapping:
  - meego_project_id: "project_xxx"
    repos:
      - path: "/home/user/repos/frontend-main"
        name: "前端主仓库"
      - path: "/home/user/repos/frontend-components"
        name: "组件库"
  - meego_project_id: "project_yyy"
    repos:
      - path: "/home/user/repos/admin-portal"
        name: "管理后台"
```

---

## 参考代码清单（移植为 TypeScript）

> 所有参考源码均为 Python/Go，TypeScript + Bun 项目**不能直接 import**，需移植核心逻辑。

| 优先级 | 参考文件/模块 | 移植方式 | 工作量 |
|---|---|---|---|
| P0 | `hermes-agent/hermes_state.py` (1200行) | 移植为 `src/session/session-db.ts`（`bun:sqlite`）；扩展 `teamId`/`projectId` 字段 | 1.5天 |
| P0 | `OpenViking/openviking/session/memory/` | 移植核心逻辑为 TypeScript：`ExtractLoop`、`MemoryUpdater`、`MemoryReadTool`、`MemorySearchTool`；编写 `TeamMemoryStore` 适配器（sqlite-vec + 本地 FS）；`RequestContext` 增加 `teamId` | 3天 |
| P0 | `OpenViking/openviking/retrieve/memory_lifecycle.py` | 移植 `hotness_score()` → `src/memory/lifecycle.ts`，配置 `halfLifeDays` | 0.5天 |
| P0 | `mem0/mem0/memory/main.py` | 移植 `scoreAndRank` + `upsertEntity` → `src/memory/entity-merge.ts` | 1天 |
| P1 | `openclaw/src/agents/subagent-registry.ts` | TypeScript，直接参考移植（主要调整：`Bun.file`/`Bun.write` 替换 Node.js fs） | 1天 |
| P1 | `lark-cli` binary | 直接调用（`Bun.spawnSync`），封装 TypeScript wrapper `src/lark/lark-cli.ts` | 0.5天 |
| P1 | multica `execenv/runtime_config.go` 模式 | 移植为 `DynamicContextAssembler` TypeScript 类；`InjectRuntimeConfig()` → `buildInitialPrompt()` | 1天 |
| P2 | multica `internal/daemon/execenv/execenv.go` `Reuse()` | 移植 Session Resume + worktree 复用逻辑（带 graceful fallback） | 0.5天 |
| P2 | `cognee/cognee/modules/retrieval/` | 移植 triplet 检索逻辑增强召回 | 1.5天 |
| P1 | qmd `src/db.ts` sqlite-vec 集成 | 参考 Bun 兼容层 + `setCustomSQLite` + 两步查询模式（vec0 不可 JOIN） | 0.5天 |
| P1 | qmd `src/llm.ts` node-llama-cpp embedding | 参考模型加载 / 并行推理 / Qwen3 格式处理 | 0.5天 |

> **相关文档**：各模块的详细架构设计见 [02-核心类型与记忆](02-core-types-and-memory.md) 至 [06-Sidecar 与 Session](06-sidecar-and-session.md)；风险与实现路径见 [09-风险、实现路径与决策追溯](09-risks-roadmap-decisions.md)。

---
[← 上一篇: 通讯、可观测与关键数据流](07-communication-observability-dataflows.md) | [目录](README.md) | [下一篇: 风险、实现路径与决策追溯 →](09-risks-roadmap-decisions.md)
