/**
 * 生成 handle-meego-issue workflow 内容
 *
 * @returns handle-meego-issue.md 文件内容
 */
export function generateHandleMeegoIssueWorkflow(): string {
  return `# 处理新 Meego 工单

当收到 {source: "meego", sourceEvent: "issue.created"} 时的推荐流程。

## 步骤

### 1. 深度采集
teamsland ticket status <issue-id> --set enriching
teamsland ticket enrich <issue-id>
# 或手动逐步执行：
#   teamsland meego get <issue-id>
#   提取飞书文档 URL
#   teamsland lark doc-read <url>（每个文档）

### 2. 智能分诊
仔细阅读 enriching 产出的完整上下文，评估：
- 需求是否清晰？PRD 有验收标准吗？描述够 Worker 执行吗？
- 仓库能确定吗？对照 \`.claude/rules/repo-mapping.md\` + enriching 提取的模块路径推理
- 这个工单需要自动处理吗？

teamsland ticket status <issue-id> --set triaging

根据评估结果：
- 清晰充分 → \`teamsland ticket status <issue-id> --set ready\`
- 信息不足 → \`teamsland ask --to <creator> --ticket <issue-id> --text "请补充..."\`
- 无需处理 → \`teamsland ticket status <issue-id> --set skipped\`

### 3. 执行
teamsland ticket status <issue-id> --set executing
teamsland worker spawn --repo <repo> --role <role> --prompt <指令>
# 指令中应包含：工单摘要 + PRD 要点 + 技术方案要点 + 验收标准

### 4. 通知
teamsland lark send --to <相关人员/群> --text "已开始处理 <issue-id>: <title>"

## 可以偏离的场景
- 工单已有人类 assignee（非 bot）→ 可能只需通知，不 spawn
- 工单标题含"紧急"/"P0" → 优先处理，考虑中断低优先级 Worker
- 同一 issue 已有 Worker 在运行 → 不重复 spawn
- enriching 阶段没有找到飞书文档 → 仍然可以继续，但 triaging 时应评估信息是否足够
- 追问超时（suspended）→ 通知团队群，记录原因
`;
}
