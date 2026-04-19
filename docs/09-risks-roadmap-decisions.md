# 风险、实现路径与决策追溯（Risks, Roadmap & Decisions）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§6–§8

> **TL;DR**
> - 识别工程风险（Memory 并发写冲突、spawn 开销、Webhook 抖动）和产品风险（敏感信息泄露、状态误扭转），均有对应缓解措施
> - 单机部署基于 Docker Compose，暴露 3 个端口（Webhook 8080、Dashboard 3000、Jaeger 16686）
> - 测试策略覆盖单元测试、集成测试和端到端冒烟测试，系统生命周期入口为 main.ts
> - 分 4 阶段实施路线图：P1 记忆层+Sidecar → P2 Meego+意图 → P3 Swarm+方案 → P4 Dashboard
> - 附决策追溯日志，记录关键技术选型的理由和替代方案对比

---

## 风险与挑战

### 工程风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 多 Agent 并发写 Memory 冲突 | 记忆数据不一致 | SQLite WAL 序列化写；Worker 禁止直接写团队记忆，只能通过 Orchestrator |
| Claude Code 实例 spawn 开销高 | Swarm 性能差 | Session 复用（parent_session_id 模式）；同类任务复用实例 |
| Meego Webhook 状态抖动 | 重复触发 Pipeline | 事件去重（issue_id + 30s 防抖） + 幂等 event_id |
| 记忆召回噪音 | Agent 决策错误 | L0 摘要质量控制；引入 MUST PRESERVE 清单；定期人工审核 L1 |
| lark-cli 权限范围 | 找人/发消息越权 | 配置独立 App Token，最小权限原则；涉及个人数据查询前二次确认 |

### 产品风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 记忆中含敏感信息（薪资/职级） | 隐私泄露 | Memory 写入时 LLM 提取阶段跳过敏感字段（`ExtractLoop` prompt 中明确禁止写入）；Memory 访问需 team_id 鉴权 |
| Agent 自动扭转 Meego 状态出错 | 需求流程混乱 | 状态扭转设为"需人工确认"模式（Phase 1），跑稳后再开放自动 |
| 多 Agent 结果不一致 | 方案质量差 | Orchestrator 保留合并决策权；引入 review Agent 做二次审核 |

### 部署架构

**单机部署拓扑（Docker Compose）**：

```yaml
# docker-compose.yml
services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports: ["16686:16686", "4318:4318"]  # UI + OTLP HTTP

  # team-ai 主进程运行在宿主机（需要 git worktree）
  # 通过 systemd unit 管理
```

**端口清单**：

| 服务 | 端口 | 用途 |
|------|------|------|
| Meego Webhook | 8080 | 接收 Meego 事件推送 |
| Dashboard | 3000 | Web UI + WebSocket |
| Jaeger UI | 16686 | 链路追踪可视化 |
| OTLP Collector | 4318 | OpenTelemetry 数据接收 |

**Secrets 管理**：

```bash
# .env（不入 Git，通过 .gitignore 排除）
LARK_APP_ID=cli_xxx
LARK_APP_SECRET=xxx
MEEGO_PLUGIN_TOKEN=xxx
```

**磁盘容量规划**：

| 资源 | 估算 | 说明 |
|------|------|------|
| SQLite WAL | ~100MB/万条消息 | 定期 compaction 后归档 |
| Git worktree | ~500MB/个 | 取决于仓库大小 |
| Agent 输出日志 | ~10MB/session (.jsonl) | 随 worktree 7 天后清理 |
| sqlite-vec 向量 | ~200MB/10万×512维 | 嵌入同一 SQLite 文件 |
| GGUF 模型缓存 | ~630MB | Qwen3-Embedding-0.6B 模型文件 |

### 测试策略（Testing Strategy）

**分层测试金字塔**：

| 层级 | 范围 | 工具 | 覆盖目标 |
|------|------|------|----------|
| 单元测试 | 纯函数 / 工具函数 | `bun:test` | `hotnessScore`、`entityMerge`、SHA256 去重、URI 模板生成 |
| 集成测试 | 模块间交互 | `bun:test` + Testcontainers | ExtractLoop → TeamMemoryStore → sqlite-vec 写入/召回链路 |
| 端到端测试 | 完整 Pipeline | 自定义测试框架 | Meego 事件 → 意图识别 → 方案生成 → 飞书推送 |
| 混沌测试 | 容错能力 | 手动脚本 | Sidecar 崩溃恢复、进程异常退出恢复 |
| 负载测试 | 并发上限 | k6 / autocannon | 20 并发 Claude Code 实例同时运行，SQLite WAL 写入吞吐，20 并发 WebSocket 连接 |

