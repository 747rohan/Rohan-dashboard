import { Router } from 'express';
import fs from 'node:fs';
import { config } from '../config.js';
import { tailLines } from '../lib/tail.js';

const router = Router();

router.get('/pb-tail', (req, res) => {
  try {
    const lines = Math.min(Math.max(Number(req.query.lines) || 30, 1), 200);
    const file = config.solbot.pbLog;
    if (!fs.existsSync(file)) return res.status(404).json({ error: `log not found at ${file}` });
    const tail = tailLines(file, lines);
    // Parse into {ts, level, src, msg}
    const parsed = tail.map((raw) => {
      // 2026-04-16 21:45:05,257 INFO     services.phase_broadcaster.sender: text
      const m = raw.match(/^(\S+ \S+)\s+(\w+)\s+([^:]+):\s*(.*)$/);
      if (m) {
        return { raw, ts: m[1], level: m[2], src: m[3], msg: m[4] };
      }
      return { raw, msg: raw };
    });
    res.json({ count: parsed.length, lines: parsed });
  } catch (e) {
    console.error('[logs/pb-tail]', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;
