import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getDashboardSummary } from '../services/dashboard.service.js';

const router = Router();

router.use(authenticate, requireRole('DISPATCHER'));

/** Job counts per status, overdue jobs, and rider availability counts. */
router.get('/summary', async (_req, res) => {
  res.json(await getDashboardSummary());
});

export default router;
