#!/usr/bin/env bash
# Запуск Holst desktop с CDP-портом для holst-mcp.
# Сохраняет логин (user-data-dir не трогаем).
# Использование:
#   ~/Developer/holst-mcp/bin/start-holst.sh
# или повесить на keyboard shortcut / autoload.
#
# SECURITY: CDP-порт НЕ аутентифицирован — любой локальный процесс получает
# полный доступ к сессии Holst (токен, чтение/запись всех досок), пока порт
# открыт. Закрывайте Holst, когда MCP не используется. Подробности: README → Security.

set -euo pipefail

PORT="${HOLST_DEBUG_PORT:-9222}"
APP="/Applications/Holst.app/Contents/MacOS/Holst"
LOG_DIR="$HOME/Library/Logs/holst-mcp"
LOG="$LOG_DIR/holst.log"

if [[ ! -x "$APP" ]]; then
  echo "Holst.app not installed at /Applications/Holst.app — install from https://holst.so/download first." >&2
  exit 1
fi

# Список слушателей порта (имена процессов, без заголовка lsof).
port_owners() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 { print $1 }' | sort -u
}

port_held_by_holst() {
  port_owners | grep -qx Holst
}

port_held_by_other() {
  [[ -n "$(port_owners | grep -vx Holst || true)" ]]
}

# Снимаем quarantine ТОЛЬКО если он реально есть, и только сам атрибут
# (xattr -cr раньше срывал ВСЕ xattrs бандла).
# Это нужно: с quarantine macOS App Translocation запускает копию приложения
# в рандомном read-only месте, и CDP-порт недоступен.
# Best-effort: без Full Disk Access у терминала xattr может получить
# "Operation not permitted" — это не должно ронять скрипт (set -e).
if xattr -p com.apple.quarantine /Applications/Holst.app >/dev/null 2>&1; then
  echo "Снимаю com.apple.quarantine с Holst.app (иначе macOS заблокирует CDP-порт через App Translocation)..."
  if ! xattr -dr com.apple.quarantine /Applications/Holst.app 2>/dev/null; then
    echo "WARN: не хватило прав снять quarantine. Продолжаю — если CDP-порт не откроется, выполните вручную: xattr -dr com.apple.quarantine /Applications/Holst.app" >&2
  fi
fi

if port_held_by_holst; then
  echo "Holst CDP уже слушает на :${PORT} — оставляем как есть."
  exit 0
fi

if port_held_by_other; then
  echo "ОШИБКА: порт :${PORT} занят процессом НЕ Holst ($(port_owners | paste -sd, -)). Возможна подмена CDP-сервера — отказываюсь продолжать." >&2
  exit 1
fi

# Если запущен без CDP — закрываем и поднимаем заново.
# -x: точное совпадение имени процесса (раньше pkill -f "Holst" убивал
# любые процессы со словом Holst в командной строке).
if pgrep -x Holst >/dev/null 2>&1; then
  echo "Holst запущен без CDP-порта, перезапускаю..."
  pkill -x Holst || true
  sleep 2
fi

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

echo "Запускаю Holst с --remote-debugging-port=${PORT}"
"$APP" --remote-debugging-port="$PORT" >>"$LOG" 2>&1 &
disown

# Ждём, пока CDP откроется, и проверяем что слушает именно Holst
# (раньше лог писался в world-readable /tmp).
for i in {1..15}; do
  sleep 1
  if port_held_by_holst; then
    echo "OK — CDP на 127.0.0.1:${PORT} (лог: $LOG)"
    exit 0
  fi
  if port_held_by_other; then
    echo "ОШИБКА: порт :${PORT} занял чужой процесс ($(port_owners | paste -sd, -)) — прерываю ожидание." >&2
    exit 1
  fi
done

echo "Не дождался CDP-порта :${PORT} за 15 секунд. Лог: $LOG" >&2
exit 1
