# Teamsland

**团队 AI 协作平台** — 监听 Meego 项目事件，自动分类意图、创建 Git Worktree、组装上下文、启动 Claude Code Agent 完成任务，全程通过飞书同步进度。

## 快速开始

### 前置条件

| 工具 | 版本 | 说明 |
|------|------|------|
| [Bun](https://bun.sh) | >= 1.0 | 运行时与包管理器 |
| Git | 任意 | 版本控制 |

可选（缺失时自动降级，不影响核心功能）：

- `claude` CLI — Agent 子进程派发
- `lark-cli` — 飞书消息/文档操作
- `sqlite-vec` 扩展 — 向量记忆检索（否则仅用全文检索）

### 安装

```bash
git clone <repo-url>
cd teamsland
bun install
```

### 配置环境变量

在项目根目录创建 `.env`（Bun 自动加载），或直接 `export`：

```bash
# ── 必填 ──────────────────────────────────────────────
LARK_APP_ID=cli_xxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
ANTHROPIC_AUTH_TOKEN=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_BASE_URL=https://api.anthropic.com

# ── 可选 ──────────────────────────────────────────────
MEEGO_WEBHOOK_SECRET=your_webhook_secret       # Webhook HMAC 签名验证
MEEGO_PLUGIN_ACCESS_TOKEN=your_plugin_token    # Meego API 调用
LARK_TEAM_CHANNEL_ID=oc_xxxxxxxxxxxx           # 飞书团队通知频道
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318  # OTel 追踪
LOG_LEVEL=info                                 # trace|debug|info|warn|error
LOG_PRETTY=true                                # 开发环境可读日志
```

`config/config.json` 中的 `${VAR}` 占位符会在启动时被自动替换为对应环境变量值。

### 启动

```bash
# 启动主服务（默认端口 3000）
bun run apps/server/src/main.ts

# 另一个终端 — 启动 Dashboard 开发服务器（端口 8080，自动代理到 3000）
bun run dev:dashboard
```

启动后：
- 打开 `http://localhost:8080` 查看 Dashboard（Agent 列表、会话消息、实时 WebSocket 推送）
- 服务健康检查：`curl http://localhost:3000/health`

### 运行测试

```bash
bun run test        # watch 模式
bun run test:run    # CI 单次运行
bun run lint        # Biome 检查（pre-commit hook 会自动执行）
```

---

## 它是怎么工作的

```
Meego 工单事件 (Webhook / Poll / SSE)
    │
    ▼
MeegoConnector → MeegoEventBus (SQLite 幂等去重)
    │
    ▼
issue.created 处理器
    ├─→ DocumentParser      解析工单描述
    ├─→ IntentClassifier    规则匹配 → LLM 回退分类
    ├─→ WorktreeManager     git worktree add（隔离分支）
    ├─→ [异步] 记忆摄取     ExtractLoop → MemoryUpdater
    │
    ├─→ [复杂任务] Swarm    TaskPlanner 拆解 → DAG 拓扑 → 多 Agent 并行
    └─→ [简单任务] 单 Agent
            ├─→ DynamicContextAssembler  组装 5 段 Prompt
            │       §A 工单上下文
            │       §B 团队记忆（向量 + 全文检索）
            │       §C 技能路由
            │       §D 仓库信息
            │       §E 角色指令模板
            ├─→ ProcessController.spawn()   Bun.spawn("claude", ...)
            └─→ SidecarDataPlane            NDJSON 流 → SessionDB
```

### 六种 Agent 角色

| 角色 | 触发类型 | 职责 |
|------|----------|------|
| 前端开发 | `frontend_dev` | 实现页面/组件，编写测试，提交 PR |
| 技术方案 | `tech_spec` | 分析可行性，设计架构，输出方案文档 |
| 设计评审 | `design` | 检查设计一致性，编写评审意见 |
| 信息查询 | `query` | 搜索记忆和代码库，合成带引用的回答 |
| 状态同步 | `status_sync` | 聚合 Sprint 状态，生成报告推送飞书 |
| 人工确认 | `confirm` | 发送确认请求，轮询审批状态 |

---

## 项目结构

```
teamsland/
├── apps/
│   ├── server/          主服务进程（事件管线、Agent 调度、API）
│   ├── dashboard/       React 监控面板（rspack + TailwindCSS v4）
│   └── docs/            文档站点（Rspress）
├── packages/
│   ├── types/           共享类型定义（零依赖）
│   ├── config/          配置加载、Zod 校验、环境变量替换
│   ├── observability/   pino 日志 + OpenTelemetry 追踪
│   ├── session/         会话/消息存储（SQLite WAL + FTS5）
│   ├── memory/          团队记忆（sqlite-vec 向量 + FTS5 全文）
│   ├── ingestion/       文档解析 + 意图分类
│   ├── context/         动态上下文组装（5 段 Prompt）
│   ├── meego/           Meego 事件连接器 + 确认监听
│   ├── sidecar/         Agent 进程管理 + NDJSON 数据面
│   ├── swarm/           多 Agent DAG 任务拆解
│   ├── lark/            飞书 CLI 封装
│   └── git/             Git Worktree 生命周期管理
└── config/
    ├── config.json      运行时配置（支持 ${ENV_VAR} 替换）
    └── templates/       6 个 Agent 角色指令模板
```

所有包以 `@teamsland/` 为 scope，通过 Bun workspace 链接。

---

## 配置

中心配置文件 `config/config.json` 涵盖以下模块：

| 配置节 | 说明 |
|--------|------|
| `meego` | 事件接入：Webhook / 轮询 / SSE 三种模式 |
| `lark` | 飞书应用凭据、Bot 配置、通知频道 |
| `session` | SessionDB：token 压缩阈值、WAL 写入抖动 |
| `sidecar` | Agent 并发上限 (20)、重试次数、超时 |
| `memory` | 衰减半衰期、ExtractLoop 迭代数、按类型 TTL |
| `storage` | sqlite-vec 路径/维度、embedding 模型、FTS5 优化间隔 |
| `confirmation` | 人工确认：轮询间隔、最大提醒次数 |
| `dashboard` | 端口、飞书 OAuth 认证、部门白名单 |
| `repoMapping` | Meego 项目 → Git 仓库映射 |
| `skillRouting` | 意图类型 → 可用工具/技能映射 |
| `llm` | Anthropic 模型配置（可选，缺失时走纯规则分类） |

详细字段说明见文档站 [配置参考](apps/docs/docs/reference/config.md)。

---

## 优雅降级

系统在关键依赖缺失时不会崩溃，而是自动降级：

| 缺失组件 | 降级行为 |
|----------|----------|
| `config.llm` 未配置 | IntentClassifier 仅用规则匹配；Swarm / ExtractLoop 禁用 |
| `sqlite-vec` 不可用 | 记忆存储降级为 NullMemoryStore（跳过向量检索） |
| Embedding 模型加载失败 | 降级为 NullEmbedder（返回零向量） |
| `lark-cli` 未安装 | 飞书通知跳过，日志记录 LarkCliError |
| `MEEGO_PLUGIN_ACCESS_TOKEN` 为空 | ConfirmationWatcher 始终返回 "pending" |

---

## 常用命令

```bash
bun run apps/server/src/main.ts    # 启动主服务
bun run dev:dashboard              # Dashboard 开发服务器
bun run dev:docs                   # 文档站开发服务器
bun run test                       # 测试（watch 模式）
bun run test:run                   # 测试（CI 模式）
bun run lint                       # Biome 代码检查
bun run lint:fix                   # Biome 自动修复
bun run format                     # Biome 格式化
bun run build                      # 构建所有应用
bun run typecheck                  # 全量类型检查
```

---

## 技术栈

| 层面 | 技术 |
|------|------|
| 运行时 | Bun |
| 语言 | TypeScript (strict) |
| 存储 | bun:sqlite (WAL) + sqlite-vec (向量) + FTS5 (全文) |
| Embedding | Qwen3-Embedding-0.6B (本地 GGUF，无需 GPU) |
| LLM | Anthropic Claude (Messages API) |
| 前端 | rspack + React 19 + TailwindCSS v4 |
| Lint | Biome (pre-commit hook) |
| 测试 | Vitest |
| 可观测性 | OpenTelemetry + pino |
| 文档 | Rspress |

---

## 文档

完整文档位于 `apps/docs/`，可通过以下命令启动本地预览：

```bash
bun run dev:docs
```

主要内容：

- [快速开始](apps/docs/docs/guide/getting-started.md)
- [架构总览](apps/docs/docs/guide/architecture.md)
- [核心概念](apps/docs/docs/guide/core-concepts.md)
- [事件管线](apps/docs/docs/guide/event-pipeline.md)
- [记忆系统](apps/docs/docs/guide/memory-system.md)
- [Dashboard](apps/docs/docs/guide/dashboard.md)
- [部署运维](apps/docs/docs/guide/deployment.md)
- [配置参考](apps/docs/docs/reference/config.md)
- [包一览](apps/docs/docs/reference/packages.md)
- [Server API](apps/docs/docs/reference/server-api.md)
