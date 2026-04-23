# teamsland 技术方案交叉审阅报告

> 审阅日期: 2026-04-23
> 审阅范围: Phase 0 ~ Phase 7 共 7 份技术方案
> 参考文档: PRODUCT.md, claude-code-skills.md, hooks-guide.md, claude-code-directory.md, memory.md, best-practices.md

---

## 1. 接口一致性问题

### [Critical] Phase 2 API 端点与 Phase 1 定义不匹配

Phase 1 定义的 Server API 路由:

| 方法 | 路径 |
|------|------|
| `POST` | `/api/workers` |
| `GET` | `/api/workers` |
| `GET` | `/api/workers/:id` |
| `POST` | `/api/workers/:id/cancel` |
| `GET` | `/api/workers/:id/transcript` |

Phase 2 第 8.2 节引用的端点:

| 方法 | 路径 |
|------|------|
| `POST` | `/api/workers/spawn` |
| `GET` | `/api/workers` |
| `GET` | `/api/workers/:id` |
| `GET` | `/api/workers/:id/result` |
| `POST` | `/api/workers/:id/cancel` |

差异:
- Phase 1 创建 Worker 为 `POST /api/workers`; Phase 2 写成 `POST /api/workers/spawn`
- Phase 1 将 `result` 内嵌在 `GET /api/workers/:id` 的 `WorkerDetailResponse` 中; Phase 2 假设存在独立的 `GET /api/workers/:id/result` 端点
- Phase 2 遗漏了 `GET /api/workers/:id/transcript`

**建议**: 统一为 Phase 1 的路由定义。Phase 2 的 SKILL.md 和 Coordinator 代码中所有 API 调用需同步修正。

---

### [Critical] Phase 2 CLI 参数与 Phase 1 定义不匹配

Phase 1 定义的 `teamsland spawn` 参数:

```
--repo, --worktree, --task, --task-brief, --parent, --origin-chat, --origin-sender
```

Phase 2 SKILL.md (4.1 teamsland-spawn) 使用了:

```
--requester, --chat-id
```

Phase 1 中不存在 `--requester` 和 `--chat-id` 参数。Phase 1 的对应参数是 `--origin-sender` 和 `--origin-chat`。

**建议**: Phase 2 的所有 SKILL.md 示例和 Coordinator CLAUDE.md 中的 CLI 调用统一使用 Phase 1 定义的参数名。

---

### [Critical] Phase 4-5 使用了 Phase 1 未定义的 CLI 参数和 API 端点

Phase 4D 的 Spawn 完整流程使用了 `--task-type` 参数:

```bash
teamsland spawn --task "..." --task-type coding --requester "张三" --chat-id "oc_xxx"
```

Phase 1 的 CLI 参数设计中没有 `--task-type`、`--requester`、`--chat-id`。

Phase 4-5 (teamsland-report SKILL.md) 引用了:
- `POST /api/workers/:id/progress` -- Phase 1 未定义
- `POST /api/workers/:id/result` -- Phase 1 未定义 (Phase 1 的 result 是 GET 查询，不是 POST 上报)

Phase 5F 新增的 API 端点:
- `POST /api/workers/:id/interrupt`
- `POST /api/workers/:id/resume`
- `POST /api/workers/:id/observe`

这些在 Phase 1 中均无定义。

**建议**: 在 Phase 1 方案中增加"扩展预留"节，列出后续 Phase 会追加的端点和 CLI 参数，形成明确的接口演进路线图。或者在 Phase 4-5 方案中明确声明"本 Phase 需要扩展 Phase 1 的 API"。

---

### [Critical] Transcript 路径推算算法矛盾

Phase 1 (3.2 节 GET /api/workers/:id/transcript):
```typescript
const projectDir = worktreePath.replaceAll("/", "-").slice(1, 65);
```

Phase 4-5 (5A TranscriptReader):
```typescript
function projectHash(worktreePath: string): string {
  return createHash("sha256").update(worktreePath).digest("hex").slice(0, 16);
}
```

