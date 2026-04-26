# Teamsland Primitive-First 重设计 — 05 Worker、模块拆分与迁移

## Worker 架构

### 定位

Worker 是纯执行者——接收 Coordinator 指令，在隔离环境中完成任务，向 Coordinator 汇报结果。Worker 不做"该不该做"的决策，只做"怎么做"的决策。

### 生命周期

```
Coordinator: teamsland worker spawn --repo <path> --role <role> --prompt <指令>
    ↓
Server:
  1. 创建 Git Worktree
  2. 注入 CLAUDE.md（任务上下文 + 工作约束）
  3. 注入 Worker Skills（lark-reply, meego-update, teamsland-report）
  4. 按 role 注入额外 Skills
  5. 启动 Claude Code CLI 进程
    ↓
Worker 执行:
  - 使用内置工具（Read/Edit/Bash/...）完成研发任务
  - 通过 Skills 与外部系统交互
  - 通过 teamsland report 汇报进度/结果/阻塞
    ↓
Worker 结束 → TeamEvent 回流 → Coordinator 决策后续
```

### Worker 角色（Role）

Coordinator 自主选择角色，角色决定注入哪些额外 Skills 和 Prompt 指引：

| Role | 额外 Skills | 用途 |
|------|------------|------|
| `general` | 无额外 | 通用任务 |
| `coder` | git-operate | 写代码、修 bug |
| `reviewer` | git-operate | 代码 review |
| `researcher` | memory-manage | 调研、信息收集 |
| `planner` | meego-operate | 技术方案、任务拆解 |

角色不是硬编码的——对应 `config/worker-roles/` 目录下的配置文件：

```
config/worker-roles/
├── general.md
├── coder.md
├── reviewer.md
├── researcher.md
└── planner.md
```

Coordinator 也可以不指定预定义 role，直接通过 `--prompt` 给完整指令。

### Worker 汇报

统一通过 `teamsland report` CLI：

```bash
teamsland report progress --text "已完成 API 接口开发，开始写测试"
teamsland report done --text "任务完成" --data '{"pr_url": "..."}'
teamsland report blocked --text "缺少 migration 权限"
```

Server 收到汇报后构建 TeamEvent 入队，Coordinator 消费后决策。

### Worker 不做的事

- 不自行 spawn 子 Worker（汇报给 Coordinator 拆分）
- 不自行决定通知谁（通过 report 汇报）
- 不读取队列或其他 Worker 状态（隔离性）
- 不创建或管理规则（Coordinator 专属）

### Worker Prompt 结构（两层）

1. **CLAUDE.md**：任务描述 + 工作约束（Coordinator spawn 时注入）
2. **Skills**：lark-reply, meego-update, teamsland-report + role 额外 skills

Worker 不需要 Workflow 层——它的"流程"就是 Coordinator 给的指令。

---

## 模块拆分

### 新包结构

