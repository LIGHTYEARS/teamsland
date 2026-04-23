# teamsland 产品理解

## 定位

teamsland 是一个 **Claude Code agent 编排平台**，它的角色类似流浪地球中的 Moss —— 团队的 AI 大管家。它作为飞书群聊中的机器人存在，是团队的一份子，持续"听"群里的所有对话，理解上下文，主动或被动地帮团队完成任务。

## 核心能力定义

机器人需要具备的能力：
- 理解谁在说什么、说给谁
- 判断哪些消息需要介入，哪些只是闲聊
- 识别连续对话的关联性（"帮我改登录页" → 五分钟后 "再加个验证码" 是同一任务的延续）
- 同时跟踪多个人的多个任务进展

**关键设计原则：这些意图理解和上下文关联的能力，是 Claude 本身就擅长的，不应该用外部规则引擎（如 IntentClassifier）替它做决策。**

## 架构思路：大脑 + 手脚

### 大脑（Coordinator Agent）

事件驱动的短 session，负责"想"：
- 每条群聊消息触发一次推理（从外部存储加载记忆 → 推理 → 输出决策 → 写回状态）
- 自己判断：这条消息要不要处理、是新任务还是对已有任务的追加、应该怎么拆解
- 记忆不在 context window 里，而是外化到持久化存储中，每次按需加载
- **不自己执行耗时任务** —— 只负责对话理解和任务调度，所有需要超过几秒的工作都 spawn worker
- session 是无状态的、可抛弃的、可随时重建的

**spawn worker 的判断标准不是"是否涉及代码"，而是"是否耗时"。** 整理 OKR、写周报、查资料这些非编码任务同样需要 spawn worker，因为它们涉及多轮工具调用，可能耗时数分钟甚至更久。大脑永远保持轻量、快速响应。

大脑的职责严格收窄为：
1. 理解消息意图
2. 决策（回复 / spawn worker / 更新状态 / 忽略）
3. 跟踪 worker 状态
4. 转发 worker 结果给用户

### 手脚（Worker Agent Sessions）

按需 spawn 的独立 session + worktree，负责"做"：
- 大脑决定要执行某个具体任务时 spawn
- 通过 Skills 获得上下文和能力（见下方"能力扩展"章节）
- 干完活通过 Skills 提供的工具汇报结果
- 大脑收到结果后决定怎么回复群聊

### 这种分离的好处

- **上下文连续性由外部记忆维持** —— 不依赖 session 存活，记忆持久化在存储中
- **并发执行由 worker 隔离** —— 多个任务同时进行，互不干扰
- **意图理解是 Claude 自己做的** —— 不需要外部的 IntentClassifier
- **大脑的 context 不会被代码操作污染** —— 它只处理对话和决策，重活交给 worker
- **大脑可随时重建** —— 进程崩溃、部署更新都不影响，从存储恢复即可

## 常驻 session 的问题

大脑如果是一个常驻的 Claude Code session，长期运行会遇到根本性问题：

1. **记忆衰减** —— 压缩机制是有损的。周一说的需求细节，到周三可能已经被压缩成一句摘要。张三周四回来说"上次那个需求再改改"，大脑可能已经丢失了关键细节。
2. **压缩累积偏差** —— 每次压缩都是一次信息筛选，多轮压缩后保留的摘要可能偏离原始意图。像传话游戏，传多了就变味。
3. **成本持续膨胀** —— session 越老，每次调用的 token 开销越大。
4. **不可恢复性** —— 进程崩溃、服务器重启、部署更新，所有对话记忆都丢了。
5. **多群扩展不了** —— 每个群一个常驻 session，资源占用线性增长。

**核心矛盾：context window 是有限的，但团队对话是无限的。**

## 解法：记忆外化 + 无状态 session

### 设计原则

**session 是无状态的推理引擎，所有记忆都在外部持久化，每次推理时按需加载。**

session 挂了随时重建，靠外部记忆恢复到接近之前的状态。

### 记忆分层

大脑需要的记忆有三种不同的时效性：

**第一层：团队知识（几乎不变）**
- 团队成员信息、职责分工
- 项目架构、代码规范、技术栈
- 工作流程约定
- **载体：CLAUDE.md** —— 已有机制，天然解决。

**第二层：任务状态（天级变化）**
- 当前有哪些进行中的任务，谁发起的，进展如何
- 哪些 worker agent 在运行，关联哪个任务
- 任务之间的依赖关系
- **载体：任务状态数据库** —— 结构化存储，每次 session 启动时查询注入。

