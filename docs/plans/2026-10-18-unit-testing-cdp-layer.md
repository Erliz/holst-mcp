# План: юнит-тестирование CDP-слоя holst-mcp

Дата: 2026-10-18
Статус: утверждён к реализации (фаза 1 стартует первой)
Постмортемы-мотиваторы: регресс v0.4 `${SLATE_NODES_PLACEHOLDER}` (сломал `getBoardContent`), инцидент docs.js (сбитое экранирование бэктиков)

## Контекст

- 190 тестов (node:test, без внешних зависимостей) — покрывают чистые модули:
  `validate`, `batch`, `policy`, `cdp` (фейки WS), `reference`, `text-match`,
  `text-style`, `arrow-text`, `scripts-compile` guard
- `src/holst.js` (~1500 строк) — ноль покрытия. Каждый тулз смешивает три заботы:
  1. валидация входа (покрыта через validate.js)
  2. композиция eval-скриптов (чистая функция `(аргументы) → строка JS`, не протестирована)
  3. CDP-оркестрация — сайд-эффекты, ретраи, фолбэки (не протестирована)
- Оба реальных инцидента жили именно в слоях 2–3: строка-становится-кодом
  ломается только при парсинге в V8 страницы — `node --check` и юнит-тесты
  этого класса не видят

## Ключевая идея: три уровня защиты

```
L1: compile-check     — строка парсится как JS (new Function, парсер тот же, что в странице)
L2: fake-ds execution — скрипт реально исполняется против фейкового window.ds + мини-Yjs
L3: orchestration     — ретраи/фолбэки/самолечение флоу на fake-сессии
```

Рост точности = рост цены. L1 убивает класс v0.4-регресса, L2 ловит логику
полей (zIndex-слои, texts-структура, спреды стилей), L3 — тайминги и маршрутизацию.

## Фаза 1 — извлечение билдеров скриптов

- Новый `src/eval-scripts.js`: каждый `session.evaluate(\`...\`)` из holst.js →
  экспортируемая `buildXxxExpr(args) → string`
  (`buildBoardContentExpr`, `buildAddShapeExpr`, `buildBatchCreationExpr`,
  `buildBatchArrowsExpr`, `buildUpdateArrowTextExpr`, `buildSetColorExpr`, …)
- holst.js вызывает билдеры — поведение идентично, диффы минимальные
- Порядок извлечения по критичности:
  1. `getBoardContent` (главный read-путь)
  2. `batchCreationExpr` / `batchArrowsExpr`
  3. `add_*` (sticker, shape, simple-text, arrow, frame, stamp)
  4. `setColor` / `updateText` (обе ветки) / `deleteObject` / `moveObject` / `resizeObject`
- Тесты L1 на каждый билдер:
  - компиляция (`new Function`)
  - отсутствие `${…}`-плейсхолдеров в итоговой строке
  - инъекционная безопасность: враждебный ввод (`"'}; evil()"`, NaN, Infinity)
    не может вырваться из строкового литерала / сломать скрипт

## Фаза 2 — fake-ds харнесс (исполнение скриптов)

- `test/helpers/fake-holst.js` (~150 строк): мини-реализация
  - `window.ds.yPersistence.yDoc` — Y.Map с `get/set/entries/toJSON`
  - `window.Yjs` — `Map`, `Text` (с `toDelta`)
  - `ds.store.objects` (has/get), `objectBuilder.singleDocumentStore`
    (`createFromString`/`createFromJSON`-заглушки), `crypto.randomUUID`
- Раннер: `runInFakeDs(exprString, seedState) → finalState`
  (реальные скрипты, реальные мутации, ноль Holst)
- Тесты L2:
  - addArrow пишет `texts` / `arrowheadStart/End` / `strokeWidth` в правильные поля
  - `arrowsBehind` кладёт zIndex **между** фреймом и нодами (регресс-тест бага квадранта)
  - styleExtras-спред попадает в fields; multiline-параграфы; `normalize()` эндпоинтов
  - updateArrowText сохраняет position существующего лейбла
- Риск: расхождение fake-Yjs с реальным → фейк держим минимальным;
  расхождения ловит обязательный live-цикл (см. Конвенции)

## Фаза 3 — оркестрация (fake session поверх L2)