```
packages/
├── types/              # 共享类型 — 增加 TeamEvent, RuleContext 定义
├── config/             # 配置加载 — 不变
├── observability/      # 日志 — 不变
│
├── queue/              # 持久化队列 — 增加 stats/inspect API
│
├── connector/          # 新包：事件源连接器
│   ├── connector.ts        # Connector 接口定义
│   ├── lark-connector.ts   # Lark（纯传输）
│   └── meego-connector.ts  # Meego（纯传输）
│
├── rule-engine/        # 新包：从 hooks 演化
│   ├── engine.ts           # 规则加载、匹配、执行
│   ├── rule-context.ts     # RuleContext 实现
│   └── hot-reload.ts       # fs.watch 热加载
│
├── lark/               # 保留 LarkCli/LarkNotifier
│                         去掉 connector（→ connector 包）
│
├── meego/              # 保留 MeegoClient
│                         去掉 connector（→ connector 包）
│                         去掉 confirmation（规则或 Coordinator）
│                         去掉 event-bus（connector 统一处理）
│
├── worker/             # 新包：从 sidecar 拆出
│   ├── process-controller.ts
│   ├── registry.ts
│   ├── lifecycle-monitor.ts    # 状态检测 → TeamEvent
│   ├── anomaly-detector.ts     # 异常检测 → TeamEvent
│   ├── interrupt-controller.ts # 中断 Worker
│   ├── resume-controller.ts    # 恢复 Worker
│   ├── observer-controller.ts  # 启动 Observer 诊断
│   ├── data-plane.ts           # NDJSON 流消费
│   ├── message-bus.ts          # 可观测消息总线
│   ├── transcript-reader.ts    # 会话记录读取
│   └── worktree.ts
│
├── context/            # 简化：Worker 上下文组装
│   ├── claude-md-injector.ts
│   ├── skill-injector.ts
│   └── role-resolver.ts        # 按 role 解析额外 skills
│
├── memory/             # 不变
│
├── cli/                # CLI 入口 — 扩展子命令
│   ├── index.ts
│   ├── commands/
│   │   ├── worker.ts
│   │   ├── lark.ts
│   │   ├── meego.ts
│   │   ├── memory.ts
│   │   ├── rule.ts
│   │   ├── queue.ts
│   │   ├── git.ts
│   │   └── report.ts
│   └── http-client.ts
│
├── git/                # 保留 + 增加 repo-manager
├── session/            # 不变（内部使用）
│
├── ingestion/          # 精简：去掉 IntentClassifier，保留 DocumentParser
│
├── swarm/              # 删除（deprecated）
├── hooks/              # 删除（→ rule-engine）
└── sidecar/            # 删除（→ worker/ + context/）
```

### apps/server 简化

```
apps/server/src/
├── main.ts                  # 启动流程（精简）
├── coordinator.ts           # 会话管理（简化）
├── coordinator-prompt.ts    # Prompt 构建（简化）
├── pipeline.ts              # 新：统一事件管道
├── routes/
│   ├── worker-routes.ts     # Worker REST API
│   ├── meego-routes.ts      # Meego REST API
│   ├── lark-routes.ts       # Lark REST API
│   ├── memory-routes.ts     # 保留
│   ├── queue-routes.ts      # 新：队列查询
│   ├── rule-routes.ts       # 新：规则管理
│   └── git-routes.ts        # 保留
└── dashboard.ts
```

### Sidecar 完整 export 迁移映射

| 现 sidecar export | 迁移到 | 说明 |
|---|---|---|
| `ProcessController` | `worker/` | Worker 进程管理 |
| `SubagentRegistry` | `worker/` | Worker 注册表 |
| `SidecarDataPlane` | `worker/` | NDJSON 流消费 |
| `ObservableMessageBus` | `worker/` | 内部消息总线 |
| `Alerter` | `worker/` | 告警（合并到 anomaly-detector） |
| `ClaudeMdInjector` | `context/` | CLAUDE.md 注入 |
| `SkillInjector` | `context/` | Skills 注入 |
| `TranscriptReader` | `worker/` | 会话记录读取 |
| `AnomalyDetector` | `worker/` | 异常检测 |
| `InterruptController` | `worker/` | 中断控制 |
| `ResumeController` | `worker/` | 恢复控制 |
| `ObserverController` | `worker/` | Observer 诊断 |
| `CapacityError` | `worker/` | 容量错误类型 |

### 包依赖方向

```
types/ ← config/ ← observability/
  ↑         ↑
  ├── queue/
  ├── connector/      → types/
  ├── rule-engine/    → types/
  ├── lark/           → types/, config/
  ├── meego/          → types/, config/
  ├── memory/         → types/, config/
  ├── context/        → types/, config/         （不依赖 worker/）
  ├── worker/         → types/, context/        （单向依赖 context/）
  ├── git/            → types/
  ├── cli/            → types/                  （HTTP 客户端，不依赖其他包）
  └── session/        → types/, config/
```

