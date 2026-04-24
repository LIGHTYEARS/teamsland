#!/usr/bin/env bash
# teamsland 一键启动脚本
# 用法:
#   bash scripts/start.sh              — 启动 server + dashboard (默认)
#   bash scripts/start.sh all          — 全量启动 server + dashboard + docs + jaeger + openviking
#   bash scripts/start.sh server       — 仅启动 server
#   bash scripts/start.sh dashboard    — 仅启动 dashboard
#   bash scripts/start.sh docs         — 仅启动 docs
#   bash scripts/start.sh jaeger       — 仅启动 jaeger
#   bash scripts/start.sh openviking   — 仅启动 OpenViking server

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# ── 颜色定义 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }
log_step()  { echo -e "${CYAN}${BOLD}── $* ──${NC}"; }

# ── 前置检查 ──
check_prerequisites() {
  log_step "检查前置依赖"

  if ! command -v bun &>/dev/null; then
    log_error "未找到 bun，请先安装: https://bun.sh"
    exit 1
  fi
  log_info "bun $(bun --version)"

  if [[ "$MODE" == *"jaeger"* ]] || [[ "$MODE" == "all" ]]; then
    if ! command -v docker &>/dev/null; then
      log_warn "未找到 docker，Jaeger 将无法启动"
      SKIP_JAEGER=true
    else
      log_info "docker $(docker --version | rg -o '[0-9]+\.[0-9]+\.[0-9]+')"
      SKIP_JAEGER=false
    fi
  fi

  if [[ "$MODE" == *"openviking"* ]] || [[ "$MODE" == "all" ]]; then
    if ! command -v openviking-server &>/dev/null; then
      log_warn "未找到 openviking-server，OpenViking 将无法启动"
      SKIP_OPENVIKING=true
    else
      log_info "openviking-server 已安装"
      SKIP_OPENVIKING=false
    fi
  fi
}

# ── 环境变量 ──
ensure_env() {
  log_step "检查环境变量"

  if [[ ! -f ".env" ]]; then
    if [[ -f ".env.example" ]]; then
      cp .env.example .env
      log_warn "已从 .env.example 复制到 .env，请编辑填写实际值"
    else
      log_warn "未找到 .env 文件，部分功能可能不可用"
    fi
  else
    log_info ".env 已存在"
  fi
}

# ── 安装依赖 ──
install_deps() {
  log_step "安装依赖"

  if [[ ! -d "node_modules" ]]; then
    log_info "执行 bun install ..."
    bun install
  else
    log_info "node_modules 已存在，跳过安装（如需更新请手动执行 bun install）"
  fi
}

# ── 数据目录 ──
ensure_data_dirs() {
  log_step "初始化数据目录"
  mkdir -p data
  mkdir -p data/openviking
  log_info "data/ 目录已就绪"
}

# ── 启动 Jaeger ──
start_jaeger() {
  if [[ "${SKIP_JAEGER:-false}" == "true" ]]; then
    log_warn "跳过 Jaeger 启动"
    return
  fi

  log_step "启动 Jaeger (Tracing)"

  if docker ps --format '{{.Names}}' 2>/dev/null | rg -q 'jaeger'; then
    log_info "Jaeger 已在运行"
  else
    docker compose up -d jaeger
    log_info "Jaeger UI:   http://localhost:16686"
    log_info "Jaeger OTLP: http://localhost:4318"
  fi
}

# ── 启动 OpenViking ──
start_openviking() {
  if [[ "${SKIP_OPENVIKING:-false}" == "true" ]]; then
    log_warn "跳过 OpenViking 启动"
    return
  fi

  log_step "启动 OpenViking Server"
  log_info "OpenViking API: http://localhost:1933"
  openviking-server --config config/openviking.conf &
  PIDS+=($!)
}

# ── 启动 Server ──
start_server() {
  log_step "启动 Server"
  log_info "Server (API + WebSocket): http://localhost:3001"
  bun run dev &
  PIDS+=($!)
}

# ── 启动 Dashboard ──
start_dashboard() {
  log_step "启动 Dashboard"
  log_info "Dashboard Dev: http://localhost:5173"
  bun run dev:dashboard &
  PIDS+=($!)
}

# ── 启动 Docs ──
start_docs() {
  log_step "启动 Docs"
  log_info "Docs Site: http://localhost:3008"
  bun run dev:docs &
  PIDS+=($!)
}

# ── 打印摘要 ──
print_summary() {
  echo ""
  log_step "启动完成"
  echo -e "${BOLD}服务地址:${NC}"
  case "$MODE" in
    all)
      echo -e "  Server API  :  ${CYAN}http://localhost:3001${NC}"
      echo -e "  Dashboard   :  ${CYAN}http://localhost:5173${NC}"
      echo -e "  Docs        :  ${CYAN}http://localhost:3008${NC}"
      [[ "${SKIP_JAEGER:-false}" != "true" ]] && echo -e "  Jaeger UI   :  ${CYAN}http://localhost:16686${NC}"
      [[ "${SKIP_OPENVIKING:-false}" != "true" ]] && echo -e "  OpenViking  :  ${CYAN}http://localhost:1933${NC}"
      ;;
    server)
      echo -e "  Server API  :  ${CYAN}http://localhost:3001${NC}"
      ;;
    dashboard)
      echo -e "  Dashboard   :  ${CYAN}http://localhost:5173${NC}"
      ;;
    docs)
      echo -e "  Docs        :  ${CYAN}http://localhost:3008${NC}"
      ;;
    jaeger)
      [[ "${SKIP_JAEGER:-false}" != "true" ]] && echo -e "  Jaeger UI   :  ${CYAN}http://localhost:16686${NC}"
      ;;
    openviking)
      [[ "${SKIP_OPENVIKING:-false}" != "true" ]] && echo -e "  OpenViking  :  ${CYAN}http://localhost:1933${NC}"
      ;;
    *)
      echo -e "  Server API  :  ${CYAN}http://localhost:3001${NC}"
      echo -e "  Dashboard   :  ${CYAN}http://localhost:5173${NC}"
      ;;
  esac
  echo ""
  echo -e "${BOLD}快捷操作:${NC}"
  echo -e "  Ctrl+C     停止所有服务"
  echo -e "  bun test   运行测试"
  echo -e "  bun run lint  代码检查"
  echo ""
}

# ── 优雅退出 ──
cleanup() {
  echo ""
  log_info "正在停止所有服务..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  log_info "所有服务已停止"
}

# ── 主流程 ──
main() {
  MODE="${1:-default}"
  PIDS=()
  SKIP_JAEGER=false
  SKIP_OPENVIKING=false

  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║       Teamsland 启动脚本             ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════╝${NC}"
  echo ""

  check_prerequisites
  ensure_env
  install_deps
  ensure_data_dirs

  trap cleanup EXIT INT TERM

  case "$MODE" in
    all)
      start_jaeger
      start_openviking
      start_server
      start_dashboard
      start_docs
      ;;
    server)
      start_server
      ;;
    dashboard)
      start_dashboard
      ;;
    docs)
      start_docs
      ;;
    jaeger)
      start_jaeger
      ;;
    openviking)
      start_openviking
      ;;
    default)
      start_server
      start_dashboard
      ;;
    *)
      log_error "未知模式: $MODE"
      echo "用法: bash scripts/start.sh [all|server|dashboard|docs|jaeger|openviking]"
      exit 1
      ;;
  esac

  print_summary

  if [[ ${#PIDS[@]} -gt 0 ]]; then
    wait "${PIDS[@]}"
  fi
}

main "$@"