**关键测试场景**：

```text
1. 记忆层回归测试（每次部署前执行）
   ├── 写入 50 条历史 PRD 语料
   ├── 执行 20 条自然语言查询
   ├── 断言 P@10 ≥ 0.8（召回精度）
   └── 断言 hotnessScore 排序正确（新文档 > 旧文档，高访问 > 低访问）

2. Sidecar 崩溃恢复测试
   ├── 启动 3 个 Claude Code 实例
   ├── 强制 kill 主进程（模拟崩溃）
   ├── 重启 → 断言 60s 内所有实例恢复或重提交
   └── 验证 registry.json 一致性

3. 并发写入压测
   ├── 10 个 Agent 同时写 SessionDB
   ├── 验证无 SQLITE_BUSY 错误（jitter 机制有效）
   └── 验证消息顺序正确（按 created_at 排序）

4. Dashboard WebSocket 压测
   ├── 20 个并发 WebSocket 连接
   ├── 每个连接持续 10 分钟
   └── 断言内存无泄漏、连接无丢失
```

```yaml
# config/test.yaml
test:
  memory_corpus_path: "test/fixtures/corpus/"    # 50 条测试语料
  memory_queries_path: "test/fixtures/queries/"  # 20 条测试查询 + 期望结果
  precision_threshold: 0.8                       # P@10 最低阈值
  sidecar_recovery_timeout_ms: 60000             # 崩溃恢复超时
  concurrent_write_agents: 10                    # 并发写入 Agent 数
```

### 系统生命周期（System Lifecycle）

**启动顺序（`src/main.ts`）**：

```typescript
// src/main.ts
import { SubagentRegistry } from "./sidecar/subagent-registry.js";
import { MeegoConnector } from "./meego/connector.js";
import { TeamMemoryStore } from "./memory/team-memory-store.js";
import { SessionDB } from "./session/session-db.js";
import { ObservableMessageBus } from "./observability/observable-message-bus.js";

const controller = new AbortController();

async function main() {
  // 1. 基础设施健康检查
  const memoryStore = new TeamMemoryStore(TEAM_ID, BASE_PATH);
  const sessionDb = new SessionDB(DB_PATH);

  // 2. 恢复运行中的 Agent
  const registry = new SubagentRegistry(processController, memoryStore);
  await registry.restoreOnStartup();

  // 3. 启动事件源
  const meego = new MeegoConnector(registry, memoryStore);
  meego.start(meegoConfig, controller.signal);

  // 4. 启动 Dashboard
  const dashboard = Bun.serve({
    port: dashboardConfig.port,
    fetch: dashboardHandler,
  });

  // 5. 启动定时任务
  startWorktreeReaper(registry, 86_400_000);  // 每 24h 检查过期 worktree
  startMemoryReaper(memoryStore, 86_400_000); // 每 24h 清理低分记忆
  startSeenEventsSweep(meego.bus, 3_600_000);  // 每 1h 清理过期去重记录
  startFts5Optimize(memoryStore, 86_400_000);  // 每 24h 执行 FTS5 OPTIMIZE

  console.log("[main] system started");
}

// 优雅关闭
process.on("SIGTERM", async () => {
  console.log("[main] SIGTERM received, shutting down...");
  controller.abort();                          // 停止接收新事件
  await registry.persist();                    // 持久化注册表
  sessionDb.close();                           // 刷新 SQLite WAL
  // 注意：worktree 保留供 hotfix 复用
  console.log("[main] shutdown complete");
  process.exit(0);
});

main().catch((err) => {
  console.error("[main] fatal error:", err);
  process.exit(1);
});
```

```typescript
// FTS5 定期 OPTIMIZE（减少索引碎片，配置见 config/storage.yaml）
// 注意：memory_fts 表在 TeamMemoryStore 的 SQLite 中，不在 SessionDB 中
function startFts5Optimize(store: TeamMemoryStore, intervalMs: number) {
  setInterval(() => {
    try {
      store.optimizeFts5(); // 内部执行 INSERT INTO memory_fts(memory_fts) VALUES('optimize')
      console.log("[fts5] OPTIMIZE completed");
    } catch (err) {
      console.error("[fts5] OPTIMIZE failed:", err);
    }
  }, intervalMs);
}
```

