#!/usr/bin/env python3
"""Reshape the 7RL bot.log into the phase-broadcaster log the dashboard tails.

7RL writes one JSON object per line:

    {"event": "live_no_decisions account=okx-anton-copytest tick=1237 ...",
     "level": "info", "logger": "src.services.account_manager",
     "timestamp": "2026-08-04T11:26:34.605648Z"}

`/api/logs/pb-tail` expects the Python logging layout Solbot used:

    2026-08-04 11:26:34,605 INFO     src.services.account_manager: live_no_decisions ...

So this shim tails bot.log through `sudo -u rohan` and appends the converted
lines to /opt/dashboard/pb.log, rotating that file once it passes 100 MB. It
never writes anything under /home/rohan.
"""

import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

BOT_LOG = os.environ.get(
    "SHIM_BOT_LOG", "/home/rohan/7RL-rohan-trade-system/logs/bot.log"
)
PB_LOG = os.environ.get("SHIM_PB_LOG", "/opt/dashboard/pb.log")
MAX_BYTES = int(os.environ.get("SHIM_PB_LOG_MAX_BYTES", 100 * 1024 * 1024))

_stop = threading.Event()


def log(msg):
    print(f"{datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def format_line(raw):
    try:
        rec = json.loads(raw)
    except ValueError:
        return None
    event = rec.get("event")
    if not event:
        return None
    stamp = rec.get("timestamp") or ""
    try:
        dt = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        ts = f"{dt:%Y-%m-%d %H:%M:%S},{dt.microsecond // 1000:03d}"
    except ValueError:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S,000")
    level = str(rec.get("level", "info")).upper()
    logger = str(rec.get("logger", "7RL")).replace(":", ".")
    # pb-tail splits on the first colon, so the message keeps whatever it has
    return f"{ts} {level:<8} {logger}: {event}"


def rotate_if_needed():
    """Returns True when the file was rotated and the writer must reopen."""
    try:
        if os.path.getsize(PB_LOG) < MAX_BYTES:
            return False
    except OSError:
        return False
    try:
        os.replace(PB_LOG, PB_LOG + ".1")
        log(f"rotated {PB_LOG}")
        return True
    except OSError as e:
        log(f"rotation failed: {e}")
        return False


def tail_bot_log():
    cmd = ["sudo", "-n", "-u", "rohan", "tail", "-F", "-n", "200", BOT_LOG]
    return subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1
    )


def main():
    def on_signal(_sig, _frm):
        _stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    last_rotate_check = 0.0
    while not _stop.is_set():
        proc = tail_bot_log()
        log(f"tailing {BOT_LOG} -> {PB_LOG} (pid {proc.pid})")
        out = None
        try:
            out = open(PB_LOG, "a", encoding="utf-8")
            for raw in proc.stdout:
                if _stop.is_set():
                    break
                line = format_line(raw)
                if not line:
                    continue
                out.write(line + "\n")
                out.flush()
                now = time.monotonic()
                if now - last_rotate_check > 60:
                    last_rotate_check = now
                    if rotate_if_needed():
                        out.close()
                        out = open(PB_LOG, "a", encoding="utf-8")
        except OSError as e:
            log(f"write error: {e}")
        finally:
            if out is not None:
                out.close()
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if not _stop.is_set():
            log("tail exited, restarting in 5s")
            _stop.wait(5)

    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
