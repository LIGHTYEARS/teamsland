---
name: memory-management
description: 管理 OpenViking 长期记忆，与 Claude Code 内置记忆互补，用于存储事实、经历、经验等低频访问的被动记忆
allowed-tools: Bash(teamsland memory *)
---

# 记忆管理

你有两套记忆系统，各有分工：

## 记忆分层

### Claude Code 内置记忆（CLAUDE.md / .claude/memory/）

定位：主动记忆，人格与约束层。

每次对话都会加载，适合存放：
- 身份与角色定义
- 行为约束与决策规则
- 团队背景与组织结构
- 协作偏好

特点：高频访问、小体量、每次对话都需要。

### OpenViking 记忆（teamsland memory 命令）

定位：被动记忆，事实与经验层。

按需语义检索，适合存放：
- 具体事件和经历
- 问题-方案案例
- 用户的具体偏好细节
- 项目事实
- 工作流经验

特点：低频访问、可能大体量、需要时语义检索召回。

## 判断标准

| 问自己 | Claude Code 内置 | OpenViking |
| --- | --- | --- |
| 几乎每次对话都需要？ | 是 | 否 |
| 是身份、约束、大方向？ | 是 | 否 |
| 是具体事件、案例、事实？ | 否 | 是 |
| 内容会随时间积累变多？ | 否，应精简 | 是，正常积累 |
| 需要语义检索才能找到？ | 否，全量加载 | 是 |

灰色地带：如果一条信息现在高频使用但未来会降频，先放 OpenViking，等确认长期有效后再考虑是否提升到 Claude Code 内置记忆。

## 何时主动记忆

- 任务执行中发现的可复用经验，包括踩坑、解法、最佳实践
- 用户明确表达但不属于每次对话都要知道的偏好细节
- 重要的项目事实和技术决策的背景原因
- 不要记忆：可以从代码或 git 历史直接获取的信息
- 不要记忆：临时的、仅当前对话有用的上下文

## 何时主动检索

Agent 记忆不会自动注入你的上下文。当你认为历史经验可能对当前任务有帮助时，主动使用 `teamsland memory find` 检索。典型场景：
- 处理一个类似之前解决过的问题
- 用户提到了某个你可能记录过的项目或技术细节
- 需要回忆某个团队约定或流程

## URI 命名空间

| 类型 | URI 前缀 | 何时使用 |
| --- | --- | --- |
| Agent 记忆 | `viking://agent/teamsland/memories/` | 团队级知识、工作模式、技术决策 |
| 用户记忆 | `viking://user/<userId>/memories/` | 特定用户的偏好和背景 |
| 资源 | `viking://resources/` | 文档、任务记录等结构化资源 |

## 常用操作

### 记住新知识

```bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "## 热修复部署流程\n\n1. 从 main 拉分支 ..." \
  --mode create
```

### 检索相关记忆

```bash
teamsland memory find "部署流程" --scope agent --limit 5
```

### 更新已有记忆

```bash
teamsland memory write viking://agent/teamsland/memories/cases/deploy-hotfix.md \
  --content "更新后的内容..." --mode replace
```

### 浏览记忆结构

```bash
teamsland memory ls viking://agent/teamsland/memories/ --recursive
```

### 删除过时记忆

```bash
teamsland memory rm viking://agent/teamsland/memories/cases/outdated.md
```

### 查看摘要

```bash
teamsland memory abstract viking://agent/teamsland/memories/cases/
```

## scope 快捷方式

`--scope agent` -> `viking://agent/teamsland/memories/`
`--scope user --user <id>` -> `viking://user/<id>/memories/`
`--scope tasks` -> `viking://resources/tasks/`
`--scope resources` -> `viking://resources/`

## 记忆文件规范

- 使用 Markdown 格式，文件名语义化，如 `deploy-hotfix.md`、`alice-preferences.md`
- cases/ 下存问题-方案案例
- patterns/ 下存交互模式和工作流
- preferences/ 下存用户偏好，放在对应用户的 URI 下
- 记忆内容简洁，聚焦为什么和怎么做，避免冗余
