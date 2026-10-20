# holst-mcp

MCP-сервер для работы с досками Holst.so (российская альтернатива Miro/FigJam) через Claude Code или любого другого MCP-клиента.

У Holst нет публичного API, поэтому интеграция работает в обход — через **локально запущенный десктоп-клиент Holst.app** с включённым Chrome DevTools Protocol. Сервер подключается к локальному порту, читает и пишет в Yjs-документ доски через её живую сессию пользователя.

## Что умеет

### Диагностика и справка
| Тулза | Описание |
|---|---|
| `holst_whoami` | Проверка соединения и авторизации. |
| `holst_doctor` | Полная самодиагностика: CDP, приложение, вкладки, авторизация, редактор, конфиг — с вердиктом и рекомендацией. |
| `holst_reference` | Справочник: рекомендованные hex-цвета, типы, конвенции, тайминги, лимиты, env. |

### Чтение
| Тулза | Описание |
|---|---|
| `holst_list_boards` | Список всех досок и папок во всех workspace'ах. |
| `holst_get_board_content` | Полный сырой Yjs-дамп доски: все объекты + все документы. Экономия токенов: `bbox` / `positionsOnly`. |
| `holst_get_board_summary` | Структурированный markdown: стикеры по ближайшим shape-заголовкам + секции фреймов + инвентарь стрелок (`from→to · label · стиль`). |
| `holst_screenshot` | Снимок канвы доски как MCP image content (без записи на диск): текущий вьюпорт или `bbox` (камера возвращается на место); jpeg/png, css/device масштаб, `withBase64` для не-мультимодальных агентов |
| `holst_search_text` | Текстовый поиск по всем объектам доски. |

### Создание объектов
| Тулза | Тип | Описание |
|---|---|---|
| `holst_batch_create` | * | **Вся диаграмма одним вызовом** (~10× быстрее): объекты с `ref` + стрелки по ref'ам **или по `objectId` существующих объектов**; подписи, стили, наконечники, zIndex, `arrowsBehind`; `ref` у стрелок попадает в результат. |
| `holst_add_sticker` | sticker | Жёлтый стикер 192×192 |
| `holst_add_shape` | shape | Фигура с текстом. Типы (whitelist): **square, round-rect, diamond, triangle, ellipse**; `borderRadius` (= h/2 → капсула). Типографика: fontSize, textColor (hex), textOpacity, bold/italic, выравнивания, letterSpacing, fontFamily, runs |
| `holst_add_simple_text` | simple-text | Текстовый лейбл без фона: авторазмер или `width`+`horizontalAlign` для центрирования; типографика и `runs` — как у shape |
| `holst_add_arrow` | arrow | Стрелка между точками или объектами — подпись (`text`, `textPosition` 0..1), стиль линии (solid/dashed/dotted), толщина, наконечники (`arrowheadStart/End`: none/miro/arc/figma), размер/цвет подписи |
| `holst_add_frame` | frame | Большой контейнер с подписью (садится под контент); `backgroundStyle`: fill / fill-border / border-only |
| `holst_add_stamp` | stamp | Эмодзи / штамп 60×60 |