**第三层：对话上下文（分钟级变化）**
- 最近的群聊消息
- 谁在跟机器人对话，聊到哪了
- 哪些消息已处理，哪些待处理
- **载体：滑动窗口 + 向量检索**
  - 最近 N 条消息直接注入（短期记忆）
  - 更早的消息持久化，需要时通过向量检索召回（长期记忆）

### 大脑的运行模型

不再是"常驻 session"，而是 **事件驱动的短 session**：

```
新消息到达
  → 从存储加载：任务状态 + 最近对话窗口 + 相关历史记忆
  → 组装成 context，启动一次 Claude 推理
  → Claude 输出决策（回复消息 / spawn worker / 更新任务状态 / 什么都不做）
  → 把决策结果和新的状态写回存储
  → session 结束
```

每次推理都是"无状态"的 —— 但因为加载了充分的外部记忆，对 Claude 来说感觉像是连续的对话。

### 短 session 模式的取舍

丢失的东西：**Claude 自己在 context window 里积累的隐式理解**。经过几轮对话，Claude 对某个人的表达风格、对某个模块的理解会越来越深 —— 这种"渐入佳境"的感觉，每次重建 session 都会丢失。

折中方案：**短期内用同一个 session 处理连续对话（比如同一个人几分钟内的多条消息），但不依赖 session 长期存活。** session 是"可抛弃的"，随时能从外部记忆重建。

### 消息队列：大脑的入口

即使大脑只做秒级决策，LLM 推理本身也有延迟（几秒到十几秒）。一个 worker 任务可能耗时十几分钟甚至几小时。如果大脑正在推理时又有新消息到达，没有队列就会丢消息或并发冲突。

**所有 @机器人 的消息先进持久化队列，不直接触发 session：**

```
群聊消息 → 持久化消息队列 → 大脑按顺序消费 → 决策 → 写回状态 → 取下一条
```

队列的作用：
- **削峰** —— 消息密集到达时不丢失，排队等待处理
- **容错** —— 大脑 session 崩溃时队列里的消息不丢，重建后继续消费
- **解耦** —— 消息摄入（LarkConnector）和消息处理（大脑 session）完全解耦

这和"无状态 session + 外部记忆"的设计天然吻合 —— 队列是持久化的，session 是可抛弃的。

---

## 能力扩展：Skills 而非 MCP

> 官方文档：[docs/claude-code-skills.md](docs/claude-code-skills.md)

### MCP vs Skills

给 Claude Code agent 扩展能力有两种技术路径：

**MCP（Model Context Protocol）** 是协议级别的扩展 —— 需要启动独立的 stdio/HTTP server 进程，有序列化开销和生命周期管理的复杂度。本质上是"外挂一个服务"。

**Skills** 是 prompt 级别的扩展 —— 一个 `SKILL.md` 文件，描述能力和操作步骤。Claude Code 启动时自动发现，需要时自动加载到 context 中。不是调用外部服务，而是**教会 Claude 怎么做某件事**，Claude 用自己已有的工具（Bash、Read、Write 等）来执行。

### 为什么 teamsland 选择 Skills

- **零基础设施开销** —— 不需要启动额外进程，没有协议层
- **按需加载** —— skill body 只在使用时加载到 context，平时只有 description 在 context 中
- **自描述** —— Claude 根据 description 自动判断何时使用哪个 skill
- **可组合** —— skill 可以包含脚本、模板、参考文档，可以 `context: fork` 在子 agent 中隔离运行
- **天然适配** —— teamsland spawn 的就是 Claude Code agent，skills 是其原生能力扩展机制

### 实际应用

teamsland 给 agent 扩展 lark/meego 能力的方式是写 skills，而非 MCP server：
- 飞书消息操作 → skill（教会 agent 用 `lark-cli` 命令）
- Meego 工单查询 → skill（教会 agent 调用 Meego API）
- 文档读写 → skill（教会 agent 用 `lark-cli docs` 命令）

agent spawn 到 worktree 后，通过 `.claude/skills/` 目录里的 skill 文件自动获得这些能力。大脑（Coordinator）同样通过 skills 获得沟通和信息收集的能力。

---

## 大脑如何 spawn Worker：teamsland CLI

### 设计思路

大脑是一个 Claude Code session，它需要启动 worker 但不应该直接管理进程。解法是分两层：

- **teamsland server** —— 已有全部进程管理基础设施（ProcessController、SubagentRegistry、WorktreeManager），新增 HTTP API 暴露 spawn/status/cancel 等接口
- **`@teamsland/cli`** —— 新 package，封装 `teamsland` 命令行工具，调用 server API。类似 `lark-cli` 之于飞书

