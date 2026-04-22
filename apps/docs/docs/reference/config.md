# 配置文件参考

系统的中心配置文件位于 `config/config.json`。启动时由 `@teamsland/config` 包的 `loadConfig()` 函数读取，经过 `resolveEnvVars()` 进行环境变量替换（语法：`${ENV_VAR}`），最后通过 Zod `AppConfigSchema` 做结构校验。

## 环境变量替换

配置文件中任何字符串字段均可使用 `${VAR_NAME}` 占位符，`resolveEnvVars()` 会在运行时将其替换为对应的环境变量值。

```json
{
  "lark": {
    "appSecret": "${LARK_APP_SECRET}"
  }
}
```

---

## 配置节详解

### meego

Meego 项目管理平台的集成配置。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `spaces` | `Array<{spaceId, name}>` | 是 | Meego 空间列表，每项包含空间 ID 与名称 |
| `eventMode` | `"webhook" \| "poll" \| "both"` | 是 | 事件接收模式：webhook 推送、主动轮询或两者并用 |
| `webhook.host` | string | 是 | Webhook 服务监听地址 |
| `webhook.port` | number | 是 | Webhook 服务监听端口 |
| `webhook.path` | string | 是 | Webhook 路径（如 `/meego/webhook`） |
| `webhook.secret` | string | 否 | HMAC-SHA256 签名密钥，用于验证请求合法性 |
| `poll.intervalSeconds` | number | 是 | 轮询间隔（秒） |
| `poll.lookbackMinutes` | number | 是 | 每次轮询回看的时间窗口（分钟） |
| `longConnection.enabled` | boolean | 是 | 是否启用 SSE 长连接模式 |
| `longConnection.reconnectIntervalSeconds` | number | 是 | SSE 断线后的基础重连间隔（秒），实际使用指数退避 |
| `apiBaseUrl` | string | 是 | Meego API 的基础地址 |
| `pluginAccessToken` | string | 是 | 插件 API Token，通过 `${ENV_VAR}` 从环境变量注入 |

**示例：**

```json
"meego": {
  "spaces": [
    { "spaceId": "space_001", "name": "后端平台" }
  ],
  "eventMode": "webhook",
  "webhook": {
    "host": "0.0.0.0",
    "port": 8080,
    "path": "/meego/webhook",
    "secret": "${MEEGO_WEBHOOK_SECRET}"
  },
  "poll": {
    "intervalSeconds": 60,
    "lookbackMinutes": 5
  },
  "longConnection": {
    "enabled": false,
    "reconnectIntervalSeconds": 30
  },
  "apiBaseUrl": "https://meego.example.com",
  "pluginAccessToken": "${MEEGO_PLUGIN_TOKEN}"
}
```

---

### lark

飞书（Lark）Bot 与通知集成配置。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `appId` | string | 是 | 飞书应用的 App ID |
| `appSecret` | string | 是 | 飞书应用的 App Secret，建议通过环境变量注入 |
| `bot.historyContextCount` | number | 是 | Bot 回复时携带的历史消息上下文数量 |
| `notification.teamChannelId` | string | 是 | 系统通知发送的目标群组 ID |

**示例：**

```json
"lark": {
  "appId": "cli_xxxxxxxxxxxxxx",
  "appSecret": "${LARK_APP_SECRET}",
  "bot": {
    "historyContextCount": 10
  },
  "notification": {
    "teamChannelId": "oc_xxxxxxxxxxxxxxxx"
  }
}
```

---

### session

Agent 会话数据库（SQLite WAL 模式）的运行参数。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `compactionTokenThreshold` | number | `80000` | 会话 Token 总量超过此阈值时触发上下文压缩 |
| `sqliteJitterRangeMs` | `[min, max]` | `[20, 150]` | 并发写入时的随机延迟范围（毫秒），减少写锁竞争 |
| `busyTimeoutMs` | number | `5000` | SQLite BUSY 状态的等待超时（毫秒） |

**示例：**

```json
"session": {
  "compactionTokenThreshold": 80000,
  "sqliteJitterRangeMs": [20, 150],
  "busyTimeoutMs": 5000
}
```

---

### sidecar

