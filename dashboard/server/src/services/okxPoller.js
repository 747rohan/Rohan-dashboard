import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { OkxClient } from '../lib/okx.js';

const INITIAL_EQUITY = 100.0;
const INITIAL_TS = Date.parse(config.okx.startIso);

let _client = null;
function client() {
  if (_client) return _client;
  if (!config.okx.apiKey) return null;
  _client = new OkxClient({
    apiKey: config.okx.apiKey,
    secret: config.okx.secret,
    passphrase: config.okx.passphrase,
  });
  return _client;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const state = {
  closedById: new Map(),
  lastUTime: 0,
  lastError: null,
  lastSnapshotAt: 0,
  latestEquity: null,
};

export function okxState() {
  return {
    closedCount: state.closedById.size,
    lastUTime: state.lastUTime,
    lastError: state.lastError,
    lastSnapshotAt: state.lastSnapshotAt,
    latestEquity: state.latestEquity,
    enabled: !!config.okx.apiKey,
  };
}

async function readEquity() {
  const c = client();
  if (!c) return null;
  try {
    const data = await c.balance();
    const row = data?.[0];
    if (!row) return null;
    const usdt = (row.details || []).find((d) => d.ccy === 'USDT');
    const equity = Number(usdt?.eq);
    return Number.isFinite(equity) ? equity : null;
  } catch (e) {
    state.lastError = e.message;
    console.warn('[okx] readEquity failed:', e.message);
    return null;
  }
}

async function snapshotEquity() {
  const c = client();
  if (!c) return null;
  try {
    const data = await c.balance();
    const row = data?.[0];
    if (!row) return null;
    // Use USDT `eq` from details to avoid USDT/USD exchange rate noise.
    // `totalEq` is USD-denominated and fluctuates with the USDT/USD price.
    const usdt = (row.details || []).find((d) => d.ccy === 'USDT');
    const equity = Number(usdt?.eq);
    if (!Number.isFinite(equity)) return null;
    const record = { ts_ms: Date.now(), equity, source: 'okx' };
    appendJsonl(config.okx.equityHistoryPath, record);
    state.latestEquity = equity;
    state.lastSnapshotAt = Date.now();
    state.lastError = null;
    return record;
  } catch (e) {
    state.lastError = e.message;
    console.warn('[okx] snapshotEquity failed:', e.message);
    return null;
  }
}

async function backfillClosed() {
  const c = client();
  if (!c) return;
  try {
    // Load existing keys only once (at startup, when state is empty)
    if (state.closedById.size === 0) {
      const existing = readJsonl(config.okx.closedPositionsPath);
      for (const p of existing) {
        const k = p.key || `${p.posId}_${p.uTime}`;
        state.closedById.set(k, p);
        if (p.uTime > state.lastUTime) state.lastUTime = p.uTime;
      }
    }
    // Paginate via `after` cursor until we reach records older than cutoff or exhaust pages.
    let after = null;
    let added = 0;
    let fetched = 0;
    let skippedEarly = 0;
    for (let page = 0; page < 12; page++) {
      const data = await c.positionsHistory({ limit: 100, after });
      if (!data || data.length === 0) break;
      fetched += data.length;
      let oldestCTime = Infinity;
      let oldestUTime = Infinity;
      for (const p of data) {
        const cTime = Number(p.cTime);
        const uTime = Number(p.uTime);
        if (Number.isFinite(cTime) && cTime < oldestCTime) oldestCTime = cTime;
        if (Number.isFinite(uTime) && uTime < oldestUTime) oldestUTime = uTime;
        if (Number.isFinite(cTime) && cTime < INITIAL_TS) { skippedEarly++; continue; }
        // OKX reuses posId across multiple partial closes. Key by posId+uTime.
        const posId = p.posId || p.instId;
        const key = `${posId}_${p.uTime}`;
        if (state.closedById.has(key)) continue;
        const pnl = Number(p.pnl) || 0;
        const fee = Number(p.fee) || 0;
        const fundingFee = Number(p.fundingFee) || 0;
        const net = pnl + fee + fundingFee;
        const openAvgPx = Number(p.openAvgPx) || 0;
        const closeAvgPx = Number(p.closeAvgPx) || 0;
        const direction = p.direction || p.posSide;
        let priceChangePct = 0;
        if (openAvgPx > 0) {
          const raw = (closeAvgPx - openAvgPx) / openAvgPx;
          priceChangePct = direction === 'long' ? raw : -raw;
        }
        const rec = {
          posId,
          key,
          instId: p.instId,
          cTime, uTime,
          direction,
          openAvgPx, closeAvgPx, priceChangePct,
          pnl, fee, fundingFee, net,
        };
        state.closedById.set(key, rec);
        if (rec.uTime > state.lastUTime) state.lastUTime = rec.uTime;
        appendJsonl(config.okx.closedPositionsPath, rec);
        added++;
      }
      // stop once we've reached records older than cutoff
      if (oldestCTime < INITIAL_TS) break;
      if (data.length < 100) break;
      after = String(oldestUTime);
    }
    if (added > 0) {
      console.log(`[okx] +${added} positions (total ${state.closedById.size}, fetched ${fetched}, skipped ${skippedEarly} pre-cutoff)`);
    }
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    console.warn('[okx] backfillClosed failed:', e.message);
  }
}

export async function okxInit() {
  if (!config.okx.apiKey) {
    console.log('[okx] disabled (no credentials)');
    return;
  }
  ensureDir(path.dirname(config.okx.equityHistoryPath));
  if (!fs.existsSync(config.okx.equityHistoryPath)) {
    // Seed the baseline from what the account actually holds — a fixed $100
    // would show a phantom gain or loss from the very first snapshot.
    const equity = (await readEquity()) ?? INITIAL_EQUITY;
    appendJsonl(config.okx.equityHistoryPath, {
      ts_ms: INITIAL_TS,
      equity,
      source: 'inception',
    });
    console.log(`[okx] seeded inception point $${equity} at ${config.okx.startIso}`);
  }
  await backfillClosed();
  await snapshotEquity();

  // Use setTimeout chains instead of setInterval to prevent overlap
  function scheduleEquity() {
    setTimeout(async () => {
      await snapshotEquity();
      scheduleEquity();
    }, 60_000);
  }
  function scheduleClosed() {
    setTimeout(async () => {
      await backfillClosed();
      scheduleClosed();
    }, 60_000);
  }
  scheduleEquity();
  scheduleClosed();
  console.log('[okx] poller started (equity 60s, closed-positions 60s, non-overlapping)');
}