两种完全不同的算法。Phase 1 使用路径字符替换，Phase 5 使用 SHA-256 哈希。两者不可能产生相同的结果。

两份方案都承认算法未经验证，但互相没有对齐。

**建议**: 实施前必须通过实际 Claude Code session 验证真实的 project hash 算法，然后统一到一个正确的实现。建议在 Phase 1 实施时就完成验证，后续 Phase 直接引用。备选方案: 使用 `--output-file` 显式指定 transcript 路径，彻底规避推算问题。

---

### [Important] Phase 2 创建了重复的消息队列

Phase 0 创建了 `@teamsland/queue` 包中的 `PersistentQueue`，设计为所有事件的统一入口。

Phase 2 第 7.1 节创建了 `CoordinatorMessageQueue` -- 另一个基于 SQLite 的持久化优先级队列，存储在 `data/coordinator-queue.sqlite`。

两个队列功能高度重叠:
- 都是 SQLite WAL 模式
- 都支持优先级排序
- 都有 enqueue/dequeue/ack 语义
- 都有超时恢复

Phase 2 还创建了 `EventBusToQueueAdapter`，将 `MeegoEventBus` 的事件转换后投递到 `CoordinatorMessageQueue`。但 Phase 0 已经将 Connector 直接对接到 `PersistentQueue`，并且 `MeegoEventBus` 已标记为 deprecated。

这意味着事件流变成:
```
Connector → PersistentQueue (Phase 0)
                  ↓ (消费者处理)
MeegoEventBus (deprecated but still used by Phase 2)
                  ↓
EventBusToQueueAdapter (Phase 2)
                  ↓
CoordinatorMessageQueue (Phase 2)
                  ↓
CoordinatorSessionManager
```

这是不合理的三级转发。

**建议**: Phase 2 应直接消费 Phase 0 的 `PersistentQueue`，不创建第二个队列。`CoordinatorSessionManager` 通过 `PersistentQueue.consume()` 注册消费者回调，在回调中根据 `QueueMessageType` 转换为 `CoordinatorEvent` 并处理。如果需要额外的优先级语义，在 `PersistentQueue` 的消费者中实现，而不是引入第二层队列。

---

### [Important] Phase 6 Hooks 层集成方式与 Phase 0 架构冲突

Phase 6 第 4.2 节的集成方式:
```typescript
const originalHandle = eventBus.handle.bind(eventBus);
eventBus.handle = async (event: MeegoEvent) => {
  const consumed = await hookEngine.processEvent(event);
  if (consumed) return;
  await originalHandle(event);
};
```

问题: Phase 0 已经将 `MeegoEventBus` 标记为 deprecated，并用 `PersistentQueue` 替代。Phase 6 却 monkey-patch 了 `eventBus.handle()`，这依赖于 `MeegoEventBus` 仍然是事件的主通道。

**建议**: Phase 6 的 Hook Engine 应作为 `PersistentQueue` 消费者之前的拦截层:
```
Connector → HookEngine.processEvent(event)
              ├→ matched → handle() → done
              └→ no match → PersistentQueue.enqueue(event) → Coordinator
```
即 Hook Engine 在入队之前拦截，而不是在 MeegoEventBus 上打补丁。

---

### [Important] AgentStatus 和 AgentRecord 的跨 Phase 扩展缺乏协调

Phase 1 新增 `AgentRecord` 字段:
```
origin?, taskBrief?, parentAgentId?, result?, completedAt?
```

Phase 4-5 新增 `AgentRecord` 字段:
```
workerType?, observeTargetId?, predecessorId?, interruptReason?, taskPrompt?, progressReports?
```

Phase 4-5 新增 `AgentStatus` 值:
```
"interrupted", "observing"
```

但 Phase 1 定义的 `WorkerSummary` 和 `WorkerDetailResponse` 类型只包含 `"running" | "completed" | "failed"` 三种状态。Phase 4-5 扩展后，Phase 1 的 API 响应类型需要同步更新。

