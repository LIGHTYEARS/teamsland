---
name: meego-update
description: 更新 Meego 工单状态或添加评论。当任务进度变更、需要记录处理结果、或同步状态到项目管理系统时使用。
user-invocable: false
allowed-tools:
  - Bash(curl *)
---

# meego-update

通过 Meego OpenAPI 更新工单状态或添加评论。

## 环境变量

以下环境变量由运行时自动注入，无需手动设置：

- `MEEGO_API_BASE` — Meego OpenAPI 基础地址（例如 `https://project.feishu.cn/open_api`）
- `MEEGO_PLUGIN_TOKEN` — 插件访问令牌，用于鉴权

## 添加工单评论

向指定工单添加评论，用于记录处理进度或结果：

```bash
curl -s -X POST \
  "${MEEGO_API_BASE}/${PROJECT_KEY}/work_item/${WORK_ITEM_TYPE_KEY}/${WORK_ITEM_ID}/comment/create" \
  -H "Content-Type: application/json" \
  -H "X-PLUGIN-TOKEN: ${MEEGO_PLUGIN_TOKEN}" \
  -d '{
    "content": "Agent 已完成代码变更，PR 链接: https://github.com/org/repo/pull/42"
  }'
```

参数说明：
- `PROJECT_KEY` — 项目标识（如 `project_xxx`）
- `WORK_ITEM_TYPE_KEY` — 工单类型（如 `story`、`bug`、`task`）
- `WORK_ITEM_ID` — 工单 ID

## 更新工单状态

变更工单的流转状态：

```bash
curl -s -X POST \
  "${MEEGO_API_BASE}/${PROJECT_KEY}/work_item/${WORK_ITEM_TYPE_KEY}/${WORK_ITEM_ID}/workflow/transit" \
  -H "Content-Type: application/json" \
  -H "X-PLUGIN-TOKEN: ${MEEGO_PLUGIN_TOKEN}" \
  -d '{
    "transition_id": "TARGET_TRANSITION_ID"
  }'
```

参数说明：
- `transition_id` — 目标流转节点 ID，需根据工单当前状态查询可用流转

## 查询可用流转

在更新状态前，先查询当前工单可执行的流转列表：

```bash
curl -s -X GET \
  "${MEEGO_API_BASE}/${PROJECT_KEY}/work_item/${WORK_ITEM_TYPE_KEY}/${WORK_ITEM_ID}/workflow/query" \
  -H "X-PLUGIN-TOKEN: ${MEEGO_PLUGIN_TOKEN}"
```

## 注意事项

- 所有 API 请求必须携带 `X-PLUGIN-TOKEN` 头
- 评论内容支持纯文本，建议包含关键结论和相关链接
- 状态变更前务必先查询可用流转，避免使用无效的 `transition_id`
- `$PROJECT_KEY`、`$WORK_ITEM_TYPE_KEY`、`$WORK_ITEM_ID` 由上游任务上下文提供
