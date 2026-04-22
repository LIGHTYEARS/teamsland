# Teamsland

**团队 AI 协作平台** — 将 Meego 项目管理事件自动转化为 AI Agent 任务，实现从需求创建到代码提交的端到端自动化。

## 它能做什么？

当团队成员在 Meego 上创建一个需求工单，Teamsland 会：

1. **接收事件** — 通过 Webhook / 轮询 / SSE 实时监听 Meego 事件
2. **意图分类** — 基于规则 + LLM 判断工单类型（前端开发、技术方案、设计评审……）
3. **创建工区** — 在对应仓库自动创建 Git Worktree 隔离分支
4. **组装上下文** — 拉取团队记忆、技能路由、角色模板，构建高质量 Prompt
5. **派发 Agent** — 启动 Claude Code 子进程，在 Worktree 中独立工作
6. **流式监控** — 实时解析 Agent 的 NDJSON 输出，写入会话数据库
7. **飞书通知** — 全程通过飞书消息/卡片同步进度，支持人工确认审批

对于复杂任务，还可启用 **Swarm 模式** —— 自动拆解子任务、拓扑排序、多 Agent 并行执行。

## 核心特性

| 特性 | 说明 |
|------|------|
| **多模式事件接入** | Webhook、REST 轮询、SSE 长连接三种模式，可同时启用 |
| **六种 Agent 角色** | 前端开发、技术方案、设计评审、状态同步、信息查询、人工确认 |
| **三层团队记忆** | L0 常驻记忆 + L1 向量检索 + L2 全文搜索，支持衰减淘汰 |
| **Swarm 任务拆解** | LLM 拆分子任务 → DAG 拓扑排序 → 多 Agent 并行 → 法定人数投票 |
| **优雅降级** | LLM 未配置时走规则分类；sqlite-vec 不可用时跳过向量检索 |
| **实时 Dashboard** | WebSocket 推送 Agent 状态、会话消息流查看、飞书 OAuth 登录 |
| **OpenTelemetry** | 全链路 Span 追踪，兼容 Jaeger / Grafana Tempo |

## 技术栈

- **运行时**: Bun
- **语言**: TypeScript (strict)
- **存储**: bun:sqlite (WAL 模式) + sqlite-vec (向量) + FTS5 (全文)
- **Embedding**: Qwen3-Embedding-0.6B (本地 GGUF，无需 GPU)
- **LLM**: Anthropic Claude (Messages API)
- **前端**: rspack + React 19 + TailwindCSS v4
- **可观测性**: OpenTelemetry + pino

## 快速导航

- [快速开始](/guide/getting-started) — 5 分钟跑通本地开发环境
- [架构总览](/guide/architecture) — 分层架构与数据流
- [核心概念](/guide/core-concepts) — Agent 角色、意图分类、动态上下文
- [事件管线](/guide/event-pipeline) — 从 Meego Webhook 到 Agent 启动的完整流程
- [记忆系统](/guide/memory-system) — 三层记忆、向量检索、衰减淘汰
- [Dashboard](/guide/dashboard) — 实时监控面板与飞书认证
- [部署运维](/guide/deployment) — 环境变量、生产配置、监控告警
- [配置文件参考](/reference/config) — config.json 全字段说明
- [包一览](/reference/packages) — 12 个 @teamsland/* 包的职责与 API
- [Server API](/reference/server-api) — HTTP / WebSocket 接口文档
