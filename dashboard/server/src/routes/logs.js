import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const router = Router();

function tailLines(file, nLines) {
  const st = fs.statSync(file);
  const chunkSize = 4096;
  const buffers = [];
  let pos = st.size;
  let lines = 0;
  const fd = fs.openSync(file, 'r');
  try {
    while (pos > 0 && lines <= nLines) {
      const read = Math.min(chunkSize, pos);
      pos -= read;
      const buf = Buffer.alloc(read);
      fs.readSync(fd, buf, 0, read, pos);
      buffers.unshift(buf);
      for (const b of buf) if (b === 0x0a) lines++;
    }
  } finally {
    fs.closeSync(fd);
  }
  const text = Buffer.concat(buffers).toString('utf8');
  const arr = text.split('\n').filter(Boolean);
  return arr.slice(-nLines);
}

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
