import crypto from 'node:crypto';

const BASE = 'https://www.okx.com';

function sign(ts, method, pathWithQs, body, secret) {
  const prehash = ts + method + pathWithQs + (body || '');
  return crypto.createHmac('sha256', secret).update(prehash).digest('base64');
}

export class OkxClient {
  constructor({ apiKey, secret, passphrase }) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.passphrase = passphrase;
  }

  async get(path, params = {}) {
    const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
    const qs = entries.length
      ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
      : '';
    const fullPath = path + qs;
    const ts = new Date().toISOString();
    const signature = sign(ts, 'GET', fullPath, '', this.secret);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch(BASE + fullPath, {
        method: 'GET',
        signal: ctrl.signal,
        headers: {
          'OK-ACCESS-KEY': this.apiKey,
          'OK-ACCESS-SIGN': signature,
          'OK-ACCESS-TIMESTAMP': ts,
          'OK-ACCESS-PASSPHRASE': this.passphrase,
          'Content-Type': 'application/json',
        },
      });
      clearTimeout(to);
      const j = await r.json();
      if (j.code !== '0') throw new Error(`OKX ${j.code}: ${j.msg}`);
      return j.data;
    } catch (e) {
      clearTimeout(to);
      throw e;
    }
  }

  balance()   { return this.get('/api/v5/account/balance', { ccy: 'USDT' }); }
  positions() { return this.get('/api/v5/account/positions', { instType: 'SWAP' }); }
  positionsHistory({ beginMs, endMs, limit = 100, after } = {}) {
    return this.get('/api/v5/account/positions-history', {
      instType: 'SWAP',
      limit,
      begin: beginMs,
      end: endMs,
      after,
    });
  }
}
