import { Router } from 'express';
import { clock } from '../common/clock.js';
import { authenticate } from '../middleware/auth.js';
import { JOB_PRIORITIES, JOB_STATUSES, transitionMap } from '../domain/jobLifecycle.js';
import { RIDER_AVAILABILITY } from '../domain/rider.js';
import { travelMatrix, ZONE_LABELS, ZONES } from '../domain/zones.js';

const router = Router();

router.use(authenticate);

/** Reference data for frontend forms, filters and the status stepper. */
router.get('/', (_req, res) => {
  res.json({
    zones: ZONES.map((code) => ({ code, label: ZONE_LABELS[code] })),
    travelMinutes: travelMatrix(),
    riderAvailability: RIDER_AVAILABILITY,
    jobStatuses: JOB_STATUSES,
    jobPriorities: JOB_PRIORITIES,
    jobTransitions: transitionMap(),
    serverTime: clock.now(),
  });
});

export default router;
