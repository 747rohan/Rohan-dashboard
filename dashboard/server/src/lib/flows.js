import fs from 'node:fs';
import { config } from '../config.js';

// Capital moved in or out of the trading account (OKX bills, type 1). The
// balance moves with them, the strategy's result does not, so everything that
// compares equity across time has to take them out first.
export function readFlows() {
  const file = config.okx.flowsPath;
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((f) => f && Number.isFinite(f.ts_ms) && Number.isFinite(f.amount))
    .sort((a, b) => a.ts_ms - b.ts_ms);
}

// Net amount transferred in (a, b].
export function flowsBetween(flows, a, b) {
  let s = 0;
  for (const f of flows) if (f.ts_ms > a && f.ts_ms <= b) s += f.amount;
  return s;
}
