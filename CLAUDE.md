# CLAUDE.md — Dashboard project

## Язык
Всегда общайся на русском.

## Проект
Внутренний sci-fi дашборд для команды (до 10 чел.), агрегирует данные торговой инфраструктуры.
- Код: `c:\Users\admin\Documents\Claude\Projects\Dashboard\dashboard\`
- Сервер: `ubuntu@43.198.49.213` (AWS, Ubuntu 24.04), ключ `~/7RL платформа/Credo/AntonK.pem`
- План 6 фаз: `PLAN.md`
- Живёт на `http://43.198.49.213` (Basic Auth), контейнер `dashboard:0.68`
- На этом же хосте работает чужой торговый сервис **7RL Rohan Trade System** под пользователем `rohan` — дашборд читает его данные через шимы (`dashboard/shims/`) и **никогда не пишет** в `/home/rohan/`
- Старый сервер Rohan_server001 (62.60.232.247) удалён 07.08.2026 — все упоминания устарели

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
- Перед любым деплоем — предупреждать. Дашборд теперь единственная копия, запасного сервера нет.
- **На хосте живая торговля 7RL** — сборка только с `nice -n 19 ionice -c 3`, в `/home/rohan/` ничего не писать, конфиги и `.env` 7RL не трогать.
- После деплоя проверять `docker inspect --format '{{.State.Health.Status}}' dashboard` (и `worldmonitor`).
- `docker restart` не перечитывает `--env-file` — при смене env всегда `stop && rm && run`.
- Порт 80 открыт в AWS security group `trading_strategies_prod`, общей с торговыми инстансами — правила SG менять только с ведома владельца 7RL.
- Никаких прямых запросов к BingX из dashboard (см. `knowledge/decisions/решение — чтение локальных артефактов solbot, без bingx.md`).
