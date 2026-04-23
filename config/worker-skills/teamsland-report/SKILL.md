---
name: teamsland-report
description: 向 teamsland 主服务汇报 Worker 的执行进度和最终结果。Worker 执行过程中应定期汇报，任务结束时必须上报结果。
user-invocable: false
allowed-tools:
  - Bash(curl *)
---

# teamsland-report

向 teamsland 主服务上报 Worker 执行进度与最终结果。

## 环境变量

以下环境变量由运行时自动注入，无需手动设置：

- `WORKER_ID` — 当前 Worker 实例 ID
- `TEAMSLAND_API_BASE` — teamsland 服务基础地址（默认 `http://localhost:3001`）

## 上报执行进度

在任务执行过程中，定期上报当前进度：

```bash
curl -s -X POST \
  "${TEAMSLAND_API_BASE}/api/workers/${WORKER_ID}/progress" \
  -H "Content-Type: application/json" \
  -d '{
    "stage": "coding",
    "message": "已完成 3/5 个文件的修改",
    "percent": 60
  }'
```

字段说明：
- `stage` — 当前阶段标识（如 `analyzing`、`coding`、`testing`、`reviewing`）
- `message` — 人类可读的进度描述
- `percent` — 完成百分比（0-100），可选

建议在以下时机上报进度：
1. 开始分析需求时
2. 开始编写代码时
3. 运行测试时
4. 完成代码审查时

## 上报最终结果

任务执行完毕后，必须上报最终结果：

```bash
curl -s -X POST \
  "${TEAMSLAND_API_BASE}/api/workers/${WORKER_ID}/result" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "success",
    "summary": "已完成所有代码修改并通过测试",
    "artifacts": {
      "pr_url": "https://github.com/org/repo/pull/42",
      "branch": "feat/implement-feature-x",
      "files_changed": 5
    }
  }'
```

字段说明：
- `status` — 任务结果状态：`success`、`failure`、`partial`
- `summary` — 结果摘要，简明扼要描述产出
- `artifacts` — 产出物信息（可选），如 PR 链接、分支名、变更文件数等

## 注意事项

- 进度上报频率不宜过高，建议每个关键阶段上报一次
- 任务结束时**必须**调用 result 接口，无论成功或失败
- 失败时 `summary` 应包含失败原因和已完成的部分
- `$WORKER_ID` 和 `$TEAMSLAND_API_BASE` 由运行时注入，Worker 无需关心具体值
