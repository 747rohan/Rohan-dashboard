import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';

const router = Router();

// The gex_server collector rewrites gex_zones.json once a minute. Parsing it
// (60 kB, 300 candles, six expiry groups) on every poll from every open tab is
// wasted work, so keep the parsed copy until the file's mtime moves.
let cache = { mtimeMs: 0, data: null };

function readZones() {
  const st = fs.statSync(config.gex.zonesPath);
  if (st.mtimeMs !== cache.mtimeMs) {
    cache = { mtimeMs: st.mtimeMs, data: JSON.parse(fs.readFileSync(config.gex.zonesPath, 'utf8')) };
  }
  return cache.data;
}

router.get('/zones', (req, res) => {
  try {
    if (!fs.existsSync(config.gex.zonesPath)) {
      return res.status(503).json({ error: `gex zones not found at ${config.gex.zonesPath}` });
    }
    const d = readZones();
    const groups = Object.keys(d.groups || {});
    const key = groups.includes(req.query.group) ? req.query.group : (groups.includes('7D') ? '7D' : groups[0]);
    const g = d.groups[key];
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 2), 75);
    const since = d.generated_ts - hours * 3600; // the collector writes seconds

    const ageS = Math.floor(Date.now() / 1000) - d.generated_ts;
    res.set('Cache-Control', 'no-store').json({
      generated_ts: d.generated_ts,
      age_s: ageS,
      stale: ageS > config.gex.staleSec,
      checks_ok: !!d.checks_ok,
      failed_checks: (d.checks || []).filter((c) => !c.ok).map((c) => ({ name: c.name, text: c.text })),
      spot: d.spot,
      bar: d.bar,
      groups,
      group: key,
      title: g.title,
      expiries: (g.expiries || []).length,
      regime: g.regime,
      net_gex_usd_1pct: g.net_gex_usd_1pct,
      flow_net_gex_usd_1pct: g.flow_net_gex_usd_1pct ?? null,
      flow_coverage: g.flow_coverage ?? null,
      // Expected move is only computed for the nearest expiry; it frames the
      // chart for every group because it is the one range priced for "today".
      em: d.em ? { lower: d.em.lower, upper: d.em.upper, expiry: d.em.expiry, source: d.em.em_source } : null,
      zones: (g.zones || []).map((z) => ({
        type: z.type, lo: z.lo, hi: z.hi, strike: z.strike, rank: z.rank,
        value_usd_1pct: z.value_usd_1pct, flow_check: z.flow_check ?? null,
        confluence: z.confluence ?? null,
      })),
      lines: (g.lines || []).map((l) => ({ type: l.type, price: l.price, label: l.label })),
      // Milliseconds out, like every other series the dashboard serves.
      candles: (d.candles || []).filter((c) => c.t >= since)
        .map((c) => ({ t: c.t * 1000, o: c.o, h: c.h, l: c.l, c: c.c })),
    });
  } catch (e) {
    console.error('[gex/zones]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
