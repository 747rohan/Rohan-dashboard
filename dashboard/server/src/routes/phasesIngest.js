import { Router } from 'express';
import { config } from '../config.js';
import { phaseStore } from '../lib/phaseStore.js';

const router = Router();

router.post('/', (req, res) => {
  const expected = config.phasesIngestKey;
  if (!expected) return res.status(503).json({ error: 'ingest not configured' });

  const key = req.header('X-API-Key');
  if (!key || key !== expected) {
    return res.status(401).json({ error: 'invalid api key' });
  }
  const body = req.body;
  if (!body || !Array.isArray(body.phases)) {
    return res.status(400).json({ error: 'payload.phases missing' });
  }
  phaseStore.set(body);
  res.json({ ok: true, received: body.phases.length });
});

export default router;
