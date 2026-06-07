import { Router } from 'express';

const router = Router();
const startedAt = Date.now();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    uptime: process.uptime(),
    startedAt,
  });
});

export default router;
