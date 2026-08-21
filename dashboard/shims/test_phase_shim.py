"""Offline checks for phase_shim: run `python test_phase_shim.py` from this folder.

No server, no 7RL and no network — synthetic metrics lines go straight into the
parser and the database is a throwaway file in a temp dir. Covers the traps that
make this shim subtle: treating the opening snapshot as lifetime totals rather
than news, still reacting when 7RL restarts and its counters fall back to one,
dropping replayed lines from a rotated file, keeping the chart overlay a
market-wide distribution, and reading BTC's own phase from the trade log.
"""

import json, os, sqlite3, sys, tempfile
from datetime import datetime, timezone

TMP = tempfile.mkdtemp()
os.environ["SHIM_ORCH_DB"] = os.path.join(TMP, "orch", "orchestrator.db")
os.environ["SHIM_STATE_PATH"] = os.path.join(TMP, "state.json")
os.environ["SHIM_METRICS_PATH"] = os.path.join(TMP, "metrics.jsonl")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import phase_shim as S

def line(ts_ms, sym, frm, to, val):
    ts = datetime.fromtimestamp(ts_ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return json.dumps({"ts": ts, "name": "phase_changes_total", "kind": "counter",
                       "value": val, "labels": {"symbol": sym, "from_phase": frm, "to_phase": to}})

st = S.PhaseState()
T0 = 1785840000000  # base ms

# --- flush 1: first sighting, adopt without inventing a transition
st_lines = [
    line(T0, "BTC/USDT", "uptrend", "ranging", 3.0),
    line(T0, "ETH/USDT", "ranging", "creep_up", 1.0),
]
for l in st_lines: S.handle_line(st, l)
assert st.current_phase("BTC/USDT") == "ranging", st.current_phase("BTC/USDT")
assert len(st.history["BTC/USDT"]) == 1

assert not st.bootstrapped, "opening snapshot is still lifetime totals"

# --- flush 2 (+30 min): past the opening snapshot, a key appearing for the
# first time is a transition that just happened, not a baseline to adopt.
# 7RL restarts every few hours and its counters restart at 1 with it, so
# waiting for a second increment strands the symbol until the triple repeats.
S.handle_line(st, line(T0 + 1800_000, "BTC/USDT", "ranging", "uptrend", 1.0))
assert st.bootstrapped
assert st.current_phase("BTC/USDT") == "uptrend", st.current_phase("BTC/USDT")

# --- the same snapshot republished every 15s must not move anything
before = len(st.history["BTC/USDT"])
S.handle_line(st, line(T0 + 1815_000, "BTC/USDT", "ranging", "uptrend", 1.0))
assert len(st.history["BTC/USDT"]) == before

# --- older line from a rotated file must be ignored
S.handle_line(st, line(T0 - 600_000, "BTC/USDT", "uptrend", "downtrend", 99.0))
assert st.current_phase("BTC/USDT") == "uptrend"

# --- counter going backwards = 7RL restarted, and the transition is real
S.handle_line(st, line(T0 + 2400_000, "BTC/USDT", "uptrend", "creep_down", 1.0))
assert st.current_phase("BTC/USDT") == "creep_down", st.current_phase("BTC/USDT")

# --- occupancy over the trailing hour: 30 min ranging, 10 uptrend, 20 creep_down
now = T0 + 3600_000
occ = st.occupancy("BTC/USDT", now)
assert abs(sum(occ.values()) - 1.0) < 1e-9, occ
assert abs(occ["ranging"] - 0.5) < 0.02, occ
assert abs(occ["uptrend"] - 1 / 6) < 0.02, occ
assert abs(occ["creep_down"] - 1 / 3) < 0.02, occ
print("occupancy:", {k: round(v, 3) for k, v in occ.items()})

# --- market cross-section drives phase_probs, not a single symbol
st.apply_transition("SOL/USDT", "creep_up", now)
st.apply_transition("XRP/USDT", "ranging", now)
mp = st.market_probs()
assert abs(sum(mp.values()) - 1.0) < 1e-9, mp
assert sum(1 for v in mp.values() if v > 0) >= 2, "срез должен быть не one-hot"
print("market_probs:", {k: round(v, 3) for k, v in mp.items() if v > 0})

# --- markov sampling + predictions
st.last_sample = {}
st.sample_markov()                       # baseline
st.apply_transition("BTC/USDT", "ranging", now + 300_000)
st.sample_markov()                       # uptrend -> ranging
st.apply_transition("BTC/USDT", "ranging", now + 600_000)
st.sample_markov()                       # ranging -> ranging
mat = st.transition_matrix()
for row in mat:
    assert abs(sum(row) - 1.0) < 1e-9, row
pred = S.predict(occ, mat, 12)
assert abs(sum(pred.values()) - 1.0) < 1e-9
print("pred 1h:", {k: round(v, 3) for k, v in pred.items()})

# --- db rows land and satisfy the dashboard's own queries
conn = S.open_db()
assert S.write_db_rows(conn, st, now + 600_000) is True
row = conn.execute("SELECT ts, dominant_phase, phase_probs, confidence FROM phase_history ORDER BY id DESC LIMIT 1").fetchone()
print("phase_history:", row[0], row[1], "conf", round(row[3], 3))
probs = json.loads(row[2]); assert set(probs) == set(S.PHASES)
d = conn.execute("SELECT ts, dominant_phase, phase_current, phase_pred_1h, phase_pred_4h, phase_pred_24h, signals, version_id FROM decisions ORDER BY id DESC LIMIT 1").fetchone()
assert d and json.loads(d[3]) and d[7] == 1
# the exact query /api/phases/distribution runs
cut = datetime.fromtimestamp((now - 7200_000) / 1000, timezone.utc).isoformat()
assert conn.execute("SELECT ts, phase_probs FROM phase_history WHERE ts >= ? ORDER BY ts ASC", (cut,)).fetchall()
conn.close()

# --- state round-trip
st.save()
st2 = S.PhaseState(); st2.load()
assert st2.current_phase("BTC/USDT") == st.current_phase("BTC/USDT")
assert st2.last_ts == st.last_ts

# --- ingest payload shape matches what PhasesByInstrument parses
import re
sent = {}
class FakeResp:
    def read(self): return b"{}"
    def __enter__(self): return self
    def __exit__(self, *a): return False
def fake_urlopen(req, timeout=5):
    sent["body"] = json.loads(req.data.decode())
    return FakeResp()
S.urllib.request.urlopen = fake_urlopen
S.post_ingest(st, now)
body = sent["body"]
assert body["phases"], body
for p in body["phases"]:
    assert re.match(r"^([A-Z0-9]+)-USDT", p["instId"]), p
    assert p["phase"] in S.PHASES
print("ingest:", body["source"], [p["instId"] for p in body["phases"]])

# --- BTC's phase comes from the trade log, immune to counter resets
pb = os.path.join(TMP, "pb.log")
os.environ["SHIM_PB_LOG"] = pb
S.PB_LOG = pb
with open(pb, "w", encoding="utf-8") as fh:
    fh.write("2026-08-21 12:00:00,000 INFO     src.services.system_loop: loop_heartbeat tick_id=90 running=True\n")
    fh.write("2026-08-21 12:00:01,000 INFO     src.services.account_manager: dry_run_no_decisions account=okx-lid001 tick=90 balance=99.78 phase=uptrend\n")
    fh.write("2026-08-21 12:00:02,000 INFO     src.services.account_manager: live_no_decisions account=okx-anton-copytest tick=90 balance=301.6 phase=uptrend open_positions=0\n")
S.refresh_btc_phase(st, now)
assert st.btc_phase == "uptrend", st.btc_phase

# the detector row must describe BTC, not the market mix
conn2 = S.open_db()
assert S.write_db_rows(conn2, st, now) is True
d = conn2.execute("SELECT dominant_phase, phase_current FROM decisions ORDER BY id DESC LIMIT 1").fetchone()
assert d[0] == "uptrend", d[0]
cur = json.loads(d[1])
assert cur["uptrend"] == 1.0 and sum(cur.values()) == 1.0, cur
# ...while the chart series keeps the market-wide mix
h = conn2.execute("SELECT dominant_phase, phase_probs FROM phase_history ORDER BY id DESC LIMIT 1").fetchone()
assert h[0] == "uptrend"
assert sum(1 for v in json.loads(h[1]).values() if v > 0) >= 2, "overlay stays a distribution"
conn2.close()

# a garbled log line must not crash or wipe a known phase
with open(pb, "a", encoding="utf-8") as fh:
    fh.write("not a log line at all\n")
S.refresh_btc_phase(st, now)
assert st.btc_phase == "uptrend"
print("BTC phase from log:", st.btc_phase)

# --- phase gauges: preferred over the transition counters when 7RL publishes them
def gauge(ts_ms, name, value, **labels):
    ts = datetime.fromtimestamp(ts_ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return json.dumps({"ts": ts, "name": name, "kind": "gauge", "value": value, "labels": labels})

g = S.PhaseState()
g.bootstrapped = True
T1 = T0 + 7200_000
probs = {"uptrend": 0.55, "downtrend": 0.05, "ranging": 0.25, "creep_up": 0.10, "creep_down": 0.05}
for ph, v in probs.items():
    S.handle_line(g, gauge(T1, "phase_probability", v, symbol="BTC/USDT", phase=ph))
S.handle_line(g, gauge(T1, "phase_confidence", 0.55, symbol="BTC/USDT"))
S.handle_line(g, gauge(T1, "phase_vol_regime", 2, symbol="BTC/USDT"))
assert g.current_phase("BTC/USDT") == "uptrend", g.current_phase("BTC/USDT")
assert g.gauge["BTC/USDT"]["vol_regime"] == "high"
assert g.last_seen("BTC/USDT") == T1
print("gauge -> фаза:", g.current_phase("BTC/USDT"), "| vol:", g.gauge["BTC/USDT"]["vol_regime"])

# a stable regime keeps the reading fresh even though nothing changed
for ph, v in probs.items():
    S.handle_line(g, gauge(T1 + 60_000, "phase_probability", v, symbol="BTC/USDT", phase=ph))
assert g.last_seen("BTC/USDT") == T1 + 60_000
assert len(g.history["BTC/USDT"]) == 1, "неизменная фаза не должна плодить переходы"

# the detector now carries the real distribution rather than a one-hot flag
g.btc_phase = "uptrend"
conn3 = S.open_db()
assert S.write_db_rows(conn3, g, T1 + 60_000) is True
cur = json.loads(conn3.execute("SELECT phase_current FROM decisions ORDER BY id DESC LIMIT 1").fetchone()[0])
assert abs(cur["uptrend"] - 0.55) < 1e-6 and abs(cur["ranging"] - 0.25) < 1e-6, cur
assert sum(1 for v in cur.values() if v > 0) == 5
conn3.close()
print("detector phase_current:", {k: round(v, 2) for k, v in cur.items()})

# and the ingest payload passes 7RL's own confidence and vol_regime through
sent.clear()
S.post_ingest(g, T1 + 60_000)
btc = [p for p in sent["body"]["phases"] if p["instId"] == "BTC-USDT"][0]
assert abs(btc["confidence"] - 0.55) < 1e-6 and btc["vol_regime"] == "high", btc
assert btc["age_s"] == 0, btc
print("ingest BTC:", btc)

# --- a phase taken from the log must not borrow another phase's occupancy
sent.clear()
st.btc_phase = "downtrend"          # log says one thing, counter history another
assert st.current_phase("BTC/USDT") != "downtrend"
S.post_ingest(st, now)
btc = [p for p in sent["body"]["phases"] if p["instId"] == "BTC-USDT"][0]
assert btc["phase"] == "downtrend" and btc["confidence"] is None, btc
print("mismatched source -> confidence:", btc["confidence"])
print("ALL TESTS PASSED")