### Редактирование
| Тулза | Описание |
|---|---|
| `holst_update_text` | Перезаписать текст в стикере / shape / simple-text / подписи стрелки (+ стиль: fontSize, textColor, bold/italic; `\n` = параграф) |
| `holst_move_object` | Переместить объект |
| `holst_resize_object` | Изменить размер (для shape, sticker) |
| `holst_set_z_order` | Слой объекта после создания (#10): `placement` (front = выше всех, back = ниже всех, включая фреймы) ИЛИ абсолютный `zIndex` (−1e7..1e7, тот же словарь, что в batch; текущие значения видны в `get_board_content`). Возвращает эффективный `zIndex`. Работает для всех типов объектов — без delete + recreate |
| `holst_set_color` | Установить fillColor / strokeColor (`#RRGGBB`) / strokeStyle (solid/dashed/dotted) / strokeWidth / fillOpacity / strokeOpacity (0..1) / backgroundStyle (фреймы) |
| `holst_delete_object` | Удалить объект |
| `holst_delete_objects` | Массовое удаление одним вызовом (до 200 id, per-id отчёт; каскадно удалённые — `{ok: true, alreadyGone: true}`, не ошибка) |

Все изменения автоматически синкаются на других подключённых клиентов (Yjs CRDT).

### Цвета и типографика (v0.6)
- **Только `#RRGGBB`**: все цветовые параметры принимают исключительно hex, и чтение возвращает hex (int'ы нормализуются, имена палитры из UI транслируются таблицей `src/palette-data.js`; источник — `docs/palette.md`). Токен и его hex рендерятся идентично (проверено попиксельно). Нюанс roundtrip: если агент прочитал переведённый hex UI-объекта и записал обратно — в хранилище станет int, пикер покажет custom вместо свотча (рендер тот же)
- **Рендер-гармонизация**: насыщенные оттенки Holst рисует приглушеннее (тон сохраняется, светлота тянется к ~57–62%) — одинаково для любых входов, детерминированно; бледные/тёмные/серые — дословно
- **Шрифты**: токены PascalCase — `SourceCodePro` (моно), `Inter`, `EBGaramond`, `NotoSerif`, `Montserrat`, `Caveat`, …
- **textOpacity** (0..1, с textColor) — полупрозрачные фоновые цифры «01/02»
- **fillOpacity/strokeOpacity** — в batch прямо при создании, и в set_color
- **runs**: `[{text, color, bold, italic, underline, strikethrough}]` — несколько цветов/стилей в ОДНОМ тексте (через `singleDocumentStore.createFromJSON`)
- **verticalAlign** (top/center/bottom), **letterSpacing** (px), **borderRadius** (капсула = round-rect + h/2)

### Что НЕ поддерживается (v0.5)
- **drawing (P)** — рисование от руки. Содержит сложный path в виде строки координат (`"0,0,8.2,-11.7,..."`), кривые Безье, pivot. Требует написания path-генератора.
- **task-card / kanban / voting / reaction-stamp** — нишевые типы, не требовались.
- **Списки в тексте** (dots/numbered/check) — двухуровневая модель редактора, отдельная задача.
- **parentId-вложение при создании** — приложение не использует поле для вложения; workaround — позиционирование в границы фрейма.

## Требования

- macOS / Linux / Windows (тестировалось на macOS)
- Node.js ≥ 20
- Holst.app установлен и **запущен с флагом `--remote-debugging-port=9222`**
- Пользователь залогинен в Holst desktop

## Установка

```bash
cd ~/Developer/holst-mcp
npm install
chmod +x bin/start-holst.sh
```

Зарегистрировать в MCP-клиенте (путь — ваш).

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

Проверка в OpenCode: `opencode mcp list` (или `/mcps` в TUI). После правок кода сервера перезапусти MCP — процесс живёт в памяти и не подхватит изменения сам.

## Запуск Holst в режиме CDP

Перед использованием MCP **обязательно** запустить Holst с дебаг-портом:

```bash
~/Developer/holst-mcp/bin/start-holst.sh
```

Скрипт:
1. Снимает quarantine с приложения (иначе macOS блокирует CDP-порт)
2. Если Holst уже запущен с CDP — ничего не делает
3. Если запущен без CDP — перезапускает
4. Если не запущен — запускает заново
5. Сессия залогиненного пользователя сохраняется (user-data-dir не трогается)

После первого запуска нужно один раз залогиниться через Google/Yandex/email — дальше сессия живёт в `~/Library/Application Support/Holst/` и переживает рестарты.

## Как это работает технически

### Архитектура

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

MCP-сервер — это просто посредник между Claude и работающим браузером Holst. Все запросы идут через **сессию реального пользователя**: cookies, токены, права — всё как у обычной работы с приложением.

### Чтение доски

1. Подключаемся к `127.0.0.1:9222`, находим вкладку с `app.holst.so/board/{id}`. Если такой нет — берём любую вкладку Holst и навигируем её на нужную доску.
2. Через CDP `Runtime.evaluate` выполняем в контексте страницы:
   ```js
   window.ds.yPersistence.yDoc.toJSON()
   ```
3. Получаем JSON со всем содержимым:
   - `documents`: `{ docId: "текст" }` — текстовое содержимое
   - `objects`: `{ oid: { type, position, documentId, ... } }` — визуальные объекты
   - `task-card-statusesStore`, `kanban-*Store`, `reactionsStore` — другие подсистемы

### Запись на доску

Holst использует **Yjs CRDT** (`window.Yjs` экспортирован глобально). Модель данных:

- `yDoc.getMap('objects')` — Y.Map, ключ = UUID объекта, значение = Y.Map с полями (type, position, documentId, width, height, ...).
- `yDoc.getMap('documents')` — Y.Map, ключ = documentId, значение = Y.Text.

Чтобы добавить стикер:

```js
const yObjects = yDoc.getMap('objects');
const yDocs = yDoc.getMap('documents');

const stickerMap = new Yjs.Map();
stickerMap.set('type', 'sticker');
stickerMap.set('documentId', newDocId);
stickerMap.set('position', { x, y });
// ... другие поля

const yText = new Yjs.Text();
yText.insert(0, 'текст стикера');

yDoc.transact(() => {
  yDocs.set(newDocId, yText);
  yObjects.set(newId, stickerMap);
});
```

Yjs автоматически:
- Синкает изменения через WebSocket-провайдер на сервер Holst
- Доставляет другим подключённым клиентам
- Решает конфликты при concurrent-редактировании

### Авторизация

Holst использует Bearer-токен в `Authorization` header (НЕ в куках). Токен лежит в `localStorage['social-auth-store'].token`. MCP не знает токен сам — он выполняется в контексте страницы, где локальное хранилище уже доступно.

## Тулзы — детали

### `holst_get_board_content`
```json
{ "boardId": "123e4567-e89b-42d3-a456-426614174000" }
```
Возвращает:
```json
{
  "meta": { "id": "...", "name": "Настя", "workspace_id": "...", ... },
  "content": {
    "documents": { "bb3c0ac3-...": "ЦЕННОСТИ", ... },
    "objects": { "04a54183-...": { "type": "shape", "position": {...}, ... } },
    ...
  }
}
```

Экономия токенов:
- `bbox: {x1,y1,x2,y2}` — только объекты, пересекающие область (стрелки — по коробке, вычисленной из концов: привязанные концы резолвятся в опорную точку на referenced-объекте, свободные берутся как есть; кривые стрелки аппроксимируются коробкой концов).
- `positionsOnly: true` — компактные `{type,x,y,w,h}` без текстов документов; стрелки получают ту же вычисленную коробку вместо бессмысленных нулей.

### `holst_add_sticker`
```json
{
  "boardId": "...",
  "text": "новый стикер",
  "x": 100,
  "y": 200,
  "width": 192,
  "height": 192
}
```
Возвращает `{ ok: true, id, documentId }` — id нового стикера и его документа.

### `holst_update_text`
```json
{ "boardId": "...", "objectId": "...", "text": "новый текст" }
```
Меняет текст в существующем объекте (стикер/shape/simple-text/подпись стрелки; для стрелок — перезапись `texts[0]` с сохранением позиции метки). `text` можно заменить на `runs: [{text, color, bold}]` — несколько стилей в одном объекте. Пишет через нативный Slate-конвейер приложения (paste в смонтированный редактор; для run-цветов — `singleDocumentStore.createFromJSON`), с паузой на оседание биндинга и ретраями; верификация срабатывания — параграф/mark-aware. Не пересоздаёт объект.

## Подводные камни

- **Holst-апдейт может сломать схему.** Проверено на сборках Holst 0.0.2 (Electron 29.4.6) и 2026-10 (двухслойная текстовая модель — см. ниже). Если в новой версии изменятся имена share-ключей (`documents`, `objects`), кейсы Yjs или window-глобалы (`window.ds`, `window.Yjs`) — нужно править `src/holst.js`.
- **Bearer-токен ротируется при логауте.** Если пользователь разлогинился — MCP отдаст ошибку, нужно запустить `start-holst.sh` и снова залогиниться.
- **CDP-порт нужно держать открытым.** Если Holst упал или перезапущен без флага — MCP не подключится. `start-holst.sh` это лечит.
- **Ничего не блокирует concurrent-редактирование** — если ты пишешь через MCP, и одновременно человек редактирует ту же доску в UI, Yjs всё мерджит. Но если объект только что удалён человеком и MCP пытается его обновить — будет ошибка `object not found`.
- **Двухслойная модель текста (Holst ≥ 2026-10).** Рендер текста идёт из Slate-редактора, а не из сырого Y.Text: прямые `Y.Text.insert` лежат в yDoc, но НЕ отображаются, а при монтировании нового объекта приложение затирает документ своей пустой view-model. Поэтому MCP пишет текст через нативный конвейер приложения (`ds.store.objects.get(id).editor` → select-all → deleteFragment → paste; фолбэк — `singleDocumentStore.createFromString`). Чтение (`get_board_content` и производные) идёт через `toDelta()`. Запись после `add_*` делается с паузой ~2с на оседание биндинга + ретраями; если объект не смонтировался в доменный стор — тулз сам перезагружает вкладку (это лечит и «осиротевшие» редакторы).
- **Удаления тоже двухслойны.** Raw `yObjects.delete()` убирает объект из yDoc, но доменный стор (и канвас) продолжают его рисовать до перезагрузки страницы. Поэтому `delete_object` использует нативный `objectsService.remove(id)` — он удаляет из yDoc И размонтирует объект из стора сразу; при лаге размонтирования тулз самолечится перезагрузкой. Повторное удаление уже удалённого даёт понятную ошибку «object not found».

## Безопасность

### Главный риск: CDP-порт не аутентифицирован

`--remote-debugging-port` даёт **любому локальному процессу** полный доступ к сессии Holst: Bearer-токен из `localStorage`, чтение/запись/удаление всех досок всех workspace, произвольный JS в контексте `app.holst.so`. Это свойство архитектуры, а не бага MCP-сервера.

Правила гигиены:
- Запускайте Holst с CDP-портом **только на время работы с MCP**. Не держите его открытым постоянно.
- Не запускайте так на машинах, которым не доверяете (общие/compromised-хосты).
- `start-holst.sh` снимает `com.apple.quarantine` с бандла (иначе macOS App Translocation прячет приложение и порт недоступен). Осознайте этот компромисс: Gatekeeper больше не проверяет этот бандл.

### Prompt injection через контент досок

Текст на досках (особенно shared) контролируется другими людьми. Вредоносный стикер с инструкцией — это попытка управления агентом, у которого есть права на запись и удаление. Защита:

- **Allowlist досок**: `HOLST_ALLOWED_BOARD_IDS` — доступ только к перечисленным доскам.
- **Read-only режим**: `HOLST_READ_ONLY=1` — все тулзы записи отключаются.

### Переменные окружения

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `HOLST_AUTO_START` | `1` | MCP-сервер сам запускает Holst.app с CDP-портом, если приложение не работает (JS-порт `start-holst.sh`). `0` — выключить. |
| `HOLST_RW_BOARD_IDS` | не задан | UUID досок с полным доступом (чтение + запись). Если задан хотя бы один из списков — доски вне обоих блокируются. |
| `HOLST_RO_BOARD_IDS` | не задан | UUID досок только для чтения: читаются, но все изменяющие тулзы отказывают. Если id в обоих списках — побеждает RO (fail-closed). |
| `HOLST_READ_ONLY` | выкл | Глобальный master-switch: `1`/`true` — блокирует все изменяющие тулзы на ВСЕХ досках. |
| `HOLST_MAX_DUMP_BYTES` | `2000000` | Лимит размера сырого дампа доски (`holst_get_board_content`). Защита контекста LLM. |
| `HOLST_DEBUG_PORT` | `9222` | Порт CDP. Учитывается и сервером, и автозапуском, и `start-holst.sh`. |

### Self-sufficient режим (для агентов без доступа к этому репо)

MCP спроектирован так, чтобы **любой агент в любом проекте** работал с ним без инструкций извне:

- **Описания тулзов** — единственный канал, гарантированно доходящий до любого MCP-клиента: тайминги («add_* занимает 3–8 c — это норма»), семантика полей ответа (`mounted`/`native`), паттерн верификации, конвенции координат — всё вшито в описания (english).
- **`holst_doctor`** — самодиагностика одним вызовом: CDP, версия приложения, вкладки, авторизация (с ретраем на прогрев), готовность редактора, latency, эффективный конфиг + вердикт с рекомендацией. Никогда не бросает исключений.
- **`holst_reference`** — справочник по запросу: рекомендованные hex-цвета, типы, лимиты, env, «never do». Не тратит контекст, пока не вызван.
- **MCP-resource `holst://docs/usage`** — полный мануал агента (workflow, таблица «ошибка → действие») для клиентов с поддержкой resources.
- **Автозапуск** — сервер поднимает Holst.app сам при первом же обращении, если тот не запущен (анти-спуфинг проверка владельца порта сохранена).

Что MCP не может сам: установить Holst.app и залогинить пользователя — при этих проблемах тулзы возвращают actionable-ошибки с инструкцией для человека.

### Что уже сделано в коде

- Строгая валидация входов: `boardId` — только UUID (защита от навигации вкладки на произвольный URL), координаты/размеры — конечные числа (защита Yjs от `NaN`/`Infinity`), цвета — только `#RRGGBB` (имена палитры не принимаются с v0.6.0), типы — enum-whitelist'ы (единый источник: списки экспортируются из `validate.js`, описания схем и справочник генерируются из них же).
- Проверка origin по `new URL().hostname === 'app.holst.so'` вместо substring (раньше матчился `https://evil.com/?app.holst.so`).
- Таймауты на все CDP-операции + reject зависших запросов при обрыве соединения.
- Санитизация ошибок: стектреки и внутренности не попадают в LLM-контекст.
- `start-holst.sh`: отказ работать, если порт занят не-Holst процессом (анти-спуфинг), `pkill -x` вместо убийства по подстроке, лог в `~/Library/Logs/holst-mcp/` вместо world-readable `/tmp`.
- Зависимости без известных уязвимостей (`npm audit` чист).

## Troubleshooting

| Симптом | Причина | Что делать |
|---|---|---|
| `No app.holst.so tab found` | Holst не запущен или без CDP-флага | `~/Developer/holst-mcp/bin/start-holst.sh` |
| `Holst API 401: unauthorized` | Сессия пропала / разлогинен | Залогиниться в Holst desktop, потом повторить |
| `JS exception: TypeError: e.toJSON is not a function` | Записали plain object вместо Y.Map | Возможна несовместимость с новой версией Holst — проверить `holst.js` |
| `JS exception: Cannot read properties of undefined (reading 'yDoc')` | Доска ещё не загрузилась | Подождать 5 секунд, повторить |

## Разработка

Smoke-тест локально (Holst должен быть запущен):

```bash
cd ~/Developer/holst-mcp
node -e "import('./src/holst.js').then(m => m.whoAmI()).then(console.log)"
```

Юнит-тесты (не требуют запущенного Holst):

```bash
npm test
```

Структура:
```
src/
├── server.js        # MCP-сервер (stdio): транспорт + роутинг на DISPATCH
├── tools-schema.js  # Схемы тулз + диспетч (тестируемые; инвариант schema↔dispatch)
├── eval-scripts.js  # Билдеры page-eval скриптов (компиляция/инъекции под тестами)
├── holst.js         # Holst-специфика: сессии, оркестрация тулз, yDoc
├── batch.js         # Batch-планировщик (чистая валидация плана)
├── arrow-text.js    # Payload подписей стрелок (plain texts + Slate-дерево)
├── text-style.js    # Типографика: styleExtras, runs → сегменты/HTML/Slate-ноды
├── text-match.js    # Параграф/mark-aware сравнение текстов (multiline-фикс)
├── validate.js      # Валидация входов + enum-источник правды (whitelist'ы)
├── palette-data.js  # Генерируемая карта токен→hex (транслятор чтения; источник docs/palette.md)
├── dump-colors.js   # Нормализация цветов чтения: int/токен → #RRGGBB
├── policy.js        # Allowlist досок, read-only, лимит дампа, санитизация
├── reference.js     # holst_reference (рекомендованные hex/шрифты/типы — из enum'ов)
├── docs.js          # MCP-resource usage-мануал
├── autostart.js     # Автозапуск Holst.app с CDP
└── cdp.js           # CDP-клиент над WebSocket + строгая проверка origin
test/                # 247 тестов (node:test): юнит + fake-ds (L2) + relation-инварианты
docs/plans/          # Инженерные планы (unit-testing, инварианты, карта поверхностей)
bin/
└── start-holst.sh   # Запускает Holst.app с дебаг-флагом
```

## Лицензия

MIT.
