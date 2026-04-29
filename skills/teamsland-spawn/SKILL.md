---
name: teamsland-spawn
description: Spawn and manage teamsland workers. Use when you need to delegate a task to a worker agent, check worker status, get results, or cancel a running worker.
allowed-tools: Bash(teamsland *)
---

# teamsland Worker Management

## Spawning a Worker

```bash
teamsland spawn --repo <repo-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

## Resume in Existing Worktree

```bash
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

## With Metadata

```bash
teamsland spawn --repo <repo-path> \
  --task-brief "简短描述" \
  --origin-chat "oc_xxx" \
  --origin-sender "ou_xxx" \
  --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

## Injecting Rules via System Prompt

When a worker must strictly follow specific rules (coding standards, output format, constraints), use `--append-system-prompt` to inject them as system-level instructions rather than embedding in the task prompt:

```bash
teamsland spawn --repo <repo-path> \
  --append-system-prompt "$(cat <<'EOF'
你必须使用中文回复。
所有代码修改必须附带单元测试。
禁止修改 package.json 的 dependencies。
EOF
)" \
  --task "$(cat <<'EOF'
修复 AuthService 的 token 过期处理逻辑。
EOF
)"
```

System prompt 规则与 task prompt 的区别：
- `--append-system-prompt`: 作为系统指令注入，worker 会将其视为硬性约束
- `--task`: 作为用户消息发送，worker 视为任务描述

## Checking Status

```bash
teamsland list
teamsland status <worker-id>
teamsland result <worker-id>
```

## Cancelling

```bash
teamsland cancel <worker-id>
teamsland cancel <worker-id> --force
```

## CRITICAL: Always use single-quoted EOF

Always use `'EOF'` (single-quoted) to prevent shell expansion of `$variables` and backticks.
