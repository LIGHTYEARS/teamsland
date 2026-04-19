# 背景与目标（Background & Goals）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§0
>
> 整体分层架构请参阅 [01-整体分层架构](01-layered-architecture-overview.md)。

> **TL;DR**
> - 当前 AI 辅助停留在"单人单会话"模式，缺乏团队记忆共享和跨 session 状态持久化
> - 提出 6 大设计目标：飞书 Bot 感知、Meego 全生命周期监听、技术方案自动生成、Claude Code 自动实现、Dashboard、工程可靠性
> - 记录 28+ 项已确认的产品决策，涵盖记忆层级、确认流程、Agent 角色分配等
> - 参考 7 个开源项目（OpenViking Memory、hermes-agent、multica 等）的设计经验

---

## 问题陈述

当前研发团队的 AI 辅助仍停留在"单人单会话"模式：每个工程师各自与 AI 交互，上下文孤立、团队记忆不共享、任务执行不透明。复杂需求（PRD → 技术方案 → 代码实现 → 飞书推送）需要多次手动衔接，没有跨 session 的状态持久化，也没有 Agent 协作的基础设施。

**具体场景**（开放平台前端团队）：
- 飞书群「开放平台前端」有机器人在群，@机器人时需要读取群消息上下文后再决策
- 需求维护在**多个 Meego 空间**下，需要全生命周期监听（文档变更、节点状态变化等）
- 进入前端开发节点时，需确定目标仓库（团队有多个仓库对应不同项目），生成前端技术方案
- 技术方案模板可配置，完成后私聊确认，用户确认后自动开 worktree 并 spawn Claude Code 实现
- 需要 Dashboard 实时观测所有在运行的 Claude Code 实例，WebSocket 展示结构化事件流

## 设计目标

1. **飞书群 Bot 感知**：@提及时读取可配置数量的历史上下文，理解意图后决策和回复 — 详见 [§2.5 意图识别](04-meego-and-intent.md)
2. **Meego 全生命周期监听**：多空间 Webhook 监听，响应行为为可插拔扩展点 — 详见 [§2.4 Meego 状态监听](04-meego-and-intent.md)
3. **前端技术方案自动生成**：进入开发节点 → 确定仓库 → Swarm 生成方案 → 私聊确认 — 详见 [§2.6 Swarm 设计](05-swarm-design.md)
4. **Claude Code 自动实现**：用户确认方案 → git worktree → Sidecar spawn Claude Code — 详见 [§2.7 Sidecar 控制面](06-sidecar-and-session.md)
5. **Dashboard**：可视化所有 Agent 实例，WebSocket 实时展示结构化事件流 — 详见 [§3 关键数据流](07-communication-observability-dataflows.md)
6. **工程可靠**：Session 持久化、Sidecar 容错、通讯可观测 — 详见 [§2.8 Session 持久化](06-sidecar-and-session.md)、[§2.9 通讯与可观测](07-communication-observability-dataflows.md)

## 已确认的产品决策

> 本节记录已通过确认的产品决策，不再作为 open question。
>
> 部分决策在其他文档中有详细设计：记忆层 → [02-核心类型与团队记忆层](02-core-types-and-memory.md)；动态上下文 → [03-动态上下文组装](03-dynamic-context-assembly.md)；Session 与 Sidecar → [06-Sidecar 与 Session](06-sidecar-and-session.md)；风险与路线图 → [09-风险与决策追溯](09-risks-roadmap-decisions.md)。