Agent 进程池与调度策略配置。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxConcurrentSessions` | number | `20` | 允许同时运行的最大 Agent 进程数 |
| `maxRetryCount` | number | `3` | Agent 任务失败后的最大重试次数 |
| `maxDelegateDepth` | number | `2` | Agent 委托链的最大深度，防止无限嵌套 |
| `workerTimeoutSeconds` | number | `300` | 单个 Worker 进程的最长运行时间（秒） |
| `healthCheckTimeoutMs` | number | `30000` | 健康检查请求的超时时间（毫秒） |
| `minSwarmSuccessRatio` | number | `0.5` | Swarm 任务的最低成功率阈值，低于此值视为整体失败 |

**示例：**

```json
"sidecar": {
  "maxConcurrentSessions": 20,
  "maxRetryCount": 3,
  "maxDelegateDepth": 2,
  "workerTimeoutSeconds": 300,
  "healthCheckTimeoutMs": 30000,
  "minSwarmSuccessRatio": 0.5
}
```

---

### memory

团队记忆系统的衰减与存留策略配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `decayHalfLifeDays` | number | 记忆热度的衰减半衰期（天）。经过此天数后，热度降至原来的一半 |
| `extractLoopMaxIterations` | number | `ExtractLoop` 每次运行的最大迭代次数，防止无限循环 |
| `exemptTypes` | string[] | 列出的记忆类型不参与衰减，永久保留 |
| `perTypeTtl` | Record\<string, number\> | 按记忆类型设置 TTL（天）。未列出的类型使用系统默认值 |

**示例：**

```json
"memory": {
  "decayHalfLifeDays": 30,
  "extractLoopMaxIterations": 10,
  "exemptTypes": ["decision", "architecture"],
  "perTypeTtl": {
    "task_note": 7,
    "code_snippet": 90
  }
}
```

---

### storage

向量数据库与 Embedding 模型的配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `sqliteVec.dbPath` | string | 记忆向量数据库的文件路径 |
| `sqliteVec.busyTimeoutMs` | number | 向量库 SQLite BUSY 超时（毫秒） |
| `sqliteVec.vectorDimensions` | number | 向量维度，必须与 Embedding 模型输出一致（通常为 `512`） |
| `embedding.model` | string | Embedding 模型文件路径（GGUF 格式） |
| `embedding.contextSize` | number | 模型上下文窗口大小（token 数） |
| `entityMerge.cosineThreshold` | number | 实体合并时的余弦相似度阈值（0~1），高于此值则视为同一实体 |
| `fts5.optimizeIntervalHours` | number | FTS5 全文索引后台优化任务的执行间隔（小时） |

**示例：**

```json
"storage": {
  "sqliteVec": {
    "dbPath": "data/memory.db",
    "busyTimeoutMs": 5000,
    "vectorDimensions": 512
  },
  "embedding": {
    "model": "models/bge-small-zh-v1.5.gguf",
    "contextSize": 512
  },
  "entityMerge": {
    "cosineThreshold": 0.88
  },
  "fts5": {
    "optimizeIntervalHours": 6
  }
}
```

---

### confirmation

待确认任务的提醒机制配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `reminderIntervalMin` | number | 两次提醒之间的间隔（分钟） |
| `maxReminders` | number | 单个任务的最大提醒次数，超出后停止提醒 |
| `pollIntervalMs` | number | 系统轮询待确认任务队列的频率（毫秒） |

**示例：**

```json
"confirmation": {
  "reminderIntervalMin": 30,
  "maxReminders": 3,
  "pollIntervalMs": 10000
}
```

---

### dashboard

管理 Dashboard 的服务与认证配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| `port` | number | Dashboard HTTP 服务监听端口 |
| `auth.provider` | `"lark_oauth" \| "none"` | 认证方式：飞书 OAuth 登录或不启用认证 |
| `auth.sessionTtlHours` | number | 登录会话的有效期（小时） |
| `auth.allowedDepartments` | string[] | 允许访问的部门名称列表；空数组表示不限制 |

**示例：**

```json
"dashboard": {
  "port": 3000,
  "auth": {
    "provider": "lark_oauth",
    "sessionTtlHours": 8,
    "allowedDepartments": ["工程部", "产品部"]
  }
}
```

---

### repoMapping

Meego 项目与本地代码仓库的映射关系。Agent 通过此配置定位需要操作的代码仓库。

```json
"repoMapping": [
  {
    "meegoProjectId": "project_xxx",
    "repos": [
      { "path": "/path/to/repo-a", "name": "后端服务" },
      { "path": "/path/to/repo-b", "name": "前端应用" }
    ]
  }
]
```

每个条目将一个 Meego 项目 ID 映射到一组本地仓库路径。

---

### skillRouting

意图类型到可用工具/技能名称的路由映射。系统支持 8 种意图类型，每种类型可配置多个候选工具名称。

```json
"skillRouting": {
  "code_review": ["github_review", "local_diff"],
  "bug_fix": ["code_patch", "test_runner"],
  "documentation": ["doc_writer"],
  "task_planning": ["planner"],
  "deployment": ["deploy_tool"],
  "monitoring": ["log_analyzer"],
  "security_audit": ["security_scanner"],
  "general": ["assistant"]
}
```

---

### llm（可选）

LLM 提供商配置。若省略，系统将使用内置默认值（需确保相关环境变量已设置）。

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `provider` | string | — | LLM 提供商标识，目前仅支持 `"anthropic"` |
| `apiKey` | string | — | API Key，强烈建议通过 `${ENV_VAR}` 从环境变量注入 |
| `model` | string | — | 模型名称（如 `claude-opus-4-5`） |
| `baseUrl` | string | `https://api.anthropic.com` | API 基础地址，代理部署时可修改 |
| `maxTokens` | number | `4096` | 单次请求的最大输出 token 数 |