**关键设计决策**：
- `SIGTERM` 时保留 worktree（供 hotfix 复用）
- `AbortSignal` 传递给所有长连接（MeegoConnector、LongConnection）
- 启动顺序保证依赖关系：SQLite → Memory → Registry → EventSource → Dashboard

---

## MVP 实现路径

### Phase 1 — 记忆层（Week 1-3）

**目标**：能写入、能召回，记忆质量可验证

```text
Week 1: 搭建基础存储
  ├── 配置 sqlite-vec 扩展 + Qwen3-Embedding-0.6B 本地模型
  ├── 移植 hermes_state.py → src/session/session-db.ts（bun:sqlite，加 teamId/projectId）
  ├── 实现 TeamMemoryStore（sqlite-vec + 本地FS 适配器，TypeScript 接口）
  └── 实现 L2 Raw Corpus append-only 写入

Week 2: OpenViking 记忆提取移植
  ├── 移植 ExtractLoop + MemoryUpdater → TypeScript（src/memory/）
  ├── RequestContext 增加 teamId，URI 模板改为 team/{teamId}/...
  ├── 配置 10+2 类记忆 YAML Schema
  └── 验证 L0/L1 自动更新

Week 3: 召回 + 动态上下文组装测试
  ├── 接入 FTS5 (bun:sqlite) + sqlite-vec 混合召回 + hotnessScore 重排
  ├── 集成 entityMerge 逻辑（移植自 mem0）
  ├── 实现 DynamicContextAssembler.buildInitialPrompt()
  └── 手动写入50条语料，召回精度验证（目标 P@10 ≥ 0.8）
```

**验收标准**：写入一批历史 PRD，能通过自然语言查询准确召回相关决策和人员信息。

### Phase 2 — Meego + 意图识别（Week 4-5）

**目标**：PRD 进来 → 飞书推送出去

```text
Week 4: Meego 接入
  ├── 实现 MeegoEventBus（Webhook 接收 + 去重 + 路由）
  ├── issue.created → WriteRawCorpus pipeline
  └── 基础意图识别（PRD/技术方案/设计稿 三类）

Week 5: 关联人/群发现
  ├── 封装 lark-cli TypeScript wrapper（Bun.spawnSync 调用）
  ├── 实体提取 → lark-cli contact/group search
  └── 端到端测试：一条 Meego PRD → 飞书群推送
```

**验收标准**：Meego 新建需求后，5分钟内在正确的飞书群收到摘要推送，人员识别准确率 ≥ 70%。

### Phase 3 — Sidecar + Session（Week 6-8）

**目标**：Agent 执行稳定，崩溃可恢复

```text
Week 6: Sidecar 基础
  ├── SubagentRegistry（spawn/kill/health-check）
  ├── Claude Code stream-json 事件处理
  └── Bun.spawn + stream-json stdin/stdout 通信

Week 7: 持久化
  ├── SessionDB 完整实现（含 compaction）
  ├── orphan 恢复机制测试（手动 kill Sidecar 验证）
  └── Session 链（parent_session_id）压缩测试

Week 8: 稳定性测试
  ├── 模拟 Sidecar 崩溃 → 恢复验证
  ├── 并发写 SQLite WAL jitter 压测
  └── 接入 OpenTelemetry 基础指标
```

**验收标准**：Sidecar 进程崩溃重启后，所有 running 状态的 Agent 能在60秒内完成恢复或重提交。

### Phase 4 — Swarm + 可观测 + Dashboard（Week 9-10）

**目标**：多 Agent 协同，链路可见，Dashboard 可交互

```text
Week 9: Swarm
  ├── TaskPlanner（SubTask DAG 分解）
  ├── Orchestrator → Worker 分发（delegate 模式）
  └── Promise.allSettled 并发执行 + 超时控制（setTimeout 300s）

Week 10: 可观测 + Dashboard
  ├── ObservableMessageBus（trace_id 注入）
  ├── Jaeger 部署 + OpenTelemetry 完整接入
  ├── 告警规则配置 + 端到端链路测试
  └── Dashboard Web UI（rspack + swc + React + shadcn/ui + TailwindCSS）
      ├── Agent 列表面板（状态/任务/实例数）
      ├── WebSocket 实时推送 + React 结构化事件渲染
      └── OTel Trace 视图嵌入
```