大脑通过 skill 学会使用 `teamsland` 命令，就像通过 skill 学会使用 `lark-cli` 一样。大脑输出的是**意图**（"我要 spawn 一个 worker"），CLI + server 是**执行层**。

### CLI 命令设计

```bash
teamsland spawn    # 创建 worker（server 负责 worktree、注入 skills、启动 claude 进程、注册）
teamsland status   # 查询 worker 状态
teamsland list     # 列出所有 worker
teamsland result   # 获取 worker 结果
teamsland cancel   # 取消 worker
```

### 大脑 spawn worker 的完整流程

```
大脑消费消息 "整理 OKR"
  → 决策：spawn worker
  → Bash: teamsland spawn --task "$(cat <<'EOF'
    整理本季度 OKR 进展：读取飞书文档，查询 Meego 工单完成率，汇总后回复群聊
    EOF
    )" --requester "张三" --chat-id "oc_xxx"
  → server 收到请求，创建 worktree，注入 skills，启动 claude 进程，注册到 registry
  → CLI 返回 worker-id
  → 大脑 session 结束

... worker 运行中 ...

worker 完成
  → server 监听到进程退出/流结束
  → 更新任务数据库：{ status: "completed", result: "..." }
  → 投递 "worker_completed" 消息到队列

大脑消费消息 "worker_completed"
  → Bash: teamsland result <worker-id>
  → 通过 skill 调用 lark-cli 回复张三的群聊
  → session 结束
```

### 关键技术细节：heredoc 传递提示词

CLI 传递提示词**必须使用 `'EOF'`（单引号 heredoc 标记）**。因为提示词内容不可控，可能包含 `$`、反引号、引号等特殊字符。单引号 heredoc 禁止 shell 对内容做任何变量展开和转义，确保原样传递。

```bash
# 正确：单引号 'EOF' —— shell 不对内容做任何解释
teamsland spawn --task "$(cat <<'EOF'
注意 $revenue 指标和 `conversion_rate` 字段
EOF
)"

# 错误：无引号 EOF —— $revenue 被展开，反引号被执行
teamsland spawn --task "$(cat <<EOF
注意 $revenue 指标和 `conversion_rate` 字段
EOF
)"
```

### 这种设计的好处

- **大脑不直接管进程** —— 只调 CLI 命令，spawn/监控/注册全由 server 处理
- **CLI 是标准 Unix 工具** —— Claude Code 天然擅长使用命令行，通过 skill 教它就行
- **server 保持中心控制** —— 所有 worker 生命周期统一管理，容量控制、健康检查都在 server 侧
- **可独立测试** —— CLI 作为独立 package，可以单独测试

---

## 大脑与 Worker 的工作环境

### 大脑：独立的干净目录

大脑**不运行在任何代码仓库中**。它的工作是理解对话和调度，不需要看到任何源代码。如果运行在 teamsland 项目目录下，框架代码、package.json、配置文件等都会成为干扰信息。

大脑有一个**专属的、干净的工作目录**，只放它需要的东西：

```
~/.teamsland/coordinator/
├── CLAUDE.md              # 团队知识：成员、项目、仓库列表、工作流程
└── .claude/
    └── skills/
        ├── teamsland-spawn/SKILL.md    # 教大脑怎么用 teamsland CLI 调度 worker
        ├── lark-message/SKILL.md       # 教大脑怎么回复群聊
        └── lark-docs/SKILL.md          # 教大脑怎么读飞书文档
```

没有 git 仓库、没有源代码、没有 node_modules。大脑看到的世界只有：
- CLAUDE.md 里的团队知识（谁是谁、有哪些项目、每个项目对应哪个仓库路径）
- Skills 里的工具使用指南
- Prompt 里的当前消息和加载的记忆

### Worker：目标仓库的 worktree

Worker 运行在**具体代码仓库的 worktree 中**。大脑 spawn 时通过 `--repo` 指定目标仓库，server 在该仓库中创建 worktree。

Worker 启动后自动获得：
- worktree 内的 `CLAUDE.md` → 项目编码规范、架构说明
- worktree 内的 `.claude/skills/` → lark-cli、meego 等工具能力
- 完整的 git 仓库上下文 → 读代码、写代码、跑测试

### 大脑怎么知道改哪个仓库

