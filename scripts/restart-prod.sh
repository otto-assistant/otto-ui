#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# restart-prod.sh — one-button refresh of the production stack
#   Stops dev (port conflict), optionally rebuilds dist, restarts
#   otto-prod.service (or CLI daemon fallback), waits for health,
#   and on failure prints a ready-to-paste OpenCode debug prompt.
#
# Usage:
#   ./scripts/restart-prod.sh            # restart only
#   ./scripts/restart-prod.sh --rebuild  # build:web then restart
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE="${OPENCHAMBER_PROD_SERVICE:-otto-prod.service}"
DEV_SERVICE="${OPENCHAMBER_DEV_SERVICE:-otto-dev.service}"
UI_PORT="${OPENCHAMBER_PROD_PORT:-${OPENCHAMBER_HMR_UI_PORT:-5180}}"
CLI="${WORKDIR}/packages/web/bin/cli.js"
DIST_INDEX="${WORKDIR}/packages/web/dist/index.html"
LOG_FILE="/tmp/otto-prod-restart.log"
BUN="${BUN:-bun}"
NODE="${NODE:-node}"

REBUILD=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--rebuild]

Options:
  --rebuild   Run \`bun run build:web\` before restart
  -h, --help  Show this help
EOF
}

for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

: >"$LOG_FILE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄  Otto Prod — Повний рестарт"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

has_systemd_unit() {
  systemctl cat "$1" >/dev/null 2>&1
}

wait_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"
  local delay="${4:-1}"
  local i=1
  while [ "$i" -le "$attempts" ]; do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep "$delay"
    i=$((i + 1))
  done
  echo "  timeout: ${label} (${url})" | tee -a "$LOG_FILE" >&2
  return 1
}

cli_instance_running() {
  if [ ! -f "$CLI" ]; then
    return 1
  fi
  local status_out
  status_out=$("$NODE" "$CLI" status --port "$UI_PORT" --quiet 2>/dev/null || true)
  if echo "$status_out" | grep -q "^port ${UI_PORT} "; then
    return 0
  fi
  status_out=$("$NODE" "$CLI" status --quiet 2>/dev/null || true)
  echo "$status_out" | grep -q "^port ${UI_PORT} " && return 0
  return 1
}

# ── 1. Status before ─────────────────────────────────────────
echo ""
echo "▸ Поточний стан:"

DEV_ACTIVE=0
if systemctl is-active "$DEV_SERVICE" >/dev/null 2>&1; then
  DEV_ACTIVE=1
  echo "  ⚠️  ${DEV_SERVICE} — active (буде зупинено)"
else
  echo "  ✅ ${DEV_SERVICE} — inactive"
fi

RESTART_MODE="cli"
if has_systemd_unit "$SERVICE"; then
  RESTART_MODE="systemd"
  if systemctl is-active "$SERVICE" >/dev/null 2>&1; then
    echo "  ✅ ${SERVICE} — active"
  else
    echo "  ❌ ${SERVICE} — inactive/unknown"
  fi
else
  echo "  ℹ️  ${SERVICE} — unit не знайдено (режим CLI daemon)"
  if cli_instance_running; then
    echo "  ✅ OpenChamber daemon — running (port ${UI_PORT})"
  else
    echo "  ❌ OpenChamber daemon — not running (port ${UI_PORT})"
  fi
fi

if [ ! -f "$DIST_INDEX" ]; then
  echo ""
  echo "  ❌ Відсутній production build: packages/web/dist/index.html"
  echo "     Запусти: $(basename "$0") --rebuild"
  exit 1
fi

# ── 2. Optional rebuild ──────────────────────────────────────
if [ "$REBUILD" -eq 1 ]; then
  echo ""
  echo "▸ Збираємо production build (bun run build:web)..."
  if ! command -v "$BUN" >/dev/null 2>&1; then
    echo "  ❌ bun не знайдено в PATH" | tee -a "$LOG_FILE"
    exit 1
  fi
  (cd "$WORKDIR" && "$BUN" run build:web) 2>&1 | tee -a "$LOG_FILE"
  if [ ! -f "$DIST_INDEX" ]; then
    echo "  ❌ build завершився, але dist/index.html відсутній" | tee -a "$LOG_FILE"
    exit 1
  fi
  echo "  ✅ Build готовий"
fi

# ── 3. Stop dev (shared port) ────────────────────────────────
if [ "$DEV_ACTIVE" -eq 1 ]; then
  echo ""
  echo "▸ Зупиняємо dev (${DEV_SERVICE}) — порт ${UI_PORT} потрібен для prod..."
  sudo systemctl stop "$DEV_SERVICE" 2>&1 | tee -a "$LOG_FILE" || true
  sudo systemctl disable "$DEV_SERVICE" >/dev/null 2>&1 || true
  sleep 2
  echo "  ✅ Dev зупинено"
fi

# ── 4. Restart prod ──────────────────────────────────────────
echo ""
RESTART_EXIT=0

if [ "$RESTART_MODE" = "systemd" ]; then
  echo "▸ Рестарт ${SERVICE}..."
  if ! sudo systemctl restart "$SERVICE" 2>&1 | tee -a "$LOG_FILE"; then
    RESTART_EXIT=$?
    echo "  ❌ systemctl restart завершився з кодом $RESTART_EXIT" | tee -a "$LOG_FILE"
  fi
else
  echo "▸ Рестарт OpenChamber daemon (port ${UI_PORT})..."
  if ! command -v "$NODE" >/dev/null 2>&1; then
    echo "  ❌ node не знайдено в PATH" | tee -a "$LOG_FILE"
    exit 1
  fi
  if [ ! -f "$CLI" ]; then
    echo "  ❌ CLI не знайдено: $CLI" | tee -a "$LOG_FILE"
    exit 1
  fi

  if cli_instance_running; then
    if ! OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
      "$NODE" "$CLI" restart --port "$UI_PORT" --quiet 2>&1 | tee -a "$LOG_FILE"; then
      RESTART_EXIT=$?
      echo "  ❌ CLI restart завершився з кодом $RESTART_EXIT" | tee -a "$LOG_FILE"
    fi
  else
    if ! OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true \
      "$NODE" "$CLI" serve --lan --port "$UI_PORT" --quiet 2>&1 | tee -a "$LOG_FILE"; then
      RESTART_EXIT=$?
      echo "  ❌ CLI serve завершився з кодом $RESTART_EXIT" | tee -a "$LOG_FILE"
    fi
  fi
fi

# ── 5. Wait for healthy ──────────────────────────────────────
echo ""
echo "▸ Чекаємо поки prod підніметься (до 30s)..."
sleep 3

ACTIVE="unknown"
if [ "$RESTART_MODE" = "systemd" ]; then
  if systemctl is-active "$SERVICE" >/dev/null 2>&1; then
    ACTIVE="active"
  else
    ACTIVE="inactive"
  fi
else
  if cli_instance_running; then
    ACTIVE="active"
  else
    ACTIVE="inactive"
  fi
fi

UI_OK=0
HEALTH_OK=0
wait_http "http://127.0.0.1:${UI_PORT}/" "UI" 30 1 && UI_OK=1 || true
wait_http "http://127.0.0.1:${UI_PORT}/health" "API /health" 30 1 && HEALTH_OK=1 || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$ACTIVE" = "active" ] && [ "$UI_OK" -eq 1 ] && [ "$HEALTH_OK" -eq 1 ]; then
  echo "  ✅  ВСЕ ПРАЦЮЄ"
  echo ""
  echo "     URL: http://127.0.0.1:${UI_PORT}/"
  echo "     Health: http://127.0.0.1:${UI_PORT}/health"
  if [ "$RESTART_MODE" = "systemd" ]; then
    echo "     Service: ${SERVICE}"
  else
    echo "     Mode: CLI daemon"
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

echo "  ❌  ЩОСЬ ПІШЛО НЕ ТАК"
echo ""
echo "     Статус:           ${ACTIVE}"
echo "     UI (${UI_PORT}):     $([ "$UI_OK" -eq 1 ] && echo "✅" || echo "❌")"
echo "     /health:          $([ "$HEALTH_OK" -eq 1 ] && echo "✅" || echo "❌")"
echo "     Режим:            ${RESTART_MODE}"
echo ""

if [ "$RESTART_MODE" = "systemd" ]; then
  JOURNAL=$(journalctl -u "$SERVICE" --since "2 minutes ago" --no-pager -n 80 2>/dev/null || echo "journalctl unavailable")
  LOG_HINT="sudo journalctl -u $SERVICE --since '2 minutes ago' --no-pager -n 80"
  START_CMD="systemd unit ${SERVICE}"
else
  JOURNAL=$("$NODE" "$CLI" logs --port "$UI_PORT" --lines 80 --no-follow --quiet 2>/dev/null || echo "CLI logs unavailable")
  LOG_HINT="$NODE $CLI logs --port $UI_PORT --lines 80 --no-follow"
  START_CMD="OPENCHAMBER_ALLOW_UNAUTHENTICATED_LAN=true $NODE $CLI serve --lan --port $UI_PORT"
fi

echo "━━━━  OPENCODE DEBUG PROMPT  ━━━━"
echo "Скопіюй це повідомлення і відправ в OpenCode (бажано DeepSeek V4 Flash Free):"
echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"
echo ""
cat <<PROMPT
/debug

Prod-сервер Otto UI не запускається після рестарту.

Останні логи:

${JOURNAL}

---
Контекст:
- Робоча директорія: ${WORKDIR}
- Режим рестарту: ${RESTART_MODE}
- Команда запуску: ${START_CMD}
- Система: $(uname -a)
- Bun: $($BUN --version 2>/dev/null || echo "N/A")
- Node: $($NODE --version 2>/dev/null || echo "N/A")
- Build: $([ -f "$DIST_INDEX" ] && echo "dist OK" || echo "dist MISSING")
- Перевірка: UI на http://127.0.0.1:${UI_PORT}/ $([ "$UI_OK" -eq 1 ] && echo "ОК" || echo "НЕ ВІДПОВІДАЄ")
- Перевірка: /health на http://127.0.0.1:${UI_PORT}/health $([ "$HEALTH_OK" -eq 1 ] && echo "ОК" || echo "НЕ ВІДПОВІДАЄ")

Продіагностуй проблему і виправ щоб prod запустився.
PROMPT
echo ""
echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"
echo "Або виконай вручну:"
echo "  ${LOG_HINT}"
if [ "$RESTART_MODE" = "cli" ] && ! has_systemd_unit "$SERVICE"; then
  echo ""
  echo "Для постійного prod через systemd скопіюй unit:"
  echo "  sudo cp ${SCRIPT_DIR}/otto-prod.service /etc/systemd/system/"
  echo "  sudo systemctl daemon-reload && sudo systemctl enable --now otto-prod.service"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 1
