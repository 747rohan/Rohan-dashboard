# Deploy artifacts — 43.198.49.213 (7RL host)

Everything here lives on the server under `/opt/dashboard/`, and is kept in the
repo so the host can be rebuilt without reverse-engineering a running machine.
These files are **not** applied automatically by anything; copy them by hand.

| File | Goes to |
|---|---|
| `systemd-units.txt` | `/etc/systemd/system/dash-*.{service,timer}` — split on the `=====` headers |
| `wm-warm.sh` | `/opt/dashboard/worldmonitor/warm.sh` (chmod +x) |
| `worldmonitor-compose.yml` | `/opt/dashboard/worldmonitor/docker-compose.yml` |

## Secrets kept out of the repo

- `/opt/dashboard/dashboard.env` (chmod 600) — basic auth, `PHASES_INGEST_KEY`,
  OKX Testi07 credentials. The units read it through `EnvironmentFile=`.
- `/opt/dashboard/worldmonitor/.env` (chmod 600) — Finnhub and FRED API keys.
- `SRH_TOKEN` in the compose file is a placeholder. Any value works as long as
  `redis-rest` and `worldmonitor` agree on it; both ports bind to 127.0.0.1, so
  it never leaves the host.

## Rebuilding the dashboard container

```sh
cd ~/Rohan-dashboard && git pull && cd dashboard
nice -n 19 ionice -c 3 docker build -t dashboard:<version> .
docker rm -f dashboard
docker run -d --name dashboard --restart unless-stopped \
  -p 80:3000 --env-file /opt/dashboard/dashboard.env \
  --network worldmonitor_default \
  -v /opt/dashboard/data-solbot:/data/solbot \
  -v /opt/dashboard/data-orch:/data/orch \
  -v /opt/dashboard/pb.log:/data/pb.log \
  -v /opt/dashboard/data-okx:/data/okx \
  -v /opt/dashboard/architecture.json:/data/architecture.json:ro \
  dashboard:<version>
```

`docker restart` does not re-read `--env-file`, so always recreate the
container after touching `dashboard.env`. Mount `/data/orch` as a directory and
without `:ro` — the shim writes SQLite in WAL mode and readers need the
`-shm`/`-wal` files.

## Why the warm timer exists

`worldmonitor` only refreshes a `wm:*` key when its HTTP endpoint is called and
the key has already expired — `cachedFetch` never extends a live key. Nothing
else on this host calls it, so without the timer the dashboard would show
permanently stale market data. It runs every minute: long gaps would otherwise
leave a key missing for minutes after each expiry, and an upstream timeout
(Finnhub drops roughly one request every two hours) would extend that further.
