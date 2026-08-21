import { Router } from 'express';
import { orchDb } from '../lib/db.js';
import { phaseStore } from '../lib/phaseStore.js';

const router = Router();

router.get('/distribution', (req, res) => {
  try {
    let cutoff;
    let hoursForGrid;
    if (req.query.from) {
      const fromMs = Date.parse(req.query.from);
      if (!Number.isFinite(fromMs)) return res.status(400).json({ error: 'bad from= param' });
      cutoff = new Date(fromMs).toISOString();
      hoursForGrid = Math.ceil((Date.now() - fromMs) / 3600_000);
    } else {
      hoursForGrid = Math.min(Math.max(Number(req.query.hours) || 200, 1), 2000);
      cutoff = new Date(Date.now() - hoursForGrid * 3600_000).toISOString();
    }
    const hours = hoursForGrid;
    // Fetch raw JSON so we can remap v1 → v2 schema on the fly
    const rawRows = orchDb()
      .prepare(`SELECT ts, phase_probs FROM phase_history WHERE ts >= ? ORDER BY ts ASC`)
      .all(cutoff);

    // v1: {trending, ranging, high_vol, low_vol}  →  v2: 5 phases
    // Split trending evenly between 4 directional phases, ranging stays
    function remapV1(p) {
      const trending = Number(p.trending) || 0;
      const ranging = Number(p.ranging) || 0;
      return {
        uptrend:    trending / 4,
        downtrend:  trending / 4,
        creep_up:   trending / 4,
        creep_down: trending / 4,
        ranging:    ranging,
      };
    }
    function normalize(p) {
      if (!p) return null;
      if (p.uptrend != null || p.creep_up != null) {
        return {
          uptrend:    Number(p.uptrend)    || 0,
          downtrend:  Number(p.downtrend)  || 0,
          ranging:    Number(p.ranging)    || 0,
          creep_up:   Number(p.creep_up)   || 0,
          creep_down: Number(p.creep_down) || 0,
        };
      }
      if (p.trending != null || p.ranging != null) return remapV1(p);
      return null;
    }

    // bucket into hours
    const buckets = new Map(); // hourIso -> {sum:{}, n}
    for (const r of rawRows) {
      let probs = null;
      try { probs = JSON.parse(r.phase_probs); } catch {}
      const norm = normalize(probs);
      if (!norm) continue;
      const hourIso = r.ts.slice(0, 13) + ':00:00Z'; // 'YYYY-MM-DDTHH:00:00Z'
      let b = buckets.get(hourIso);
      if (!b) {
        b = { sum: { uptrend:0, downtrend:0, ranging:0, creep_up:0, creep_down:0 }, n: 0 };
        buckets.set(hourIso, b);
      }
      for (const k of Object.keys(b.sum)) b.sum[k] += norm[k];
      b.n += 1;
    }
    let points = [...buckets.entries()]
      .map(([iso, b]) => ({
        ts: Date.parse(iso),
        uptrend:    b.sum.uptrend    / b.n,
        downtrend:  b.sum.downtrend  / b.n,
        ranging:    b.sum.ranging    / b.n,
        creep_up:   b.sum.creep_up   / b.n,
        creep_down: b.sum.creep_down / b.n,
        n: b.n,
      }))
      .sort((a, b) => a.ts - b.ts);

    // Linear-interpolate missing hours within requested range
    const keys = ['uptrend', 'downtrend', 'ranging', 'creep_up', 'creep_down'];
    const HOUR = 3600_000;
    if (points.length >= 2) {
      const tsEnd = points[points.length - 1].ts;
      // Never reach back past the first real bucket: filling the hours before
      // it would extrapolate the oldest reading across the whole window and
      // present a phase that was never observed.
      const tsStart = Math.max(points[0].ts, tsEnd - (hours - 1) * HOUR);
      const realByTs = new Map(points.map((p) => [p.ts, p]));
      const have = points.slice();
      have.sort((a, b) => a.ts - b.ts);
      const out = [];
      let i = 0;
      for (let t = tsStart; t <= tsEnd; t += HOUR) {
        while (i + 1 < have.length && have[i + 1].ts <= t) i++;
        const bef = have[i];
        const aft = have[i + 1];
        if (bef && bef.ts === t) {
          out.push({ ...bef, real: true });
        } else if (bef && aft) {
          const frac = (t - bef.ts) / (aft.ts - bef.ts);
          const row = { ts: t, n: 0, real: false };
          for (const k of keys) row[k] = bef[k] + (aft[k] - bef[k]) * frac;
          out.push(row);
        } else if (bef) {
          out.push({ ...bef, ts: t, real: false });
        } else if (aft) {
          out.push({ ...aft, ts: t, real: false });
        }
      }
      points = out;
    }

    const smooth = Math.min(Math.max(Number(req.query.smooth) || 1, 1), 21);
    if (smooth > 1 && points.length > smooth) {
      const half = Math.floor(smooth / 2);
      const out = new Array(points.length);
      for (let i = 0; i < points.length; i++) {
        const lo = Math.max(0, i - half);
        const hi = Math.min(points.length - 1, i + half);
        const n = hi - lo + 1;
        const sums = { uptrend: 0, downtrend: 0, ranging: 0, creep_up: 0, creep_down: 0 };
        for (let j = lo; j <= hi; j++) {
          for (const k of keys) sums[k] += points[j][k] || 0;
        }
        out[i] = { ts: points[i].ts, n: points[i].n, real: points[i].real };
        for (const k of keys) out[i][k] = sums[k] / n;
      }
      points = out;
    }

    const realCount = points.filter((p) => p.real).length;
    res.json({ count: points.length, real_count: realCount, smooth, points });
  } catch (e) {
    console.error('[phases/distribution]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/current', (req, res) => {
  const { latest, receivedAt } = phaseStore.get();
  if (!latest) {
    return res.json({ ok: false, reason: 'no data yet — waiting for phase-broadcaster push' });
  }
  res.json({
    ok: true,
    received_at: receivedAt,
    age_ms: Date.now() - receivedAt,
    version: latest.version,
    ts_utc: latest.ts_utc,
    ts_ms: latest.ts_ms,
    source: latest.source,
    phases: latest.phases,
  });
});

router.get('/history', (req, res) => {
  try {
    // `from` returns BTC's phase per hour — one entry per hour, the phase it
    // spent most of that hour in. That is what the chart band draws, and it
    // keeps ten days down to ~240 points instead of 14k rows.
    if (req.query.from) {
      const fromMs = Date.parse(req.query.from);
      if (!Number.isFinite(fromMs)) return res.status(400).json({ error: 'bad from= param' });
      const rows = orchDb()
        .prepare(`SELECT ts, dominant_phase FROM phase_history WHERE ts >= ? ORDER BY id`)
        .all(new Date(fromMs).toISOString());
      const buckets = new Map(); // hourIso -> {phase -> count}
      for (const r of rows) {
        if (!r.dominant_phase) continue;
        const hour = r.ts.slice(0, 13);
        let b = buckets.get(hour);
        if (!b) buckets.set(hour, (b = new Map()));
        b.set(r.dominant_phase, (b.get(r.dominant_phase) || 0) + 1);
      }
      const points = [...buckets.entries()]
        .map(([hour, counts]) => {
          let phase = null;
          let best = -1;
          let total = 0;
          for (const [p, n] of counts) {
            total += n;
            if (n > best) { best = n; phase = p; }
          }
          return { ts: Date.parse(`${hour}:00:00Z`), phase, share: best / total, n: total };
        })
        .sort((a, b) => a.ts - b.ts);
      return res.json({ count: points.length, points });
    }

    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const rows = orchDb()
      .prepare(
        `SELECT ts, dominant_phase, confidence
         FROM phase_history
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(limit)
      .reverse()
      .map((r) => ({
        ts: Date.parse(r.ts),
        phase: r.dominant_phase,
        confidence: r.confidence,
      }));
    res.json({ count: rows.length, points: rows });
  } catch (e) {
    console.error('[phases/history]', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/changes', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 200);
    const rows = orchDb()
      .prepare(
        `SELECT id, ts, dominant_phase, phase_probs, confidence
         FROM phase_history
         ORDER BY id DESC
         LIMIT 20000`,
      )
      .all();
    rows.reverse();
    const changes = [];
    let prev = null;
    for (const r of rows) {
      if (prev !== null && r.dominant_phase !== prev.dominant_phase) {
        let probs = null;
        try {
          probs = JSON.parse(r.phase_probs);
        } catch {}
        changes.push({
          ts: Date.parse(r.ts),
          from: prev.dominant_phase,
          to: r.dominant_phase,
          confidence: r.confidence,
          probs,
        });
      }
      prev = r;
    }
    res.json({ count: changes.length, changes: changes.slice(-limit).reverse() });
  } catch (e) {
    console.error('[phases/changes]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
