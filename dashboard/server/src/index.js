process.on('unhandledRejection', (e) => console.error('[UNHANDLED]', e));
process.on('uncaughtException', (e) => console.error('[UNCAUGHT]', e));

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { auth } from './auth.js';
import healthRoute from './routes/health.js';
import btcRoute from './routes/btc.js';
import phasesRoute from './routes/phases.js';
import phasesIngestRoute from './routes/phasesIngest.js';
import tickerRoute from './routes/ticker.js';
import pnlRoute from './routes/pnl.js';
import tradingRoute from './routes/trading.js';
import processesRoute from './routes/processes.js';
import wmRoute from './routes/wm.js';
import archRoute from './routes/architecture.js';
import logsRoute from './routes/logs.js';
import okxProbeRoute from './routes/okxProbe.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));

app.use('/api/phases/ingest', phasesIngestRoute);

app.use(auth);

app.use('/api/health', healthRoute);
app.use('/api/btc', btcRoute);
app.use('/api/phases', phasesRoute);
app.use('/api/ticker', tickerRoute);
app.use('/api/pnl', pnlRoute);
app.use('/api/trading', tradingRoute);
app.use('/api/processes', processesRoute);
app.use('/api/wm', wmRoute);
app.use('/api/architecture', archRoute);
app.use('/api/logs', logsRoute);
app.use('/api/okx-probe', okxProbeRoute);

if (fs.existsSync(config.staticDir)) {
  app.use(express.static(config.staticDir));
  app.get(/^\/(?!api\/).*/, (req, res) => {
    res.sendFile(path.join(config.staticDir, 'index.html'));
  });
} else {
  app.get('/', (req, res) => {
    res.type('text/plain').send('dashboard: web/dist not built yet');
  });
}

app.listen(config.port, () => {
  console.log(`[dashboard] listening on :${config.port}`);
});

import('./services/okxPoller.js').then((m) => m.okxInit().catch((e) => console.error('[okx init]', e)));
