# Dashboard (Phase 1 — каркас)

Sci-fi дашборд на Vue 3 + Express. См. `../PLAN.md`.

## Локальная разработка

```bash
# терминал 1 — бэк
cd server
cp .env.example .env
npm install
npm run dev        # :3000, отдаёт /api/health (Basic Auth)

# терминал 2 — фронт
cd web
npm install
npm run dev        # :5173, проксирует /api → :3000
```

Открыть `http://localhost:5173`, ввести `admin / change-me` (из `.env`).
HealthWidget должен показать `CONNECTED` и растущий uptime, опрос каждые 2 сек.

Свернуть вкладку на 30 сек → polling встаёт на паузу (`visibilitychange`).

## Docker (локальная сборка)

```bash
cd dashboard
docker build -t dashboard:0.1 .
docker run --rm -p 3000:3000 -e BASIC_AUTH_PASS=change-me dashboard:0.1
# http://localhost:3000
```

## Деплой на Rohan_server001

```bash
docker save dashboard:0.1 | gzip > dashboard-0.1.tar.gz
scp dashboard-0.1.tar.gz root@62.60.232.247:/root/
ssh root@62.60.232.247
# на сервере:
docker load < /root/dashboard-0.1.tar.gz
cat > /root/dashboard.env <<EOF
PORT=3000
BASIC_AUTH_USER=admin
BASIC_AUTH_PASS=<strong-password>
EOF
docker run -d --name dashboard --restart unless-stopped \
  -p 80:3000 --env-file /root/dashboard.env \
  --add-host=host.docker.internal:host-gateway \
  dashboard:0.1
```

Smoke:
```bash
curl -u admin:<pass> http://62.60.232.247/api/health
```
