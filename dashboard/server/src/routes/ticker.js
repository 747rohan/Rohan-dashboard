import { Router } from 'express';

const router = Router();

const SYMBOLS = [
  'ADAUSDT', 'APTUSDT', 'ARBUSDT', 'AVAXUSDT', 'BNBUSDT',
  'BTCUSDT', 'DOGEUSDT', 'ENAUSDT', 'ETHUSDT', 'HBARUSDT',
  'INJUSDT', 'LTCUSDT', 'NEARUSDT', 'OPUSDT', 'POLUSDT',
  'SEIUSDT', 'SOLUSDT', 'SUIUSDT', 'TIAUSDT', 'TRUMPUSDT',
  'WIFUSDT', 'XRPUSDT',
];

const BOOK_TICKER_URL =
  `https://api.binance.com/api/v3/ticker/bookTicker?symbols=${encodeURIComponent(JSON.stringify(SYMBOLS))}`;

// Single batched snapshot for all symbols — one Binance call per refresh.
let cache = { items: [], fetchedAt: 0 };
const CACHE_TTL_MS = 5_000; // frontend polls every 5s

async function fetchBookTickers() {
  const now = Date.now();
  if (cache.items.length && now - cache.fetchedAt < CACHE_TTL_MS) return cache.items;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(BOOK_TICKER_URL, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Binance ${r.status}`);
    const rows = await r.json();
    const items = [];
    for (const row of rows) {
      const bid = Number(row.bidPrice);
      const ask = Number(row.askPrice);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) continue;
      const mid = (bid + ask) / 2;
      items.push({
        symbol: row.symbol,
        ts: now,
        bid,
        ask,
        mid,
        spread_bp: ((ask - bid) / mid) * 10_000,
      });
    }
    if (!items.length) throw new Error('empty book ticker response');
    cache = { items, fetchedAt: now };
    return items;
  } finally {
    clearTimeout(to);
  }
}

router.get('/', async (req, res) => {
  try {
    const items = await fetchBookTickers();
    const freshestTs = items.reduce((m, i) => (i.ts > m ? i.ts : m), 0);
    res.json({ count: items.length, freshestTs, items, source: 'binance' });
  } catch (e) {
    // Serve stale snapshot rather than blanking the banner on a transient error
    if (cache.items.length) {
      const freshestTs = cache.items.reduce((m, i) => (i.ts > m ? i.ts : m), 0);
      return res.json({ count: cache.items.length, freshestTs, items: cache.items, source: 'binance', stale: true });
    }
    res.status(500).json({ error: e.message });
  }
});

export default router;
