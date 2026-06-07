# Sci-Fi Dashboard — план разработки и контекст

Документ-передача из Cowork в VS Code + Claude Code. Продолжаем разработку в вашей локальной среде, где есть прямой сетевой доступ к прод-серверу.

---

## 1. Контекст и цель

Разработать внутренний дашборд для команды (до 10 пользователей) в sci-fi стилистике, вдохновлённой eDEX-UI и финансовыми терминалами (референс — `Dashboard/Примеры дизайна/Screenshot_10.png` и `Screenshot_11.png`).

Дашборд агрегирует данные с уже существующего прод-проекта на сервере `Rohan_server001` и отображает их в нескольких виджетах с независимыми интервалами опроса (polling).

**Критично для пользователя:** сначала построить работающий каркас со связью клиент↔сервер, пройти smoke-тесты, и только потом докручивать дизайн и виджеты. Не тратить время на красоту до того, как работает фундамент.

---

## 2. Стек (зафиксирован)

| Слой | Технология | Примечание |
|---|---|---|
| Фронт | **Vue 3** + Vite + Pinia | Composition API, быстрая сборка |
| Бэк | **Express.js** (Node 20 LTS) | |
| Стили | CSS + CSS-переменные | Без Tailwind для простоты тем |
| 3D-граф | **Three.js r128** | Для центрального виджета сети |
| Таблица | **Tanstack Table v8** | Виртуализация, сортировка |
| Транспорт | **HTTP short polling** | У каждого виджета свой `setInterval`. Пауза опросов при `document.visibilitychange === 'hidden'` — беречь батарею на Fold6 |
| Авторизация | **Basic Auth** через Express middleware | Один общий пароль в `.env` — достаточно для 10 чел. |
| Контейнеризация | **Один Docker-контейнер** (монолит) | Express отдаёт `/api/*` и статику из `web/dist/`. Если упрёмся в производительность — добавим Redis и nginx позже |
| Порт | **80** (если свободен), иначе **8080** | Решение — по итогам Phase 0 |
| Исходники | Локально у пользователя, без git на старте | Деплой через `scp` + `docker load` / `docker build` на сервере |

---

## 3. Сервер

- **Хост:** Rohan_server001 (4vps.su)
- **IP:** `62.60.232.247`
- **Логин:** `root` (Linux)
- **Пароль:** в файле `Dashboard/Rohan_server001.txt` (не коммитить, не публиковать)
- **ОС и стек:** неизвестны — определяем в Phase 0
- **Что уже крутится:** неизвестно — определяем в Phase 0

---

## 4. Ответы пользователя на ключевые развилки

| Вопрос | Ответ |
|---|---|
| Формат вывода (чистый HTML / React / Electron) | Не определён заранее → выбран **Vue 3 + Express, упакованный в Docker** (так как нужен реальный бэк и polling) |
| Источник данных | **Комбинация всего** — БД прод-проекта + его HTTP API + логи/docker stats |
| Виджеты MVP | **3D-граф сети + терминал (лог-поток) + таблица** |
| Стилистика | **Финансовый стиль** (Screenshot 10–11): чёрный фон, белый/серый текст, один акцентный цвет, моноширинный шрифт |
| Авторизация | **Basic Auth** с одним общим паролем |
| Docker-схема | **Один контейнер-монолит** (рекомендация после «не знаю») |
| Мобильный UX (Fold6 в планшете) | **Точная копия десктопа** — одна сетка на все экраны |
| Репозиторий | **Локально у пользователя, без git на старте** |

---

## 5. Архитектура (верхний уровень)

```
┌──────────────────────────────────────┐     ┌────────────────────────┐
│  Browser (Chrome/Fold6/планшет)      │     │ 62.60.232.247 :80      │
│  ┌──────────────────────────────┐    │     │ ┌────────────────────┐ │
│  │ Vue 3 app (dist/ статика)   │    │ GET │ │ dashboard container│ │
│  │ ┌─────┐ ┌──────┐ ┌────────┐  │◄───┼─────┤ │ Node 20 + Express │ │
│  │ │Graph│ │ Term │ │ Table  │  │    │     │ │ Basic Auth        │ │
│  │ │5s   │ │ 2s   │ │ 10s    │  │    │     │ │ /api/* + static   │ │
│  │ └─────┘ └──────┘ └────────┘  │    │     │ │                    │ │
│  │ каждый widget = свой poll    │    │     │ │ Источники:        │ │
│  └──────────────────────────────┘    │     │ │ ├─ prod DB        │ │
│  visibilitychange → пауза опросов    │     │ │ ├─ prod API       │ │
└──────────────────────────────────────┘     │ │ └─ docker/fs logs │ │
                                             │ └────────────────────┘ │
                                             └────────────────────────┘
```

---

## 6. Структура проекта