**建议**: 在 `packages/types/src/sidecar.ts` 中为 `AgentRecord` 和 `AgentStatus` 建立版本化扩展策略。所有 Phase 的 API 响应类型引用同一个 `AgentStatus` 类型，避免硬编码联合类型字面量。

---

### [Suggestion] Phase 2 遗漏了 Phase 0 的部分队列消息类型

Phase 0 的 `QueueMessageType` 包含:
```
meego_issue_status_changed, meego_sprint_started, diagnosis_ready
```

Phase 2 的 `CoordinatorEventType` 不包含:
```
meego_issue_status_changed, meego_sprint_started
```

Phase 2 新增了 Phase 0 未定义的:
```
worker_timeout, user_query
```

**建议**: 确保 Phase 2 的事件类型是 Phase 0 队列消息类型的超集（除了纯内部消息）。遗漏的 `meego_issue_status_changed` 和 `meego_sprint_started` 应在 Phase 2 中作为 low-priority 事件处理。

---

## 2. 依赖关系图

```
Phase 0: 清理 + 消息队列
  │  @teamsland/queue (PersistentQueue)
  │  deprecated: IntentClassifier, Swarm, MeegoEventBus
  │
  ├──> Phase 1: CLI + Server API
  │      @teamsland/cli, /api/workers 路由
  │      AgentRecord 扩展, Coordinator Skill
  │      │
  │      ├──> Phase 2: Coordinator 框架
  │      │      CoordinatorSessionManager
  │      │      CoordinatorMessageQueue (!!应改为复用 PersistentQueue)
  │      │      EventBusToQueueAdapter (!!应改为直接消费 PersistentQueue)
  │      │      CLAUDE.md + 4 Skills
  │      │      │
  │      │      └──> Phase 3: OpenViking 记忆层
  │      │             VikingMemoryClient
  │      │             替代 StubContextLoader
  │      │             知识导入管道
  │      │
  │      ├──> Phase 4-5: Skills + 观察者
  │      │      SkillInjector, ClaudeMdInjector
  │      │      TranscriptReader
  │      │      InterruptController, ResumeController
  │      │      AnomalyDetector
  │      │      扩展 /api/workers 端点
  │      │
  │      └──> Phase 6: Hooks + 自进化 (!!需修正集成方式)
  │             @teamsland/hooks (HookEngine)
  │             HookContext, HookMetrics
  │             self-evolve Skill
  │             5 preset hooks
  │
  └──> Phase 7: Dashboard 重建
         Claude Agent SDK 集成
         NormalizedMessage schema
         Session 发现 + 接管
         Worker 拓扑可视化
         独立于其他 Phase，但需要 SubagentRegistry 数据
```

**关键依赖路径**: Phase 0 → Phase 1 → Phase 2 → Phase 3 是严格串行的。Phase 4-5 和 Phase 6 可以在 Phase 2 之后并行开发。Phase 7 可以在 Phase 1 之后独立开始。

**环形依赖风险**: 无。但 Phase 2 和 Phase 6 对 `MeegoEventBus` 的依赖与 Phase 0 的 deprecation 计划矛盾，需修正。

---

## 3. 官方能力边界问题

### [Critical] `--input-format stream-json` 未在官方文档中记载

Phase 2 (9.5 节) 的 `spawnSession` 使用了:
```typescript
"--input-format", "stream-json",
```

审查了以下官方文档:
- `docs/best-practices.md`: 仅提及 `--output-format stream-json` 和 `--output-format json`，未提及 `--input-format`
- `docs/hooks-guide.md`: 无 `--input-format` 相关内容
- `docs/claude-code-directory.md`: 无 `--input-format` 相关内容

`--input-format stream-json` 可能是有效的 CLI 参数（teamsland 现有的 sidecar 代码中已在使用），但未在官方文档中找到说明。

**建议**: 通过 `claude --help` 实际验证此参数是否存在且行为符合预期。如果是非公开 API，需要评估版本升级后的兼容性风险。在 Phase 2 方案中标注此依赖。

---

