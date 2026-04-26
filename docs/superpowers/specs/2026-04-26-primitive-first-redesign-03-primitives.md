# Teamsland Primitive-First 重设计 — 03 Primitives 体系

## 设计原则

1. **一个入口**：所有 Primitive 通过 `teamsland` CLI 暴露，按能力域分子命令组。
2. **混合粒度**：简单操作原子级（`lark send`），复杂能力域封装（`meego` 下十几个子命令）。
3. **统一输出**：所有命令默认输出 JSON，方便 Agent 解析；加 `--human` 输出可读格式。错误也输出结构化 JSON（`{error: string, code: string}`），不输出 stack trace。
4. **幂等优先**：能做到幂等的命令都做到幂等。
5. **全局 flags**：`--timeout <ms>`（默认 30s）、`--retry <N>`（默认 0）、`--verbose`（debug 日志到 stderr）。CLI 对 server 连接失败（ECONNREFUSED / 502 / 503）自动重试 1 次。

## 完整命令树

```
teamsland
├── health                          # 服务器连通性 + 子系统状态
│
├── worker                          # Worker 全生命周期
│   ├── spawn [--repo] [--role] [--prompt]   # 创建 Worker
│   ├── list [--status]                      # 列出 Workers
│   ├── status <id>                          # 查看状态详情
│   ├── result <id>                          # 获取完成结果
│   ├── cancel <id> [--force]                # 取消 Worker
│   ├── interrupt <id> --reason <text>       # 中断并说明原因
│   ├── resume <id> --instructions <text>    # 恢复并注入纠正指令
│   ├── observe <id>                         # 启动 Observer 诊断
│   └── transcript <id>                      # 获取会话记录路径
│
├── lark                            # Lark 消息能力
│   ├── send --to <user|chat> --text <msg>   # 发送文本消息
│   ├── reply --message-id <id> --text <msg> # 回复消息
│   ├── card --to <user|chat> --template <json>  # 发送卡片消息
│   ├── history <chat-id> [--count N]        # 获取聊天历史
│   ├── doc-read <url>                       # 读取飞书文档内容
│   ├── contact-search <query>               # 搜索联系人
│   └── group-search <query>                 # 搜索群组
│
├── meego                           # Meego 能力域
│   ├── get <issue-id>                       # 查询工单详情
│   ├── search --project <key> [--filter ...]# 搜索工单
│   ├── create --project <key> --title <t>   # 创建工单
│   ├── update <issue-id> --field <k=v>      # 更新简单字段
│   ├── update <issue-id> --field-json <json># 更新复杂字段（多选、富文本等）
│   ├── delete <issue-id>                    # 删除工单
│   ├── comment <issue-id> --text <msg>      # 添加评论
│   ├── assign <issue-id> --to <user>        # 变更负责人
│   ├── transition <issue-id> --to <status>  # 状态流转
│   ├── transition-fields <issue-id> --to <status>  # 预览流转所需字段
│   ├── workflow <issue-id>                  # 查看工作流定义
│   ├── fields <project-key>                 # 列出项目字段定义
│   └── upload <issue-id> --file <path>      # 上传附件
│
├── memory                          # 知识库能力
│   ├── find <query> [--scope user|agent]    # 语义搜索
│   ├── read <resource-uri>                  # 读取资源
│   ├── write <resource-uri> --content <text># 写入资源
│   ├── ls [path]                            # 列出资源
│   └── rm <resource-uri>                    # 删除资源
│
├── rule                            # 自演化规则管理
│   ├── create <name> --file <path>           # 创建规则（从文件读 TS 内容）
│   ├── list                                 # 列出所有规则
│   ├── show <name>                          # 查看规则内容
│   ├── delete <name>                        # 删除规则
│   ├── disable <name>                       # 禁用规则
│   ├── enable <name>                        # 启用规则
│   └── test <name>                          # 测试匹配
│
├── queue                           # 队列可观测
│   ├── stats                                # 队列统计
│   ├── inspect [--status <s>] [--limit N]   # 查看队列消息
│   └── retry <msg-id>                       # 重试失败消息
│
├── git                             # Git 操作
│   ├── status [--repo <path>]               # 查看状态
│   ├── diff [--repo <path>]                 # 查看变更
│   ├── log [--repo <path>] [--count N]      # 查看日志
│   ├── commit --repo <path> -m <msg>        # 提交
│   ├── branches [--repo <path>]             # 列出分支
│   ├── stage --repo <path> --files <f1,f2>  # 暂存文件
│   ├── unstage --repo <path> --files <f1,f2># 取消暂存
│   └── checkout --repo <path> --branch <name># 切换分支
│
└── report                          # Worker 汇报（Worker 专用）
    ├── progress --text <msg>                # 汇报进度
    ├── done --text <msg> [--data <json>]    # 汇报完成
    └── blocked --text <msg>                 # 汇报阻塞
```

## 与现有能力的对应关系

| 新 CLI 命令 | 现有后端能力 | 现状 |
|---|---|---|
| `health` | 无 | 新增 |
| `worker interrupt/resume/observe` | `POST /api/workers/:id/interrupt` 等 REST API | 有 API，无 CLI |
| `meego get/search/transition/...` | `MeegoClient` 的 15+ typed 方法 | 有 client，worker 只能 curl |
| `meego delete/assign/upload/transition-fields` | `MeegoClient` 对应方法 | 有 client，未暴露 |
| `lark history/doc-read/contact-search/group-search` | `LarkCli` 对应方法 | 有实现，未暴露 |
| `memory write/rm` | `viking-routes.ts` write/rm 路由 | 有路由，skill 未文档化 |
| `queue stats/inspect/retry` | `PersistentQueue` 全功能 | 完全未暴露 |
| `git stage/unstage/checkout` | `/api/git/*` 路由 | 有路由，无 CLI |
| `rule create --file` | Hook Engine 热加载机制 | 有机制，无管理接口 |
| `report *` | `teamsland-report` skill（curl 方式） | 有，统一为 CLI 子命令 |

## 实现方式

每个子命令组是 CLI 的一个模块，内部通过 HTTP 调用本地 server（`localhost:3001/api/*`）。CLI 是薄客户端，业务逻辑在 server 端。

```
teamsland meego get ISSUE-123
    ↓
HTTP GET localhost:3001/api/meego/items/ISSUE-123
    ↓
Server 调用 MeegoClient.getWorkItem()
    ↓
JSON 输出返回给 Agent
```