大脑本身不在任何仓库里工作，但它需要知道任务对应哪个仓库。信息来源：
1. **对话上下文** —— "帮我改 dashboard 的设置页"，大脑从团队知识中知道 dashboard 在哪个仓库
2. **Meego 工单关联** —— 工单属于哪个 project，project 对应哪个仓库（repoMapping）
3. **直接追问** —— 大脑不确定时可以回复群聊："你说的是哪个项目？"

### 从群聊到 Worker 写代码的完整链路

```
群聊对话（散落的需求讨论）
  → 大脑整合上下文，形成结构化任务 brief
  → teamsland spawn --repo "/path/to/frontend-repo" --task "$(cat <<'EOF'
    ## 任务
    实现用户头像上传功能
    ## 背景
    张三提出需求，参考 Notion 的头像交互，使用项目已有的 ImageCropper 组件
    ## 要求
    - 个人设置页新增头像上传区域
    - 支持裁剪和预览
    - 调用 POST /api/user/avatar 接口上传
    ## 完成后
    通过 lark-cli 回复群聊 oc_xxx 汇报结果
    EOF
    )"
  → server 在 frontend-repo 创建 worktree
  → server 启动 claude -p（worktree 内自动加载 CLAUDE.md + skills）
  → worker 读 CLAUDE.md 了解编码规范
  → worker 读 prompt 理解任务
  → worker 自主执行：读代码 → 理解现有结构 → 写代码 → 跑测试
  → worker 完成，通过 skill 调用 lark-cli 回复群聊
```

**大脑的核心价值：把模糊的群聊对话转化成清晰的任务 brief。** 它理解了对话全貌，把散落在多条消息里的信息整合成 worker 可以独立执行的完整指令。

---

## Worker 观测：进度、质量、问题诊断

> 参考文档：[docs/claude-code-directory.md](docs/claude-code-directory.md) — Claude Code 的 `.claude` 目录结构与数据持久化机制

### 观测手段：Session Transcript

Claude Code 会将每个 session 的完整对话记录持久化到磁盘：

```
~/.claude/projects/<project>/<session-id>.jsonl
```

这个 NDJSON 文件包含**每一条消息、每一次工具调用、每一个工具结果** —— 是 worker 行为的完整客观记录。teamsland server 知道每个 worker 的 session ID 和项目路径，可以推算出 transcript 文件位置。

### 观察者模式：spawn worker 去观测 worker

**大脑不亲自分析 transcript** —— 那本身是耗时任务，违反"秒级决策"原则。大脑 spawn 一个**观察者 worker**，让它去读目标 worker 的 session transcript 并总结。

```
张三："头像上传做得怎么样了？"
  → 大脑决策（秒级）：需要查看 worker-abc 的进度
  → teamsland spawn --task "$(cat <<'EOF'
    读取 worker-abc 的 session transcript：
    ~/.claude/projects/<project>/<session-id>.jsonl
    总结当前进展，回复群聊 oc_xxx 告诉张三
    EOF
    )"
  → 观察者 worker 读取 transcript 文件
  → 分析：已读完代码结构，正在实现裁剪组件，测试还没跑
  → 通过 lark-cli 回复群聊
```

### 同一模式，不同职责

观察者 worker 本身就是 Claude —— 它天然擅长理解 transcript 中的推理过程和工具调用。通过给观察者不同的 prompt/skill，可以回答不同层面的问题：

| 问题 | 观察者的职责 |
|------|------------|
| 干得进度怎么样？ | 读 transcript，总结已完成/进行中/待做的步骤 |
| 干得对不对？ | 读 transcript + 原始任务 brief，检查 worker 是否偏离需求 |
| 干得好不好？ | 读 transcript + worktree 的代码变更，做代码审查 |
| 为什么卡住了？ | 读 transcript 尾部，诊断错误原因，建议解决方案 |

### 这种设计的好处

- **大脑保持轻量** —— 不被 transcript 分析阻塞
- **观察者是 Claude** —— 比任何规则引擎都能给出更好的上下文理解和摘要
- **统一模式** —— 进度查询、质量审查、错误诊断都是"spawn 观察者 worker"，只是 prompt 不同
- **可组合** —— 可以同时 spawn 多个观察者从不同角度分析同一个 worker

---

## Worker 打断与恢复

### 为什么需要打断

观察者发现问题后，光能看到不够，还得能介入：
- Worker 跑偏了（实现的不是用户要的）
- Worker 卡住了（陷入重试循环或死胡同）
- 需求变了（用户在群里追加了新要求）

### 打断

`teamsland cancel <worker-id>` —— server 给 worker 进程发 SIGINT（优雅停止）或 SIGKILL（强制终止）。当前 ProcessController 已有 `interrupt(pid)` 方法。