```
dashboard/
├── server/                    # Express.js бэк
│   ├── src/
│   │   ├── index.js           # entrypoint: создаёт app, подключает middleware и роуты
│   │   ├── auth.js            # Basic Auth middleware
│   │   ├── config.js          # чтение .env
│   │   └── routes/
│   │       ├── health.js      # GET /api/health → { ok, ts, uptime }
│   │       ├── graph.js       # GET /api/graph → { nodes, edges }  (Phase 3)
│   │       ├── logs.js        # GET /api/logs  → [{ts, level, msg}] (Phase 3)
│   │       └── events.js      # GET /api/events → rows             (Phase 3)
│   ├── package.json
│   └── .env.example
├── web/                       # Vue 3 фронт
│   ├── src/
│   │   ├── main.js            # Vue + Pinia init
│   │   ├── App.vue            # grid-layout всех виджетов
│   │   ├── composables/
│   │   │   └── usePolling.js  # хук: принимает url+interval, управляет pause/resume
│   │   └── widgets/
│   │       ├── HealthWidget.vue      # Phase 1 — пинг-виджет
│   │       ├── NetworkGraphWidget.vue # Phase 3 — Three.js
│   │       ├── TerminalWidget.vue     # Phase 3 — лог-поток
│   │       └── EventsTableWidget.vue  # Phase 3 — Tanstack Table
│   ├── vite.config.js
│   └── package.json
├── Dockerfile                 # multi-stage: build web → copy dist → run server
├── docker-compose.yml         # опционально (упрощает `docker compose up`)
├── .dockerignore
├── .env.example
└── README.md                  # запуск, деплой, troubleshooting
```

---

## 7. Фазы разработки

### Phase 0 — Recon сервера (30 минут) 🔴 БЛОКЕР

Цель: понять окружение перед тем, как что-то ставить.

1. Подключиться по SSH под `root` с известным паролем.
2. Определить ОС, версию ядра, архитектуру.
3. Проверить, установлен ли Docker и его версия.
4. Проверить занятость порта 80 (`ss -tlnp | grep :80`).
5. Инвентаризировать прод-проект: процессы, сервисы, БД, логи, куда смотрит.
6. Записать итог в `server-inventory.md` (фиксируем в проекте для будущей справки).

**Recon-скрипт для запуска на сервере:**

```bash
echo "=== OS ===" && cat /etc/os-release 2>/dev/null | head -5
echo && echo "=== KERNEL & ARCH ===" && uname -a
echo && echo "=== CPU / RAM ===" && nproc && free -h
echo && echo "=== DISK ===" && df -h / 2>/dev/null
echo && echo "=== DOCKER ===" && (docker --version 2>&1; docker ps -a 2>&1 | head -20)
echo && echo "=== DOCKER COMPOSE ===" && (docker compose version 2>&1 || docker-compose --version 2>&1)
echo && echo "=== PORT 80 ===" && (ss -tlnp 2>/dev/null | grep -E ':80\s|:80$' || netstat -tlnp 2>/dev/null | grep -E ':80\s|:80$' || echo "port 80 appears free")
echo && echo "=== PORTS LISTENING ===" && (ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | grep LISTEN | head -30
echo && echo "=== NODE / NPM ===" && (node -v 2>&1; npm -v 2>&1)
echo && echo "=== NGINX / APACHE ===" && (systemctl is-active nginx 2>&1; systemctl is-active apache2 2>&1; systemctl is-active httpd 2>&1)
echo && echo "=== RUNNING SERVICES (top 15) ===" && ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu | head -16
echo && echo "=== DATABASES ===" && (which psql mysql mongo redis-cli sqlite3 2>&1; systemctl list-units --type=service --state=running 2>&1 | grep -iE "postgres|mysql|mongo|redis|mariadb" || echo "no DB services found by name")
echo && echo "=== /var/log recent files ===" && ls -lt /var/log 2>/dev/null | head -10
echo && echo "=== DONE ==="
```

**Развилка после Phase 0:** если порт 80 занят nginx или прод-проектом — ставим dashboard на 8080 и либо оставляем так (доступ через `http://62.60.232.247:8080`), либо настраиваем существующий nginx как reverse-proxy на `/dashboard`.

### Phase 1 — Каркас без красоты (1–2 часа)

Цель: минимальное работающее приложение клиент↔сервер.

1. Создать структуру папок из раздела 6.
2. **Server (`server/src/index.js`):**
   - `express()` с middleware: `express.json()`, `basicAuth`, `express.static('../web/dist')`.
   - Роут `GET /api/health` → `{ ok: true, ts: Date.now(), uptime: process.uptime() }`.
   - Слушает `process.env.PORT || 3000`.
3. **Web (`web/src/`):**
   - `App.vue` с одним компонентом `HealthWidget`.
   - `usePolling.js` — composable, принимает `(url, intervalMs)`, использует `ref`, `onMounted`, `onUnmounted`, слушает `document.visibilitychange` для паузы.
   - `HealthWidget.vue` — показывает «connected / uptime / last poll ts», опрашивает `/api/health` каждые 2 сек.
4. **Dockerfile (multi-stage):**
   - Stage 1: `node:20-alpine`, копируем `web/`, `npm ci`, `npm run build` → `/app/web/dist`.
   - Stage 2: `node:20-alpine`, копируем `server/`, `npm ci --production`, копируем `web/dist` из stage 1 в `/app/web/dist`. `CMD ["node","src/index.js"]`. `EXPOSE 3000`.
