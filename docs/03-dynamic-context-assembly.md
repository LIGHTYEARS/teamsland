# 动态上下文组装（Dynamic Context Assembly）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.3

> **TL;DR**
> - CLAUDE.md 存放相对稳定的团队规范，首次提示词（initial prompt）每次动态组装当前任务上下文
> - 首次提示词由 5 部分构成：Meego issue 详情、历史方案摘要、可用 Skill 列表、目标仓库信息、任务专属指令
> - DynamicContextAssembler 按 agent_role 路由 Skill，避免全量注入以控制 token 成本
> - 借鉴 multica runtime_config.go 模式，用 TypeScript 实现

**两层区分**：

| 层 | 内容 | 稳定性 | 来源 |
|---|---|---|---|
| `CLAUDE.md`（工作目录） | 团队规范、工具链、代码风格指引 | **相对稳定**，不随每次任务重建 | 人工维护，存入代码仓库或固定路径 |
| **首次提示词**（spawn 时注入） | 当前任务上下文、召回记忆、Skill 列表、仓库信息 | **每次动态组装** | `DynamicContextAssembler` 生成 |

**首次提示词组装维度**：

```text
首次提示词 = [
  §A: 当前 Meego issue 详情    ← 从 MeegoConnector 获取（详见 [Meego 状态监听与意图识别](04-meego-and-intent.md)）
  §B: 相关历史方案摘要          ← Memory L0 全量 + L1 向量召回 top-10（详见 [核心类型与团队记忆层](02-core-types-and-memory.md)）
  §C: 可用 Skill 列表           ← 按 trigger_type 筛选（非全量注入）
  §D: 目标仓库信息              ← 从 repo_mapping 解析 + worktree 路径
  §E: 任务专属指令              ← 按 agent_role 加载（repo-scan/prd-parse/api-check）
]
注意：CLAUDE.md 已在 worktree 中，不在此处重复注入。
```

**实现（借鉴 multica `execenv/runtime_config.go`，TypeScript 实现）**：

```typescript
// src/context/dynamic-context-assembler.ts
export class DynamicContextAssembler {
  /**
   * 每次 spawn Claude Code 前调用，生成任务专属首次提示词。
   * CLAUDE.md（团队规范）已在 worktree 中，不由此处负责。
   */
  async buildInitialPrompt(task: TaskConfig, teamId: string): Promise<string> {
    const sections: string[] = [];

    // §A: Meego issue 详情
    sections.push(this.renderIssue(task.meegoEvent));

    // §B: 相关历史（Memory 召回）
    const recalled = await memoryRetriever.retrieve(task.description, teamId, 10);
    if (recalled.length > 0) sections.push(this.renderHistory(recalled));

    // §C: Skill 列表（按 triggerType 筛选）
    const skills = skillRegistry.getForTrigger(task.triggerType);
    sections.push(this.renderSkills(skills));

    // §D: 仓库 + worktree 信息
    const repos = repoMapping.resolve(task.meegoProjectId);
    sections.push(this.renderRepos(repos, task.worktreePath));

    // §E: 任务专属模板指令
    const template = await this.loadTemplate(task.agentRole);
    if (template) sections.push(template);

    return sections.join("\n\n---\n\n");
  }

  private async loadTemplate(agentRole: string): Promise<string> {
    /**
     * 模板来源（配置决定）：
     * 1. 飞书文档链接 → lark-cli doc read {url}（子进程调用）
     * 2. 固定 Markdown 文件路径 → Bun.file().text()
     */
    const cfg = templateConfig.get(agentRole);
    if (!cfg) return "";
    if (cfg.source === "lark_doc") {
      const result = Bun.spawnSync(["lark-cli", "doc", "read", cfg.url]);
      return result.stdout?.toString() ?? "";
    }
    return Bun.file(cfg.path).text();
  }
}
```

**Spawn 流程**（完整 Sidecar 生命周期详见 [Sidecar 控制面与 Session 持久化](06-sidecar-and-session.md)）：

```typescript
// src/sidecar/spawn.ts
export async function spawnClaudeCode(task: TaskConfig, teamId: string): Promise<string> {
  // 1. 生成任务专属首次提示词
  const assembler = new DynamicContextAssembler();
  const initialPrompt = await assembler.buildInitialPrompt(task, teamId);

  // 2. 通过 ProcessController 启动（CLAUDE.md 已在 worktree）
  return processController.spawnCc({
    issueId: task.issueId,
    worktree: task.worktreePath,
    initialPrompt, // 通过 stdin stream-json 协议注入
  });
}
```

**Skill 筛选规则（按 trigger_type）**：

```yaml
# config/skill_routing.yaml
skill_routing:
  frontend_dev:                      # Meego 进入前端开发节点
    - figma-reader                   # 设计稿读取（后续安装）
    - lark-docs                      # 飞书文档操作
    - git-tools                      # Git 操作
    - architect-template             # 技术方案模板读取
  code_review:                       # CR 节点
    - git-diff                       # diff 分析
    - lark-comment                   # 飞书评论
  bot_query:                         # 飞书 Bot @提及
    - lark-docs
    - lark-base                      # 多维表格查询
  # Worker Agent 不注入 memory_write Skill（防止直接写团队记忆）
```

---
[← 上一篇: 核心类型定义与团队记忆层](02-core-types-and-memory.md) | [目录](README.md) | [下一篇: Meego 状态监听与意图识别 →](04-meego-and-intent.md)
