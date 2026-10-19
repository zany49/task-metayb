/**
 * Demo controls, so a reviewer can see the 2-hour confirmation timeout without waiting:
 * move the app clock forward and run the timeout check immediately.
 * Enabled by default outside production (ENABLE_SIMULATION in .env).
 */
import { Router } from 'express';
import { clock } from '../common/clock.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/validate.js';
import { simulationEnabled } from '../config/env.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AdvanceClockSchema } from '../schemas/dispatch.schemas.js';
import { expireOverdueAssignments } from '../services/dispatch.service.js';

const router = Router();

router.use((_req, _res, next) => {
  if (!simulationEnabled) throw new AppError(404, 'SIMULATION_DISABLED', 'Demo controls are turned off on this server');
  next();
});
router.use(authenticate, requireRole('DISPATCHER'));

const clockView = () => ({ now: clock.now(), offsetMinutes: Math.round(clock.offsetMs() / 60_000) });

router.get('/clock', (_req, res) => {
  res.json(clockView());
});

/** Move the clock forward by { minutes }, then run the timeout check straight away. */
router.post('/clock/advance', async (req, res) => {
  const { minutes } = parse(AdvanceClockSchema, req.body);
  clock.advance(minutes * 60_000);
  const sweep = await expireOverdueAssignments();
  res.json({ ...clockView(), ...sweep });
});

/** Back to real time. Deadlines already given keep their values. */
router.post('/clock/reset', (_req, res) => {
  clock.reset();
  res.json(clockView());
});

/** Run the timeout check now instead of waiting for the next sweep. */
router.post('/sweep', async (_req, res) => {
  res.json({ ...clockView(), ...(await expireOverdueAssignments()) });
});

export default router;