### 恢复：不是重启，是接力

Worker 被打断后，它的工作不需要从头来：
- **worktree 还在** —— 代码改动保留在文件系统中
- **session transcript 还在** —— 完整的推理历史可供回溯

恢复的做法是 **spawn 一个新 worker，在同一个 worktree 里继续工作**，把前任的 transcript 摘要和纠正指令作为上下文：

```
观察者发现 worker-abc 跑偏了
  → 结果写回任务数据库，投递到队列
  → 大脑消费，决定打断并恢复

  → teamsland cancel worker-abc
  → teamsland spawn --worktree "/path/to/existing-worktree" --task "$(cat <<'EOF'
    继续在此 worktree 中工作。

    ## 前任 worker 的工作摘要
    [由观察者生成的 transcript 摘要]

    ## 纠正指令
    前一个 worker 在实现裁剪组件时用了第三方库，但项目要求使用已有的 ImageCropper 组件。
    请基于当前代码状态，用 ImageCropper 重新实现裁剪功能。

    ## 完成后
    通过 lark-cli 回复群聊 oc_xxx
    EOF
    )"
```

关键：`--worktree` 参数指定复用已有 worktree，不创建新的。新 worker 看到的是前任留下的代码状态，加上纠正后的指令。

### CLI 命令扩展

```bash
teamsland cancel <worker-id>              # 打断 worker（优雅停止）
teamsland cancel <worker-id> --force      # 强制终止
teamsland spawn --worktree <path> --task   # 在已有 worktree 中 spawn（恢复/接力场景）
```

### 观察→打断→恢复的自动化链条

整个流程可以由大脑自动驱动：

```
worker 运行中
  → server 检测到异常（超时 / 错误频率过高）
  → 投递 "worker_anomaly" 到队列
  → 大脑消费，spawn 观察者 worker 诊断问题
  → 观察者分析 transcript，输出诊断报告
  → 投递 "diagnosis_ready" 到队列
  → 大脑消费诊断报告，决策：打断 + 恢复
  → teamsland cancel + teamsland spawn --worktree
  → 新 worker 带着纠正指令继续工作
```

---

## 多事件源与三层处理架构

### 统一事件入口

大管家不只关注群聊消息。团队工作信号来自多个源：
- **飞书群聊** —— @机器人 消息
- **Meego** —— 工单创建、指派、状态变更、冲刺开始
- **未来可扩展** —— GitHub PR、CI/CD 通知、报警系统等

大脑的消息队列是**统一的事件入口**，不管事件来自哪里。大脑还能关联不同源的信息 —— 张三在群里聊的需求和他在 Meego 上创建的工单，大脑能识别出是同一件事。

### 问题：事件量远超大脑处理能力

如果每个事件都要大脑做一次 LLM 推理，成本和延迟都不可接受。但实际上，大部分事件的处理方式是确定性的，不需要 LLM"思考"。

### 三层处理架构

```
事件到达
  → Hooks 层（server 侧，零 LLM 开销，毫秒级）
    ├→ 匹配到 hook → 直接执行（发通知、spawn worker、调 API）
    └→ 无匹配 hook
        → Skills/Subagents 层（大脑侧，轻量 LLM，秒级）
          ├→ 匹配到 skill/subagent → 按固化模式处理
          └→ 无匹配
              → 大脑深度推理（完整 LLM 推理，数秒）
```

**Hooks** —— 最轻量的自动化，纯代码执行，零 token 开销：
- `issue.assigned` → 直接发飞书通知
- `issue.created` + 匹配特定项目 → 直接 spawn worker
- CI 失败 → 直接通知群聊

**Skills/Subagents** —— 固化的 LLM 处理模式，轻量推理：
- 复杂工单分析 → 专门的 subagent 处理
- 冲刺整理 → 固化的 skill 处理

**大脑深度推理** —— 真正需要理解的事件，完整 LLM 推理：
- 自然语言的群聊消息
- 从未见过的事件模式
- 需要关联多个信息源的决策

### Hooks：大脑直接编辑的文件

Hooks 不通过 CLI 管理 —— 它们是大脑工作目录下的代码/配置文件，teamsland server watch 目录并热重载。大脑想固化一个处理模式，直接 Write 文件；想调整，直接 Edit；想废弃，直接删。

