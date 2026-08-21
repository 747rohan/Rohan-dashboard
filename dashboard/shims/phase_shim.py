#!/usr/bin/env python3
"""Feed the dashboard with market phases derived from the 7RL trade system.

7RL leaves its own `phase_transitions` / `markov_matrices` tables empty, but its
OpenTelemetry file exporter writes a `phase_changes_total` counter per
(symbol, from_phase, to_phase) into `state/metrics.jsonl` every 15 s. Replaying
the increments of that counter reconstructs the live phase of every symbol.

From that this shim maintains two things the dashboard already knows how to read:

  * `orchestrator.db` — `phase_history` and `decisions` rows in the original
    Solbot schema. `phase_history.phase_probs` is the share of instruments in
    each phase, which is what makes the chart overlay readable; `decisions`
    describes BTC alone, since the detector sits on a BTC chart. Predictions
    come from a Markov matrix estimated from 5-minute samples of all 22 symbols.

    BTC's own phase does NOT come from the counters. 7RL restarts every few
    hours, its counters restart with it, and no amount of delta bookkeeping
    survives that reliably — it froze symbols for a week. Instead it is read
    from the trade log, which restates the phase on every tick.
  * `POST /api/phases/ingest` — the current phase of every symbol, for the
    PhasesByInstrument grid.

It only ever reads 7RL data (through `sudo -u rohan tail`) and never writes
anything under /home/rohan.
"""

import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

METRICS_PATH = os.environ.get(
    "SHIM_METRICS_PATH", "/home/rohan/7RL-rohan-trade-system/state/metrics.jsonl"
)
ORCH_DB = os.environ.get("SHIM_ORCH_DB", "/opt/dashboard/data-orch/orchestrator.db")
STATE_PATH = os.environ.get("SHIM_STATE_PATH", "/opt/dashboard/shim/phase_state.json")
INGEST_URL = os.environ.get("SHIM_INGEST_URL", "http://localhost/api/phases/ingest")
INGEST_KEY = os.environ.get("PHASES_INGEST_KEY", "")

PB_LOG = os.environ.get("SHIM_PB_LOG", "/opt/dashboard/pb.log")

PHASES = ["uptrend", "downtrend", "ranging", "creep_up", "creep_down"]

# Every tick the trade system logs the phase it is acting on, and
# system_loop.py takes that from `global_state.phases["BTC/USDT"]` — so this is
# BTC's phase as 7RL itself sees it, restated once a minute.
BTC_PHASE_LINE = re.compile(r"_decisions?\b.*?\bphase=([a-z_]+)")
PHASE_IDX = {p: i for i, p in enumerate(PHASES)}

OCCUPANCY_WINDOW_MS = 3600_000  # trailing hour behind per-symbol confidence
HISTORY_KEEP_MS = 26 * 3600_000  # keep a bit more than a day of transitions

INGEST_EVERY = 15.0
DB_WRITE_EVERY = 60.0
SAMPLE_EVERY = 300.0  # markov step = 5 min
PERSIST_EVERY = 30.0

# 5-minute steps behind each prediction horizon
HORIZON_STEPS = {"1h": 12, "4h": 48, "24h": 288}

_stop = threading.Event()
_lock = threading.Lock()


def log(msg):
    print(f"{datetime.now(timezone.utc).isoformat()} {msg}", flush=True)


def parse_ts(iso):
    """'2026-08-04T11:27:41.188Z' -> epoch ms."""
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except (ValueError, AttributeError):
        return None


