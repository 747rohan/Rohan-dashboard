import { Router } from 'express';
import { OkxClient } from '../lib/okx.js';
import { config } from '../config.js';

const router = Router();

function client() {
  return new OkxClient({
    apiKey: config.okx.apiKey,
    secret: config.okx.secret,
    passphrase: config.okx.passphrase,
  });
}

router.get('/positions-history', async (req, res) => {
  try {
    const c = client();
    const params = { instType: 'SWAP', limit: 100 };
    if (req.query.begin) params.begin = req.query.begin;
    if (req.query.after) params.after = req.query.after;
    if (req.query.before) params.before = req.query.before;
    const data = await c.get('/api/v5/account/positions-history', params);
    res.json({ count: data.length, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/orders-history-archive', async (req, res) => {
  try {
    const c = client();
    const params = { instType: 'SWAP', limit: 100, state: 'filled' };
    if (req.query.begin) params.begin = req.query.begin;
    if (req.query.after) params.after = req.query.after;
    const data = await c.get('/api/v5/trade/orders-history-archive', params);
    res.json({ count: data.length, sample: data.slice(0, 3), all: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/fills-history', async (req, res) => {
  try {
    const c = client();
    const params = { instType: 'SWAP', limit: 100 };
    if (req.query.begin) params.begin = req.query.begin;
    const data = await c.get('/api/v5/trade/fills-history', params);
    res.json({ count: data.length, sample: data.slice(0, 3), all: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
