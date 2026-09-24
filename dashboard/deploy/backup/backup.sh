#!/usr/bin/env bash
# Snapshot everything under /opt/dashboard that cannot be rebuilt from the repo.
# Runs daily from dash-backup.timer; safe to run by hand at any time.
#
# The host also runs live 7RL trading, so every expensive step is wrapped in
# nice/ionice and nothing outside /opt/dashboard is read or written.
set -euo pipefail

ROOT=/opt/dashboard
DEST=$ROOT/backups
KEEP=5
STAMP=$(date -u +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST"

low() { nice -n 19 ionice -c 3 "$@"; }

# orchestrator.db is the only copy of the phase history (since 2026-04-01).
# .backup uses SQLite's online backup API: it folds in the -wal and leaves the
# writing shim alone, which a plain cp of the file would not.
low sqlite3 "$ROOT/data-orch/orchestrator.db" ".backup '$WORK/orchestrator.db'"
low sqlite3 "$WORK/orchestrator.db" "PRAGMA integrity_check;" | head -1 | grep -qx ok

# pb.log is regenerated from 7RL's bot.log, but only as far back as its
# rotations reach — older ticks exist here and nowhere else.
low cp "$ROOT/pb.log" "$WORK/pb.log"

low cp -r "$ROOT/data-okx" "$ROOT/data-solbot" "$WORK/"
low cp "$ROOT/architecture.json" "$WORK/"

# Secrets: the archive is only ever written here (chmod 700) and pulled over
# SSH, and without them a restore cannot start the container.
cp "$ROOT/dashboard.env" "$WORK/dashboard.env"
[ -f "$ROOT/worldmonitor/.env" ] && cp "$ROOT/worldmonitor/.env" "$WORK/worldmonitor.env"

{
  echo "taken:      $(date -u +%FT%TZ)"
  echo "host:       $(hostname) $(uname -sr)"
  echo "containers:"
  docker ps --format '  {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true
  echo "units:"
  systemctl is-active dash-phase-shim dash-bot-log dash-wm-warm.timer 2>/dev/null |
    paste -d' ' <(printf '  dash-phase-shim\n  dash-bot-log\n  dash-wm-warm.timer\n') - || true
  echo "phase_history:"
  sqlite3 "$WORK/orchestrator.db" \
    "SELECT '  rows=' || COUNT(*) || ' first=' || MIN(ts) || ' last=' || MAX(ts) FROM phase_history;"
} > "$WORK/MANIFEST.txt" 2>&1

ARCHIVE=$DEST/dashboard-$STAMP.tar.gz
low tar -czf "$ARCHIVE" -C "$WORK" .
chmod 600 "$ARCHIVE"
chmod 700 "$DEST"

# Keep the newest $KEEP archives, drop the rest.
ls -1t "$DEST"/dashboard-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

ln -sfn "$ARCHIVE" "$DEST/latest.tar.gz"
echo "backup ok: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
