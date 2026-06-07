import fs from 'node:fs';

const PERSIST_PATH = '/data/okx/last_phases.json';

let latest = null;
let receivedAt = null;

// Restore from disk on module load
try {
  if (fs.existsSync(PERSIST_PATH)) {
    const raw = fs.readFileSync(PERSIST_PATH, 'utf8');
    const saved = JSON.parse(raw);
    if (saved?.payload && saved?.receivedAt) {
      latest = saved.payload;
      receivedAt = saved.receivedAt;
    }
  }
} catch {}

export const phaseStore = {
  set(payload) {
    latest = payload;
    receivedAt = Date.now();
    try {
      fs.writeFileSync(PERSIST_PATH, JSON.stringify({ payload, receivedAt }));
    } catch {}
  },
  get() {
    return { latest, receivedAt };
  },
};
