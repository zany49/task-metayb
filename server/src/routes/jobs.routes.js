import { Router } from 'express';
import { parse } from '../common/validate.js';
import { actorOf, authenticate, requireRole } from '../middleware/auth.js';
import { AssignRiderSchema, ReasonSchema } from '../schemas/dispatch.schemas.js';
import { CancelJobSchema, CreateJobSchema, JobRefParamsSchema, ListJobsQuerySchema } from '../schemas/job.schemas.js';
import * as dispatch from '../services/dispatch.service.js';
import * as jobService from '../services/job.service.js';
import { getRecommendations } from '../services/recommendation.service.js';

const router = Router();
const dispatcherOnly = requireRole('DISPATCHER');
const jobRefOf = (req) => parse(JobRefParamsSchema, req.params).jobRef;

router.use(authenticate);

/**
 * Create a job. Safe to retry: the same orderRef with the same details returns the existing job.
 *   201 Created  -> new job
 *   200 OK       -> this order already existed; existing job returned (header Idempotent-Replayed: true)
 *   409          -> this orderRef already exists with different details
 */
router.post('/', dispatcherOnly, async (req, res) => {
  const input = parse(CreateJobSchema, req.body);
  const { job, created } = await jobService.createJob(input, actorOf(req));
  if (!created) res.set('Idempotent-Replayed', 'true');
  res.status(created ? 201 : 200).json(job);
});

/** List / filter / search jobs: ?status=A,B&zone=&priority=&q=&overdue=&sort=&page=&limit= */
router.get('/', dispatcherOnly, async (req, res) => {
  const query = parse(ListJobsQuerySchema, req.query);
  res.json(await jobService.listJobs(query));
});

/** One job, by id or order reference (e.g. /api/jobs/ORD-1001). Riders: only the job they hold. */
router.get('/:jobRef', async (req, res) => {
  res.json(await jobService.getJob(jobRefOf(req), actorOf(req)));
});

/** The job's history, oldest first. */
router.get('/:jobRef/events', async (req, res) => {
  res.json(await jobService.getJobHistory(jobRefOf(req), actorOf(req)));
});

/** Cancel a job (before pickup). Body: { reason } */
router.post('/:jobRef/cancel', dispatcherOnly, async (req, res) => {
  const { reason } = parse(CancelJobSchema, req.body);
  res.json(await jobService.cancelJob(jobRefOf(req), reason, actorOf(req)));
});

// ---- Dispatch ---------------------------------------------------------------------------------

/** Eligible riders ranked with reasons, and riders who are not eligible with why. */
router.get('/:jobRef/recommendations', dispatcherOnly, async (req, res) => {
  res.json(await getRecommendations(jobRefOf(req)));
});

/** Every assignment attempt on the job, oldest first. */
router.get('/:jobRef/assignments', async (req, res) => {
  res.json(await dispatch.listJobAssignments(jobRefOf(req), actorOf(req)));
});

/** Assign (or reassign from the Manual Queue). Body: { riderId, overrideReason? } */
router.post('/:jobRef/assignments', dispatcherOnly, async (req, res) => {
  const input = parse(AssignRiderSchema, req.body);
  res.status(201).json(await dispatch.assignRider(jobRefOf(req), input, actorOf(req)));
});

/** The rider has collected the delivery. Rider holding the job, or a dispatcher. */
router.post('/:jobRef/pickup', async (req, res) => {
  res.json(await dispatch.markPickedUp(jobRefOf(req), actorOf(req)));
});

/** The delivery is complete. Rider holding the job, or a dispatcher. */
router.post('/:jobRef/deliver', async (req, res) => {
  res.json(await dispatch.markDelivered(jobRefOf(req), actorOf(req)));
});

/**
 * Take the job back from its rider (dispatcher), or drop an accepted job (rider), before pickup.
 * The job goes to the Manual Queue. Body: { reason }
 */
router.post('/:jobRef/unassign', async (req, res) => {
  const { reason } = parse(ReasonSchema, req.body);
  res.json(await dispatch.unassignJob(jobRefOf(req), reason, actorOf(req)));
});

/** Park a ready job in the Manual Queue. Body: { reason } */
router.post('/:jobRef/manual-queue', dispatcherOnly, async (req, res) => {
  const { reason } = parse(ReasonSchema, req.body);
  res.json(await dispatch.moveToManualQueue(jobRefOf(req), reason, actorOf(req)));
});

export default router;