```
~/.teamsland/coordinator/
├── CLAUDE.md
├── .claude/
│   ├── skills/
│   │   ├── teamsland-spawn/SKILL.md
│   │   ├── lark-message/SKILL.md
│   │   ├── handle-assignment/SKILL.md      # 大脑自己创建
│   │   └── sprint-kickoff/SKILL.md         # 大脑自己创建
│   └── agents/
│       └── ci-failure-triage.md            # 大脑自己创建
└── hooks/
    ├── meego/
    │   ├── issue-assigned.ts               # 工单指派 → 发通知
    │   ├── issue-created.ts                # 工单创建 → spawn worker
    │   └── sprint-started.ts               # 冲刺开始 → 整理通知
    ├── lark/
    │   └── keyword-reply.ts                # 关键词自动回复
    └── ci/
        └── build-failed.ts                 # CI 失败 → 通知群聊
```

### 大脑的自我进化路径

大脑在运行过程中不断把"思考"变成"反射"：

1. **新类型事件** → 大脑 LLM 深度推理，理解并处理
2. **模式初步固化** → 大脑写一个 skill/subagent（`.claude/skills/` 或 `.claude/agents/`），用轻量 LLM 处理
3. **模式完全确定** → 大脑写一个 hook 文件（`hooks/`），server 热加载，零 LLM 开销

全程都是大脑读写自己工作目录里的文件。Claude Code 的文件操作能力就是管理界面。

处理同类事件的成本随时间递减，响应速度递增。大脑越工作越高效。

---

## 记忆层：OpenViking

