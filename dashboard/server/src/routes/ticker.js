import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { listParquetFilesSorted, readParquetTail } from '../lib/parquet.js';

const router = Router();

const SYMBOLS = [
  'ADAUSDT', 'APTUSDT', 'ARBUSDT', 'AVAXUSDT', 'BNBUSDT',
  'BTCUSDT', 'DOGEUSDT', 'ENAUSDT', 'ETHUSDT', 'HBARUSDT',
  'INJUSDT', 'LTCUSDT', 'NEARUSDT', 'OPUSDT', 'POLUSDT',
  'SEIUSDT', 'SOLUSDT', 'SUIUSDT', 'TIAUSDT', 'TRUMPUSDT',
  'WIFUSDT', 'XRPUSDT',
];

// { symbol -> { ts, value, fetchedAt } }
const cache = new Map();
const CACHE_TTL_MS = 10_000; // 10s — reduce parquet read pressure on VPS

async function readLastTick(symbol) {
  const now = Date.now();
  const c = cache.get(symbol);
  if (c && now - c.fetchedAt < CACHE_TTL_MS) return c.value;

  const dir = path.join(config.solbot.dataDir, 'book', symbol);
  if (!fs.existsSync(dir)) return null;
  const files = listParquetFilesSorted(dir);
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  const filePath = path.join(dir, latest);
  try {
    const rows = await readParquetTail(filePath, 1, ['ts', 'best_bid', 'best_ask', 'spread_bp']);
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const value = {
      symbol,
      ts: Number(last.ts),
      bid: Number(last.best_bid),
      ask: Number(last.best_ask),
      mid: (Number(last.best_bid) + Number(last.best_ask)) / 2,
      spread_bp: Number(last.spread_bp),
    };
    cache.set(symbol, { value, fetchedAt: now });
    return value;
  } catch (e) {
    return { symbol, error: e.message };
  }
}

router.get('/', async (req, res) => {
  try {
    const results = await Promise.all(SYMBOLS.map((s) => readLastTick(s)));
    const items = results.filter(Boolean);
    const freshestTs = items.reduce((m, i) => (i.ts > m ? i.ts : m), 0);
    res.json({ count: items.length, freshestTs, items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