### [Important] project hash 算法未公开文档化

`docs/claude-code-directory.md` 描述了 transcript 路径格式:
```
~/.claude/projects/<project>/<session>.jsonl
```

但 `<project>` 的计算方式未明确说明。文档仅提到 "path derived from git repository"。Phase 1 和 Phase 5 各自猜测了不同的算法，且均标注为"需要验证"。

**建议**: 这是一个阻塞性问题。建议在 Phase 1 实施的第一步就验证此算法。如果无法可靠推算，使用 ProcessController spawn 时通过 `--output-file` 或其他机制显式记录 transcript 路径。

---

### [Important] `bypassPermissions` 的启用条件

`docs/hooks-guide.md` 第 386 行明确说明:

> `bypassPermissions` only applies if the session was launched with bypass mode already available: `--dangerously-skip-permissions`, `--permission-mode bypassPermissions`, `--allow-dangerously-skip-permissions`, or `permissions.defaultMode: "bypassPermissions"` in settings, and not disabled by `permissions.disableBypassPermissionsMode`.

Phase 2 的设计是通过 `--permission-mode bypassPermissions` 启动参数传入，这是合规的。但需要确保:
1. 不存在 managed policy 中的 `permissions.disableBypassPermissionsMode: true` 设置
2. Coordinator 的 `settings.json` 中没有冲突的权限配置

Phase 2 的 `settings.json` 设计合理: 在 settings.json 中定义 allow/deny 列表作为安全兜底，同时通过启动参数传入 `bypassPermissions`。

**建议**: 在 Phase 2 方案的风险点中补充 managed policy 可能禁用 bypassPermissions 的场景。

---

### [Suggestion] Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) 的 API 稳定性

Phase 7 大量依赖 Claude Agent SDK 的 `query()` async generator API:
```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
```

这是 claudecodeui 使用的接口。SDK 版本为 `^0.2.116`。此 SDK 尚处于快速迭代中，API 可能不稳定。

**建议**: Phase 7 方案中已在风险点提及版本兼容性，建议进一步: (1) 锁定具体版本而非 caret range; (2) 在 SDK 调用处增加适配层，隔离 SDK API 变更对业务代码的影响。

---

## 4. 文件修改冲突列表

以下文件被多个 Phase 修改，实施时存在冲突风险:

| 文件路径 | 修改的 Phase | 冲突风险 |
|----------|-------------|---------|
| `apps/server/src/main.ts` | 0, 1, 2, 3, 4-5, 6 | **极高** -- 6 个 Phase 都修改此文件的初始化和注入逻辑 |
| `apps/server/src/event-handlers.ts` | 0, 6 | **高** -- Phase 0 重写为队列消费者, Phase 6 在同一位置插入 Hook 层 |
| `packages/types/src/sidecar.ts` | 1, 4-5 | **中** -- 两个 Phase 扩展 AgentRecord 的不同字段 |
| `packages/types/src/config.ts` | 0, 2, 3 | **中** -- 三个 Phase 各自添加配置类型 |
| `packages/config/src/schema.ts` | 0, 2, 3 | **中** -- 配置 schema 扩展 |
| `config/config.json` | 0, 2, 3, 4-5 | **中** -- 配置文件多次扩展 |
| `apps/server/src/dashboard.ts` | 1, 6, 7 | **中** -- Phase 1 添加 worker routes, Phase 6 添加 hook endpoints, Phase 7 大幅重建 |
| `packages/sidecar/src/process-controller.ts` | 1 | 低 |
| `packages/lark/src/connector.ts` | 0 | 低 |
| `packages/meego/src/connector.ts` | 0 | 低 |
| `packages/memory/src/*` | 3 | 低 |

**main.ts 冲突缓解建议**:

`main.ts` 是冲突最严重的文件。建议将初始化逻辑拆分为独立模块:
- `apps/server/src/init/queue.ts` -- Phase 0 队列初始化
- `apps/server/src/init/worker-api.ts` -- Phase 1 API 注入
- `apps/server/src/init/coordinator.ts` -- Phase 2 Coordinator 初始化
- `apps/server/src/init/openviking.ts` -- Phase 3 记忆层初始化
- `apps/server/src/init/hooks.ts` -- Phase 6 Hook Engine 初始化
- `main.ts` 只负责调用各初始化模块，按顺序组装

