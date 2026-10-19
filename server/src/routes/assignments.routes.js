import { Router } from 'express';
import { parse } from '../common/validate.js';
import { actorOf, authenticate, requireRole } from '../middleware/auth.js';
import { AssignmentIdParamsSchema, ReasonSchema } from '../schemas/dispatch.schemas.js';
import * as dispatch from '../services/dispatch.service.js';

const router = Router();

router.use(authenticate);

/** Rider: my live jobs (offers waiting for an answer, jobs in progress) and recent ones. */
router.get('/mine', requireRole('RIDER'), async (req, res) => {
  res.json(await dispatch.listMyAssignments(actorOf(req)));
});

/** Accept a pending assignment. The assigned rider, or a dispatcher on their behalf. */
router.post('/:id/accept', async (req, res) => {
  const { id } = parse(AssignmentIdParamsSchema, req.params);
  res.json(await dispatch.respondToAssignment(id, { accept: true }, actorOf(req)));
});

/** Decline a pending assignment; the job moves to the Manual Queue. Body: { reason } */
router.post('/:id/reject', async (req, res) => {
  const { id } = parse(AssignmentIdParamsSchema, req.params);
  const { reason } = parse(ReasonSchema, req.body);
  res.json(await dispatch.respondToAssignment(id, { accept: false, reason }, actorOf(req)));
});

export default router;