| 决策 | 结论 |
|------|------|
| **版本目标** | 直接交付功能完整的最终版本，不是 MVP 缩减版 |
| **Skills 扩展机制** | 所有开箱即用能力封装为 Claude Code Skill；Figma/设计稿读取等复杂能力通过独立 Skill 提供；Skills 是能力扩展核心方案 |
| **Meego 空间范围** | 多空间配置化，在配置文件中维护 space_id 列表 |
| **私聊未确认处理** | 隔 N 分钟提醒（默认 N=30，可配置），提醒 M 次后（默认 M=3，可配置）发超时告警告知即将关单，超时后自动关单 |
| **仓库映射** | 人工维护配置文件（Meego 项目 ID → Git 仓库路径），不自动推断 |
| **多仓库需求** | 一个需求涉及多个仓库时，合并输出一份技术方案 |
| **Dashboard 权限** | 所有团队成员均可查看和操作，无权限区分 |
| **技术方案模板** | 通过 Skill 提供，由 **Architect Agent** 专门负责出方案；模板来源为飞书文档链接或固定 Markdown 文件路径，在 Architect Agent 提示词中提供读取指引 |
| **Architect Agent** | 独立 Agent 角色，专责生成前端技术方案；模板通过 Skill 注入 |
| **记忆归属** | 全部为团队记忆，无个人记忆概念；记忆具有自动衰减机制（decay TTL 可配置） |
| **Session 压缩阈值** | 可配置（`session.compaction_token_threshold`），无硬编码 |
| **记忆层实现** | 直接使用 OpenViking Memory 模块（不另造轮子）；存储层编写 sqlite-vec + 本地 FS 适配器；团队化改造：`RequestContext` 增加 `team_id` 字段 + URI 模板隔离 |
| **动态上下文组装** | 系统发送给 Claude Code 的**首次提示词**支持动态组装（Meego issue 上下文 + Memory 召回 + Skill 列表）；`CLAUDE.md` 相对稳定，不每次重建 |
| **Figma Skill** | 后续独立安装，不是当前卡点；与其他 Skill 同等对待 |
| **worktree 保留** | 进程完成后 worktree 保留 **7 天**，供 hotfix 场景直接 cd 到 worktree 手动执行 claude |
| **Session 崩溃恢复** | 先尝试 `--resume session_id`；Resume 失败则读取 SQLite 完整历史记录，压缩为摘要后作为上下文注入新 session |
| **输出安全过滤** | 不需要，移除 `OutputRedactor` 设计 |
| **可观测** | OpenTelemetry 不对接外部系统，本地 Jaeger + 本地日志双轨；不需要外部 APM 对接 |
| **实现语言** | TypeScript + Bun runtime；Biome 作为 lint 和格式化工具（替代 ESLint + Prettier） |
| **Dashboard 前端** | rspack + swc + React + shadcn/ui + TailwindCSS |
| **Bun 版本** | 最新稳定版（不锁定版本号），保持与上游同步 |
| **最大并发 Agent 数** | 最多同时运行 **20** 个 Claude Code 实例（`MAX_CONCURRENT_SESSIONS = 20`），超限直接拒绝 spawn |
| **飞书权限** | 权限已提前申请完毕；保留 `app_id` / `app_secret` 配置项，供环境切换用 |
| **team_id 字段** | 一套系统对应一个团队，`team_id` 为保留扩展字段（不作多租户隔离，固定值即可） |
| **Session 压缩执行方式** | 压缩时启动一个**独立的 Claude Code session** 读取 SQLite 历史并生成摘要；而非由 Orchestrator 直接调 Claude API |
| **ExtractLoop 失败策略** | 失败时**静默跳过**，不阻断当前任务；下次摄入同一文档时重试（最终一致性） |
| **向量存储** | sqlite-vec 嵌入 SQLite，不引入独立向量数据库；200K 向量为性能红线 |
| **Embedding 模型** | Qwen3-Embedding-0.6B (GGUF Q8_0) 本地推理，不依赖外部 embedding API |
| **进程控制面** | Bun.spawn + stream-json 协议，不使用 tmux |
| **worktree 清理策略** | 7 天到期前先执行 `git status` 检查；有未提交变更则先 `git commit`，再 `git worktree remove` |

## 借鉴项目

| 项目 | 借鉴点 |
|---|---|
| **openclaw** | SubagentRegistry + Gateway Protocol（控制面/数据面分离）+ compaction 摘要机制 |
| **hermes-agent** | SQLite WAL Session DB + 父子 Session 链 + delegate 沙盒 |
| **OpenViking** | 直接复用 Memory 模块；12 类记忆 YAML Schema（含 soul/identity 扩展） + L0/L1/L2 三层存储 + `ExtractLoop` ReAct 提取 + `hotness_score()` 衰减 |
| **multica** | `ExecEnv` 任务隔离目录 + `InjectRuntimeConfig()` 动态 CLAUDE.md 生成 + `Backend` 接口抽象 + Session Resume 带优雅降级 + `redact.Text()` 输出安全过滤 + 协作式取消轮询 |
| **mem0** | 实体合并（cosine≥0.95）+ BM25+向量混合召回 |
| **cognee** | 知识图谱 triplet 检索 + 多策略 Retriever |
| **lark-cli** | 飞书全业务域 200+ 命令 + AI-friendly stdout/stderr 格式 |

---

[目录](./README.md) | [下一篇: 整体分层架构 →](01-layered-architecture-overview.md)
