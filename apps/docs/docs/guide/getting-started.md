# 快速开始

本指南将帮助你在本地搭建并运行 Teamsland — 一个基于 Bun/TypeScript 构建的团队 AI 协作平台。

## 前置条件

在开始之前，请确保已安装以下工具：

| 工具 | 版本要求 | 说明 |
|------|----------|------|
| [Bun](https://bun.sh) | >= 1.0 | 运行时与包管理器 |
| [Git](https://git-scm.com) | 任意 | 版本控制 |
| `lark-cli` | 可选 | 飞书命令行工具，启用飞书通知功能时需要 |
| `claude` (Claude Code CLI) | 可选 | 用于在 Sidecar 中派生 Agent 进程 |
| `sqlite-vec` extension | 可选 | 向量记忆功能所需，未安装时降级为纯全文检索 |

> **提示**：可选依赖缺失时，Teamsland 会优雅降级并在启动日志中给出提示，不影响核心功能运行。

## 安装

克隆仓库并安装依赖：

```bash
git clone <repo>
cd teamsland
bun install
```

`bun install` 会根据 `bun.lockb` 安装所有工作区依赖，并自动链接各 `packages/*` 子包。

## 环境变量

Teamsland 通过环境变量注入密钥和运行时参数。可以在 Shell 中直接 `export`，也可以在项目根目录创建 `.env` 文件（Bun 会自动加载）。

### 必填变量

```bash
# 飞书应用凭据
LARK_APP_ID=cli_xxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxx

# Anthropic API 密钥（二选一，优先使用 ANTHROPIC_AUTH_TOKEN）
ANTHROPIC_AUTH_TOKEN=sk-ant-...
# ANTHROPIC_API_KEY=sk-ant-...

# 使用的模型，例如：
ANTHROPIC_MODEL=claude-sonnet-4-20250514

# Anthropic API 基础 URL
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### 可选变量

```bash
# Meego（飞书项目）集成
MEEGO_WEBHOOK_SECRET=your_webhook_secret
MEEGO_PLUGIN_ACCESS_TOKEN=your_plugin_token

# 飞书通知频道
LARK_TEAM_CHANNEL_ID=oc_xxxxxxxxxxxx

# OpenTelemetry 追踪端点（如 Jaeger、Tempo）
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# 日志配置
LOG_LEVEL=info          # 可选值：trace | debug | info | warn | error
LOG_PRETTY=true         # 开发环境建议开启，输出带颜色的格式化日志
```

### 环境变量替换机制

`config/config.json` 中支持使用 `${VAR}` 语法引用环境变量，例如：

```json
{
  "lark": {
    "appId": "${LARK_APP_ID}",
    "appSecret": "${LARK_APP_SECRET}"
  }
}
```

`@teamsland/config` 包中的 `resolveEnvVars` 函数会在配置加载时自动将所有 `${VAR}` 占位符替换为对应的环境变量值。若变量未设置，将保留原始占位符并在日志中给出警告。

## 配置文件

`config/config.json` 是 Teamsland 的核心运行时配置文件，涵盖以下主要部分：

```json
{
  "lark": { ... },        // 飞书应用配置
  "anthropic": { ... },   // Anthropic 模型配置
  "meego": { ... },       // Meego Webhook 配置
  "session": { ... },     // SQLite 会话数据库路径
  "memory": { ... },      // 向量记忆配置
  "sidecar": { ... },     // Agent 进程管理配置
  "dashboard": { ... },   // 监控面板端口配置
  "observability": { ... } // 日志与追踪配置
}
```

完整的配置项说明请参阅 [配置参考](../reference/config.md) 页面。

## 启动服务

```bash
bun run apps/server/src/main.ts
```

服务启动时会依序执行以下步骤：

1. 解析命令行参数与环境变量
2. 加载并校验 `config/config.json`
3. 替换配置中的 `${VAR}` 占位符
4. 初始化 OpenTelemetry 追踪（若已配置端点）
5. 初始化结构化日志（`@teamsland/observability`）
6. 打开 SessionDB（SQLite WAL 模式）
7. 运行数据库迁移
8. 初始化嵌入模型（Embedder）
9. 初始化向量记忆存储（若 `sqlite-vec` 可用则启用向量检索，否则降级为全文检索）
10. 加载 Agent 角色模板（`config/templates/`）
11. 初始化上下文组装器（Context Assembler）
12. 创建 MeegoConnector（Webhook 接收器）
13. 创建 Sidecar 进程管理器
14. 创建 Swarm 任务调度器
15. 创建 Lark 通知客户端
16. 创建 Git Worktree 管理器
17. 注册 Webhook 路由（`/webhook/meego`）
18. 注册 Dashboard API 路由（`/api/*`）
19. 注册 WebSocket 端点（`/ws`）
20. 启动 HTTP 服务器（默认端口 3000）
21. 启动 MeegoConnector 轮询
22. 注册定时任务（心跳、会话清理等）
23. 注册进程信号处理（`SIGINT` / `SIGTERM` 优雅退出）
24. 打印就绪日志，服务进入运行状态

启动成功后，终端将显示类似以下的日志：

```
{"level":"info","msg":"server ready","port":3000,"time":"..."}
```

## 启动 Dashboard

Dashboard 是一个独立的 React 应用，使用 rspack 构建：

```bash
cd apps/dashboard
bun run dev
```

默认运行在 **8080 端口**，并自动将 `/api/*` 与 `/ws` 请求代理到 **3000 端口**的后端服务。在浏览器中访问 `http://localhost:8080` 即可查看 Agent 运行状态、会话列表和实时日志。

> **注意**：启动 Dashboard 前请确保后端服务已在 3000 端口正常运行。

## 运行测试

```bash
bun run test        # 监听模式（开发时使用，文件变更自动重跑）
bun run test:run    # CI 模式（单次运行，非零退出码表示失败）
bun run lint        # Biome 代码规范检查与格式校验
```

> **提交前**：项目配置了 pre-commit hook，提交时会自动运行 `bun run lint`。若存在规范违规，提交将被阻止，请先修复后再提交。

## 项目结构

Teamsland 采用 Bun 工作区（Workspaces）管理的 Monorepo 结构：

```
teamsland/
├── apps/
│   ├── server/       — 主服务进程
│   ├── dashboard/    — React 监控面板
│   └── docs/         — 文档站点 (Rspress)
├── packages/
│   ├── types/        — 共享类型定义
│   ├── config/       — 配置加载与校验
│   ├── observability/— 日志与 OTel 追踪
│   ├── session/      — 会话存储 (SQLite WAL)
│   ├── memory/       — 团队记忆 (向量+全文)
│   ├── ingestion/    — 文档解析与意图分类
│   ├── context/      — 动态上下文组装
│   ├── meego/        — Meego 事件连接器
│   ├── sidecar/      — Agent 进程管理
│   ├── swarm/        — 多 Agent 任务拆解
│   ├── lark/         — 飞书通信
│   └── git/          — Git Worktree 管理
└── config/
    ├── config.json   — 运行时配置
    └── templates/    — Agent 角色模板
```

所有包均以 `@teamsland/` 为作用域（scope），例如 `@teamsland/types`、`@teamsland/observability`。

## 下一步

- [架构概览](../architecture/overview.md) — 了解各模块之间的关系与数据流
- [核心概念](../architecture/concepts.md) — 深入理解 Session、Memory、Sidecar 等核心抽象
- [事件管道](../architecture/event-pipeline.md) — Meego Webhook 到 Agent 派生的完整链路
- [配置参考](../reference/config.md) — `config.json` 全量字段说明