- Fake `session.evaluate` = запуск через fake-ds; `session.send` — программируемые
  ответы; ожидания вместо реальных таймаутов (короткие константы)
- Инъекция фабрики сессий в holst.js (`getBoardSession` уже абстракция — обёртка для тестов)
- Тесты L3:
  - маршрутизация `updateText`: arrow-ветка / doc-нативная / raw-фолбэк
  - `nativeWriteWithRetry`: 2 неудачи → успех на 3-й попытке
  - `ensureMounted`: путь самолечения через Page.reload
  - `batchCreate`: фазы, `textOk` по нормализованному сравнению, `__error` всплывает понятным

## Фаза 4 — гигиена

- `node --test --coverage` в `npm test`; цели: `eval-scripts.js` ≥ 90%,
  оркестрация holst.js ≥ 70%
- `npm run test:live` (opt-in): smoke read + write + batch на живой доске
- Обновить README (раздел «Разработка»)

## Конвенции (в README + AGENTS)

- Новые фичи CDP-слоя сдаются с L1+L2-тестами, TDD — как в чистых модулях
- Правило постмортема: правка общих expr/хелперов → обязательный live-цикл
  «чтение + запись + батч» до отчёта, не только изменённый путь

## Relation-инварианты и карта поверхностей (добавлено 2026-10-19)

Все регрессы v0.4–v0.5 были нарушениями СВЯЗЕЙ между артефактами, а не поведения.
Слой relation-тестов теперь существует и обязателен к поддержке:

1. **schema ↔ dispatch** (`test/tools-schema.test.js`): каждый `args.X`,
   читаемый диспетчером, объявлен в схеме
2. **add_* ↔ batch** (`test/contract-parity.test.js`): каждое поле схемы
   add-тулзы реально читается батч-планом того же kind (механика: сентинел,
   который обязан завалить валидацию, если поле читается)
3. **enum ↔ описания** (`test/tools-schema.test.js`): enum-списки
   (SHAPE_TYPES, ARROW_TYPES, STROKE_STYLES, ARROWHEADS) экспортируются из
   `validate.js`; описания схем и reference ГЕНЕРИРУЮТСЯ из них — правка
   списка в одном месте разъезжаться не может

### Карта поверхностей филд-изменения

Поле-концепция течёт через **7 поверхностей** — чек-лист при ревью:

| # | Поверхность | Файл |
|---|---|---|
| 1 | валидатор | `src/validate.js` |
| 2 | батч-план (per kind) | `src/batch.js` |
| 3 | eval-скрипт создания | `src/eval-scripts.js` |
| 4 | схема add-тулзы | `src/tools-schema.js` |
| 5 | описание batch | `src/tools-schema.js` |
| 6 | reference | `src/reference.js` |
| 7 | usage-doc / README | `src/docs.js`, `README.md` |

Правило: после филд-изменения — `grep <имяПоля> src/ test/`; каждый hit либо
осознанно пропущен (с комментарием почему), либо обновлён. Чек-лист выводится
из grep, не из памяти.

### Правила батч-правок кода

- python `str.replace` без проверки — запрещён: каждый replace с `assert count`
- после пакетных правок — `node --check` ВСЕХ тронутых файлов + прогон тестов
- изменения схем верифицируются stdio-пробом (`tools/list`), не только тестами

## Оценки

| Фаза | Объём | Тестов (примерно) |
|---|---|---|
| 1 | ~10 билдеров, инкрементально | +30 |
| 2 | харнесс + тесты | +25 |
| 3 | DI + 5–6 флоу | +15 |
| 4 | конфиг/доки | — |

Без новых зависимостей — всё на `node:test`.

## Принятые решения

- **Глубина**: L1+L2 обязательны (закрывают оба реальных класса багов);
  L3 — по остаточному принципу после фаз 1–2
- **Темп**: инкрементально — билдеры вытаскиваются по мере прикосновения
  к тулзам, read-путь первым (он уронил прод)

## Критерии готовности

1. Все eval-скрипты holst.js строятся билдерами из `eval-scripts.js`
2. Каждый билдер имеет L1-тест (компиляция + плейсхолдеры + инъекции)
3. Ключевые write-пути покрыты L2 (fake-ds): arrow/batch/styles/multiline
4. `npm test` зелёный, покрытие `eval-scripts.js` ≥ 90%
5. README описывает конвенции и `test:live`
