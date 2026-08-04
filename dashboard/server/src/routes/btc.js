import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { listParquetFilesSorted, readParquet, readParquetTail } from '../lib/parquet.js';
import { orchDb } from '../lib/db.js';

const router = Router();

const ALLOWED_TF = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const TF_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
const BINANCE_INTERVALS = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };

function safeParse(s) { if (!s) return null; try { return JSON.parse(s); } catch { return null; } }

// Candle cache from the Binance public API. It fills the gap after the last
// parquet file, and carries the whole series where no parquet files exist.
const _binanceCache = { key: null, data: [], fetchedAt: 0 };
const BINANCE_CACHE_TTL = 5 * 60_000; // 5 min
const BINANCE_MAX_LIMIT = 1000;

async function fetchBinanceLiveCandles(tf = '1h', limit = 48) {
  const capped = Math.min(Math.max(Math.ceil(limit) || 48, 2), BINANCE_MAX_LIMIT);
  const key = `${tf}:${capped}`;
  const now = Date.now();
  if (_binanceCache.key === key && now - _binanceCache.fetchedAt < BINANCE_CACHE_TTL && _binanceCache.data.length > 0) {
    return _binanceCache.data;
  }
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${BINANCE_INTERVALS[tf] || '1h'}&limit=${capped}`;
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const klines = await r.json();
    const points = klines.map((k) => ({ ts: Number(k[0]), close: Number(k[4]), real: true, source: 'binance' }));
    _binanceCache.key = key;
    _binanceCache.data = points;
    _binanceCache.fetchedAt = now;
    return points;
  } catch (e) {
    console.warn('[btc/price] Binance live fetch failed:', e.message);
    return _binanceCache.data; // stale ok
  }
}

router.get('/price', async (req, res) => {
  try {
    const tf = ALLOWED_TF.has(req.query.tf) ? req.query.tf : '1h';
    const dir = path.join(config.solbot.dataDir, 'candles', 'BTCUSDT', tf);
    // Missing parquet candles is normal on hosts without an ob-recorder —
    // Binance then supplies the whole series instead of only the tail.
    const files = listParquetFilesSorted(dir);

    const step = TF_MS[tf];
    let tsStart, tsEnd;
    const fromIso = req.query.from;
    const barsPerDay = { '1m': 1440, '5m': 288, '15m': 96, '1h': 24, '4h': 6, '1d': 1 }[tf];

    // Decide which files to read, and how many bars Binance has to cover
    let take;
    let binanceBars;
    if (fromIso) {
      const fromMs = Date.parse(fromIso);
      if (!Number.isFinite(fromMs)) return res.status(400).json({ error: 'bad from= param' });
      tsStart = Math.floor(fromMs / step) * step;
      // read all files from start date onward (plus a small tail for interpolation continuity)
      const fromDate = new Date(tsStart).toISOString().slice(0, 10);
      take = files.filter((f) => f.slice(0, 10) >= fromDate);
      if (take.length === 0) take = files.slice(-1);
      binanceBars = Math.ceil((Date.now() - tsStart) / step) + 2;
    } else {
      const limit = Math.min(Number(req.query.limit) || 200, 2000);
      const needFiles = Math.min(files.length, Math.ceil(limit / barsPerDay) + 5);
      take = files.slice(-needFiles);
      tsStart = null; // set from raw later
      binanceBars = limit + 2;
    }

    const rawMap = new Map();
    for (const f of take) {
      const records = await readParquet(path.join(dir, f), ['ts', 'close']);
      for (const r of records) {
        const t = Number(r.ts);
        const c = Number(r.close);
        if (Number.isFinite(t) && Number.isFinite(c)) rawMap.set(t, c);
      }
    }
    // Merge live candles from Binance to cover gap after last parquet file
    const binanceLive = await fetchBinanceLiveCandles(tf, binanceBars);
    for (const b of binanceLive) {
      if (!rawMap.has(b.ts)) rawMap.set(b.ts, b.close);
    }
    const raw = [...rawMap.entries()]
      .map(([ts, close]) => ({ ts, close }))
      .sort((a, b) => a.ts - b.ts);
    if (raw.length === 0) return res.status(404).json({ error: 'no rows' });

    const last = raw[raw.length - 1];
    tsEnd = Math.floor(last.ts / step) * step;
    if (tsStart == null) {
      const limit = Math.min(Number(req.query.limit) || 200, 2000);
      tsStart = tsEnd - (limit - 1) * step;
    }

    // Linear interpolation on regular hourly grid
    const rawInRange = raw.filter((p) => p.ts >= tsStart - step && p.ts <= tsEnd);
    const points = [];
    let i = 0;
    for (let t = tsStart; t <= tsEnd; t += step) {
      while (i + 1 < rawInRange.length && rawInRange[i + 1].ts <= t) i++;
      const before = rawInRange[i];
      const after = rawInRange[i + 1];
      if (before && before.ts === t) {
        points.push({ ts: t, close: before.close, real: true });
      } else if (before && after) {
        const frac = (t - before.ts) / (after.ts - before.ts);
        const close = before.close + (after.close - before.close) * frac;
        points.push({ ts: t, close, real: false });
      } else if (before) {
        points.push({ ts: t, close: before.close, real: false });
      } else if (after) {
        points.push({ ts: t, close: after.close, real: false });
      }
    }

    const realCount = points.filter((p) => p.real).length;
    res.json({
      symbol: 'BTCUSDT',
      tf,
      count: points.length,
      real_count: realCount,
      synthetic_count: points.length - realCount,
      ts_from: points[0]?.ts ?? null,
      ts_to: points[points.length - 1]?.ts ?? null,
      points,
    });
  } catch (e) {
    console.error('[btc/price]', e);
    res.status(500).json({ error: e.message });
  }
});

let _btcTickCache = { value: null, at: 0 };
router.get('/tick', async (req, res) => {
  try {
    const now = Date.now();
    if (_btcTickCache.value && now - _btcTickCache.at < 1500) {
      return res.json(_btcTickCache.value);
    }
    // Use Binance public ticker for real-time price (no auth, instant)
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const j = await r.json();
    const price = parseFloat(j.price);
    const value = {
      symbol: 'BTCUSDT',
      ts: now,
      mid: price,
      bid: price,
      ask: price,
      source: 'binance',
    };
    _btcTickCache = { value, at: now };
    res.json(value);
  } catch (e) {
    // fallback to cached
    if (_btcTickCache.value) return res.json(_btcTickCache.value);
    res.status(500).json({ error: e.message });
  }
});

router.get('/phase-detector', (req, res) => {
  try {
    const row = orchDb()
      .prepare(
        `SELECT ts, dominant_phase, phase_current, phase_pred_1h, phase_pred_4h, phase_pred_24h, signals, version_id
         FROM decisions
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get();
    if (!row) return res.status(404).json({ error: 'no decisions yet' });

    // Get phase_probs from ~60 min ago for delta calculation
    let prevPhase = null;
    try {
      const cutoff = new Date(Date.now() - 65 * 60_000).toISOString();
      const prev = orchDb()
        .prepare(`SELECT phase_probs FROM phase_history WHERE ts <= ? ORDER BY id DESC LIMIT 1`)
        .get(cutoff);
      if (prev?.phase_probs) prevPhase = safeParse(prev.phase_probs);
    } catch {}

    res.json({
      ts: Date.parse(row.ts),
      ts_iso: row.ts,
      dominant_phase: row.dominant_phase,
      phase_current: safeParse(row.phase_current),
      phase_prev_1h: prevPhase,
      phase_pred_1h: safeParse(row.phase_pred_1h),
      phase_pred_4h: safeParse(row.phase_pred_4h),
      phase_pred_24h: safeParse(row.phase_pred_24h),
      signals: safeParse(row.signals),
      version_id: row.version_id,
    });
  } catch (e) {
    console.error('[btc/phase-detector]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
