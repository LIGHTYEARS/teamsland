# 团队 AI 协作平台 — 分层架构设计文档

> 拆分自「团队 AI 协作平台分层架构设计 v2.0」（2026-04-19）

---

## 文档索引

| # | 文档 | 对应章节 | 内容概要 |
|---|------|---------|---------|
| 00 | [背景与目标](00-background-and-goals.md) | §0 | 问题陈述、设计目标、已确认产品决策、借鉴项目 |
| 01 | [整体分层架构](01-layered-architecture-overview.md) | §1 | Layer 0–6 分层架构总览图 |
| 02 | [核心类型与团队记忆层](02-core-types-and-memory.md) | §2.0–§2.2 | TypeScript 核心接口、L0/L1/L2 三层记忆存储、召回 Pipeline、衰减机制 |
| 03 | [动态上下文组装](03-dynamic-context-assembly.md) | §2.3 | CLAUDE.md vs 首次提示词区分、DynamicContextAssembler、Skill 路由 |
| 04 | [Meego 状态监听与意图识别](04-meego-and-intent.md) | §2.4–§2.5.1 | MeegoEventBus、三模式接入、IntentClassifier、RepoMapping、WorktreeManager |
| 05 | [Swarm 方案设计与执行](05-swarm-design.md) | §2.6 | Architect Agent、Worker Swarm、SubTask DAG、结果聚合 |
| 06 | [Sidecar 控制面与 Session 持久化](06-sidecar-and-session.md) | §2.7–§2.8 | 进程控制面、ProcessController、SubagentRegistry、Session Schema、Compaction |
| 07 | [通讯、可观测与关键数据流](07-communication-observability-dataflows.md) | §2.9, §3 | ObservableMessageBus、告警、核心主流程、Bot 决策流、Dashboard 架构 |
| 08 | [技术选型与参考代码](08-tech-stack-and-references.md) | §4–§5 | 技术栈表、全部配置文件清单、参考代码移植优先级 |
| 09 | [风险、实现路径与决策追溯](09-risks-roadmap-decisions.md) | §6–§8 | 工程/产品风险、部署架构、测试策略、系统生命周期、Phase 1–4 路线图、决策日志 |

## 模块依赖关系

```text
00 背景与目标
 └─► 01 分层架构总览
      ├─► 02 核心类型与记忆层 ─► 03 动态上下文组装
      ├─► 04 Meego 与意图识别 ─► 05 Swarm 方案设计
      ├─► 06 Sidecar 与 Session
      ├─► 07 通讯与数据流
      └─► 08 技术选型
           └─► 09 风险与路径
```

## 阅读建议

- **快速了解项目**：从 `00` → `01` 开始，掌握背景和整体架构
- **开发某个模块**：直接跳到对应编号的文档
- **查看技术决策**：`00`（产品决策）+ `09`（补充决策 + 版本历史）
- **部署与运维**：`09` 中的 §6.3 部署架构 + §6.5 系统生命周期

## 快速导航

| 常见问题 | 推荐文档 |
|---------|---------|
| 系统怎么启动/关闭？ | [09 风险、实现路径与决策追溯](09-risks-roadmap-decisions.md) |
| Claude Code 实例怎么管理？ | [06 Sidecar 控制面与 Session 持久化](06-sidecar-and-session.md) |
| 记忆怎么存储和召回？ | [02 核心类型与团队记忆层](02-core-types-and-memory.md) |
| Meego 事件怎么处理？ | [04 Meego 状态监听与意图识别](04-meego-and-intent.md) |
| 方案怎么生成？ | [05 Swarm 方案设计与执行](05-swarm-design.md) |
| 用了什么技术栈？ | [08 技术选型与参考代码](08-tech-stack-and-references.md) |

## 术语表（Glossary）

| 术语 | 说明 |
|------|------|
| **Meego** | 字节跳动项目管理工具（类似 Jira），用于需求/任务全生命周期管理 |
| **飞书 / Lark** | 字节跳动企业协作平台（IM + 文档 + 日历等） |
| **lark-cli** | 飞书官方命令行工具，支持 200+ 命令，AI-friendly 输出格式 |
| **FTS5** | SQLite Full-Text Search 5 扩展，用于全文索引和 BM25 检索 |
| **WAL** | Write-Ahead Logging，SQLite 日志模式，支持并发读写 |
| **L0 / L1 / L2** | 记忆三层模型：L0 摘要（≤50字/topic）、L1 概览（~500字）、L2 全文（无限制） |
| **Sidecar** | 控制面进程，管理 Claude Code 实例的 spawn/kill/health-check |
| **Swarm** | 多 Agent 并行协作模式：Architect Agent 分发任务给 Worker Agents |
| **ExtractLoop** | 从 OpenViking 移植的 ReAct 记忆提取循环（最多 3 轮 tool-use 迭代） |
| **hotnessScore** | 记忆衰减评分函数（shifted sigmoid），用于按时效性排序记忆条目 |
| **Compaction** | Session token 数超阈值时的上下文压缩机制，生成摘要后开启新 session |
| **CLAUDE.md** | Claude Code 工作目录中的团队规范文件，相对稳定，不随每次任务重建 |
| **sqlite-vec** | SQLite 向量相似度搜索扩展，用于记忆层语义检索（替代独立向量数据库） |
| **stream-json** | Claude Code 的结构化 NDJSON 输入/输出协议，用于编程式进程管理 |
| **Qwen3-Embedding** | Qwen3-Embedding-0.6B (GGUF Q8_0)，本地 embedding 模型，中英混合支持 |
