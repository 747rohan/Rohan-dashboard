# Deploy artifacts — 43.198.49.213 (7RL host)

Everything here lives on the server under `/opt/dashboard/`, and is kept in the
repo so the host can be rebuilt without reverse-engineering a running machine.
These files are **not** applied automatically by anything; copy them by hand.

| File | Goes to |
|---|---|
| `systemd-units.txt` | `/etc/systemd/system/dash-*.{service,timer}` — split on the `=====` headers |
| `wm-warm.sh` | `/opt/dashboard/worldmonitor/warm.sh` (chmod +x) |
| `worldmonitor-compose.yml` | `/opt/dashboard/worldmonitor/docker-compose.yml` |
| `backup/backup.sh` | `/opt/dashboard/backup.sh` (chmod +x) |
| `backup/pull-backup.ps1` | stays here — runs on the Windows box |

## Secrets kept out of the repo

- `/opt/dashboard/dashboard.env` (chmod 600) — basic auth, `PHASES_INGEST_KEY`,
  OKX read-only credentials (AntonCopyTest since 2026-10-02, history from
  2026-08-17). The units read it through `EnvironmentFile=`.
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
  -v /home/ubuntu/gex_server/data:/data/gex:ro \
  dashboard:<version>
```

The GEX widget reads `gex_zones.json`, which the `gex_server` collector
rewrites once a minute. Mount the directory, read-only: a single-file mount
would keep serving the old file if the collector ever replaces it. The
dashboard never opens `gex.db` there.

`docker restart` does not re-read `--env-file`, so always recreate the
container after touching `dashboard.env`. Mount `/data/orch` as a directory and
without `:ro` — the shim writes SQLite in WAL mode and readers need the
`-shm`/`-wal` files.

## Backups

`orchestrator.db` holds the phase history since 2026-04-01 and exists in no
other place; the old Rohan host was deleted before its data was copied off, and
that is not a mistake worth repeating. `backup.sh` snapshots everything under
`/opt/dashboard` that the repo cannot rebuild — the database (through SQLite's
online backup API, so the writing shim is undisturbed), `pb.log`, `data-okx/`,
`architecture.json` and both env files — into `/opt/dashboard/backups/`, keeping
the five newest. It takes about six seconds and produces roughly 24 MB.

`dash-backup.timer` runs it daily at 03:17 UTC. To take one by hand:

```sh
sudo systemctl start dash-backup.service   # or: /opt/dashboard/backup.sh
```

Those archives sit on the same instance as the data they protect, so they are a
rollback, not a backup. The copy that survives losing the instance is pulled by
`backup/pull-backup.ps1` from the Windows box:

```powershell
powershell -ExecutionPolicy Bypass -File dashboard\deploy\backup\pull-backup.ps1
# -Fresh  snapshot on the server first, then pull
# -Dest   where to keep them (default %USERPROFILE%\DashboardBackups, keeps 14)
```

It resolves the `latest.tar.gz` symlink server-side, skips a file it already
has, and deletes any copy that will not unpack. Register it to run daily:

```powershell
schtasks /create /tn "Dashboard backup pull" /sc daily /st 09:00 /f ^
  /tr "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%USERPROFILE%\Documents\Claude\Projects\Dashboard\dashboard\deploy\backup\pull-backup.ps1\""
```

**The archive contains secrets** (both env files) — it is written `chmod 600`
inside a `chmod 700` directory, travels over SSH, and must never be committed
or handed to anyone outside the team.

To restore: unpack somewhere, put `orchestrator.db` in `/opt/dashboard/data-orch/`
(no `-wal`/`-shm` files — the snapshot already folded them in), restore the other
files to the paths in the table above, and start the container as described in
this README. `MANIFEST.txt` records what was running and how much history the
snapshot carried.

## Why the warm timer exists

`worldmonitor` only refreshes a `wm:*` key when its HTTP endpoint is called and
the key has already expired — `cachedFetch` never extends a live key. Nothing
else on this host calls it, so without the timer the dashboard would show
permanently stale market data. It runs every minute: long gaps would otherwise
leave a key missing for minutes after each expiry, and an upstream timeout
(Finnhub drops roughly one request every two hours) would extend that further.
