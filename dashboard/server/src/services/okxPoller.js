import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { OkxClient } from '../lib/okx.js';
import { readFlows } from '../lib/flows.js';

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
  flowIds: null,
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
    const upl = Number(usdt?.upl) || 0;
    return Number.isFinite(equity) ? { equity, upl } : null;
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

async function syncFlows() {
  const c = client();
  if (!c) return;
  try {
    if (state.flowIds === null) {
      state.flowIds = new Set(readFlows().map((f) => f.billId));
    }
    let after = null;
    let added = 0;
    for (let page = 0; page < 10; page++) {
      const data = await c.transferBills({ beginMs: INITIAL_TS, after });
      if (!data || data.length === 0) break;
      for (const b of data) {
        if (state.flowIds.has(b.billId)) continue;
        const ts = Number(b.ts);
        const amount = Number(b.balChg);
        if (!Number.isFinite(ts) || ts < INITIAL_TS || !Number.isFinite(amount) || amount === 0) continue;
        state.flowIds.add(b.billId);
        appendJsonl(config.okx.flowsPath, { ts_ms: ts, amount, billId: b.billId, subType: b.subType });
        added++;
      }
      if (data.length < 100) break;
      after = data[data.length - 1].billId;
    }
    if (added > 0) console.log(`[okx] +${added} transfers in/out of the account`);
  } catch (e) {
    state.lastError = e.message;
    console.warn('[okx] syncFlows failed:', e.message);
  }
}

// Balance at startIso, rebuilt from today's: what the account holds now, less
// open positions' unrealised PnL, less every closed trade and every transfer
// since. Exact as long as nothing was open across startIso — the account's
// bills show no activity between the last pre-start transfer and the first
// trade, so for AntonCopyTest (2026-08-17) it is.
function seedHistory(now) {
  const closed = [...state.closedById.values()]
    .filter((p) => Number.isFinite(p.uTime))
    .map((p) => ({ ts_ms: p.uTime, d: Number.isFinite(p.net) ? p.net : p.pnl }));
  const flows = readFlows().map((f) => ({ ts_ms: f.ts_ms, d: f.amount }));
  const events = closed.concat(flows).sort((a, b) => a.ts_ms - b.ts_ms);
  const seed = now.equity - now.upl - events.reduce((s, e) => s + e.d, 0);

  appendJsonl(config.okx.equityHistoryPath, { ts_ms: INITIAL_TS, equity: seed, source: 'inception' });
  // Realised steps from the start up to now, so the chart has a past rather
  // than a straight line from the seed to the first live snapshot.
  let eq = seed;
  for (const e of events) {
    eq += e.d;
    appendJsonl(config.okx.equityHistoryPath, { ts_ms: e.ts_ms, equity: eq, source: 'backfill' });
  }
  console.log(`[okx] seeded $${seed.toFixed(2)} at ${config.okx.startIso}, backfilled ${events.length} steps ` +
              `(${closed.length} trades, ${flows.length} transfers)`);
}

export async function okxInit() {
  if (!config.okx.apiKey) {
    console.log('[okx] disabled (no credentials)');
    return;
  }
  ensureDir(path.dirname(config.okx.equityHistoryPath));
  // Trades and transfers first: the seed is reconstructed from them.
  await backfillClosed();
  await syncFlows();
  if (!fs.existsSync(config.okx.equityHistoryPath)) {
    const now = await readEquity();
    if (now) {
      seedHistory(now);
    } else {
      // No balance to rebuild from; a fixed seed is wrong but visibly so.
      appendJsonl(config.okx.equityHistoryPath, { ts_ms: INITIAL_TS, equity: INITIAL_EQUITY, source: 'inception' });
      console.warn(`[okx] balance unavailable — seeded a placeholder $${INITIAL_EQUITY}`);
    }
  }
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
  function scheduleFlows() {
    setTimeout(async () => {
      await syncFlows();
      scheduleFlows();
    }, 300_000);
  }
  scheduleEquity();
  scheduleClosed();
  scheduleFlows();
  console.log('[okx] poller started (equity 60s, closed-positions 60s, transfers 5m, non-overlapping)');
}
