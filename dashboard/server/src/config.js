import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  auth: {
    user: process.env.BASIC_AUTH_USER || 'admin',
    pass: process.env.BASIC_AUTH_PASS || 'change-me',
  },
  staticDir: path.resolve(__dirname, '../../web/dist'),
  solbot: {
    dataDir: process.env.SOLBOT_DATA_DIR || '/data/solbot',
    orchDb: process.env.SOLBOT_ORCH_DB || '/data/orch/orchestrator.db',
    pbLog: process.env.SOLBOT_PB_LOG || '/data/pb.log',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://worldmonitor-redis:6379',
  },
  phasesIngestKey: process.env.PHASES_INGEST_KEY || '',
  okx: {
    apiKey:     process.env.OKX_API_KEY    || '',
    secret:     process.env.OKX_SECRET     || '',
    passphrase: process.env.OKX_PASSPHRASE || '',
    equityHistoryPath:   process.env.OKX_EQUITY_HISTORY   || '/data/okx/equity_history.jsonl',
    closedPositionsPath: process.env.OKX_CLOSED_POSITIONS || '/data/okx/closed_positions.jsonl',
    startIso:            process.env.OKX_START_ISO        || '2026-04-15T07:00:00Z',
  },
};