---

## 5. PRODUCT.md 功能覆盖检查

| PRODUCT.md 功能需求 | 覆盖 Phase | 覆盖完整度 | 备注 |
|---------------------|-----------|-----------|------|
| **大脑(Coordinator) + 手脚(Worker) 架构** | Phase 1 + 2 | 完整 | Phase 1 建立调度通道, Phase 2 实现决策框架 |
| **事件驱动的短 session** | Phase 0 + 2 | 完整 | Phase 0 建立队列, Phase 2 实现 session 管理 |
| **记忆外化 + 无状态 session** | Phase 3 | 完整 | OpenViking 覆盖三层记忆: 团队知识/任务状态/对话上下文 |
| **消息队列作为大脑入口** | Phase 0 | 完整 | PersistentQueue 实现 |
| **能力扩展用 Skills 不用 MCP** | Phase 1 + 4 | 完整 | Phase 1 定义 Coordinator Skill, Phase 4 定义 Worker Skills |
| **teamsland CLI 作为调度工具** | Phase 1 | 完整 | 6 个子命令覆盖完整生命周期 |
| **大脑的专属干净工作目录** | Phase 2 | 完整 | `~/.teamsland/coordinator/` 目录结构完整定义 |
| **Worker 在目标仓库 worktree 中运行** | Phase 1 + 4 | 完整 | Phase 1 WorktreeManager, Phase 4 SkillInjector |
| **Worker 观测: 进度/质量/诊断** | Phase 5 | 完整 | TranscriptReader + 观察者 Worker 模式 |
| **Worker 打断与恢复** | Phase 5 | 完整 | InterruptController + ResumeController |
| **三层处理架构 (Hooks/Skills/Deep)** | Phase 6 | 完整 | HookEngine + self-evolve Skill |
| **大脑自我进化** | Phase 6 | 完整 | self-evolve Skill + evolution-log |
| **OpenViking 记忆层** | Phase 3 | 完整 | VikingMemoryClient + URI 命名约定 + 知识导入管道 |
| **Dashboard: claudecodeui 整合** | Phase 7 | 完整 | 详细的搬运清单和转换策略 |
| **Dashboard: Session 接管** | Phase 7 | 完整 | Claude Agent SDK + resume 流程 |
| **Dashboard: Worker 拓扑视图** | Phase 7 | 完整 | TopologyGraph + CSS Grid 渲染 |
| **单机部署架构** | 全部 Phase | 完整 | 所有设计均基于单机假设 |
| **heredoc 传递提示词** | Phase 1 + 2 | 完整 | SKILL.md 和 CLAUDE.md 中反复强调 |

**覆盖率: 100%** -- PRODUCT.md 中定义的所有核心功能在 7 个 Phase 中均有对应的技术设计。

---

## 6. 总体评估

### 优点

1. **架构设计忠实于产品理念**: "大脑 + 手脚"的分离在所有 Phase 中得到一致体现, Coordinator 的职责收窄和 Worker 的隔离执行贯穿始终。

2. **渐进式实施策略合理**: Phase 0 清理遗留 → Phase 1 建立通道 → Phase 2 引入大脑 → Phase 3 增强记忆 → Phase 4-5 丰富能力 → Phase 6 降低成本 → Phase 7 升级 UI。每个 Phase 都保持系统可运行。

3. **降级策略充分**: Phase 3 的 `NullVikingMemoryClient`、Phase 2 的 `StubContextLoader`、Phase 0 的双写过渡期，都考虑了组件不可用时的降级路径。

4. **技术选型贴合约束**: 选择 SQLite WAL 而非 Redis 作为队列, 选择 Skills 而非 MCP 作为能力扩展, 选择 Bun 原生 API 而非第三方库, 都符合单机部署的约束。