5. **`.env.example`:** `PORT=3000`, `BASIC_AUTH_USER=admin`, `BASIC_AUTH_PASS=change-me`.
6. Локальный запуск для sanity-check: `cd server && npm start` + `cd web && npm run dev`, открыть `http://localhost:5173`, убедиться что виджет пингует.

### Phase 2 — Деплой и smoke-тест (30–60 минут)

1. `docker build -t dashboard:0.1 .` локально.
2. `docker save dashboard:0.1 | gzip > dashboard-0.1.tar.gz`.
3. `scp dashboard-0.1.tar.gz root@62.60.232.247:/root/`.
4. На сервере: `docker load < dashboard-0.1.tar.gz`.
5. На сервере: создать `/root/dashboard.env` с реальным паролем, запустить:
   ```bash
   docker run -d --name dashboard --restart unless-stopped \
     -p 80:3000 --env-file /root/dashboard.env dashboard:0.1
   ```
   (порт `80` замените на `8080`, если занят — по итогам Phase 0).
6. **Smoke-тесты:**
   - `curl -u admin:<пароль> http://62.60.232.247/api/health` → `{"ok":true,...}`.
   - Открыть `http://62.60.232.247` в десктопном Chrome — ввести логин/пароль — увидеть обновляющийся HealthWidget.
   - Открыть на Samsung Z Fold6 в обоих режимах (phone + planshet) — убедиться, что страница открывается и виджет обновляется.
   - Свернуть вкладку на 30 сек — убедиться, что polling встал на паузу; вернуться — возобновился.

**Если все тесты зелёные — фундамент работает. Продолжаем. Если что-то красное — чиним здесь, не идём дальше.**

### Phase 3 — Реальные виджеты (2–4 часа, по одному в коммит)

1. **TerminalWidget** — `GET /api/logs?source=docker&container=<prod>&tail=100` раз в 2 сек. Бэк: `child_process.execFile('docker', ['logs', '--tail', '100', container])`. Фронт: скроллящийся div, подсветка INFO/WARN/ERROR по regex.
2. **EventsTableWidget** — `GET /api/events` раз в 10 сек. Бэк: SQL запрос к БД прод-проекта (после получения read-only креда). Фронт: Tanstack Table с виртуализацией.
3. **NetworkGraphWidget** — `GET /api/graph` раз в 5 сек. Бэк: формирование `{ nodes, edges }` из комбинации источников (например, узлы = активные сессии БД, рёбра = связи между ними). Фронт: Three.js r128, force-directed layout, медленное вращение сцены, мерцание узлов.

### Phase 4 — Mobile/Fold6 (1–2 часа)

Поскольку выбран вариант «точная копия десктопа»:
- Фиксированная CSS Grid, минимальная ширина ~1280px.
- На планшетном режиме Fold6 (2160×1812) десктоп-раскладка вписывается без проблем.
- На телефонном режиме Fold6 (968×2376) — горизонтальный скролл + pinch-zoom всей страницы.
- Тесты на реальном устройстве — обязательно.

### Phase 5 — Sci-fi theming (вариативно)

Только после того, как всё работает: тонкие линии, рамки, моноширинный шрифт (JetBrains Mono через `@fontsource/jetbrains-mono`), акцентный цвет через CSS-переменную `--accent`, доводка Three.js-графа до ощущения Screenshot 10 (частицы, свечение, низкая opacity линий).

---

## 8. Правила разработки

1. **Пароли и IP только в `.env`**, `.env` в `.gitignore` (когда git появится).
2. **Не деплоим автоматически** — каждый `docker run` на прод запускаете вы сами после ревью.
3. **Один виджет — один коммит/этап**, не смешивать.
4. **Каждая фаза заканчивается smoke-тестом.** Не переходим к следующей, пока текущая не зелёная.
5. **Polling всегда с `visibilitychange`-паузой** — экономим батарею на Fold6 и уменьшаем нагрузку на сервер.

---

## 9. Следующий ход (для Claude Code в VS Code)

1. Прочитать этот файл (`Dashboard/PLAN.md`) и `Dashboard/Rohan_server001.txt`.
2. Выполнить **Phase 0** — подключиться по SSH к `62.60.232.247` под `root`, запустить recon-скрипт из раздела 7, сохранить вывод в `dashboard/server-inventory.md`.
3. Отчитаться пользователю: какая ОС, свободен ли 80 порт, есть ли Docker, что уже крутится. Предложить решение по порту.
4. После одобрения — **Phase 1**: создать структуру `dashboard/`, написать минимальный Express + Vue с HealthWidget, собрать Docker-образ, прогнать локально.
5. **Phase 2**: деплой на сервер и smoke-тесты.
6. Дальше по фазам согласно плану.

---

## 10. Референсы

- Дизайн-референс: `Dashboard/Примеры дизайна/Screenshot_10.png`, `Screenshot_11.png` (финансовый стиль, 3D-граф в центре).
- Вдохновение по sci-fi UI: <https://github.com/GitSquared/edex-ui>.
- Three.js CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`.
- Tanstack Table: <https://tanstack.com/table/v8>.
