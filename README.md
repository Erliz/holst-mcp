<div align="center">

# holst-mcp

MCP-сервер для чтения и записи досок [Holst.so](https://holst.so) через локальный десктоп-клиент.

[![CI](https://img.shields.io/github/actions/workflow/status/Erliz/holst-mcp/ci.yml?style=flat-square&label=CI)](https://github.com/Erliz/holst-mcp/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.10-3c873a?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-5ed9c7?style=flat-square)](https://modelcontextprotocol.io)

[Обзор](#обзор) • [Возможности](#возможности) • [Установка](#установка) • [Конфигурация](#конфигурация) • [Безопасность](#безопасность) • [Troubleshooting](#troubleshooting) • [Разработка](#разработка)

</div>

## Обзор

`holst-mcp` позволяет [Claude Code](https://claude.com/claude-code), [OpenCode](https://opencode.ai) или любому другому MCP-клиенту работать с досками Holst — российской альтернативой Miro/FigJam: читать содержимое, создавать диаграммы и стикеры, редактировать тексты и цвета, делать скриншоты канвы.

У Holst нет публичного API, поэтому интеграция работает в обход: сервер подключается по **Chrome DevTools Protocol к локально запущенному десктоп-приложению Holst** и читает/пишет Yjs-документ доски через её живую сессию. Все изменения автоматически синкаются на другие подключённые клиенты (Yjs CRDT).

```
Claude Code
    │ (stdio)
    ▼
holst-mcp server (Node.js)
    │ (CDP WebSocket)
    ▼
Holst.app:9222 (Electron, локально)
    │ (HTTPS + WSS, авторизованная сессия)
    ▼
api.holst.so / hud.holst.so
```

> [!IMPORTANT]
> Все запросы выполняются от имени залогиненного пользователя: cookies, Bearer-токен и права — как при обычной работе в приложении. Ограничьте доступ allowlist'ом досок и read-only режимом — см. [Безопасность](#безопасность).

Сервер спроектирован самодостаточным для агентов: тайминги, конвенции координат и паттерны верификации вшиты в описания тулзов; `holst_doctor` диагностирует окружение одним вызовом; `holst_reference` отдаёт справочник (цвета, типы, лимиты) по запросу; полный мануал агента доступен как MCP-resource `holst://docs/usage`.

## Возможности

### Диагностика

| Тулза | Описание |
|---|---|
| `holst_whoami` | Проверка соединения и авторизации |
| `holst_doctor` | Полная самодиагностика: CDP, приложение, вкладки, авторизация, редактор, конфиг — с вердиктом и рекомендацией |
| `holst_reference` | Справочник: рекомендованные hex-цвета, типы, конвенции, тайминги, лимиты, env |

### Чтение

| Тулза | Описание |
|---|---|
| `holst_list_boards` | Все доски и папки во всех workspace'ах |
| `holst_get_board_content` | Дамп живого контента доски: объекты + тексты. Экономия токенов: `bbox`, `positionsOnly`; `includeDeleteEvents` — полный сырой дамп с аудитом удалений |
| `holst_get_board_summary` | Структурированный markdown: стикеры по ближайшим shape-заголовкам, секции фреймов, инвентарь стрелок (`from→to · label · стиль`) |
| `holst_search_text` | Текстовый поиск по всем объектам доски |
| `holst_screenshot` | Снимок канвы как image content (без записи на диск): вьюпорт или `bbox` (камера возвращается на место), jpeg/png, `withBase64` для не-мультимодальных клиентов |

### Создание

| Тулза | Описание |
|---|---|
| `holst_batch_create` | **Вся диаграмма одним вызовом** (~10× быстрее): объекты с `ref` + стрелки по ref'ам или по `objectId` существующих; подписи, стили, наконечники, zIndex, `arrowsBehind` |
| `holst_add_sticker` | Жёлтый стикер 192×192 |
| `holst_add_shape` | Фигура с текстом: square, round-rect, diamond, triangle, ellipse; `borderRadius` (= h/2 → капсула), типографика, `runs` |
| `holst_add_simple_text` | Текстовый лейбл без фона: авторазмер или `width` + `horizontalAlign` |
| `holst_add_arrow` | Стрелка между точками или объектами: подпись (`textPosition` 0..1), стиль линии (solid/dashed/dotted), толщина, наконечники |
| `holst_add_frame` | Большой контейнер с подписью (садится под контент); `backgroundStyle`: fill / fill-border / border-only |
| `holst_add_stamp` | Эмодзи / штамп 60×60 |

### Редактирование

| Тулза | Описание |
|---|---|
| `holst_update_text` | Перезаписать текст (+ стиль, `runs`) в стикере / shape / simple-text / подписи стрелки, без пересоздания объекта |
| `holst_move_object` | Переместить объект |
| `holst_resize_object` | Изменить размер (shape, sticker; для simple-text — ширина с переносом) |
| `holst_set_z_order` | Слой объекта после создания: `placement` (front/back) или абсолютный `zIndex` (−1e7..1e7); возвращает эффективный `zIndex` |
| `holst_set_color` | fillColor / strokeColor (`#RRGGBB`) / strokeStyle / strokeWidth / прозрачности / backgroundStyle |
| `holst_measure_text` | Реальная ширина/высота текста ДО создания — метрики канвас-рендера приложения, а не номинальные множители |
| `holst_delete_object` | Удалить объект |
| `holst_delete_objects` | Массовое удаление одним вызовом (до 200 id, per-id отчёт) |

### Цвета и типографика

- Все цветовые параметры принимают **только `#RRGGBB`**; чтение тоже возвращает hex (int'ы нормализуются, имена палитры из UI транслируются)
- Шрифты — токены PascalCase: `Inter`, `SourceCodePro`, `EBGaramond`, `NotoSerif`, `Montserrat`, `Caveat`, …
- `runs`: `[{text, color, bold, italic, underline, strikethrough}]` — несколько цветов/стилей в одном тексте
- Прозрачности `textOpacity` / `fillOpacity` / `strokeOpacity` (0..1), `letterSpacing`, `verticalAlign`

> [!NOTE]
> Насыщенные оттенки Holst рисует приглушённее (тон сохраняется, светлота тянется к ~57–62%) — одинаково для любых входов. Детали — в [docs/internals.md](docs/internals.md).

### Что не поддерживается

- Рисование от руки (drawing) — требует path-генератора
- task-card / kanban / voting / reaction-stamp — нишевые типы
- Списки в тексте (dots/numbered/check) — двухуровневая модель редактора
- `parentId`-вложение при создании — workaround: позиционирование в границы фрейма

## Установка

### Требования

- macOS / Linux / Windows (тестировалось на macOS)
- [Node.js](https://nodejs.org) ≥ 20.10
- Holst.app установлен; пользователь залогинен в десктоп-клиенте

### Сервер

```bash
git clone https://github.com/Erliz/holst-mcp.git
cd holst-mcp
npm install
chmod +x bin/start-holst.sh
```

### Регистрация в MCP-клиенте

**Claude Code** — `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "holst": {
      "command": "node",
      "args": ["/abs/path/to/holst-mcp/src/server.js"]
    }
  }
}
```

**OpenCode v2** — глобально в `~/.config/opencode/opencode.jsonc` (или в проекте как `opencode.jsonc`; в проекте конфиг затирает глобальный):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "holst": {
        "type": "local",
        "command": ["node", "/abs/path/to/holst-mcp/src/server.js"],
        "enabled": true,
        "environment": {
          "HOLST_AUTO_START": "1",
          "HOLST_RW_BOARD_IDS": "допустимые-uuid-досок"
        }
      }
    }
  }
}
```

Проверка в OpenCode: `opencode mcp list` (или `/mcps` в TUI). После правок кода сервера перезапустите MCP — процесс живёт в памяти и не подхватит изменения сам.

### Запуск Holst в режиме CDP

Перед использованием Holst должен работать с дебаг-портом. Проще всего:

```bash
bin/start-holst.sh
```

Скрипт снимает quarantine с бандла (иначе macOS блокирует CDP-порт), перезапускает уже запущенный без CDP Holst или запускает с нуля — сессия залогиненного пользователя сохраняется. По умолчанию (`HOLST_AUTO_START=1`) MCP-сервер делает то же самое сам при первом обращении.

После первого запуска один раз залогиньтесь через Google/Yandex/email — дальше сессия живёт в `~/Library/Application Support/Holst/` и переживает рестарты.

### Быстрая проверка

Попросите агента: «Проверь соединение с Holst» — должен отработать `holst_whoami` или `holst_doctor`. Не заработало — см. [Troubleshooting](#troubleshooting).

## Конфигурация

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `HOLST_AUTO_START` | `1` | MCP-сервер сам запускает Holst.app с CDP-портом, если приложение не работает. `0` — выключить |
| `HOLST_RW_BOARD_IDS` | не задан | UUID досок с полным доступом (чтение + запись). Если задан хотя бы один из списков — доски вне обоих блокируются |
| `HOLST_RO_BOARD_IDS` | не задан | UUID досок только для чтения. Если id в обоих списках — побеждает RO (fail-closed) |
| `HOLST_READ_ONLY` | выкл | Глобальный master-switch: `1`/`true` — блокирует все изменяющие тулзы на всех досках |
| `HOLST_MAX_DUMP_BYTES` | `2000000` | Лимит размера дампа доски (`holst_get_board_content`). Защита контекста LLM |
| `HOLST_DEBUG_PORT` | `9222` | Порт CDP. Учитывается сервером, автозапуском и `start-holst.sh` |

## Безопасность

> [!WARNING]
> `--remote-debugging-port` даёт **любому локальному процессу** полный доступ к сессии Holst: Bearer-токен, чтение/запись/удаление всех досок, произвольный JS в контексте `app.holst.so`. Это свойство архитектуры, а не бага MCP-сервера. Запускайте Holst с CDP-портом только на время работы с MCP и не делайте этого на машинах, которым не доверяете. Учтите: `start-holst.sh` снимает `com.apple.quarantine` с бандла — Gatekeeper больше не проверяет эту копию приложения.

> [!CAUTION]
> Текст на досках (особенно shared) контролируется другими людьми. Вредоносный стикер с инструкцией — это попытка управления агентом с правами записи. Защита: allowlist досок (`HOLST_RW_BOARD_IDS` / `HOLST_RO_BOARD_IDS`) и read-only режим (`HOLST_READ_ONLY=1`) — см. таблицу [Конфигурация](#конфигурация).

Меры, реализованные в коде (валидация входов, проверка origin, таймауты, санитизация ошибок), — в [docs/internals.md](docs/internals.md).

## Troubleshooting

| Симптом | Причина | Что делать |
|---|---|---|
| `No app.holst.so tab found` | Holst не запущен или без CDP-флага | `bin/start-holst.sh` |
| `Holst API 401: unauthorized` | Сессия пропала / разлогинен | Залогиниться в Holst desktop, повторить |
| `JS exception: TypeError: e.toJSON is not a function` | Записали plain object вместо Y.Map | Возможна несовместимость с новой версией Holst — проверить `holst.js` |
| `JS exception: Cannot read properties of undefined (reading 'yDoc')` | Доска ещё не загрузилась | Подождать 5 секунд, повторить |

## Разработка

```bash
npm test
```

Тесты самодостаточные (`test/helpers/fake-holst.js` подменяет CDP) — запущенный Holst не нужен.

Быстрый smoke на живом приложении (Holst должен быть запущен):

```bash
node -e "import('./src/holst.js').then(m => m.whoAmI()).then(console.log)"
```

<details>
<summary>Структура исходников</summary>

```
src/
├── server.js        # MCP-сервер (stdio): транспорт + роутинг на DISPATCH
├── tools-schema.js  # Схемы тулз + диспетч (тестируемые; инвариант schema↔dispatch)
├── eval-scripts.js  # Билдеры page-eval скриптов (компиляция/инъекции под тестами)
├── holst.js         # Holst-специфика: сессии, оркестрация тулз, yDoc
├── batch.js         # Batch-планировщик (чистая валидация плана)
├── arrow-text.js    # Payload подписей стрелок (plain texts + Slate-дерево)
├── text-style.js    # Типографика: styleExtras, runs → сегменты/HTML/Slate-ноды
├── text-match.js    # Параграф/mark-aware сравнение текстов
├── validate.js      # Валидация входов + enum-источник правды (whitelist'ы)
├── palette-data.js  # Генерируемая карта токен→hex (источник docs/palette.md)
├── dump-colors.js   # Нормализация цветов чтения: int/токен → #RRGGBB
├── dump-shape.js    # Компоновка объектов дампа (bbox/positionsOnly)
├── tool-result.js   # Формирование ответов тулз
├── policy.js        # Allowlist досок, read-only, лимит дампа, санитизация
├── reference.js     # holst_reference (рекомендованные hex/шрифты/типы)
├── docs.js          # MCP-resource usage-мануал
├── autostart.js     # Автозапуск Holst.app с CDP
└── cdp.js           # CDP-клиент над WebSocket + строгая проверка origin
test/                # Тесты (node:test): юнит + fake-ds (L2) + relation-инварианты
docs/plans/          # Инженерные планы
bin/
└── start-holst.sh   # Запускает Holst.app с дебаг-флагом
```

</details>

Глубокие внутренности — механика чтения/записи Yjs, двухслойная текстовая модель, правила подсчёта объектов, детали цветов и совместимость версий Holst — в [docs/internals.md](docs/internals.md).
