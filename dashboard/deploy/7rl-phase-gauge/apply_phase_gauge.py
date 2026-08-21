#!/usr/bin/env python3
"""Publish the current market phase as OTel gauges in 7RL Rohan Trade System.

Run from the trade-system root:

    python3 apply_phase_gauge.py --check     # verify every anchor matches
    python3 apply_phase_gauge.py             # apply, keeping .bak copies
    python3 apply_phase_gauge.py --revert    # restore the .bak copies

Why
---
`phase_changes_total` is a *transition* counter. It fires only when a symbol's
dominant phase changes, which means:

  * a holding regime emits nothing at all, so a consumer cannot tell
    "unchanged" from "no data";
  * the counters restart at zero with the process, so anyone reconstructing
    state from their deltas loses a transition on every restart.

The dashboard needs *state*, so this adds three gauges that restate the current
PhaseOutput on every tick:

    phase_probability{symbol, phase}  — the five entries of phase_probs
    phase_confidence{symbol}          — PhaseOutput.confidence
    phase_vol_regime{symbol}          — 0=low, 1=normal, 2=high (-1 unknown)

The dominant phase is the argmax of phase_probability, so it needs no series of
its own and no series is ever left behind holding a stale value.

Scope: three files, additive only. No existing metric, log line or behaviour is
touched, nothing is removed, and no trading path is involved. Each edit is
anchored on an exact snippet — if the source has moved on, the script refuses
to write rather than guessing.
"""

import argparse
import pathlib
import shutil
import sys

EDITS = [
    (
        "src/telemetry/metrics.py",
        [
            (
                "declare the instruments",
                """    state_writes: Any
    telegram_polls: Any
    data_gap_checks: Any""",
                """    state_writes: Any
    telegram_polls: Any
    data_gap_checks: Any

    # Current market phase published as state, not as transition events.
    phase_probability: Any
    phase_confidence: Any
    phase_vol_regime: Any""",
            ),
            (
                "create the gauges",
                """        liquidation_distance=meter.create_gauge(
            "liquidation_distance_pct",
            description="Mark-to-liquidation distance as pct of entry price",
        ),""",
                """        liquidation_distance=meter.create_gauge(
            "liquidation_distance_pct",
            description="Mark-to-liquidation distance as pct of entry price",
        ),
        phase_probability=meter.create_gauge(
            "phase_probability",
            description=(
                "PhaseOutput.phase_probs per (symbol, phase), restated every "
                "tick so consumers read the current phase directly instead of "
                "replaying phase_changes_total — which stays silent while a "
                "regime holds and restarts at zero with the process."
            ),
        ),
        phase_confidence=meter.create_gauge(
            "phase_confidence",
            description="PhaseOutput.confidence per (symbol)",
        ),
        phase_vol_regime=meter.create_gauge(
            "phase_vol_regime",
            description=(
                "PhaseOutput.vol_regime per (symbol) as an index into "
                "VOL_REGIMES: 0=low, 1=normal, 2=high, -1=unknown"
            ),
        ),""",
            ),
            (
                "add the setter",
                """def inc_state_writes(*, account_id: str, op: str, count: int = 1) -> None:""",
                '''# Kept local so this addition needs no new imports; mirrors
# src.contracts._constants.PHASES / VOL_REGIMES.
_PHASE_ORDER = ("uptrend", "downtrend", "ranging", "creep_up", "creep_down")
_VOL_REGIME_CODES = {"low": 0.0, "normal": 1.0, "high": 2.0}


def set_phase_output(
    *,
    symbol: str,
    phase_probs: list[float],
    confidence: float,
    vol_regime: str,
) -> None:
    """Publish the current PhaseOutput as gauges.

    Counters describe what happened; these describe what is. Consumers read the
    phase per symbol without replaying transitions, which is what lets them
    survive both a stable market and a process restart."""
    inst = _get()
    for phase, prob in zip(_PHASE_ORDER, phase_probs):
        inst.phase_probability.set(float(prob), {"symbol": symbol, "phase": phase})
    inst.phase_confidence.set(float(confidence), {"symbol": symbol})
    inst.phase_vol_regime.set(
        _VOL_REGIME_CODES.get(vol_regime, -1.0), {"symbol": symbol}
    )


def inc_state_writes(*, account_id: str, op: str, count: int = 1) -> None:''',
            ),
            (
                "export it",
                """    "inc_state_writes",""",
                """    "inc_state_writes",
    "set_phase_output",""",
            ),
        ],
    ),
    (
        "src/telemetry/__init__.py",
        [
            (
                "re-export (import)",
                "    set_data_staleness,",
                "    set_data_staleness,\n    set_phase_output,",
            ),
            (
                "re-export (__all__)",
                '    "set_data_staleness",',
                '    "set_data_staleness",\n    "set_phase_output",',
            ),
        ],
    ),
    (
        "src/services/system_loop.py",
        [
            (
                "import the setter",
                "    inc_phase_changes,",
                "    inc_phase_changes,\n    set_phase_output,",
            ),
            (
                "publish on every tick",
                """            self._last_dominant_phase[symbol] = phase_output.dominant_phase
            self.global_state.phases[symbol] = phase_output""",
                """            self._last_dominant_phase[symbol] = phase_output.dominant_phase
            # State, not just transitions: a holding regime emits no
            # phase_changes_total, so publish the phase itself each tick.
            set_phase_output(
                symbol=symbol,
                phase_probs=phase_output.phase_probs,
                confidence=phase_output.confidence,
                vol_regime=phase_output.vol_regime,
            )
            self.global_state.phases[symbol] = phase_output""",
            ),
        ],
    ),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="trade-system root (default: cwd)")
    ap.add_argument("--check", action="store_true", help="verify anchors, write nothing")
    ap.add_argument("--revert", action="store_true", help="restore the .bak copies")
    args = ap.parse_args()
    root = pathlib.Path(args.root)

    if args.revert:
        for rel, _ in EDITS:
            bak = root / (rel + ".bak")
            if bak.exists():
                shutil.copy2(bak, root / rel)
                print(f"restored {rel}")
            else:
                print(f"no backup for {rel}", file=sys.stderr)
        return 0

    planned = []
    problems = []
    for rel, edits in EDITS:
        path = root / rel
        if not path.exists():
            problems.append(f"{rel}: missing")
            continue
        text = path.read_text(encoding="utf-8")
        for name, old, new in edits:
            if new in text:
                problems.append(f"{rel}: '{name}' already applied")
            elif text.count(old) != 1:
                problems.append(
                    f"{rel}: '{name}' anchor matched {text.count(old)}x, expected 1"
                )
            else:
                text = text.replace(old, new, 1)
        planned.append((path, text))

    if problems:
        print("refusing to write:", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1

    if args.check:
        print("all anchors matched; safe to apply")
        return 0

    for path, text in planned:
        shutil.copy2(path, path.with_suffix(path.suffix + ".bak"))
        path.write_text(text, encoding="utf-8")
        print(f"patched {path.relative_to(root)} (backup alongside as .bak)")
    print("\nRestart the trade system for the gauges to appear in metrics.jsonl.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
