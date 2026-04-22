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

*本文档记录产品理解的演进过程，随讨论深入持续更新。*