**示例：**

```json
"llm": {
  "provider": "anthropic",
  "apiKey": "${ANTHROPIC_API_KEY}",
  "model": "claude-opus-4-5",
  "baseUrl": "https://api.anthropic.com",
  "maxTokens": 8192
}
```

---

### templateBasePath

Agent 角色模板 Markdown 文件的根目录路径。

- **类型：** string
- **默认值：** `"config/templates"`

模板文件按角色命名，例如 `config/templates/code-reviewer.md`。`@teamsland/context` 包的 `loadTemplate()` 函数使用此路径加载对应模板。

```json
"templateBasePath": "config/templates"
```

---

## 完整配置示例

以下是一个典型的 `config/config.json` 骨架，可作为新部署的起点：

```json
{
  "meego": {
    "spaces": [{ "spaceId": "space_001", "name": "主项目" }],
    "eventMode": "webhook",
    "webhook": { "host": "0.0.0.0", "port": 8080, "path": "/meego/webhook", "secret": "${MEEGO_SECRET}" },
    "poll": { "intervalSeconds": 60, "lookbackMinutes": 5 },
    "longConnection": { "enabled": false, "reconnectIntervalSeconds": 30 },
    "apiBaseUrl": "https://meego.example.com",
    "pluginAccessToken": "${MEEGO_TOKEN}"
  },
  "lark": {
    "appId": "${LARK_APP_ID}",
    "appSecret": "${LARK_APP_SECRET}",
    "bot": { "historyContextCount": 10 },
    "notification": { "teamChannelId": "${LARK_TEAM_CHANNEL}" }
  },
  "session": {
    "compactionTokenThreshold": 80000,
    "sqliteJitterRangeMs": [20, 150],
    "busyTimeoutMs": 5000
  },
  "sidecar": {
    "maxConcurrentSessions": 20,
    "maxRetryCount": 3,
    "maxDelegateDepth": 2,
    "workerTimeoutSeconds": 300,
    "healthCheckTimeoutMs": 30000,
    "minSwarmSuccessRatio": 0.5
  },
  "memory": {
    "decayHalfLifeDays": 30,
    "extractLoopMaxIterations": 10,
    "exemptTypes": ["decision"],
    "perTypeTtl": {}
  },
  "storage": {
    "sqliteVec": { "dbPath": "data/memory.db", "busyTimeoutMs": 5000, "vectorDimensions": 512 },
    "embedding": { "model": "models/bge-small-zh-v1.5.gguf", "contextSize": 512 },
    "entityMerge": { "cosineThreshold": 0.88 },
    "fts5": { "optimizeIntervalHours": 6 }
  },
  "confirmation": {
    "reminderIntervalMin": 30,
    "maxReminders": 3,
    "pollIntervalMs": 10000
  },
  "dashboard": {
    "port": 3000,
    "auth": { "provider": "lark_oauth", "sessionTtlHours": 8, "allowedDepartments": [] }
  },
  "repoMapping": [],
  "skillRouting": {},
  "llm": {
    "provider": "anthropic",
    "apiKey": "${ANTHROPIC_API_KEY}",
    "model": "claude-opus-4-5",
    "maxTokens": 4096
  },
  "templateBasePath": "config/templates"
}
```
