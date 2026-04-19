# Swarm 方案设计与执行（Swarm Design & Execution）

> 本文档拆分自「团队 AI 协作平台分层架构设计 v2.0」§2.6

> **TL;DR**
> - 采用 Architect Agent + Worker Agents 的 Swarm 模式，Worker 受沙盒约束（禁止递归委派、自行 spawn、直接写记忆）
> - TaskPlanner 将任务分解为 SubTask DAG，runSwarm 按依赖顺序并发执行并做 quorum 校验
> - Architect Agent 负责生成前端技术方案：加载模板 → 分派 repo-scan/prd-parse 等 Worker → 汇聚产出 → 人工确认
> - Worker 超时上限 300s，最大委派深度 2 层

**借鉴 hermes-agent delegate_tool.py 的沙盒设计**：

```text
Orchestrator Agent
  ├── 从 Memory 层召回上下文（详见 [核心类型与团队记忆层](02-core-types-and-memory.md)）
  ├── 调用 TaskPlanner 分解任务为 SubTask DAG
  └── 路由给专项 Agent

专项 Agent 角色：
  ├── Architect Agent     ← 新增，专责生成前端技术方案
  │   ├── 通过 Skill 加载技术方案模板
  │   ├── 调用 repo-scan Worker 分析仓库结构
  │   └── 汇聚 Worker 产出，生成最终方案文档
  └── Worker Agents (Swarm)
      └── 约束：
          DELEGATE_BLOCKED_TOOLS = [
            "delegate",        # 禁止递归委派
            "spawn_agent",     # 禁止自行 spawn
            "memory_write",    # Worker 不直接写团队记忆
          ]
          MAX_DEPTH = 2
          TIMEOUT_SECONDS = 300
```

**Architect Agent 工作流**：

```text
触发：Meego 进入前端开发节点（详见 [Meego 状态监听与意图识别](04-meego-and-intent.md)）
  │
  ▼
[Architect Agent] 加载技术方案模板 Skill
  ├── Worker-A: repo-scan（分析目标仓库结构，输出 JSON 摘要）
  ├── Worker-B: prd-parse（解析 PRD 关键功能点）
  └── Worker-C: api-check（梳理涉及的后端接口）
  │
  ▼
[Architect Agent] 汇聚产出 → 按模板填充 → 写飞书文档
  → 多仓库需求时：合并为一份方案（各仓库分节描述）
  → lark-cli doc create → 私聊负责人确认
```

**SubTask DAG 示例（PRD → 技术方案）**：

```text
PRD 摄入
  ├── [并行]
  │   ├── Worker-A: 分析模块拆分
  │   ├── Worker-B: 识别 API 接口
  │   └── Worker-C: 识别数据模型
  └── [汇聚] Orchestrator 合并为技术方案草稿
       └── Worker-D: 生成接口文档
            └── Action: lark-cli doc create + 推送飞书群
```

**结果聚合**：

```typescript
// src/swarm/runner.ts
export async function runSwarm(task: ComplexTask): Promise<SwarmResult> {
  const subtasks = taskPlanner.decompose(task);

  // 并行执行，带超时（Promise.allSettled 保证全部完成）
  const results = await Promise.allSettled(
    subtasks.map((subtask) =>
      Promise.race([
        runWorker(subtask),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 300_000), // from config/swarm.yaml → swarm.worker_timeout_ms
        ),
      ]),
    ),
  );

  // 失败子任务记录到 Memory cases 层（详见 [核心类型与团队记忆层](02-core-types-and-memory.md)）
  const failures = results.filter((r) => r.status === "rejected");
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  if (failures.length > 0) {
    await memory.write("cases", {
      taskId: task.id,
      failures: failures.map((f) => (f as PromiseRejectedResult).reason?.message),
      timestamp: Date.now(),
    });
  }

  // 最低成功率校验：至少 50% 子任务成功，否则拒绝合并（防止不完整方案）
  const MIN_SUCCESS_RATIO = 0.5; // from config/swarm.yaml → swarm.min_success_ratio
  if (fulfilled.length / results.length < MIN_SUCCESS_RATIO) {
    throw new Error(
      `Swarm quorum not met: ${fulfilled.length}/${results.length} succeeded (need ≥${MIN_SUCCESS_RATIO * 100}%)`,
    );
  }

  return orchestrator.merge(results);
}
```

---
[← 上一篇: Meego 状态监听与意图识别](04-meego-and-intent.md) | [目录](README.md) | [下一篇: Sidecar 控制面与 Session 持久化 →](06-sidecar-and-session.md)
