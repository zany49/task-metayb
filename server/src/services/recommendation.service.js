import { clock } from '../common/clock.js';
import { Errors } from '../common/errors.js';
import { ASSIGNABLE_STATUSES } from '../domain/jobLifecycle.js';
import { recommendRiders } from '../domain/recommendation.js';
import { Assignment } from '../models/assignment.model.js';
import { Rider } from '../models/rider.model.js';
import { findJobOr404 } from './jobCore.js';
import { getDispatchSettings } from './settings.service.js';

/** Riders in the shape the recommendation rules expect (deactivated accounts are left out). */
async function loadRiders(session) {
  const riders = await Rider.find({}).populate('userId', 'name isActive').session(session ?? null).lean();
  return riders
    .filter((r) => r.userId && r.userId.isActive !== false)
    .map((r) => ({
      id: String(r._id),
      name: r.userId.name,
      zones: r.zones,
      availability: r.availability,
      capacity: r.capacity,
      reservedLoad: r.reservedLoad,
      maxActiveJobs: r.maxActiveJobs,
      activeJobs: r.activeJobs,
      currentZone: r.currentZone,
    }));
}

/** Riders who already had an attempt on this job, grouped by how that attempt ended. */
async function loadAttemptHistory(jobId, session) {
  const past = await Assignment.find({ jobId, active: false }, { riderId: 1, status: 1 }).session(session ?? null).lean();
  const ids = (status) => new Set(past.filter((a) => a.status === status).map((a) => String(a.riderId)));
  return { declined: ids('REJECTED'), dropped: ids('RELEASED'), noResponse: ids('EXPIRED') };
}

/**
 * Runs the recommendation rules for a job with current data.
 * Reads one after the other (not in parallel): inside a transaction a session must not run
 * two operations at the same time.
 */
export async function computeRecommendations(job, session) {
  const riders = await loadRiders(session);
  const history = await loadAttemptHistory(job._id, session);
  return recommendRiders({ job, riders, now: clock.now(), history });
}

/** Why a job cannot be assigned right now, in words a dispatcher understands. */
export function notAssignableMessage(job) {
  switch (job.status) {
    case 'AWAITING_CONFIRMATION':
      return `${job.orderRef} is already assigned to ${job.riderName} and waiting for their confirmation.`;
    case 'ACCEPTED':
    case 'PICKED_UP':
      return `${job.orderRef} is already with ${job.riderName}.`;
    case 'DELIVERED':
      return `${job.orderRef} has already been delivered.`;
    case 'CANCELLED':
      return `${job.orderRef} was cancelled.`;
    default:
      return `${job.orderRef} is not ready for assignment yet.`;
  }
}

export function assertAssignable(job) {
  if (!ASSIGNABLE_STATUSES.includes(job.status)) {
    throw Errors.conflict('JOB_NOT_ASSIGNABLE', notAssignableMessage(job), { status: job.status });
  }
}

/** GET /jobs/:jobRef/recommendations - ranked eligible riders, plus who is not eligible and why. */
export async function getRecommendations(jobRef) {
  const job = await findJobOr404(jobRef);
  assertAssignable(job);
  const settings = await getDispatchSettings();
  const { recommended, notEligible } = await computeRecommendations(job);

  return {
    jobId: String(job._id),
    orderRef: job.orderRef,
    status: job.status,
    generatedAt: clock.now(),
    confirmationTimeoutMinutes: settings.confirmationTimeoutMinutes,
    recommended,
    notEligible: notEligible.map(({ codes, ...rider }) => rider),
  };
}
