---
description: Подготовка релиза — версия, CHANGELOG, тег и release-страница
---

Аргументы: $ARGUMENTS

---

Ты — исполнитель релизного конвейера. Работай строго по этапам.

## Выбор версии

- Аргумент `x.y.z` → версия зафиксирована
- Аргументы пусты → сверь полноту: `git log --oneline $(git tag -l | sort -V | tail -1)..main` — коммиты без записи в CHANGELOG доложи и дополни `[Unreleased]` (русский) до PR. Затем предложи семвер по разделам `[Unreleased]` (Добавлено → minor, Исправлено → patch, ломающее изменение → major) с обоснованием; выбор версии — вопрос-инструмент, решает владелец
- Аргумент `status` → краткое содержимое `[Unreleased]`, состояние предпосылок, остановись
- Любой другой аргумент → уточни у владельца, ничего не делай до ответа

## Предпосылки (стоп при нарушении любой)

1. main чистая и синхронна: `git fetch origin`; `git status --porcelain` пуст → `git pull`
2. CI на main зелёный: `gh run list -R Erliz/holst-mcp --branch main --limit 1`
3. `[Unreleased]` в CHANGELOG.md непуст; пуст → доклад «нечего релизить» и стоп

## Подготовка

1. Ветка `release/x.y.z` от main — правки крошечные, доска не участвует, worktree не нужен
2. CHANGELOG.md: секция `## [Unreleased]` → `## [x.y.z] — <дата>`; сверху новый пустой `## [Unreleased]`; футер: `[Unreleased]` → `compare/vx.y.z...HEAD`, добавить звено `[x.y.z]: …/compare/v<предыдущий тег>...vx.y.z`
3. Версия: `npm version x.y.z --no-git-tag-version` — package.json и package-lock.json синхронно (гард `test/package-lock-sync.test.js` это проверяет)
4. `npm test` — все зелёные

## Доставка

1. Коммит `release: vx.y.z` (английский), `git push -u origin release/x.y.z`
2. PR: `gh pr create -R Erliz/holst-mcp --base main --head release/x.y.z` — тело на русском: сводка разделов релиза + чеклист (changelog свёрнут, версии синхронны, тесты зелёные)
3. CI: пауза ~30 с после create, затем `gh pr checks --watch`; красный → разбери лог, почини, запушь снова
4. Доклад со ссылкой на PR; мерж — только владелец

## Пост-мерж (после «смержил/замержил/merged» от владельца)

1. Сверь факт: `gh pr view <PR> -R Erliz/holst-mcp` → state `MERGED`; не верь предположениям. `git pull` в main
2. Тег на merge-коммите: `git tag -s vx.y.z -m "vx.y.z" <merge-sha>`; подпись не идёт (ключ не загружен) → спроси владельца, слабый тег молча не делай
3. `git push origin vx.y.z` — штатный шаг релиза: тег указывает на уже влитый владельцем коммит, историю не меняет
4. `gh release create vx.y.z --title "vx.y.z" --notes "<сводка секции CHANGELOG>"` — ноты на русском, зеркально секции
5. Удали локальную ветку; контрольный `npm test` в main; доклад: тег, ссылка на release, состояние `[Unreleased]`

## Стоп-краны

- Пустой `[Unreleased]` или красный CI → доклад и стоп
- Рассинхрон версий package.json/package-lock.json (гард) → почини, не обходи
- Тег и release-страница — строго после «смержил»; пуш в main и мерж — только владелец (тег в пост-мерже — единственное исключение)
