#!/bin/bash
# 部署 Coordinator 工作目录到 ~/.teamsland/coordinator/
# 用法: bash scripts/setup-coordinator.sh

set -euo pipefail

COORDINATOR_DIR="$HOME/.teamsland/coordinator"
SKILL_DIR="$COORDINATOR_DIR/.claude/skills/teamsland-spawn"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Setting up Coordinator at: $COORDINATOR_DIR"

mkdir -p "$SKILL_DIR"

cp "$PROJECT_DIR/config/coordinator/CLAUDE.md" "$COORDINATOR_DIR/CLAUDE.md"
cp "$PROJECT_DIR/config/coordinator/skills/teamsland-spawn/SKILL.md" "$SKILL_DIR/SKILL.md"

echo "Coordinator setup complete."
echo "  CLAUDE.md -> $COORDINATOR_DIR/CLAUDE.md"
echo "  SKILL.md  -> $SKILL_DIR/SKILL.md"
echo ""
echo "To start the Coordinator:"
echo "  cd $COORDINATOR_DIR && claude"