> 参考项目源码：`/Users/bytedance/workspace/OpenViking`（[github.com/volcengine/OpenViking](https://github.com/volcengine/OpenViking)）

### 为什么需要专门的记忆层

前面在"记忆外化 + 无状态 session"中定义了三层记忆需求（团队知识、任务状态、对话上下文），但没有明确**用什么存储和检索**。CLAUDE.md 解决了团队知识的注入，但对话上下文的"向量检索召回"和任务状态的结构化查询需要一个真正的语义存储引擎。

OpenViking 是字节跳动/火山引擎开源的 **AI Agent 上下文数据库**，定位是"The Context Database for AI Agents"。它不是简单的向量数据库，而是一个面向 agent 记忆管理的完整系统。

### OpenViking 的核心设计

**虚拟文件系统范式** —— 所有数据以 `viking://` URI 组织成目录树，不是扁平的 embedding 记录：

```
viking://
├── resources/          # 知识文档：仓库、wiki、飞书文档
│   ├── teamsland/
│   │   ├── .abstract.md    # L0: ~100 token 超短摘要（自动生成）
│   │   ├── .overview.md    # L1: ~2k token 结构化概览（自动生成）
│   │   └── src/...         # L2: 完整原始文件
│   └── frontend-repo/
├── user/
│   └── {user_id}/memories/
│       ├── profile.md          # 成员画像
│       ├── preferences/        # 偏好
│       └── events/             # 决策记录
└── agent/
    └── {agent_id}/
        ├── memories/
        │   ├── cases/          # 问题+方案记录
        │   ├── patterns/       # 可复用模式
        │   └── tools/          # 工具使用经验
        └── skills/             # 习得的能力
```

**三级内容分层（L0/L1/L2）** —— 每个目录自动生成 `.abstract.md`（L0，~100 token）和 `.overview.md`（L1，~2k token），原始文件是 L2。agent 检索时先扫 L0 定位方向，读 L1 做规划，只在真正需要时加载 L2。这极大减少了 token 消耗。

**层级递归检索** —— 查询先经过意图分析（LLM 将查询分解为 0-5 个类型化子查询），然后向量搜索定位最相关的目录，递归下钻到子目录，最终 rerank 返回结果。检索轨迹完整可追溯。

**Session 与记忆提取** —— 对话以 session 追踪。session commit 时系统自动：压缩对话、归档旧轮次（生成 L0/L1 摘要）、异步提取长期记忆（分为 6 类：用户画像、偏好、实体、事件 + agent 案例、模式）。agent 在使用中越来越懂团队。

### 与 teamsland 记忆分层的映射

| teamsland 记忆层 | OpenViking 映射 | 说明 |
|-----------------|----------------|------|
| **团队知识**（几乎不变）| `viking://resources/` | 用 `add_resource()` 导入仓库、wiki。L0/L1 自动生成结构摘要 |
| **任务状态**（天级变化）| `viking://resources/tasks/` | 结构化 markdown 文件，用 `write()` / `read()` 更新。URI 路径即任务分类 |
| **对话上下文**（分钟级变化）| `viking://session/{id}/` | session 存储完整消息历史。`get_session_context()` 按 token 预算组装上下文 |
| **长期记忆** | `viking://agent/memories/` | commit 时 LLM 自动提取。8 类记忆自动去重/合并 |
| **跨 session 记忆** | 全量持久化到磁盘 | 所有写入立即落盘，Brain/Worker 重启后完整恢复 |

### 完全本地运行

OpenViking 支持**零外部依赖的本地部署**，完全符合 teamsland 单机架构：

- **存储后端** —— 内置向量索引（C++ 核心），本地文件系统存储，不需要外部数据库
- **Embedding 模型** —— 支持 Ollama 本地模型（推荐 `nomic-embed-text`），或直接使用内置的 GGUF 模型（`bge-small-zh-v1.5`，零网络依赖）
- **VLM** —— L0/L1 摘要生成可用 Ollama 本地模型，也可用云 API（OpenAI/火山引擎）提升质量
- **部署方式** —— 单进程 HTTP server，默认端口 1933。`openviking-server init` 向导自动配置 Ollama

### teamsland 的集成方式

OpenViking 暴露完整的 REST API（FastAPI），teamsland 通过 HTTP 调用。虽然没有官方 TypeScript SDK，但项目自带了 **Claude Code memory plugin 示例**（`examples/claude-code-memory-plugin/src/memory-server.ts`），是一个现成的 TypeScript HTTP 客户端参考实现，覆盖 find/read/session/write 全部接口。

**teamsland 需要封装的 `@teamsland/memory` 包：**

```typescript
// 语义检索
const results = await memory.find("前端 dashboard 的编码规范", {
  targetUri: "viking://resources/teamsland/",
  limit: 10
});

// 渐进式读取（L0 → L1 → L2）
const overview = await memory.overview("viking://resources/teamsland/src/");
const detail = await memory.read("viking://resources/teamsland/src/brain.ts");

// 任务状态读写
await memory.write("viking://resources/tasks/task-abc.md", taskStateMarkdown);
const task = await memory.read("viking://resources/tasks/task-abc.md");

// Session 记忆提取
const sessionId = await memory.createSession();
await memory.addMessage(sessionId, "user", "我们决定用 Redis 做任务队列");
await memory.addMessage(sessionId, "assistant", "好的，我来更新架构文档");
await memory.commitSession(sessionId); // 后台 LLM 自动提取长期记忆
```

### 大脑使用 OpenViking 的流程

```
新消息到达
  → 从 OpenViking 加载：
    - find("相关任务") → 任务状态（viking://resources/tasks/）
    - find("相关记忆") → 长期记忆（viking://agent/memories/）
    - get_session_context() → 最近对话上下文
  → 组装成 context，启动一次 Claude 推理
  → Claude 输出决策
  → 把新状态写回 OpenViking（write 任务状态 + add_message 对话记录）
  → session 结束
```

### Worker 使用 OpenViking 的流程

Worker 通过 HTTP API（或 teamsland CLI 封装）访问 OpenViking：
- 启动前：检索任务相关的代码知识和历史案例
- 工作中：查询团队编码规范和架构文档
- 完成后：写回案例记忆（"这个问题是这样解决的"），供未来 worker 参考

### 文档解析能力

OpenViking 内置强大的文档解析管道，支持：
- 代码仓库（tree-sitter：Python, JS/TS, Java, C++, Go, Rust 等 10 种语言）
- Markdown, PDF, HTML, Word/Excel/PowerPoint
- 飞书文档
- 图片/视频/音频（VLM 视觉理解）

这意味着 `add_resource("./teamsland")` 可以直接导入整个仓库，OpenViking 自动解析代码结构并生成 L0/L1 摘要。团队的飞书文档也可以直接导入。

### 需要注意的限制

1. **LLM 依赖** —— L0/L1 生成和记忆提取依赖 VLM/embedding 模型。本地 Ollama 可用但较慢，云 API 质量更好但有网络依赖
2. **Embedding 模型固定** —— 同一 collection 不能混用不同 embedding 模型，换模型需重新索引
3. **无内置任务状态机** —— 任务状态管理需要通过 URI 路径约定 + 结构化 markdown 自己实现
4. **AGPLv3 许可证** —— 主体代码 AGPL，示例代码 Apache 2.0

---

## 部署架构：单机

teamsland 是**单机架构** —— 部署在开发者自己的工作电脑上。所有 Claude Code session（大脑和 worker）都运行在本地，session transcript 文件在本地 `~/.claude/projects/`，worktree 在本地文件系统。OpenViking server 也运行在本地（默认端口 1933）。

这个约束大幅简化了设计：
- 不需要分布式 session 存储
- 不需要远程 PTY 协议
- 不需要多租户隔离
- 文件系统就是数据层
- OpenViking 本地向量索引，无外部数据库依赖

---

## Dashboard：整合 claudecodeui

> 参考项目源码：`/Users/bytedance/workspace/claudecodeui`（[github.com/siteboon/claudecodeui](https://github.com/siteboon/claudecodeui)）

### 为什么需要完整 Web UI

用户需要：
- 看到所有 session（大脑 + 所有 worker）的实时输出流
- 观察 worker 的工具调用、代码变更、diff 视图
- **随时接管任何 session** —— worker 干完一轮或干到一半，用户直接在浏览器里跟它对话

这不是一个简单的状态面板，而是一个**完整的 Claude Code Web 工作台**。

### claudecodeui 提供了什么

claudecodeui 是一个成熟的 Claude Code Web UI，核心能力完全匹配 teamsland 的需求：

| 能力 | 说明 |
|------|------|
| Session 列表 | 自动发现 `~/.claude/projects/` 下的所有 session，chokidar 监听变化实时刷新 |
| 实时输出流 | 通过 `@anthropic-ai/claude-agent-sdk` 的 async generator 获取事件，WebSocket 推送到前端 |
| 工具调用可视化 | 配置驱动的 ToolRenderer：Edit/Write → diff 视图，Bash → 可折叠输出，Grep/Glob → 文件列表 |
| Session 接管 | 支持 `resume` 已有 session，用户在浏览器里直接对话 |
| 终端 | xterm.js + node-pty，完整的交互式终端 |
| 文件浏览器 | 递归文件树 + CodeMirror 编辑器 |
| Git 面板 | Stage/commit/diff/分支管理 |
| JSONL 解析 | 完整的 transcript 解析，NormalizedMessage schema，tool_use/tool_result 关联 |

### 整合策略：直接搬运模块

因为 teamsland 是单机部署，claudecodeui 的所有本地文件系统假设都成立。**直接从 claudecodeui 搬运需要的模块和组件到 teamsland Dashboard**，不做二次抽象：

**需要搬运的后端模块：**
- `server/projects.js` — session 发现和 JSONL 解析引擎
- `server/claude-sdk.js` — Claude Agent SDK 集成（替代当前的 `Bun.spawn("claude")`）
- `server/modules/providers/list/claude/` — Claude session 数据 provider 和消息归一化
- `server/routes/messages.js` — 统一消息 API
- chokidar 文件监听逻辑 — session 变化实时推送

**需要搬运的前端组件：**
- `src/components/chat/` — 完整的聊天界面 + 实时流处理
- `src/components/chat/tools/` — ToolRenderer 及所有工具可视化组件（diff 视图、Bash 输出、文件列表等）
- `src/components/sidebar/` — Session 列表侧边栏
- `src/components/shell/` — xterm.js 终端组件
- `src/components/file-tree/` — 文件浏览器
- `src/components/code-editor/` — CodeMirror 编辑器
- `src/components/git-panel/` — Git 操作面板
- `src/stores/useSessionStore.ts` — Session 消息缓存和实时/历史合并逻辑
- `src/contexts/WebSocketContext.tsx` — WebSocket 状态管理

**需要搬运的数据模型：**
- `NormalizedMessage` schema — 消息归一化格式
- Session/Project 类型定义
- 工具调用状态推导逻辑（running / completed / error / denied）

### 在搬运基础上扩展

搬运后需要为 teamsland 场景增加的功能：
- **Session 类型标注** —— 区分大脑 session、任务 worker、观察者 worker
- **任务关联视图** —— 展示 worker 对应的群聊消息、发起人、Meego 工单
- **worker 拓扑视图** —— 大脑 → worker → 观察者的层级关系可视化
- **飞书集成面板** —— 显示关联的群聊对话上下文

### 替换现有 Dashboard

当前 teamsland 的 Dashboard（rspack + React + shadcn/ui）功能单薄，只展示 agent 状态列表。整合 claudecodeui 后**完全替换**现有 Dashboard，升级为完整的 Claude Code Web 工作台。

技术栈适配：claudecodeui 使用 Vite + TailwindCSS，teamsland 当前使用 rspack + shadcn/ui。搬运时统一为 claudecodeui 的技术栈（Vite + TailwindCSS），因为其组件生态更完整。

---

*本文档记录产品理解的演进过程，随讨论深入持续更新。*
