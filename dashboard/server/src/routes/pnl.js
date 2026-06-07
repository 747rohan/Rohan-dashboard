import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';

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

    let out = points;
    if (points.length > 500) {
      const step = Math.ceil(points.length / 500);
      out = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    }
    const first = points[0]?.equity ?? null;
    const last = points[points.length - 1]?.equity ?? null;
    const deltaUsd = first != null && last != null ? last - first : null;
    const deltaPct = first && last != null ? (last - first) / first : null;

    res.json({
      range,
      count: points.length,
      first_ts: points[0]?.ts ?? null,
      last_ts: points[points.length - 1]?.ts ?? null,
      first_equity: first,
      last_equity: last,
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
