# 部署运维

## 环境变量

### 必需变量

以下变量在服务启动时会被强制检查，缺少任何一项将导致启动失败：

| 变量 | 说明 |
|------|------|
| `LARK_APP_ID` | 飞书应用 App ID |
| `LARK_APP_SECRET` | 飞书应用 App Secret |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic API Key |
| `ANTHROPIC_MODEL` | 模型名称，如 `claude-sonnet-4-20250514` |
| `ANTHROPIC_BASE_URL` | API 地址，如 `https://api.anthropic.com` |

### 可选变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `MEEGO_WEBHOOK_SECRET` | Webhook HMAC 签名密钥 | 无（跳过签名验证） |
| `MEEGO_PLUGIN_ACCESS_TOKEN` | Meego 插件 API Token | 无（ConfirmationWatcher 返回 pending） |
| `LARK_TEAM_CHANNEL_ID` | 飞书团队频道 ID | 无（通知发送到空） |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel 导出地址 | `http://localhost:4318` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOG_PRETTY` | 美化日志输出 | `false` |

## 启动服务

```bash
export LARK_APP_ID=xxx
export LARK_APP_SECRET=xxx
export ANTHROPIC_AUTH_TOKEN=sk-xxx
export ANTHROPIC_MODEL=claude-sonnet-4-20250514
export ANTHROPIC_BASE_URL=https://api.anthropic.com

bun run apps/server/src/main.ts
```

## 定时任务

服务启动后会自动注册 5 个定时任务：

| 任务 | 间隔 | 说明 |
|------|------|------|
| Health Check | 60s | Agent 数量达到容量 90% 时向飞书发送告警卡片 |
| Worktree Reaper | 1h | 清理超过 7 天的 Git Worktree |
| Memory Reaper | 24h | 对低热度记忆条目执行衰减淘汰 |
| Seen Events Sweep | 1h | 清理 MeegoEventBus 去重记录 |
| FTS5 Optimize | 可配置（默认 24h） | 优化全文搜索索引 |

## 健康检查

```
GET /health
```

返回示例：

```json
{ "status": "ok", "uptime": 12345 }
```

`uptime` 单位为毫秒，表示服务自启动以来的运行时长。

## OpenTelemetry 监控

服务启动时自动初始化链路追踪。Span 通过 OTLP HTTP 协议导出至 `OTEL_EXPORTER_OTLP_ENDPOINT` 所指定的地址。

已插桩的关键操作：

- `sidecar:process-controller / spawn` — Agent 进程创建
- `context:assembler / buildInitialPrompt` — Prompt 组装

兼容 Jaeger、Grafana Tempo 以及所有支持 OTLP 协议的后端。

## 日志

所有日志通过 pino 以 **NDJSON** 格式输出至 stdout。每条日志记录包含以下字段：

| 字段 | 说明 |
|------|------|
| `level` | 日志级别（trace / debug / info / warn / error） |
| `time` | Unix 时间戳（毫秒） |
| `pid` | 进程 ID |
| `hostname` | 主机名 |
| `name` | Logger 名称（标识来源模块） |
| `msg` | 日志消息正文 |

其余结构化字段因操作类型而异。

开发阶段可设置 `LOG_PRETTY=true` 开启易读格式输出。

## 数据目录

```
data/
├── sessions.sqlite    — 会话数据库（WAL 模式）
└── memory.sqlite      — 记忆数据库（vec0 + FTS5）
```

两个数据库在首次启动时自动创建。SQLite WAL 模式允许在写入期间并发读取，无需额外配置。

## 优雅关闭

收到 `SIGTERM` 或 `SIGINT` 信号后，服务按以下顺序执行关闭流程：

1. 通过 AbortController 取消所有进行中的操作
2. 清除所有定时任务计时器
3. 停止 Dashboard HTTP 服务器
4. 刷新并导出所有待发送的 OTel Span
5. 将 SubagentRegistry 持久化到磁盘
6. 关闭 SQLite 连接

## 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `环境变量未定义: VAR` | 缺少必需环境变量 | 检查并设置对应环境变量 |
| `sqlite-vec 扩展不可用` | 缺少 vec0 native extension | 安装 sqlite-vec；系统会自动降级为 NullMemoryStore |
| `Embedding 模型加载失败` | node-llama-cpp / GGUF 模型问题 | 检查模型路径；系统会自动降级为 NullEmbedder |
| `CapacityError` | 并发 Agent 达到上限 | 增大 `sidecar.maxConcurrentSessions` 或等待现有 Agent 完成 |
| Agent 变为 orphan | 服务重启后旧进程仍在运行 | `restoreOnStartup` 会自动探测并监控 orphan 进程直到其退出 |