**验收标准**：一个复杂需求被3个 Worker 并行处理，Jaeger 能看到完整的调用树，Dashboard 可实时查看 stream-json 事件流，p99 总耗时 < 5分钟。

---

## 决策追溯（Decision Log）

> 所有开放问题已在 [§0.3 已确认的产品决策](00-background-and-goals.md) 中关闭并归档。以下仅记录 [§0.3](00-background-and-goals.md) 未覆盖的补充结论。

| 补充决策 | 结论 |
|----------|------|
| stream-json 版本兼容 | Breaking change 不兼容，Sidecar 跟版升级 |
| 部署规模 | 单机单团队，多团队独立部署一套 |
| Skills 发布机制 | 以 Claude Code 现有 Skill 机制为准 |
| Meego OpenAPI 接入 | Base: `https://project.feishu.cn`；Auth: `plugin_access_token` header；Issue query/state_change/node operate/abort 四类核心接口 |
| sqlite-vec 替代 Qdrant | 单机场景 <100K 向量，sqlite-vec 暴力搜索 20-50ms 足够；消除 Docker 依赖、端口、circuit breaker |
| Bun.spawn 替代 tmux | multica 已验证 Bun.spawn + stream-json 模式；去除 tmux 中间层，消除 SPOF + 简化数据通路 |
| Qwen3-Embedding-0.6B | bge-small-zh-v1.5 中英混合精度差；Qwen3 多语言支持好，32K context，C-MTEB 高 ~10 分 |
| Session 续接替代 revision pipeline | 方案修订本质是对话，不应建 pipeline 状态机；multica PriorSessionID 模式已验证 |
| event_id 持久化去重 | poll+webhook "both" 模式提供 crash recovery；event_id 去重修复 30s 窗口不足的 gap |

---

<details>
<summary>版本历史（点击展开）</summary>

| 版本 | 主要变更 |
|------|----------|
| v0.9 | Meego OpenAPI 规格；team_id 扩展字段；Dashboard 前端技术栈；Session 压缩独立执行；ExtractLoop 最终一致性 |
| v0.8 | 全量改写为 TypeScript + Bun runtime；Biome 替换 ESLint+Prettier；所有代码示例移植 |
| v0.7 | CLAUDE.md 稳定 vs 首次提示词动态区分；tmux session 7 天保留；Session 崩溃三级 fallback |
| v0.6 | 记忆层确认 OpenViking；新增动态上下文组装；整合 multica 设计点 |
| v0.5 | 关闭所有开放问题；Meego 三模式接入；单机单团队部署 |
| v0.4 | 录入已确认产品决策（Skills、Architect Agent、记忆衰减等） |
| v0.3 | tmux 控制面方案；openclaw/hermes-agent 并发与打断源码核实 |
| v0.1-v0.2 | 六个项目源码深度研究（openclaw/hermes-agent/OpenViking/mem0/cognee/lark-cli） |
| **v1.0-rc** | **评审修订：修复 11 项 P0 问题；新增核心类型定义、部署架构、测试策略、Dashboard 认证；精简决策追溯** |
| **v1.0** | **最终评审：修复 5 项 medium 遗留项（processLog 自动重启、hotnessScore sigmoid 偏移、告警推送、日志轮转、FTS5 OPTIMIZE）；全部评审项关闭** |
| **v1.0.1** | **验证修订：修复 hotnessScore 注释数学错误、FTS5 OPTIMIZE 数据库对象错误、processLog 重试计数器逻辑缺陷、AgentRecord/TaskConfig 缺失字段、MeegoConnector 签名不匹配、非法 Bun API 调用；修正 §6 子节编号和 heading 层级** |
| **v2.0** | **架构精简：sqlite-vec 替代 Qdrant（零额外进程）；Bun.spawn + stream-json 替代 tmux（消除 SPOF）；Qwen3-Embedding-0.6B 本地推理；event_id 持久化去重；Session 续接替代 revision pipeline；WebSocket Dashboard 替代 wterm** |

</details>

> **相关文档**：技术选型与参考代码见 [08-技术选型与参考代码](08-tech-stack-and-references.md)；背景与目标（含已确认的产品决策）见 [00-背景与目标](00-background-and-goals.md)。

---
[← 上一篇: 技术选型与参考代码](08-tech-stack-and-references.md) | [目录](README.md)