**关键约束**：`worker/` 单向依赖 `context/`（spawn 时需要 role-resolver + injector），`context/` 不依赖 `worker/`。

### 删除的文件

- `event-handlers.ts` — switch 路由 → pipeline.ts
- `diagnosis-handler.ts` — if/else 诊断 → Coordinator 自行处理
- `worker-handlers.ts` — 升级瀑布 → Worker 事件统一入队
- `coordinator-event-mapper.ts` — 类型映射/优先级 → Connector 产出 TeamEvent
- `coordinator-init.ts` — 简化合并到 coordinator.ts

### pipeline.ts 核心逻辑

```typescript
export function createPipeline(deps: PipelineDeps) {
  // Connector 事件 → 规则引擎 → 队列
  const onEvent = async (event: TeamEvent) => {
    try {
      const handled = await deps.ruleEngine.process(event);
      if (!handled) {
        await deps.queue.enqueue(event);
      }
    } catch (err) {
      // 规则执行异常 → fail-open，事件入队交给 Coordinator
      deps.logger.error({ err, eventId: event.id }, "规则引擎异常，事件 fail-open 入队");
      await deps.queue.enqueue(event);
    }
  };

  for (const connector of deps.connectors) {
    connector.onEvent = onEvent;
  }

  // 队列消费 → Coordinator（concurrency: 1，Coordinator 是单会话）
  deps.queue.consume(async (msg) => {
    try {
      await deps.coordinator.processEvent(msg.payload as TeamEvent);
      msg.ack();
    } catch (err) {
      deps.logger.error({ err, msgId: msg.id }, "Coordinator 处理异常，消息 nack");
      msg.nack();  // 重回队列，由 PersistentQueue 的 retry/dead-letter 机制处理
    }
  }, { concurrency: 1 });
}
```

---

## 迁移策略

### Phase 1：基础管道

- 实现 TeamEvent 类型定义
- 重写 LarkConnector 和 MeegoConnector 为纯传输
- 实现 rule-engine 包（从 hooks 演化，初始无规则）
- 实现 pipeline.ts
- 保留 legacy event-handlers 作为 fallback（通过 feature flag 切换）

**退出标准**：100% 的 Lark/Meego 事件成功产出 TeamEvent；新管道与 legacy 并行运行 48h 无错误；legacy fallback 处理 0 条事件。

### Phase 2：Primitives

- 实现完整 CLI 子命令（worker, lark, meego, memory, rule, queue, git, report, health）
- 实现对应的 server routes
- 编写所有 Skill 文档

**退出标准**：所有 CLI 子命令通过集成测试；Coordinator 可通过 CLI 完成完整的事件处理流程（spawn worker → 接收结果 → 通知用户）。

### Phase 3：Coordinator 切换

- 编写新的三层 Prompt（CLAUDE.md + Skills + Workflows）
- 编写 Worker role 配置文件
- 切换 Coordinator 到新管道
- 验证稳定后删除 legacy 代码

**退出标准**：Coordinator 使用新管道处理 100+ 事件无异常；Worker spawn/完成/异常全流程验证通过；手动测试主要场景（Meego 工单处理、Lark 消息响应、Worker 异常恢复）。
**回滚**：Phase 1 的 feature flag 在整个 Phase 3 期间保持可用。切换失败时翻转 flag 回退到 legacy 路径。

### Phase 4：清理

- 拆分 sidecar → worker/ + context/
- 删除 swarm/、hooks/ 包
- 删除 IntentClassifier
- 删除 event-handlers.ts、diagnosis-handler.ts 等废弃文件
- 清理 meego 包（移除 connector、confirmation、event-bus）

**退出标准**：所有测试通过；typecheck 通过；无 dead import 或 dead code。

---

## 不在本设计范围内

- Dashboard 前端适配
- LLM 模型选择和成本优化
- 多租户 / 多团队
- 高可用和水平扩展
