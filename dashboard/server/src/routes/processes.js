import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { orchDb } from '../lib/db.js';
import { listParquetFilesSorted } from '../lib/parquet.js';

const router = Router();

const NODES = [
  { id: 'bingx',             label: 'BingX',            kind: 'external', col: 0, row: 4 },
  { id: 'orchestrator',      label: 'orchestrator',     kind: 'systemd',  col: 1, row: 1 },
  { id: 'phase-broadcaster', label: 'phase-broadcaster',kind: 'systemd',  col: 1, row: 2 },
  { id: 'ob-recorder',       label: 'ob-recorder',      kind: 'systemd',  col: 1, row: 3 },
  { id: 'eth-squeeze-bot',   label: 'eth-squeeze-bot',  kind: 'systemd',  col: 1, row: 4 },
  { id: 'fib-strategy-bot',  label: 'fib-strategy-bot', kind: 'systemd',  col: 1, row: 5 },
  { id: 'research-tg-bot',   label: 'research-tg-bot',  kind: 'systemd',  col: 1, row: 6 },
  { id: 'solbot-watchdog',   label: 'watchdog',         kind: 'systemd',  col: 1, row: 7 },
  { id: 'orch-db',           label: 'orchestrator.db',  kind: 'data',     col: 2, row: 1 },
  { id: 'data-book',         label: 'data/book',        kind: 'data',     col: 2, row: 3 },
  { id: 'dashboard',         label: 'dashboard',        kind: 'docker',   col: 3, row: 2 },
  { id: 'receivers',         label: 'receivers ×4',     kind: 'external', col: 3, row: 4 },
  { id: 'worldmonitor',      label: 'worldmonitor',     kind: 'docker',   col: 2, row: 6 },
  { id: 'wm-redis',          label: 'wm-redis',         kind: 'docker',   col: 3, row: 6 },
];

const EDGES = [
  { from: 'bingx',             to: 'orchestrator',      ping: 'orchestrator' },
  { from: 'bingx',             to: 'phase-broadcaster', ping: 'phase-broadcaster' },
  { from: 'bingx',             to: 'ob-recorder',       ping: 'ob-recorder' },
  { from: 'bingx',             to: 'eth-squeeze-bot' },
  { from: 'bingx',             to: 'fib-strategy-bot' },
  { from: 'orchestrator',      to: 'orch-db',           ping: 'orchestrator' },
  { from: 'orch-db',           to: 'dashboard',         ping: 'orchestrator' },
  { from: 'ob-recorder',       to: 'data-book',         ping: 'ob-recorder' },
  { from: 'data-book',         to: 'dashboard',         ping: 'ob-recorder' },
  { from: 'phase-broadcaster', to: 'receivers',         ping: 'phase-broadcaster' },
  { from: 'phase-broadcaster', to: 'dashboard',         ping: 'phase-broadcaster' },
  { from: 'worldmonitor',      to: 'wm-redis' },
  { from: 'wm-redis',          to: 'dashboard' },
  { from: 'solbot-watchdog',   to: 'orchestrator' },
];

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

async function redisPing(timeoutMs = 1000) {
  try {
    const r = getRedis();
    if (r.status === 'end' || r.status === 'wait') await r.connect();
    const res = await Promise.race([
      r.ping(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return res === 'PONG';
  } catch {
    return false;
  }
}

async function httpHealth(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(to);
    return r.ok;
  } catch {
    return false;
  }
}

function fileAgeSec(p) {
  try {
    const s = fs.statSync(p);
    return Math.floor((Date.now() - s.mtimeMs) / 1000);
  } catch {
    return null;
  }
}

function latestBookParquetAge() {
  const dir = path.join(config.solbot.dataDir, 'book', 'BTCUSDT');
  const files = listParquetFilesSorted(dir);
  if (!files.length) return null;
  return fileAgeSec(path.join(dir, files[files.length - 1]));
}

function latestDecisionAge() {
  try {
    const r = orchDb().prepare(`SELECT ts FROM decisions ORDER BY id DESC LIMIT 1`).get();
    if (!r) return null;
    return Math.floor((Date.now() - Date.parse(r.ts)) / 1000);
  } catch {
    return null;
  }
}

function statusFromAge(ageSec, freshLimit, staleLimit) {
  if (ageSec == null) return 'unknown';
  if (ageSec <= freshLimit) return 'active';
  if (ageSec <= staleLimit) return 'stale';
  return 'inactive';
}

router.get('/', async (req, res) => {
  const healths = {};

  const orchAge = latestDecisionAge();
  healths['orchestrator'] = { status: statusFromAge(orchAge, 90, 300), age_s: orchAge };
  healths['orch-db']      = { status: orchAge != null ? 'active' : 'unknown', age_s: orchAge };

  const pbAge = fileAgeSec(config.solbot.pbLog);
  healths['phase-broadcaster'] = { status: statusFromAge(pbAge, 360, 900), age_s: pbAge };
  healths['receivers']         = { status: statusFromAge(pbAge, 360, 900), age_s: pbAge };

  const bookAge = latestBookParquetAge();
  healths['ob-recorder'] = { status: statusFromAge(bookAge, 120, 600), age_s: bookAge };
  healths['data-book']   = { status: statusFromAge(bookAge, 120, 600), age_s: bookAge };

  const [wmOk, redisOk] = await Promise.all([
    httpHealth('http://worldmonitor:3000/api/health').catch(() => false),
    redisPing().catch(() => false),
  ]);
  healths['worldmonitor'] = { status: wmOk ? 'active' : 'inactive' };
  healths['wm-redis']     = { status: redisOk ? 'active' : 'inactive' };

  healths['dashboard'] = { status: 'active' };
  healths['bingx']     = { status: 'unknown' };
  healths['eth-squeeze-bot']  = { status: 'unknown' };
  healths['fib-strategy-bot'] = { status: 'unknown' };
  healths['research-tg-bot']  = { status: 'unknown' };
  healths['solbot-watchdog']  = { status: 'unknown' };

  const nodes = NODES.map((n) => ({
    ...n,
    ...healths[n.id],
  }));

  res.json({
    ts: Date.now(),
    nodes,
    edges: EDGES,
  });
});

export default router;
