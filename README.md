# holst-mcp

MCP-сервер для работы с досками Holst.so (российская альтернатива Miro/FigJam) через Claude Code или любого другого MCP-клиента.

У Holst нет публичного API, поэтому интеграция работает в обход — через **локально запущенный десктоп-клиент Holst.app** с включённым Chrome DevTools Protocol. Сервер подключается к локальному порту, читает и пишет в Yjs-документ доски через её живую сессию пользователя.

## Что умеет

### Диагностика и справка
| Тулза | Описание |
|---|---|
| `holst_whoami` | Проверка соединения и авторизации. |
| `holst_doctor` | Полная самодиагностика: CDP, приложение, вкладки, авторизация, редактор, конфиг — с вердиктом и рекомендацией. |
| `holst_reference` | Справочник: палитра, типы, конвенции, тайминги, лимиты, env. |

### Чтение
| Тулза | Описание |
|---|---|
| `holst_list_boards` | Список всех досок и папок во всех workspace'ах. |
| `holst_get_board_content` | Полный сырой Yjs-дамп доски: все объекты + все документы. |
| `holst_get_board_summary` | Структурированный markdown: стикеры сгруппированы по ближайшему shape-заголовку. |
| `holst_search_text` | Текстовый поиск по всем объектам доски. |

### Создание объектов
| Тулза | Тип | Описание |
|---|---|---|
| `holst_add_sticker` | sticker | Жёлтый стикер 192×192 |
| `holst_add_shape` | shape | Фигура с текстом — square, ellipse, roundedRectangle, basic-star, и т.п. |
| `holst_add_simple_text` | simple-text | Простой текстовый лейбл без фона |
| `holst_add_arrow` | arrow | Стрелка между точками или объектами |
| `holst_add_frame` | frame | Большой контейнер с подписью (садится под контент) |
| `holst_add_stamp` | stamp | Эмодзи / штамп 60×60 |

### Редактирование
| Тулза | Описание |
|---|---|
| `holst_update_text` | Перезаписать текст в стикере / shape / simple-text |
| `holst_move_object` | Переместить объект |
| `holst_resize_object` | Изменить размер (для shape, sticker) |
| `holst_set_color` | Установить fillColor / strokeColor |
| `holst_delete_object` | Удалить объект |

Все изменения автоматически синкаются на других подключённых клиентов (Yjs CRDT).

### Что НЕ поддерживается в v0.2.0
- **drawing (P)** — рисование от руки. Содержит сложный path в виде строки координат (`"0,0,8.2,-11.7,..."`), кривые Безье, pivot. Требует написания path-генератора. Можно добавить в v0.3 если понадобится.
- **task-card / kanban / voting / reaction-stamp** — нишевые типы, не требовались.
- **Прикрепление объектов в parentId** (вложение в фрейм) — добавляется одним `move_object` после, но автоматического вложения нет.

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

Зарегистрировать в `~/.claude/settings.json` (путь — ваш):

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
{ "boardId": "372ea1bf-8bac-481b-94f2-ddd9088461ca" }
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
Меняет текст в существующем объекте (стикер/секция/простой текст). Внутри — `Y.Text.delete + insert`, не пересоздаёт объект.

## Подводные камни

- **Holst-апдейт может сломать схему.** Версия проверена: Holst 0.0.2 (Electron 29.4.6). Если в новой версии изменятся имена share-ключей (`documents`, `objects`), кейсы Yjs или window-глобалы (`window.ds`, `window.Yjs`) — нужно править `src/holst.js`.
- **Bearer-токен ротируется при логауте.** Если пользователь разлогинился — MCP отдаст ошибку, нужно запустить `start-holst.sh` и снова залогиниться.
- **CDP-порт нужно держать открытым.** Если Holst упал или перезапущен без флага — MCP не подключится. `start-holst.sh` это лечит.
- **Ничего не блокирует concurrent-редактирование** — если ты пишешь через MCP, и одновременно человек редактирует ту же доску в UI, Yjs всё мерджит. Но если объект только что удалён человеком и MCP пытается его обновить — будет ошибка `object not found`.
- **Двухслойная модель текста (Holst ≥ 2026-10).** Рендер текста идёт из Slate-редактора, а не из сырого Y.Text: прямые `Y.Text.insert` лежат в yDoc, но НЕ отображаются, а при монтировании нового объекта приложение затирает документ своей пустой view-model. Поэтому MCP пишет текст через нативный конвейер приложения (`ds.store.objects.get(id).editor` → select-all → deleteFragment → paste; фолбэк — `singleDocumentStore.createFromString`). Чтение (`get_board_content` и производные) идёт через `toDelta()`. Запись после `add_*` делается с паузой ~2с на оседание биндинга + ретраями; если объект не смонтировался в доменный стор — тулз сам перезагружает вкладку (это лечит и «осиротевшие» редакторы).

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
| `HOLST_ALLOWED_BOARD_IDS` | не задан | Список разрешённых boardId через запятую/пробел. Задан — все остальные доски блокируются (чтение и запись). |
| `HOLST_READ_ONLY` | выкл | `1`/`true` — блокирует все изменяющие тулзы (add/update/delete/move/resize/set_color). |
| `HOLST_MAX_DUMP_BYTES` | `2000000` | Лимит размера сырого дампа доски (`holst_get_board_content`). Защита контекста LLM. |
| `HOLST_DEBUG_PORT` | `9222` | Порт CDP. Учитывается и сервером, и автозапуском, и `start-holst.sh`. |

### Self-sufficient режим (для агентов без доступа к этому репо)

MCP спроектирован так, чтобы **любой агент в любом проекте** работал с ним без инструкций извне:

- **Описания тулзов** — единственный канал, гарантированно доходящий до любого MCP-клиента: тайминги («add_* занимает 3–8 c — это норма»), семантика полей ответа (`mounted`/`native`), паттерн верификации, конвенции координат — всё вшито в описания (english).
- **`holst_doctor`** — самодиагностика одним вызовом: CDP, версия приложения, вкладки, авторизация (с ретраем на прогрев), готовность редактора, latency, эффективный конфиг + вердикт с рекомендацией. Никогда не бросает исключений.
- **`holst_reference`** — справочник по запросу: палитра, типы, лимиты, env, «never do». Не тратит контекст, пока не вызван.
- **MCP-resource `holst://docs/usage`** — полный мануал агента (workflow, таблица «ошибка → действие») для клиентов с поддержкой resources.
- **Автозапуск** — сервер поднимает Holst.app сам при первом же обращении, если тот не запущен (анти-спуфинг проверка владельца порта сохранена).

Что MCP не может сам: установить Holst.app и залогинить пользователя — при этих проблемах тулзы возвращают actionable-ошибки с инструкцией для человека.

### Что уже сделано в коде

- Строгая валидация входов: `boardId` — только UUID (защита от навигации вкладки на произвольный URL), координаты/размеры — конечные числа (защита Yjs от `NaN`/`Infinity`), типы и цвета — whitelist-charset.
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
├── server.js       # MCP-сервер (stdio)
├── cdp.js          # CDP-клиент над WebSocket + строгая проверка origin
├── validate.js     # Валидация входных аргументов тулз
├── policy.js       # Allowlist досок, read-only, лимит дампа, санитизация ошибок
└── holst.js        # Holst-специфика (yDoc, gapi, тулзы)
test/               # Юнит-тесты (node:test)
bin/
└── start-holst.sh  # Запускает Holst.app с дебаг-флагом
```

## Лицензия

MIT.
