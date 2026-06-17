#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# restart-dev.sh — one-button refresh of the whole dev stack
#   Restarts otto-dev.service, waits for health, and on
#   failure prints a ready-to-paste OpenCode debug prompt.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SERVICE="otto-dev.service"
UI_PORT="${OPENCHAMBER_HMR_UI_PORT:-5180}"
API_PORT="${OPENCHAMBER_HMR_API_PORT:-3902}"
WORKDIR="/data/projects/otto-ui"
LOG_FILE="/tmp/otto-dev-restart.log"

# Clean log
: >"$LOG_FILE"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄  Otto Dev — Повний рестарт"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── 1. Status before ─────────────────────────────────────────
echo ""
echo "▸ Поточний стан:"
systemctl is-active "$SERVICE" >/dev/null 2>&1 \
  && echo "  ✅ otto-dev.service — active" \
  || echo "  ❌ otto-dev.service — inactive/unknown"

# ── 2. Clear Vite cache ──────────────────────────────────────
echo ""
echo "▸ Чистимо Vite/esbuild кеш..."
rm -rf "${WORKDIR}/packages/web/node_modules/.vite" \
       "${WORKDIR}/packages/web/node_modules/.vite-temp" \
       "${WORKDIR}/node_modules/.cache" 2>/dev/null || true
echo "  ✅ Кеш очищено"

# ── 3. Restart ────────────────────────────────────────────────
echo ""
echo "▸ Рестарт $SERVICE..."
sudo systemctl restart "$SERVICE" 2>&1 | tee -a "$LOG_FILE"
RESTART_EXIT=$?

if [ $RESTART_EXIT -ne 0 ]; then
  echo "  ❌ systemctl restart завершився з кодом $RESTART_EXIT" | tee -a "$LOG_FILE"
fi

# ── 4. Wait for healthy ──────────────────────────────────────
echo ""
echo "▸ Чекаємо 12s поки піднімуться процеси..."
sleep 12

# Check systemd active
ACTIVE="unknown"
if systemctl is-active "$SERVICE" >/dev/null 2>&1; then
  ACTIVE="active"
else
  ACTIVE="inactive"
fi

# Check UI responds
UI_OK=0
curl -sf -o /dev/null "http://127.0.0.1:${UI_PORT}" 2>/dev/null && UI_OK=1 || true

# Check API responds
API_OK=0
curl -sf -o /dev/null "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null \
  || curl -sf -o /dev/null "http://127.0.0.1:${API_PORT}" 2>/dev/null \
  && API_OK=1 || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$ACTIVE" = "active" ] && [ $UI_OK -eq 1 ] && [ $API_OK -eq 1 ]; then
  echo "  ✅  ВСЕ ПРАЦЮЄ"
  echo ""
  echo "     UI:  http://127.0.0.1:${UI_PORT}"
  echo "     API: http://127.0.0.1:${API_PORT}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "  ❌  ЩОСЬ ПІШЛО НЕ ТАК"
  echo ""
  echo "     Статус:        ${ACTIVE}"
  echo "     UI ($UI_PORT):  $([ $UI_OK -eq 1 ] && echo "✅" || echo "❌")"
  echo "     API ($API_PORT): $([ $API_OK -eq 1 ] && echo "✅" || echo "❌")"
  echo ""

  # Capture journal for context
  JOURNAL=$(journalctl -u "$SERVICE" --since "30 seconds ago" --no-pager -n 60 2>/dev/null || echo "journalctl unavailable")

  echo "━━━━  OPENCODE DEBUG PROMPT  ━━━━"
  echo "Скопіюй це повідомлення і відправ в OpenCode (бажано DeepSeek V4 Flash Free):"
  echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"
  echo ""
  cat <<PROMPT
/debug

Dev-сервер Otto UI не запускається після рестарту.

Останні логи (journalctl -u otto-dev.service):

${JOURNAL}

---
Контекст:
- Робоча директорія: ${WORKDIR}
- Команда запуску: bun run dev (scripts/dev-web-hmr.mjs)
- Система: $(uname -a)
- Bun: $(bun --version 2>/dev/null || echo "N/A")
- Node: $(node --version 2>/dev/null || echo "N/A")
- Перевірка: UI на http://127.0.0.1:${UI_PORT} $([ $UI_OK -eq 1 ] && echo "ОК" || echo "НЕ ВІДПОВІДАЄ")
- Перевірка: API на http://127.0.0.1:${API_PORT} $([ $API_OK -eq 1 ] && echo "ОК" || echo "НЕ ВІДПОВІДАЄ")

Продіагностуй проблему і виправ щоб все запустилося.
PROMPT
  echo ""
  echo "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌"
  echo "Або виконай вручну:"
  echo "  sudo journalctl -u $SERVICE --since '1 minute ago' --no-pager -n 80"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
