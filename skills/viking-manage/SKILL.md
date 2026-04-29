---
name: viking-manage
description: 管理 OpenViking 知识库资源，包括添加代码仓库、导入飞书文档、搜索知识库。
allowed-tools: Bash(curl *)
---

# viking-manage

管理 OpenViking 知识库资源。

## 能力

- 添加代码仓库：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "/path/to/repo", "to": "viking://resources/{name}/", "wait": false}'

- 添加飞书文档：
  curl -X POST http://localhost:3001/api/viking/resource \
    -H "Content-Type: application/json" \
    -d '{"path": "https://xxx.feishu.cn/docx/xxx", "to": "viking://resources/lark-docs/{title}/", "wait": false}'

- 搜索知识库：
  curl -X POST http://localhost:3001/api/viking/find \
    -H "Content-Type: application/json" \
    -d '{"query": "搜索关键词", "limit": 5}'

- 查看目录：
  curl "http://localhost:3001/api/viking/ls?uri=viking://resources/"

- 读取内容：
  curl "http://localhost:3001/api/viking/read?uri=viking://resources/{name}/README.md"

## 使用场景

当用户要求：
- "帮我加一个仓库" → addResource
- "导入这个飞书文档" → addResource
- "搜一下关于 xxx 的知识" → find
- "看看知识库里有什么" → ls

## 注意

- addResource 是异步操作（wait: false），导入后语义处理在后台进行
- 仓库路径必须是部署机器上的绝对路径
- URI 命名遵循 viking://resources/{name}/ 格式
