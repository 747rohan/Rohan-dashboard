import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { readFlows, flowsBetween } from '../lib/flows.js';

const router = Router();

const RANGE_HOURS = { '24h': 24, '7d': 168, '30d': 720, all: null };

router.get('/equity', (req, res) => {
  try {
    const range = req.query.range in RANGE_HOURS ? req.query.range : 'all';
    const hours = RANGE_HOURS[range];
    const cutoffMs = hours == null ? 0 : Date.now() - hours * 3600_000;

    const file = config.okx.equityHistoryPath;
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: `equity history not found at ${file}` });
    }
    const text = fs.readFileSync(file, 'utf8');
    const points = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (Number.isFinite(obj.ts_ms) && Number.isFinite(obj.equity) && obj.ts_ms >= cutoffMs) {
          points.push({ ts: obj.ts_ms, equity: obj.equity, source: obj.source || null });
        }
      } catch {}
    }
    points.sort((a, b) => a.ts - b.ts);

    const firstTs = points[0]?.ts ?? null;
    const lastTs = points[points.length - 1]?.ts ?? null;
    const first = points[0]?.equity ?? null;
    const last = points[points.length - 1]?.equity ?? null;

    // A deposit lifts the balance without anyone having earned it. Take every
    // transfer inside the range out of the result, and out of the curve, so
    // the chart shows what the trading did rather than a step on the day the
    // money arrived.
    const flows = firstTs == null ? [] : readFlows().filter((f) => f.ts_ms > firstTs && f.ts_ms <= lastTs);
    const flowsUsd = flows.reduce((s, f) => s + f.amount, 0);
    const adjusted = points.map((p) => ({ ...p, equity: p.equity - flowsBetween(flows, firstTs, p.ts) }));

    let out = adjusted;
    if (adjusted.length > 500) {
      const step = Math.ceil(adjusted.length / 500);
      out = adjusted.filter((_, i) => i % step === 0 || i === adjusted.length - 1);
    }
    const deltaUsd = first != null && last != null ? last - first - flowsUsd : null;
    // Modified Dietz: each transfer counts towards the base for the share of
    // the range it was actually in the account.
    const span = Math.max(lastTs - firstTs, 1);
    const base = first == null ? null
      : first + flows.reduce((s, f) => s + f.amount * ((lastTs - f.ts_ms) / span), 0);
    const deltaPct = base && deltaUsd != null ? deltaUsd / base : null;

    res.json({
      range,
      count: points.length,
      first_ts: firstTs,
      last_ts: lastTs,
      first_equity: first,
      last_equity: last,
      flows_usd: flowsUsd,
      flows: flows.map((f) => ({ ts: f.ts_ms, amount: f.amount })),
      delta_usd: deltaUsd,
      delta_pct: deltaPct,
      series: out,
    });
  } catch (e) {
    console.error('[pnl/equity]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