def iso_utc(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()


class PhaseState:
    """Everything the shim needs to survive a restart."""

    def __init__(self):
        self.counters = {}  # "SYM|from|to" -> last seen counter value
        self.history = defaultdict(list)  # symbol -> [[ts_ms, phase], ...]
        self.matrix = [[0] * 5 for _ in range(5)]  # transition counts, 5-min steps
        self.last_sample = {}  # symbol -> phase at the previous markov sample
        self.last_ts = 0  # newest metrics ts already applied
        self.first_ts = None  # ts of the first snapshot of this run
        self.bootstrapped = False  # past the opening snapshot of lifetime totals
        self.btc_phase = None  # BTC's own phase, straight from the trade log
        self.btc_phase_ts = 0

    # ---- persistence -----------------------------------------------------
    def load(self):
        try:
            with open(STATE_PATH, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except (OSError, ValueError):
            log(f"no usable state at {STATE_PATH}, starting cold")
            return
        self.counters = raw.get("counters", {})
        self.history = defaultdict(list, {k: v for k, v in raw.get("history", {}).items()})
        matrix = raw.get("matrix")
        if isinstance(matrix, list) and len(matrix) == 5:
            self.matrix = matrix
        self.last_sample = raw.get("last_sample", {})
        self.last_ts = raw.get("last_ts", 0)
        # Restored counters already are the baseline, so the next line we read
        # carries news rather than lifetime totals.
        self.bootstrapped = bool(self.counters)
        log(f"state restored: {len(self.counters)} counters, {len(self.history)} symbols")

    def save(self):
        tmp = STATE_PATH + ".tmp"
        payload = {
            "counters": self.counters,
            "history": {k: v for k, v in self.history.items()},
            "matrix": self.matrix,
            "last_sample": self.last_sample,
            "last_ts": self.last_ts,
        }
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(payload, fh)
            os.replace(tmp, STATE_PATH)
        except OSError as e:
            log(f"state save failed: {e}")

    # ---- phase bookkeeping ----------------------------------------------
    def apply_transition(self, symbol, to_phase, ts_ms):
        hist = self.history[symbol]
        if hist and hist[-1][1] == to_phase:
            return
        hist.append([ts_ms, to_phase])
        cutoff = ts_ms - HISTORY_KEEP_MS
        while len(hist) > 2 and hist[1][0] < cutoff:
            hist.pop(0)

    def current_phase(self, symbol):
        hist = self.history.get(symbol)
        return hist[-1][1] if hist else None

    def occupancy(self, symbol, now_ms):
        """Share of the trailing hour spent in each phase."""
        hist = self.history.get(symbol)
        if not hist:
            return None
        start = now_ms - OCCUPANCY_WINDOW_MS
        spent = {p: 0.0 for p in PHASES}
        for i, (ts, phase) in enumerate(hist):
            end = hist[i + 1][0] if i + 1 < len(hist) else now_ms
            lo, hi = max(ts, start), min(end, now_ms)
            if hi > lo and phase in spent:
                spent[phase] += hi - lo
        total = sum(spent.values())
        if total <= 0:
            cur = hist[-1][1]
            return {p: (1.0 if p == cur else 0.0) for p in PHASES}
        return {p: v / total for p, v in spent.items()}

    def market_probs(self):
        """Share of instruments sitting in each phase right now.

        7RL reports a single hard phase per symbol, so a one-symbol view can
        only ever be one-hot. Counting across all symbols gives a real
        distribution over the five phases, which is what the chart overlay and
        the detector are built to show.
        """
        counts = {p: 0 for p in PHASES}
        total = 0
        for symbol in self.history:
            phase = self.current_phase(symbol)
            if phase in counts:
                counts[phase] += 1
                total += 1
        if total == 0:
            return None
        return {p: c / total for p, c in counts.items()}

    # ---- markov ----------------------------------------------------------
    def sample_markov(self):
        for symbol, hist in self.history.items():
            if not hist:
                continue
            cur = hist[-1][1]
            prev = self.last_sample.get(symbol)
            if prev in PHASE_IDX and cur in PHASE_IDX:
                self.matrix[PHASE_IDX[prev]][PHASE_IDX[cur]] += 1
            self.last_sample[symbol] = cur

    def transition_matrix(self):
        """Row-normalised transition probabilities; unseen rows stay put."""
        out = []
        for i, row in enumerate(self.matrix):
            total = sum(row)
            if total <= 0:
                out.append([1.0 if j == i else 0.0 for j in range(5)])
            else:
                out.append([v / total for v in row])
        return out


def mat_mul_vec(vec, mat):
    return [sum(vec[i] * mat[i][j] for i in range(5)) for j in range(5)]


def predict(probs, mat, steps):
    vec = [probs[p] for p in PHASES]
    for _ in range(steps):
        vec = mat_mul_vec(vec, mat)
    total = sum(vec) or 1.0
    return {p: vec[i] / total for i, p in enumerate(PHASES)}


# --------------------------------------------------------------------------
# orchestrator.db — the Solbot schema the dashboard reads
# --------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS phase_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT    NOT NULL,
    dominant_phase TEXT    NOT NULL,
    phase_probs    TEXT    NOT NULL,
    signals        TEXT    NOT NULL,
    confidence     REAL    NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ts             TEXT    NOT NULL,
    dominant_phase TEXT    NOT NULL,
    phase_current  TEXT    NOT NULL,
    phase_pred_1h  TEXT    NOT NULL,
    phase_pred_4h  TEXT    NOT NULL,
    phase_pred_24h TEXT    NOT NULL,
    allocations    TEXT    NOT NULL,
    signals        TEXT    NOT NULL,
    rationale      TEXT    DEFAULT '',
    version_id     INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_phase_history_ts ON phase_history(ts);
"""


def open_db():
    os.makedirs(os.path.dirname(ORCH_DB), exist_ok=True)
    conn = sqlite3.connect(ORCH_DB, timeout=10)
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.commit()
    return conn


def write_db_rows(conn, state, now_ms):
    probs = state.market_probs()
    if not probs:
        return False
    # The detector sits on a BTC chart, so it reports BTC. Its phase comes
    # straight from the trade log rather than the counters — 7RL restarts every
    # few hours and the counters restart with it, while the log states BTC's
    # phase outright on every tick.
    dominant = state.btc_phase or max(PHASES, key=lambda p: probs[p])
    btc_probs = {p: (1.0 if p == dominant else 0.0) for p in PHASES}
    ts = iso_utc(now_ms)
    # How much of the market agrees with BTC right now.
    confidence = probs[dominant]
    mat = state.transition_matrix()
    preds = {h: predict(btc_probs, mat, k) for h, k in HORIZON_STEPS.items()}
    probs_json = json.dumps(probs)
    conn.execute(
        "INSERT INTO phase_history (ts, dominant_phase, phase_probs, signals, confidence)"
        " VALUES (?, ?, ?, ?, ?)",
        (ts, dominant, probs_json, "{}", confidence),
    )
    conn.execute(
        "INSERT INTO decisions (ts, dominant_phase, phase_current, phase_pred_1h,"
        " phase_pred_4h, phase_pred_24h, allocations, signals, rationale, version_id)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            ts,
            dominant,
            json.dumps(btc_probs),
            json.dumps(preds["1h"]),
            json.dumps(preds["4h"]),
            json.dumps(preds["24h"]),
            "{}",
            "{}",
            "",
            1,
        ),
    )
    conn.commit()
    return True


# --------------------------------------------------------------------------
# /api/phases/ingest
# --------------------------------------------------------------------------
def post_ingest(state, now_ms):
    entries = []
    for symbol in sorted(state.history):
        phase = state.current_phase(symbol)
        # BTC is stated outright in the trade log every tick, so prefer that
        # over anything reconstructed from the counters.
        if symbol == "BTC/USDT" and state.btc_phase:
            phase = state.btc_phase
        if not phase:
            continue
        occ = state.occupancy(symbol, now_ms) or {}
        entries.append(
            {
                "instId": symbol.replace("/", "-"),
                "phase": phase,
                "confidence": round(occ.get(phase, 0.0), 4),
                "vol_regime": "normal",
            }
        )
    if not entries:
        return
    body = json.dumps(
        {
            "ts_ms": now_ms,
            "ts_utc": iso_utc(now_ms),
            "version": "7RL-metrics-shim",
            "source": "7RL-metrics-shim",
            "phases": entries,
        }
    ).encode()
    req = urllib.request.Request(
        INGEST_URL,
        data=body,
        headers={"Content-Type": "application/json", "X-API-Key": INGEST_KEY},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()
    except (urllib.error.URLError, OSError) as e:
        log(f"ingest POST failed: {e}")


# --------------------------------------------------------------------------
# metrics.jsonl tail
# --------------------------------------------------------------------------
def handle_line(state, line):
    if "phase_changes_total" not in line:
        return
    try:
        rec = json.loads(line)
    except ValueError:
        return
    if rec.get("name") != "phase_changes_total":
        return
    labels = rec.get("labels") or {}
    symbol = labels.get("symbol")
    to_phase = labels.get("to_phase")
    from_phase = labels.get("from_phase")
    if not symbol or to_phase not in PHASE_IDX:
        return
    ts_ms = parse_ts(rec.get("ts"))
    if ts_ms is None:
        return
    # A rotated file replays older snapshots — never walk the clock backwards.
    if ts_ms < state.last_ts:
        return
    state.last_ts = ts_ms

    # The opening snapshot of a cold start is lifetime totals; once a later
    # flush arrives we are reading news.
    if state.first_ts is None:
        state.first_ts = ts_ms
    elif not state.bootstrapped and ts_ms - state.first_ts > 2_000:
        state.bootstrapped = True

    key = f"{symbol}|{from_phase}|{to_phase}"
    value = rec.get("value")
    try:
        value = float(value)
    except (TypeError, ValueError):
        return
    prev = state.counters.get(key)
    state.counters[key] = value
    if not state.bootstrapped:
        # The very first snapshot carries lifetime totals, not news. Adopt the
        # counters, and let each symbol settle on whatever it last moved to.
        if not state.current_phase(symbol):
            state.apply_transition(symbol, to_phase, ts_ms)
        return
    if value == prev:
        # The exporter republishes the same snapshot every 15s.
        return
    # Anything else is a transition that just happened. A counter that went
    # *down*, or a key appearing out of nowhere, means 7RL restarted and began
    # counting again from zero — it restarts every few hours, and treating that
    # as "re-baseline and drop" silently swallowed almost every transition,
    # freezing symbols for days.
    state.apply_transition(symbol, to_phase, ts_ms)


def refresh_btc_phase(state, now_ms):
    """Read BTC's current phase from the tail of pb.log.

    Independent of the counter stream, so a 7RL restart cannot stale it: the
    log restates the phase every tick.
    """
    try:
        with open(PB_LOG, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 65536))
            chunk = fh.read().decode("utf-8", "replace")
    except OSError as e:
        log(f"pb.log read failed: {e}")
        return
    for line in reversed(chunk.splitlines()):
        m = BTC_PHASE_LINE.search(line)
        if m and m.group(1) in PHASE_IDX:
            if m.group(1) != state.btc_phase:
                log(f"BTC phase from trade log: {state.btc_phase} -> {m.group(1)}")
            state.btc_phase = m.group(1)
            state.btc_phase_ts = now_ms
            return


def bootstrap_rotations(state):
    """Replay the rotated metrics files so a cold start knows every symbol.

    The live file only covers ~15 minutes, which leaves symbols that have not
    changed phase recently without a phase at all. The rotations reach back a
    couple of hours and are replayed oldest first, keeping timestamps ordered.
    """
    rotations = []
    for n in range(1, 10):
        path = f"{METRICS_PATH}.{n}"
        probe = subprocess.run(
            ["sudo", "-n", "-u", "rohan", "test", "-f", path], check=False
        )
        if probe.returncode == 0:
            rotations.append((n, path))
    for _, path in sorted(rotations, reverse=True):
        log(f"bootstrap from {path}")
        proc = subprocess.run(
            ["sudo", "-n", "-u", "rohan", "grep", "-h", "phase_changes_total", path],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=False,
        )
        for line in proc.stdout.splitlines():
            handle_line(state, line)
    log(f"bootstrap done: {len(state.history)} symbols known")


def tail_metrics():
    cmd = ["sudo", "-n", "-u", "rohan", "tail", "-F", "-n", "+1", METRICS_PATH]
    return subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1
    )


def periodic_worker(state):
    conn = None
    next_ingest = next_db = next_sample = next_persist = next_btc = 0.0
    while not _stop.is_set():
        now = time.monotonic()
        now_ms = int(time.time() * 1000)
        try:
            if now >= next_btc:
                with _lock:
                    refresh_btc_phase(state, now_ms)
                next_btc = now + INGEST_EVERY
            if now >= next_sample:
                with _lock:
                    state.sample_markov()
                next_sample = now + SAMPLE_EVERY
            if now >= next_db:
                if conn is None:
                    conn = open_db()
                with _lock:
                    write_db_rows(conn, state, now_ms)
                next_db = now + DB_WRITE_EVERY
            if now >= next_ingest:
                with _lock:
                    post_ingest(state, now_ms)
                next_ingest = now + INGEST_EVERY
            if now >= next_persist:
                with _lock:
                    state.save()
                next_persist = now + PERSIST_EVERY
        except sqlite3.Error as e:
            log(f"sqlite error: {e}")
            if conn is not None:
                conn.close()
            conn = None
            next_db = now + DB_WRITE_EVERY
        except Exception as e:  # keep the shim alive whatever happens
            log(f"periodic worker error: {e!r}")
        _stop.wait(1.0)
    if conn is not None:
        conn.close()


def main():
    state = PhaseState()
    state.load()

    def on_signal(_sig, _frm):
        _stop.set()

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    if state.last_ts == 0:
        bootstrap_rotations(state)

    worker = threading.Thread(target=periodic_worker, args=(state,), daemon=True)
    worker.start()

    while not _stop.is_set():
        proc = tail_metrics()
        log(f"tailing {METRICS_PATH} (pid {proc.pid})")
        try:
            for line in proc.stdout:
                if _stop.is_set():
                    break
                with _lock:
                    handle_line(state, line)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if not _stop.is_set():
            log("tail exited, restarting in 5s")
            _stop.wait(5)

    with _lock:
        state.save()
    log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
