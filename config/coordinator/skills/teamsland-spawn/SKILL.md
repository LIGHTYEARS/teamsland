---
name: teamsland-spawn
description: Spawn and manage teamsland workers. Use when you need to delegate a task to a worker agent, check worker status, get results, or cancel a running worker. Workers run as independent Claude Code sessions in isolated git worktrees.
allowed-tools: Bash(teamsland *)
---

# teamsland Worker Management

You can spawn, monitor, and manage worker agents using the `teamsland` CLI.

## Spawning a Worker

To delegate a task to a worker, use `teamsland spawn`. The task prompt MUST be passed via single-quoted heredoc to prevent shell expansion.

### New task (creates a fresh worktree):

```bash
teamsland spawn --repo <repo-path> --task "$(cat <<'EOF'
<task prompt here>
EOF
)"
```

### Resume / continue in existing worktree:

```bash
teamsland spawn --worktree <worktree-path> --task "$(cat <<'EOF'
<task prompt with context from previous worker>
EOF
)"
```

### With metadata:

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

## CRITICAL: Heredoc quoting

Always use `'EOF'` (single-quoted) — NOT `EOF` (unquoted). Task prompts may contain `$variables`, backticks, and special characters that must NOT be expanded by the shell.

```bash
# CORRECT — single-quoted EOF prevents all expansion
teamsland spawn --repo /path --task "$(cat <<'EOF'
Check $revenue and `conversion_rate`
EOF
)"

# WRONG — unquoted EOF causes $revenue to expand and backticks to execute
teamsland spawn --repo /path --task "$(cat <<EOF
Check $revenue and `conversion_rate`
EOF
)"
```

## Checking Worker Status

```bash
# List all workers
teamsland list

# Get detailed status of a specific worker
teamsland status <worker-id>

# Get only the result (for completed workers)
teamsland result <worker-id>

# Get transcript file path (for observation)
teamsland transcript <worker-id>
```

## Cancelling a Worker

```bash
# Graceful stop (SIGINT)
teamsland cancel <worker-id>

# Force kill (SIGKILL)
teamsland cancel <worker-id> --force
```

## Spawning an Observer Worker

To check on a running worker's progress, spawn an observer:

```bash
TRANSCRIPT=$(teamsland transcript <target-worker-id> --json | jq -r '.transcriptPath')

teamsland spawn --repo <same-repo> \
  --parent <target-worker-id> \
  --task "$(cat <<'EOF'
Read the session transcript at: $TRANSCRIPT_PATH
Summarize current progress and report back.
EOF
)"
```

## Workflow: Cancel and Resume

When a worker needs correction:

```bash
# 1. Cancel the running worker
teamsland cancel <worker-id>

# 2. Get the worktree path
WORKTREE=$(teamsland status <worker-id> --json | jq -r '.worktreePath')

# 3. Spawn a new worker in the same worktree
teamsland spawn --worktree "$WORKTREE" --task "$(cat <<'EOF'
Continue in this worktree. Previous worker summary:
[summary from observer]

Correction: [what to fix]
EOF
)"
```

## Output Format

By default, output is human-readable. Add `--json` for machine-parseable JSON output:

```bash
teamsland list --json
teamsland status <worker-id> --json
```

## Available Repos

Refer to CLAUDE.md for the list of team repositories and their paths.
