"""Offline checks for phase_shim: run `python test_phase_shim.py` from this folder.

No server, no 7RL and no network — synthetic metrics lines go straight into the
parser and the database is a throwaway file in a temp dir. Covers the traps that
make this shim subtle: adopting a counter on first sight without inventing a
transition, ignoring a counter reset after 7RL restarts, dropping replayed lines
from a rotated file, and building phase_probs from the market cross-section
rather than from a single symbol.
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

# --- flush 2 (+30 min): BTC counter increments -> real transition
S.handle_line(st, line(T0 + 1800_000, "BTC/USDT", "ranging", "uptrend", 1.0))   # new key, phase already known -> no move
assert st.current_phase("BTC/USDT") == "ranging"
S.handle_line(st, line(T0 + 1800_000, "BTC/USDT", "ranging", "uptrend", 2.0))   # increment -> move
assert st.current_phase("BTC/USDT") == "uptrend", st.current_phase("BTC/USDT")

# --- older line from a rotated file must be ignored
S.handle_line(st, line(T0 - 600_000, "BTC/USDT", "uptrend", "downtrend", 99.0))
assert st.current_phase("BTC/USDT") == "uptrend"

# --- counter reset (7RL restart) must not invent a transition
S.handle_line(st, line(T0 + 2400_000, "BTC/USDT", "ranging", "uptrend", 1.0))
assert st.current_phase("BTC/USDT") == "uptrend"

# --- occupancy over the trailing hour: 30 min ranging + 30 min uptrend
now = T0 + 3600_000
occ = st.occupancy("BTC/USDT", now)
assert abs(sum(occ.values()) - 1.0) < 1e-9, occ
assert abs(occ["ranging"] - 0.5) < 0.02 and abs(occ["uptrend"] - 0.5) < 0.02, occ
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
print("ALL TESTS PASSED")
