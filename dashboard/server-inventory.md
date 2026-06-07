# Rohan_server001 — инвентарь (Phase 0)

**Дата:** 2026-04-15
**Хост:** `62.60.232.247` (hostname `154918.ip-ptr.tech`)
**Доступ:** SSH root, пароль в `Dashboard/Rohan_server001.txt`

## Окружение

| Параметр | Значение |
|---|---|
| ОС | Ubuntu 24.04.3 LTS (Noble Numbat) |
| Ядро | Linux 6.8.0-79-generic x86_64 |
| CPU | 4 vCPU |
| RAM | 3.8 GiB (used 1.1 / free 0.3 / buff 2.6 / avail 2.7) |
| Swap | 512 MiB (155 used) |
| Диск `/` | 40 GB, занято 18 GB (47%), свободно 20 GB |
| Docker | **29.3.1** ✅ |
| Docker Compose | **v5.1.1** ✅ |
| Node/npm | отсутствуют на хосте (ок — всё в контейнере) |
| nginx/apache | не активны |

## Порт 80

**Свободен.** Разворачиваем дашборд на `:80`.

## Слушающие порты

| Порт | Bind | Процесс |
|---|---|---|
| 22 | 0.0.0.0 | sshd |
| 53 | 127.0.0.53 | systemd-resolved |
| 3000 | 127.0.0.1 | docker-proxy → **worldmonitor** |
| 6379 | 127.0.0.1 | docker-proxy → **worldmonitor-redis** |
| 8079 | 127.0.0.1 | docker-proxy → **worldmonitor-redis-rest** (serverless-redis-http) |

Все прод-сервисы слушают только на loopback — дашборд-контейнер сможет достучаться через `host.docker.internal` / `--network host` или подняв его в той же docker-сети.

## Прод-стек (контейнеры)

- `worldmonitor` (image `worldmonitor-worldmonitor`) — основное приложение, health: healthy, uptime ~2 недели.
- `worldmonitor-redis` (`redis:7-alpine`) — Redis, healthy.
- `worldmonitor-redis-rest` (`hiett/serverless-redis-http`) — HTTP-мост к Redis.

## Процессы (top)

Активные: `systemd`, несколько `python` (похоже — воркеры worldmonitor / вспомогательные скрипты), `redis-server`, `dockerd`, `containerd`, `beam.smp` (Elixir — serverless-redis-http).

## БД

Системных Postgres/MySQL/Mongo на хосте нет. Данные прод-проекта — скорее всего внутри Redis и/или в контейнере `worldmonitor`. Для Phase 3 нужно:
1. Узнать, как worldmonitor хранит events (Redis / SQLite внутри контейнера / файлы).
2. Получить способ чтения (HTTP API `worldmonitor` на 127.0.0.1:3000 или прямой Redis).

## Логи

`/var/log/phase-broadcaster.log` — кастомный лог (свежий, 385 KB). Плюс стандартные syslog/auth.log. Для TerminalWidget проще всего `docker logs worldmonitor`.

## Решения по итогам Phase 0

- ✅ Деплой на **порт 80** (свободен).
- ✅ Docker + Compose уже есть → multi-stage Dockerfile по плану подходит без правок.
- ✅ Прод-сервисы на loopback → дашборд-контейнер запускаем с `--network host` либо `--add-host=host.docker.internal:host-gateway` и ходим на `127.0.0.1:3000` / `127.0.0.1:6379`.
- ⚠️ RAM 3.8 GiB, уже занято 1.1 — дашборд должен быть лёгким (Express + статика = ок).
- ⚠️ Источник данных для Phase 3: сначала исследуем API `worldmonitor` на `http://127.0.0.1:3000` и содержимое Redis — это определит форму `/api/graph`, `/api/events`, `/api/logs`.
