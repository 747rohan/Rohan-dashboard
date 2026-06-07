import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { okxState } from '../services/okxPoller.js';

const router = Router();

const INITIAL_EQUITY = 100.0;
const INITIAL_TS = Date.parse(config.okx.startIso);

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

router.get('/trades', (req, res) => {
  try {
    const closed = readJsonl(config.okx.closedPositionsPath)
      .filter((p) => Number.isFinite(p.uTime))
      .sort((a, b) => b.uTime - a.uTime);
    res.json({
      count: closed.length,
      trades: closed.map((p) => ({
        instId: p.instId,
        direction: p.direction,
        cTime_iso: new Date(p.cTime).toISOString(),
        uTime_iso: new Date(p.uTime).toISOString(),
        openAvgPx: p.openAvgPx,
        closeAvgPx: p.closeAvgPx,
        priceChangePct: p.priceChangePct,
        pnl: p.pnl, fee: p.fee, fundingFee: p.fundingFee, net: p.net,
        win_by_direction: p.priceChangePct > 0,
        win_by_pnl: p.pnl > 0,
        win_by_net: p.net > 0,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/metrics', (req, res) => {
  try {
    const closed = readJsonl(config.okx.closedPositionsPath)
      .filter((p) => Number.isFinite(p.uTime) && Number.isFinite(p.pnl))
      .sort((a, b) => a.uTime - b.uTime);
    const snapshots = readJsonl(config.okx.equityHistoryPath)
      .sort((a, b) => a.ts_ms - b.ts_ms);

    // === WIN/LOSS/PF — by NET PnL (чистый PnL) ===
    const trades = closed.length;
    const isWin  = (p) => Number.isFinite(p.net) && p.net > 0;
    const isLoss = (p) => Number.isFinite(p.net) && p.net < 0;
    const isZero = (p) => Number.isFinite(p.net) && p.net === 0;
    const wins   = closed.filter(isWin).length;
    const losses = closed.filter(isLoss).length;
    const zeros  = closed.filter(isZero).length;
    const sumWin  = closed.filter(isWin).reduce((a, p) => a + p.net, 0);
    const sumLoss = Math.abs(closed.filter(isLoss).reduce((a, p) => a + p.net, 0));
    const winRate      = trades ? wins / trades : null;
    const profitFactor = sumLoss > 0 ? sumWin / sumLoss : null;

    // Alt counts for debugging
    const altGrossWins = closed.filter((p) => p.pnl > 0).length;
    const altGrossLosses = closed.filter((p) => p.pnl < 0).length;

    // === Equity curve: synthetic (cumsum net from seed) + real snapshots ===
    // Seed taken from the first record of equity_history.jsonl (source: "reset" | "inception").
    // Falls back to hardcoded $100 only if no history exists.
    const seedEquity = Number.isFinite(snapshots[0]?.equity) ? snapshots[0].equity : INITIAL_EQUITY;
    const seedTs     = Number.isFinite(snapshots[0]?.ts_ms)  ? snapshots[0].ts_ms  : INITIAL_TS;
    const synth = [{ ts_ms: seedTs, equity: seedEquity, source: 'inception' }];
    let eq = seedEquity;
    for (const p of closed) {
      eq += Number.isFinite(p.net) ? p.net : p.pnl;
      synth.push({ ts_ms: p.uTime, equity: eq, source: 'synth' });
    }
    // merge with real snapshots (live equity includes unrealized)
    const curve = synth.concat(snapshots.filter((s) => s.source === 'okx'))
      .sort((a, b) => a.ts_ms - b.ts_ms);

    // Max DD (from peak down)
    let maxDD = 0;
    let peak = curve[0]?.equity ?? seedEquity;
    for (const p of curve) {
      if (p.equity > peak) peak = p.equity;
      const dd = peak > 0 ? (peak - p.equity) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    // Sharpe (daily returns, annualized √365)
    let sharpe = null;
    if (curve.length >= 3) {
      const daily = new Map();
      for (const p of curve) {
        const day = Math.floor(p.ts_ms / 86_400_000);
        daily.set(day, p.equity);
      }
      const eqs = [...daily.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      if (eqs.length >= 3) {
        const rets = [];
        for (let i = 1; i < eqs.length; i++) {
          const r = (eqs[i] - eqs[i - 1]) / eqs[i - 1];
          if (Number.isFinite(r)) rets.push(r);
        }
        if (rets.length >= 2) {
          const mean = rets.reduce((a, x) => a + x, 0) / rets.length;
          const variance = rets.reduce((a, x) => a + (x - mean) ** 2, 0) / rets.length;
          const std = Math.sqrt(variance);
          sharpe = std > 0 ? (mean / std) * Math.sqrt(365) : null;
        }
      }
    }

    res.json({
      summary: {
        bots: 2,
        trades,
        win_rate: winRate,
        sharpe,
        max_dd: maxDD,
        profit_factor: profitFactor,
      },
      debug: {
        by_net:   { wins, losses, zeros, sum_win: sumWin, sum_loss: sumLoss },
        by_gross: { wins: altGrossWins, losses: altGrossLosses },
        curve_points: curve.length,
        synth_points: synth.length,
        real_snapshots: snapshots.length,
        current_equity: snapshots[snapshots.length - 1]?.equity ?? null,
      },
      okx: okxState(),
    });
  } catch (e) {
    console.error('[trading/metrics]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
