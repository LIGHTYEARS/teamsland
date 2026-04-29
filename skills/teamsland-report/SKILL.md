---
name: teamsland-report
description: 向 teamsland 主服务汇报 Worker 的执行进度和最终结果。Worker 执行过程中应定期汇报，任务结束时必须上报结果。
user-invocable: false
allowed-tools:
  - Bash(teamsland report *)
---

# Worker 进度与结果上报

通过 `teamsland report` 命令向主服务上报执行状态。

环境变量 `WORKER_ID` 和 `TEAMSLAND_SERVER` 由运行时自动注入，无需手动设置。

---

## 上报进度

在关键阶段切换时上报：

```bash
teamsland report progress "$WORKER_ID" \
  --phase analyzing \
  --summary "正在阅读需求文档和相关代码"
```

```bash
teamsland report progress "$WORKER_ID" \
  --phase coding \
  --summary "已完成 3/5 个文件的修改"
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--phase` | 是 | 当前阶段：`analyzing` `coding` `testing` `reviewing` |
| `--summary` | 是 | 人类可读的进度描述 |
| `--details` | 否 | 补充细节（如变更文件列表） |

### 上报时机

1. 开始分析需求
2. 开始编写代码
3. 运行测试
4. 提交代码审查

频率不宜过高，每个阶段上报一次即可。

---

## 上报最终结果

任务结束时**必须**上报结果，无论成功或失败：

```bash
teamsland report result "$WORKER_ID" \
  --status success \
  --summary "已完成所有代码修改并通过测试" \
  --artifacts '{"pr_url":"https://github.com/org/repo/pull/42","branch":"feat/feature-x","files_changed":5}'
```

```bash
teamsland report result "$WORKER_ID" \
  --status failed \
  --summary "测试未通过：3 个用例失败，涉及权限校验逻辑"
```

### 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--status` | 是 | `success`：任务完成 / `failed`：任务失败 / `blocked`：被阻塞无法继续 |
| `--summary` | 是 | 结果摘要 |
| `--artifacts` | 否 | JSON 格式的产出物信息（PR URL、分支名、变更文件数等） |

### 失败上报要求

失败时 `--summary` 必须包含：
- 失败原因
- 已完成的部分（如果有）
- 建议的后续操作（如果明确）
