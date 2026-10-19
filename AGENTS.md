# holst-mcp — правила для агентов

MCP-сервер для Holst.so: читает и пишет белые доски через CDP-attach к локальному
Electron-приложению. Форк: `Erliz/holst-mcp` (issues и PR живут там), апстрим: `atomachinskiy/holst-mcp`.

## Команды

- `npm test` — все тесты (`node --test`). Самодостаточные: `test/helpers/fake-holst.js`
  подменяет CDP, приложение Holst не нужно
- `npm start` — запуск MCP-сервера

## Конвейер issues

Вход — команда `/issue` (см. `.opencode/commands/issue.md`): триаж бэклога,
затем следующая задача доводится до PR.

Правила:

- Один issue = одна ветка `issue-N-<slug>` = один PR в `main` форка с `Closes #N`
- Мерж только при зелёном CI
- Прогоны строго последовательные: приложение Holst одно на всех (общий CDP)
- Labels: `bug` / `enhancement` / `documentation` — тип работы; `needs-info` —
  ждём ответа автора (при ответе label снимается, issue возвращается в очередь);
  выборка берёт bugs первыми, FIFO по номеру
- Агент не пушит в `main` и не мержит — ревью и мерж делает только владелец

## Живое воспроизведение

- MCP-сервер `holst` подключён к локальному приложению (board id в `opencode.jsonc`)
- Порядок при багах: systematic-debugging → root cause → TDD-фикс (тест на
  fake-holst) → проверка на живой доске
