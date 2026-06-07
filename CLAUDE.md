# CLAUDE.md — Dashboard project

## Язык
Всегда общайся на русском.

## Проект
Внутренний sci-fi дашборд для команды (до 10 чел.), агрегирует данные Solbot-инфры.
- Код: `c:\Users\admin\Documents\Claude\Projects\Dashboard\dashboard\`
- Сервер: `root@62.60.232.247` (Rohan_server001, Ubuntu 24.04), пароль в `Rohan_server001.txt`
- План 6 фаз: `PLAN.md`
- Уже живёт на `http://62.60.232.247` (Basic Auth, пароль в `.dash-secrets`), контейнер `dashboard:0.3`

## Три уровня памяти
Вся спека в `3_уровня_памяти_Claude_Obsidian.md`.

- **Уровень 1 — Claude auto memory:** `~/.claude/projects/c--Users-admin-Documents-Claude-Projects-Dashboard/memory/` (автозагрузка `MEMORY.md`).
- **Уровень 2 — рабочая память:** `C:\Users\admin\DashboardVault\00-home\` + `sessions\`.
- **Уровень 3 — knowledge:** `C:\Users\admin\DashboardVault\knowledge\{decisions,debugging,patterns}\`.

### При старте сессии / команде «продолжаем»
Прочитай **без уточняющих вопросов**:
1. Все файлы `memory/` (авто через `MEMORY.md`).
2. `DashboardVault\00-home\index.md`.
3. `DashboardVault\00-home\текущие приоритеты.md` — там следующая задача.
4. Последние 2-3 сессии из `DashboardVault\sessions\`.
5. Если задача касается конкретного модуля — соответствующую заметку из `knowledge/`.
6. Этот файл + `PLAN.md`.

Затем продолжай с того, что указано в «текущих приоритетах». Не переспрашивай очевидное (IP, пароли, источники данных, уже реализованные виджеты).

### При команде «сохрани всё»
Пройти 5-пунктовый чек-лист из `memory/feedback_save_workflow.md`:
1. Обновить `00-home\текущие приоритеты.md` + новая сессия в `sessions\`.
2. Новые решения/баги/паттерны в `knowledge\`.
3. Обновить `memory/project_status.md`, новые feedback-правила, индекс `MEMORY.md`.
4. Проверить что код собирается.
5. Почистить временные `_tmp_*.sh`, `*.tar.gz`, `probe*.txt`.

### При команде «сохрани сессию»
Короткий чек-лист: новая сессия + обновить приоритеты + заметки в knowledge если есть + обновить `project_status.md`.

## Правила работы с прод-сервером
- Перед любым деплоем — предупреждать. Прод worldmonitor стабилен 2+ недели, не ронять.
- Сборка на сервере идёт с `nice -n 19 ionice -c 3` — не забывать.
- После деплоя проверять `docker inspect --format '{{.State.Health.Status}}' worldmonitor`.
- Никаких прямых запросов к BingX из dashboard (см. `knowledge/decisions/решение — чтение локальных артефактов solbot, без bingx.md`).