5. **每个 Phase 都包含详细的验证方式和风险分析**, 这大幅降低了实施风险。

### 主要问题

1. **跨 Phase 接口协调不足** (Critical): Phase 2 与 Phase 1 的 API 端点/CLI 参数不一致; Phase 4-5 引用了 Phase 1 未定义的接口。这些问题如果在实施时才发现，会导致返工。

2. **重复基础设施** (Important): Phase 2 创建了第二个消息队列, 与 Phase 0 的 PersistentQueue 功能重叠, 且引入了不必要的 MeegoEventBus 依赖。

3. **Transcript 路径算法矛盾** (Critical): Phase 1 和 Phase 5 给出了两种不同的推算算法, 且都标注为"需验证"。这是一个需要在实施前解决的阻塞性问题。

4. **Phase 6 依赖已 deprecated 的组件** (Important): Hook Engine 集成方式依赖 `MeegoEventBus.handle()`, 但这在 Phase 0 中已被标记为 deprecated 并被 PersistentQueue 替代。

5. **main.ts 修改冲突** (Important): 6 个 Phase 都需要修改此文件, 如果不提前拆分初始化逻辑, 并行开发时将产生大量合并冲突。

---

## 7. 优先级修改建议

### P0 -- 实施前必须修复

| # | 问题 | 涉及 Phase | 修复方案 |
|---|------|-----------|---------|
| 1 | API 端点和 CLI 参数不一致 | 1, 2, 4-5 | 以 Phase 1 为基准统一。Phase 2 的 SKILL.md 改用 `--origin-sender`/`--origin-chat`; Phase 4-5 的 `--task-type` 加入 Phase 1 定义; Phase 4-5 新增端点在 Phase 1 中预留扩展点 |
| 2 | Transcript 路径算法矛盾 | 1, 4-5 | 在 Phase 1 实施第一步验证真实算法, 写入共享工具函数 `resolveTranscriptPath()`, 后续 Phase 统一引用 |
| 3 | Phase 2 重复队列 | 0, 2 | 删除 `CoordinatorMessageQueue`, 直接消费 Phase 0 的 `PersistentQueue`, 删除 `EventBusToQueueAdapter` |
| 4 | Phase 6 集成方式错误 | 0, 6 | Hook Engine 拦截点从 `eventBus.handle()` 改为 `PersistentQueue.enqueue()` 之前 |

### P1 -- 实施中应修复

| # | 问题 | 涉及 Phase | 修复方案 |
|---|------|-----------|---------|
| 5 | `--input-format stream-json` 未文档化 | 2 | 验证参数有效性; 在风险点中标注非公开 API 依赖 |
| 6 | main.ts 冲突风险 | 0-7 | 将 main.ts 初始化逻辑拆分为独立模块 |
| 7 | AgentStatus/AgentRecord 扩展缺乏协调 | 1, 4-5 | 在 Phase 1 中定义可扩展的 AgentStatus 类型, 避免硬编码联合字面量 |
| 8 | Phase 2 遗漏队列消息类型 | 0, 2 | Phase 2 的 CoordinatorEventType 补充 `meego_issue_status_changed` 和 `meego_sprint_started` |

### P2 -- 建议改进

| # | 问题 | 涉及 Phase | 修复方案 |
|---|------|-----------|---------|
| 9 | bypassPermissions managed policy 风险 | 2 | 在 Phase 2 风险点中补充说明 |
| 10 | Claude Agent SDK 版本锁定 | 7 | 使用精确版本号, 增加 SDK 适配层 |
| 11 | Phase 4-5 teamsland-report SKILL.md 端口硬编码 | 4-5 | `http://localhost:7860` 应改为环境变量 `${TEAMSLAND_SERVER_URL}` |

---

*本报告审阅了 7 份技术方案和 PRODUCT.md, 对照 5 份 Claude Code 官方文档进行了能力边界校验。所有 Critical 和 Important 级别的问题建议在对应 Phase 开始实施前修复。*
