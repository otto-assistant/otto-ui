#!/usr/bin/env bash
# Manage OpenChamber dev (Vite HMR + API) vs prod (built static + API) runtimes.
#
# Usage:
#   ./scripts/openchamber-runtime.sh rebuild
#   ./scripts/openchamber-runtime.sh dev
#   ./scripts/openchamber-runtime.sh prod
#   ./scripts/openchamber-runtime.sh status
#   ./scripts/openchamber-runtime.sh rebuild dev
#   ./scripts/openchamber-runtime.sh rebuild prod
set -euo pipefail

WORKDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_SERVICE="${OPENCHAMBER_DEV_SERVICE:-otto-dev.service}"
UI_PORT="${OPENCHAMBER_HMR_UI_PORT:-5180}"
DEV_API_PORT="${OPENCHAMBER_HMR_API_PORT:-3902}"
CLI="${WORKDIR}/packages/web/bin/cli.js"
BUN="${BUN:-bun}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [command...]

Commands:
  rebuild   Clear Vite/esbuild cache and run \`bun run build:web\`
  dev       Stop prod, enable/start ${DEV_SERVICE} (Vite HMR on :${UI_PORT})
  prod      Stop dev, start production daemon on :${UI_PORT} (LAN / 0.0.0.0)
  status    Show which runtime is active and probe health endpoints

Examples:
  $(basename "$0") rebuild dev
  $(basename "$0") prod
  $(basename "$0") status
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

wait_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"
  local delay="${4:-1}"
  local i=1
  while [ "$i" -le "$attempts" ]; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      echo "  OK  ${label}: ${url}"
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done
  echo "  FAIL ${label}: ${url}" >&2
  return 1
}

clear_caches() {
  echo "Clearing Vite/esbuild cache..."
  rm -rf \
    "${WORKDIR}/packages/web/node_modules/.vite" \
    "${WORKDIR}/packages/web/node_modules/.vite-temp" \
    "${WORKDIR}/node_modules/.cache" 2>/dev/null || true
}

rebuild() {
  require_cmd "$BUN"
  clear_caches
  echo "Running production build (packages/web)..."
  (cd "$WORKDIR" && "$BUN" run build:web)
  echo "Rebuild complete."
}

stop_prod() {
  if [ -f "$CLI" ]; then
    node "$CLI" stop --port "$UI_PORT" >/dev/null 2>&1 || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${UI_PORT}/tcp" 2>/dev/null || true
  fi
}

stop_dev() {
  if systemctl list-unit-files "$DEV_SERVICE" >/dev/null 2>&1; then
    sudo systemctl stop "$DEV_SERVICE" >/dev/null 2>&1 || true
    sudo systemctl disable "$DEV_SERVICE" >/dev/null 2>&1 || true
  fi
  pkill -f "dev-web-hmr.mjs" 2>/dev/null || true
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${UI_PORT}/tcp" "${DEV_API_PORT}/tcp" 2>/dev/null || true
  fi
}

start_dev() {
  require_cmd "$BUN"
  echo "Starting dev runtime (${DEV_SERVICE})..."
  stop_prod
  sleep 1
  sudo systemctl enable "$DEV_SERVICE"
  sudo systemctl restart "$DEV_SERVICE"
  echo "Waiting for dev stack..."
  sleep 8
  wait_http "http://127.0.0.1:${UI_PORT}/" "UI (HMR)" 40 1
  wait_http "http://127.0.0.1:${DEV_API_PORT}/health" "API" 40 1
  echo ""
  echo "Dev ready:"
  echo "  UI:  http://127.0.0.1:${UI_PORT}/  (use this URL for HMR)"
  echo "  API: http://127.0.0.1:${DEV_API_PORT}/"
}

start_prod() {
  require_cmd node
  if [ ! -d "${WORKDIR}/packages/web/dist" ] || [ ! -f "${WORKDIR}/packages/web/dist/index.html" ]; then
    echo "error: packages/web/dist missing — run: $(basename "$0") rebuild" >&2
    exit 1
  fi
  echo "Starting prod runtime on :${UI_PORT}..."
  stop_dev
  sleep 1
  (
    cd "${WORKDIR}/packages/web"
    OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
      node "$CLI" serve --lan -p "$UI_PORT"
  )
  echo "Waiting for prod stack..."
  sleep 3
  wait_http "http://127.0.0.1:${UI_PORT}/" "UI" 30 1
  wait_http "http://127.0.0.1:${UI_PORT}/health" "API" 30 1
  echo ""
  echo "Prod ready:"
  echo "  http://127.0.0.1:${UI_PORT}/"
  echo "  http://192.168.1.200:${UI_PORT}/  (Tailscale/LAN when routed)"
}

show_status() {
  local dev_active=0 prod_active=0
  systemctl is-active "$DEV_SERVICE" >/dev/null 2>&1 && dev_active=1
  if node "$CLI" status 2>/dev/null | grep -q "port ${UI_PORT}"; then
    prod_active=1
  fi

  echo "Runtime status (UI port ${UI_PORT}):"
  if [ "$dev_active" -eq 1 ]; then
    echo "  dev:  active (${DEV_SERVICE})"
  else
    echo "  dev:  inactive"
  fi
  if [ "$prod_active" -eq 1 ]; then
    echo "  prod: active (openchamber daemon)"
  else
    echo "  prod: inactive"
  fi

  echo ""
  curl -sf -o /dev/null -w "  http://127.0.0.1:${UI_PORT}/ -> HTTP %{http_code}\n" "http://127.0.0.1:${UI_PORT}/" 2>/dev/null \
    || echo "  http://127.0.0.1:${UI_PORT}/ -> unreachable"
  if [ "$dev_active" -eq 1 ]; then
    curl -sf -o /dev/null -w "  http://127.0.0.1:${DEV_API_PORT}/health -> HTTP %{http_code}\n" "http://127.0.0.1:${DEV_API_PORT}/health" 2>/dev/null \
      || echo "  http://127.0.0.1:${DEV_API_PORT}/health -> unreachable"
  fi
}

run_command() {
  case "$1" in
    rebuild) rebuild ;;
    dev) start_dev ;;
    prod) start_prod ;;
    status) show_status ;;
    -h|--help|help) usage; exit 0 ;;
    *)
      echo "error: unknown command: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main() {
  if [ "$#" -eq 0 ]; then
    usage
    exit 1
  fi

  for cmd in "$@"; do
    run_command "$cmd"
  done
}

main "$@"
