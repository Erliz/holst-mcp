# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/), версионирование SemVer.
Между отмеченными релизами были внутренние итерации без отдельного тега.

## [Unreleased]

## [0.5.0] — 2026-10-18

Крупный релиз: типографика и визуальная точность, батч-контракты, инженерная
инфраструктура тестирования. Все даты приёмки — на живой доске через CDP;
модель данных Holst вскрыта эмпирически (yDoc-дампы UI-образцов, бандл приложения).

### Добавлено — типографика
- Подписи на стрелках: `text` + `textPosition` (0..1 вдоль пути), размер/цвет подписи
- Начертания **bold / italic / underline / strikethrough** — mark'и в Slate-документе
  (HTML `<strong>/<em>/<u>/<s>` через нативный paste-конвейер)
- **Runs** — run-стилизация в одном тексте: `[{text, color, bold, italic, …}]`;
  цвета проходят через `singleDocumentStore.createFromJSON` (HTML-паст их вырезает)
- `fontSize` (shape/arrow), `textScale` (simple-text: px→scale, база 14; sticker),
  `fontFamily` — 54 шрифта инвентаризированы из бандла (моно = `SourceCodePro`)
- `textColor` / `textBackgroundColor` / `textOpacity` (полупрозрачные «01/02»)
- `horizontalAlign`, `verticalAlign` (top/center/bottom), `letterSpacing`, `lineHeight`
- `borderRadius` у shape: капсула = `round-rect` + радиус h/2

### Добавлено — линии и цвет
- Наконечники `arrowheadStart/End`: `none | miro | arc | figma` (enum из модели)
- `strokeWidth` на стрелках (float), `strokeStyle` (solid/dashed/dotted) на стрелках и shape
- **Hex-цвета `#RRGGBB`** для всех цветовых параметров (конверсия во внутренний int)
- `fillOpacity` / `strokeOpacity` (0..1) — при создании в batch и в `holst_set_color`
- Палитра: 23 семейства × ~12 оттенков (полную карту hsl извлекли из бандла)

### Добавлено — батч-контракты
- `holst_delete_objects`: массовое удаление одним вызовом (до 200, нативный remove
  на каждый id); каскадно удалённые отчитываются `{ok: true, alreadyGone: true}`
- Стрелки batch на **существующие объекты**: `from/to: {objectId, relativePoint}`
- `ref` у стрелок (ручной или авто) → попадают в `created[ref]` результата
- Per-object `zIndex`; `options.arrowsBehind` — коннекторы под нодами, но НАД фреймами
- `width` (+`fixedWidth`) у simple-text в batch — центрирование без ручной математики

### Добавлено — чтение и верификация
- `holst_get_board_content`: `bbox {x1,y1,x2,y2}` и `positionsOnly` — экономия токенов
- `holst_get_board_summary`: секции фреймов + инвентарь стрелок (`from→to · label · стиль`)
- Результаты `add_*` включают `textOk`

### Добавлено — инженерная база (`docs/plans/2026-10-18-unit-testing-cdp-layer.md`)
- `eval-scripts.js`: page-eval билдеры (компиляция и инъекционные гарды под тестами)
- fake-ds харнесс: реальные eval-скрипты исполняются в Node против мини-`window.ds`
- `tools-schema.js`: схемы + диспетч в тестируемом модуле
- Relation-инварианты: schema↔dispatch, паритет add_*↔batch, enum-generated описания
- 247 тестов (node:test, ноль новых зависимостей)

### Изменено
- `shapeType` / `arrowType` — enum-whitelist'ы: square, round-rect, diamond, triangle,
  ellipse (**rhombus не существует** — раньше молча рендерился прямоугольником)
- `update_text`: нативный Slate-конвейер вместо устаревшего описания «Y.Text delete+insert»
- Верификация текста — параграф/mark-aware (Slate не хранит `\n` между параграфами)
- Markdown (`**bold**` и т.п.) в текстах явно отклоняется с подсказкой использовать параметры

### Исправлено
- Многострочный текст: `textOk: false` / «native write did not stick» — корнем была
  верификация, сравнивавшая тексты с `\n` против дельт без `\n`
- Регресс `${SLATE_NODES_PLACEHOLDER}`: сырые встраивания хелпера ломали ВСЕ чтения
  (get_board_content) после рестарта сервера — плейсхолдер заменён аргументом
- Batch терял цвета runs (не передавал slateNodes в text-write)
- `holst_set_color` требовал fillColor/strokeColor, вопреки описанию «и/или»
- `arrowsBehind` опускал стрелки ПОД фреймы (невидимы под непрозрачной заливкой)
- Таблица «Редактирование» в README была разорвана секцией v0.4

## [0.3.0] — 2026-10-06

Security hardening, нативный Slate-конвейер, self-sufficient MCP.

### Добавлено
- Нативная запись текста через конвейер приложения (`ds.store.objects.get(id).editor`
  → select-all → deleteFragment → paste; фолбэк `singleDocumentStore.createFromString`)
  — прямой `Y.Text.insert` не рендерится в двухслойной модели (Holst ≥ 2026-10)
- Нативное удаление через `objectsService.remove(id)` + самолечение перезагрузкой
- `holst_doctor` — полная самодиагностика без исключений, с вердиктом
- `holst_reference` — справочник по запросу (палитра, тайминги, лимиты, «never do»)
- MCP-resource `holst://docs/usage` — полный мануал агента
- Автозапуск Holst.app (`HOLST_AUTO_START`, JS-порт `start-holst.sh`)
- `holst_batch_create` — вся диаграмма одним вызовом, ref-система, стрелки по ref'ам
- `ensureMounted` + ретраи записи (гонки биндинга редактора)

### Безопасность
- Allowlist'ы `HOLST_RW_BOARD_IDS` / `HOLST_RO_BOARD_IDS` (RO побеждает, fail-closed),
  глобальный `HOLST_READ_ONLY`, лимит дампа `HOLST_MAX_DUMP_BYTES`
- Origin по `new URL().hostname` вместо substring; `boardId` — строгий UUID;
  конечные числа (защита Yjs от NaN/Infinity); санитизация ошибок из LLM-контекста
- `start-holst.sh`: анти-спуфинг владельца порта, логи вне world-readable /tmp

## [0.1.0] — 2026-05-06

Первый релиз: MCP-сервер (stdio) поверх CDP локального десктоп-клиента Holst.so.

### Добавлено
- CDP-клиент (`cdp.js`): WebSocket, строгие таймауты, пул сессий
- Чтение: `holst_whoami`, `holst_list_boards`, `holst_get_board_content`,
  `holst_get_board_summary`, `holst_search_text`
- Создание: `holst_add_sticker` / `add_shape` / `add_simple_text` / `add_arrow` /
  `add_frame` / `add_stamp`
- Редактирование: `holst_update_text`, `holst_move_object`, `holst_resize_object`,
  `holst_set_color`, `holst_delete_object`
- `bin/start-holst.sh` — запуск Holst.app с дебаг-портом (quarantine-снятие, рестарты)

[Unreleased]: https://github.com/Erliz/holst-mcp/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Erliz/holst-mcp/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/Erliz/holst-mcp/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/atomachinskiy/holst-mcp/commit/d0d649b
