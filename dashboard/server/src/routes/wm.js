import { Router } from 'express';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { translateBatch } from '../lib/translate.js';

const router = Router();

let _redis = null;
function getRedis() {
  if (_redis) return _redis;
  _redis = new Redis(config.redis.url, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  _redis.on('error', () => {});
  return _redis;
}

const KEYS = ['wm:news', 'wm:pred', 'wm:geo', 'wm:etf', 'wm:stablecoin'];

// Cache last known good values — survives Redis key expiry
const _wmCache = new Map(); // key (without wm:) -> { value, cachedAt }

let _fgCache = { value: null, at: 0 };
const FG_TTL_MS = 30 * 60 * 1000; // 30 min

async function fetchFearGreed() {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1', { signal: ctrl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const d = j?.data?.[0];
    if (!d) throw new Error('empty data');
    return {
      value: Number(d.value),
      classification: d.value_classification,
      ts_ms: Number(d.timestamp) * 1000,
      next_update_s: Number(d.time_until_update),
    };
  } catch (e) {
    clearTimeout(to);
    throw e;
  }
}

router.get('/fear-greed', async (req, res) => {
  const now = Date.now();
  if (_fgCache.value && now - _fgCache.at < FG_TTL_MS) {
    return res.json({ ...(_fgCache.value), cached: true });
  }
  try {
    const v = await fetchFearGreed();
    _fgCache = { value: v, at: now };
    res.json({ ...v, cached: false });
  } catch (e) {
    if (_fgCache.value) return res.json({ ...(_fgCache.value), cached: true, stale: true, error: e.message });
    res.status(502).json({ error: e.message });
  }
});

router.get('/feed', async (req, res) => {
  try {
    const r = getRedis();
    if (r.status === 'end' || r.status === 'wait') await r.connect();
    const pipeline = r.pipeline();
    KEYS.forEach((k) => pipeline.get(k));
    KEYS.forEach((k) => pipeline.ttl(k));
    const results = await Promise.race([
      pipeline.exec(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('redis timeout')), 2000)),
    ]);
    const out = {};
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      const [, raw] = results[i];
      const [, ttl] = results[i + KEYS.length];
      let parsed = null;
      if (raw) {
        try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      }
      const short = key.replace('wm:', '');
      if (parsed != null) {
        // fresh data — update cache
        _wmCache.set(short, { value: parsed, cachedAt: Date.now() });
        out[short] = { value: parsed, ttl, empty: false, stale: false };
      } else {
        // expired/missing — try fallback from cache
        const cached = _wmCache.get(short);
        if (cached) {
          out[short] = { value: cached.value, ttl: 0, empty: false, stale: true, cachedAt: cached.cachedAt };
        } else {
          out[short] = { value: null, ttl, empty: true, stale: false };
        }
      }
    }
    // Translate news headlines to Russian
    if (out.news?.value && Array.isArray(out.news.value)) {
      try {
        const headlines = out.news.value.map((n) => n.headline || '');
        const translated = await translateBatch(headlines);
        for (let i = 0; i < out.news.value.length; i++) {
          out.news.value[i].headline_ru = translated[i];
        }
      } catch {}
    }

    res.json({ ts: Date.now(), data: out });
  } catch (e) {
    console.error('[wm/feed]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
