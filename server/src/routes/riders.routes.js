import { Router } from 'express';
import { parse } from '../common/validate.js';
import { actorOf, authenticate, requireRole } from '../middleware/auth.js';
import { IdParamsSchema } from '../schemas/common.schemas.js';
import {
  CreateRiderSchema,
  ListRidersQuerySchema,
  SetAvailabilitySchema,
  UpdateRiderSchema,
} from '../schemas/rider.schemas.js';
import * as riderService from '../services/rider.service.js';

const router = Router();

router.use(authenticate);

/** Dispatcher adds a rider (creates their login account + rider profile). */
router.post('/', requireRole('DISPATCHER'), async (req, res) => {
  const input = parse(CreateRiderSchema, req.body);
  res.status(201).json(await riderService.createRider(input, actorOf(req)));
});

/** Dispatcher lists riders, optionally filtered by availability, zone or name/mobile search. */
router.get('/', requireRole('DISPATCHER'), async (req, res) => {
  const filters = parse(ListRidersQuerySchema, req.query);
  const items = await riderService.listRiders(filters);
  res.json({ items, total: items.length });
});

/** Dispatcher: any rider. Rider: only their own profile. */
router.get('/:id', async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  res.json(await riderService.getRider(id, actorOf(req)));
});

/** Dispatcher edits zones, capacity, job limit, location or name. */
router.patch('/:id', requireRole('DISPATCHER'), async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const patch = parse(UpdateRiderSchema, req.body);
  res.json(await riderService.updateRider(id, patch));
});

/** Dispatcher: any rider. Rider: only their own availability. */
router.patch('/:id/availability', async (req, res) => {
  const { id } = parse(IdParamsSchema, req.params);
  const { availability } = parse(SetAvailabilitySchema, req.body);
  res.json(await riderService.setAvailability(id, availability, actorOf(req)));
});

export default router;
