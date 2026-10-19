import { Router } from 'express';
import { parse } from '../common/validate.js';
import { actorOf, authenticate, requireRole } from '../middleware/auth.js';
import { UpdateSettingsSchema } from '../schemas/dispatch.schemas.js';
import { getDispatchSettings, updateDispatchSettings } from '../services/settings.service.js';

const router = Router();

router.use(authenticate, requireRole('DISPATCHER'));

/** { confirmationTimeoutMinutes, defaultConfirmationTimeoutMinutes, sweepIntervalSeconds, simulationEnabled } */
router.get('/', async (_req, res) => {
  res.json(await getDispatchSettings());
});

/** Body: { confirmationTimeoutMinutes } - applies to assignments made from now on. */
router.patch('/', async (req, res) => {
  const patch = parse(UpdateSettingsSchema, req.body);
  res.json(await updateDispatchSettings(patch, actorOf(req)));
});

export default router;
