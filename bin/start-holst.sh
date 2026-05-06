#!/usr/bin/env bash
# Запуск Holst desktop с CDP-портом для holst-mcp.
# Сохраняет логин (user-data-dir не трогаем).
# Использование:
#   ~/Developer/holst-mcp/bin/start-holst.sh
# или повесить на keyboard shortcut / autoload.

set -euo pipefail

PORT="${HOLST_DEBUG_PORT:-9222}"
APP="/Applications/Holst.app/Contents/MacOS/Holst"

if [[ ! -x "$APP" ]]; then
  echo "Holst.app not installed at /Applications/Holst.app — install from https://holst.so/download first." >&2
  exit 1
fi

# Снимаем quarantine флаг (без него macOS блокирует CDP-порт через App Translocation).
xattr -cr /Applications/Holst.app 2>/dev/null || true

# Если уже запущен — проверим, открыт ли CDP-порт. Если открыт — ничего не делаем.
if lsof -nPi -sTCP:LISTEN 2>/dev/null | grep -q ":${PORT} "; then
  echo "Holst CDP уже слушает на :${PORT} — оставляем как есть."
  exit 0
fi

# Если запущен но БЕЗ CDP — закрываем и поднимаем заново.
if pgrep -x "Holst" >/dev/null 2>&1; then
  echo "Holst запущен без CDP-порта, перезапускаю..."
  pkill -f "Holst" || true
  sleep 2
fi

echo "Запускаю Holst с --remote-debugging-port=${PORT}"
"$APP" --remote-debugging-port="$PORT" >/tmp/holst.log 2>&1 &
disown

# Ждём, пока CDP откроется
for i in {1..15}; do
  sleep 1
  if lsof -nPi -sTCP:LISTEN 2>/dev/null | grep -q ":${PORT} "; then
    echo "OK — CDP на 127.0.0.1:${PORT}"
    exit 0
  fi
done

echo "Не дождался CDP-порта :${PORT} за 15 секунд. Лог: /tmp/holst.log" >&2
exit 1
