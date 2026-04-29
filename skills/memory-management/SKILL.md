---
name: memory-management
description: 管理 OpenViking 长期记忆和知识库资源——包括 Agent/用户记忆的增删改查，以及代码仓库、飞书文档等知识资源的导入与检索。
allowed-tools:
  - Bash(teamsland memory *)
  - Bash(curl *)
---

# 记忆与知识管理

OpenViking 存储两类数据：**记忆**（经验、事实、偏好）和**知识资源**（仓库、文档）。两者共享语义检索能力，通过 URI 命名空间区分。

---

## 一、记忆管理（teamsland memory 命令）

### 记忆分层

| 层级 | 存储 | 何时用 |
|------|------|--------|
| Claude Code 内置 | CLAUDE.md / .claude/memory/ | 身份、约束、决策规则——每次对话都需要 |
| OpenViking 记忆 | `teamsland memory` 命令 | 事件、案例、偏好、经验——按需语义检索 |

灰色地带：先放 OpenViking，确认长期有效后再考虑提升到内置。

### 何时主动记忆

- 任务中发现的可复用经验（踩坑、解法、最佳实践）
- 用户偏好细节（不属于每次对话都要知道的）
- 项目事实和技术决策背景
- **不要记忆**：代码或 git 历史能直接获取的信息
- **不要记忆**：仅当前对话有用的临时上下文

### 何时主动检索

Agent 记忆不会自动注入上下文。主动使用 `teamsland memory find` 检索：
- 处理类似之前解决过的问题
- 用户提到你可能记录过的项目或技术细节
- 需要回忆团队约定或流程

### URI 命名空间

| 类型 | URI 前缀 | 用途 |
|------|---------|------|
| Agent 记忆 | `viking://agent/teamsland/memories/` | 团队级知识、工作模式、技术决策 |
| 用户记忆 | `viking://user/<userId>/memories/` | 特定用户的偏好和背景 |
| 知识资源 | `viking://resources/` | 仓库、文档等结构化资源 |

### 记忆 CRUD

```bash
# 写入
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "## 热修复流程\n\n1. 从 main 拉分支 ..." --mode create

# 更新
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "更新后的内容..." --mode replace

# 语义检索
teamsland memory find "部署流程" --scope agent --limit 5

# 浏览结构
teamsland memory ls viking://agent/teamsland/memories/ --recursive

# 删除
teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md

# 目录摘要
teamsland memory abstract viking://agent/teamsland/memories/cases/
```

### scope 快捷方式

- `--scope agent` → `viking://agent/teamsland/memories/`
- `--scope user --user <id>` → `viking://user/<id>/memories/`
- `--scope tasks` → `viking://resources/tasks/`
- `--scope resources` → `viking://resources/`

### 记忆文件规范

- Markdown 格式，文件名语义化（`deploy-hotfix.md`、`alice-preferences.md`）
- `cases/` 存问题-方案案例
- `patterns/` 存交互模式和工作流
- `preferences/` 存用户偏好（放在对应用户 URI 下）
- 内容简洁，聚焦为什么和怎么做

---

## 二、知识资源管理（HTTP API）

通过 teamsland server API 管理 `viking://resources/` 下的知识库。

### 添加代码仓库

```bash
curl -s -X POST http://localhost:3001/api/viking/resource \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/repo", "to": "viking://resources/repo-name/", "wait": false}'
```

### 添加飞书文档

```bash
curl -s -X POST http://localhost:3001/api/viking/resource \
  -H "Content-Type: application/json" \
  -d '{"path": "https://xxx.feishu.cn/docx/xxx", "to": "viking://resources/lark-docs/title/", "wait": false}'
```

### 语义搜索

```bash
curl -s -X POST http://localhost:3001/api/viking/find \
  -H "Content-Type: application/json" \
  -d '{"query": "搜索关键词", "limit": 5}'
```

### 浏览与读取

```bash
# 列出目录
curl -s "http://localhost:3001/api/viking/ls?uri=viking://resources/"

# 读取文件
curl -s "http://localhost:3001/api/viking/read?uri=viking://resources/repo-name/README.md"
```

### 注意

- `addResource` 是异步操作（`wait: false`），语义处理在后台进行
- 仓库路径必须是部署机器上的绝对路径
