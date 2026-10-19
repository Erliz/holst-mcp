# Changelog

Формат: [Keep a Changelog](https://keepachangelog.com/ru/), версионирование SemVer.
Между отмеченными релизами были внутренние итерации без отдельного тега.

## [Unreleased]

### Исправлено
- `delete_objects` (#5): один `Runtime.evaluate` на все id гонял последовательный
  in-page цикл удалений (1–3s editor settle на объект) и упирался в дефолтный
  15s CDP-таймаут обёртки: при 16+ id вызов отвергался `CDP timeout`, хотя промис
  в странице продолжал работать и объекты удалялись — вызывающий получал ложную
  ошибку. Теперь удаления чанкуются (10 id на evaluate, по образцу `batch_create`),
  каждый evaluate получает масштабируемый таймаут `15s + 3s × id` (45s на полный
  чанк), а счётчики результата честные: `deleted` — только реальные удаления,
  `alreadyGone` (каскадные/стейл-иды) и `failed` — отдельно. Проверено на живой
  доске: 16-id delete — было REJECTED ровно на 15.0s, стало RESOLVED за 15.4s
  (ok:true, deleted:16, остаток в yDoc 0/16); 12 стейл-идов — было «deleted: 12»,
  стало deleted:0, alreadyGone:12.
- `get_board_content` (#4): `bbox` и `positionsOnly` больше не теряют стрелки. В yDoc у
  стрелок `position` — константа `{0,0}` без `width/height` (геометрия живёт в `start`/`end`),
  поэтому фильтр вырождался в точку (0,0): bbox отбрасывал стрелки всегда (кроме областей,
  накрывающих начало координат), а `positionsOnly` отдавал их как `{x:0,y:0,w:0,h:0}`.
  Теперь коробка стрелки вычисляется из концов: привязанные (`objectId`) резолвятся в
  опорную точку на referenced-объекте (`position + relativePoint × size`, висячие ссылки
  пропускаются), свободные берутся из `point`; кривые стрелки аппроксимируются коробкой
  концов. Фильтрация/проекция вынесены в чистый модуль `src/dump-shape.js` (юнит-тесты).
  Проверено на живой доске: bbox над зоной стрелок — 0 → 59 стрелок; `positionsOnly` —
  нулевые коробки → реальные; полный дамп без изменений.
- `batch_create` (лейблы стрелок, #3): тексты `text` у стрелок всегда попадали в
  yDoc, но конвейер никак не проверял, смонтировал ли их рендер-слой приложения, и
  не включал стрелки в `textFailedRefs` — при регрессии/race приложения (сессия
  v0.6.0) батч отчитывался `ok:true` при фактически пропавших лейблах. Теперь после
  фазы mount-check идёт verify-проход через собственный API приложения
  (`getTextOnArrowString` — что реально смонтировано): несовпадения лечатся одной
  post-mount перезаписью (механизм `update_text`, тот самый, что спасал доску из
  репорта) с повторной проверкой; неспасённые стрелки попадают в `textFailedRefs`,
  `ok:false`, у каждой стрелки в результате появляется `textOk` (`true`/`false`,
  `null` = без текста либо билд без API — fail-open, как `native:false`).
  Сравнение нечувствительно к `\n` (редактор хранит абзацы без переводов строк).
- `update_text` (fontSize на simple-text, #2): размер теперь абсолютный px, как в
  описании тула и в путях создания (`add_simple_text`/`batch_create`). Раньше `fontSize`
  писался на объект сырым полем — полем shape/arrow, которого у simple-text нет:
  билд приложения на момент репорта рендерил его как множитель (`текущий × fontSize/14`,
  24px → `fontSize:22` ⇒ ~38px), текущий билд 0.0.7 молча игнорировал (тихий no-op).
  Теперь px конвертируется в `textScale` (база 14), явный `textScale` выигрывает,
  мусорное поле `fontSize` с простых текстов стирается (лечение объектов, загрязнённых
  старой записью), а запись идёт через собственный `objectsService.update` приложения —
  смонтированный редактор перерисовывается живьём (сырая yDoc-запись оставляла view
  со старым масштабом до перезагрузки страницы; сохранение в yDoc дебаунсится — скрипт
  ждёт сходимости ≤1.5s). Для стикеров `fontSize` отвергается с тем же сообщением,
  что и в `batch_create` (нет проверенной px-базы — используйте `textScale`).

## [0.7.0] — 2026-10-19

Новая тулза чтения: `holst_screenshot` — снимок канвы доски через нативный CDP
`Page.captureScreenshot`, без записи на диск. Дизайн сверен с эталоном playwright-mcp.

### Добавлено
- Возврат: MCP ImageContent (мультимодальные клиенты видят кадр нативно) + компактный
  текстовый метa-JSON (`{ok, format, mimeType, widthPx, heightPx, bytes, worldRect, cameraMoved, cameraRestored, cameraRestoreError?, fitApplied?}`); размеры — фактический битмап (clip × scale × dpr)
- `bbox {x1,y1,x2,y2}`: камера доезжает на регион через собственный сервис приложения
  (не input-синтез), снимок, камера возвращается на прежнее место; без bbox — текущий
  вьюпорт, нулевое вмешательство
- `format` jpeg (дефолт, компактно) | png; `quality` 1..100 (дефолт 85);
  `scale` css (дефолт — CSS-пиксели, кадр ~4× меньше retina) | device
- `withBase64: true` — опционально добавляет base64 в текстовую мету для не-мультимодальных
  агентов, которым нужно сохранить файл через свой shell (~2× base64 токенов — осознанный opt-in;
  стандартного zero-context пути в MCP сегодня нет — экосистема решает это записью файла на диск
  сервером, здесь записи нет по решению владельца)
- Клип строго по канвасу (`canvasContainer.getBoundingClientRect()`) — UI-хром приложения
  (аватары, воркспейс-лист) в кадр не попадает
- Camera-билдеры в `eval-scripts.js` (state/fit/restore) с L1-компиляцией и проверенными
  конечными числами; RO-доски разрешены (операция чтения)

### Изменено
- server.js: конвертация envelope `{__image,…}` в [text, image]-контент; версия сервера
  теперь из package.json (была захардкожена 0.3.0)

## [0.6.1] — 2026-10-19

Чтение: единый hex-контракт без сносок про внутренности.

### Изменено
- `get_board_content` транслирует имена палитры UI-созданных объектов в hex на чтении
  (генерируемая таблица `src/palette-data.js`, 276 токенов; источник — `docs/palette.md`).
  Агент больше никогда не видит токенов — ни в API, ни в дампах
- MCP-поверхности (`holst_reference`, usage-manual) очищены от внутренней модели хранения:
  контракт — «цвета `#RRGGBB` везде, запись и чтение» (прежде упоминались имена токенов
  и файл репо, недоступный потребителю)

### Нюанс
- Roundtrip для UI-объектов: прочитанный hex, записанный обратно, становится int в хранилище —
  пикер покажет custom вместо свотча палитры (рендер идентичен)

## [0.6.0] — 2026-10-19

Breaking: цветовой API переведён на `#RRGGBB`-only. Имена палитры (gray12, violet5…)
убраны из всех параметров и описаний — эмпирически доказано (попиксельные замеры
рендера), что токен и его hex-значение рендерятся идентично, имена лишь добавляли
276 лишних сущностей в контекст агентов. Полная карта токен→hex сохранена в
`docs/palette.md` (источник: бандл приложения, light theme) — она нужна для
расшифровки объектов, созданных вручную через UI Holst (там yDoc хранит имена).

### Изменено (breaking)
- `parseColor`: принимается только `#RRGGBB`; имя палитры → понятная ошибка
  с подсказкой на `holst_reference`. Затрагивает fillColor/strokeColor/textColor/
  textBackgroundColor/runs[].color во всех add_*, batch, set_color, update_text
- Дефолты инструментов переведены на hex-эквиваленты: `#ffffff` (было white3/white6),
  `#202020` (gray12), `#808080` (gray10)
- `holst_reference`: секция палитры заменена на компактный набор рекомендованных
  hex-цветов + `colorRendering` (нюанс рендера, см. ниже)
- `get_board_content` по-прежнему возвращает сырые значения: объекты из UI могут
  читаться как `{ color: "violet5" }` — расшифровка в `docs/palette.md`

### Добавлено
- Нормализация цветов при чтении: `get_board_content` возвращает MCP-записанные int-цвета
  тем же `#RRGGBB`, который передавался (модуль `src/dump-colors.js`); имена токенов из UI
  проходят as-is (расшифровка — `docs/palette.md`)
- `backgroundStyle` для фреймов: `fill` / `fill-border` / `border-only`
  (декодировано из UI-образцов; маппинг на внутренние 1/2/3) — в `holst_add_frame`,
  `holst_set_color` и batch kind `frame`; отсутствие поля = прежний вид
- `docs/palette.md`: полная карта 23 семей × 12 = 276 токен → hex с примечанием
  о рендер-гармонизации

### Исправлено
- Batch-фреймы двойную вкладывали fillColor (`{color: {color…}}`) — латентный баг
  с токенами-дефолтами, стал виден при переходе на int; теперь плоская запись

### Документировано (поведение, а не изменения)
- Старая аппроксимация из справочника v0.5 («tomato8 ≈ #ca4b31») была ошибочной —
  это значение базовой (тёмной) рампы бандла; на доске (light theme) tomato8 = `#ea9280`
- **Рендер-гармонизация**: Holst рисует насыщенные цвета приглушённее (тон ±5°,
  насыщенность ниже, светлота к ~57–62%) — единый детерминированный трансформ для
  токенов И hex (`#e54d2e → #d4583b`, `#6e56cf → #6a57c8`); бледные/тёмные/серые
  проходят дословно. Хранение всегда вербатим; чтение возвращает исходный hex
  (MCP-цвета — после нормализации, см. выше).

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

[Unreleased]: https://github.com/Erliz/holst-mcp/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/Erliz/holst-mcp/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/Erliz/holst-mcp/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/Erliz/holst-mcp/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/Erliz/holst-mcp/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/Erliz/holst-mcp/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/atomachinskiy/holst-mcp/commit/d0d649b
