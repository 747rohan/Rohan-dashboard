import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';

const router = Router();

// path inside container — provided via bind-mount at deploy
const GRAPH_PATH = process.env.ARCHITECTURE_GRAPH_PATH || '/data/architecture.json';

router.get('/graph', (req, res) => {
  try {
    if (!fs.existsSync(GRAPH_PATH)) {
      return res.status(404).json({ error: `architecture graph not found at ${GRAPH_PATH}` });
    }
    const raw = fs.readFileSync(GRAPH_PATH, 'utf8');
    const json = JSON.parse(raw);
    res.json(json);
  } catch (e) {
    console.error('[architecture/graph]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
