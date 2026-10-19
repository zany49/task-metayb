/**
 * Job building blocks shared by the job and dispatch services:
 * finding a job, the API view of a job, and the one function that changes a job's status.
 */
import { clock } from '../common/clock.js';
import { Errors } from '../common/errors.js';
import { allowedNextStatuses, assertTransition, isFinal } from '../domain/jobLifecycle.js';
import { Job } from '../models/job.model.js';
import { recordJobEvent } from './jobEvent.service.js';

/** What the API returns for a job. */
export function toJobView(job, now = clock.now()) {
  const final = isFinal(job.status);
  return {
    id: String(job._id),
    orderRef: job.orderRef,
    pickupZone: job.pickupZone,
    dropZone: job.dropZone,
    load: job.load,
    priority: job.priority,
    deadline: job.deadline ?? null,
    notes: job.notes ?? null,

    status: job.status,
    statusChangedAt: job.statusChangedAt,
    nextStatuses: allowedNextStatuses(job.status),
    minutesInStatus: Math.max(0, Math.floor((now - job.statusChangedAt) / 60_000)),
    isOverdue: Boolean(job.deadline) && !final && job.deadline < now,

    riderId: job.riderId ? String(job.riderId) : null,
    riderName: job.riderName ?? null,
    currentAssignmentId: job.currentAssignmentId ? String(job.currentAssignmentId) : null,
    confirmationDueAt: job.confirmationDueAt ?? null,
    attemptCount: job.attemptCount,
    manualQueueReason: job.manualQueueReason ?? null,
    cancelReason: job.cancelReason ?? null,

    version: job.version,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

/**
 * `jobRef` can be the job id (24 hex characters) or the order reference ("ORD-1001").
 * A value that looks like an id could also be an order reference, so then both are tried.
 */
export function jobFilter(jobRef) {
  const ref = String(jobRef);
  const byRef = { orderRef: ref.toUpperCase() };
  return /^[a-f\d]{24}$/i.test(ref) ? { $or: [{ _id: ref.toLowerCase() }, byRef] } : byRef;
}

export async function findJobOr404(jobRef, session) {
  const job = await Job.findOne(jobFilter(jobRef)).session(session ?? null);
  if (!job) throw Errors.notFound('Job');
  return job;
}

/** Riders may only see and act on the job they currently hold; dispatchers on any job. */
export function assertCanActOnJob(job, actor, action = 'view') {
  if (actor.type === 'RIDER' && String(job.riderId) !== actor.riderId) {
    throw Errors.forbidden(`Riders can only ${action} jobs assigned to them`);
  }
}

/**
 * Moves a job to a new status and records the matching history event, inside `session`.
 * Every status change in the app goes through here, so:
 *   1. the lifecycle rules are always checked (409 INVALID_TRANSITION), and
 *   2. the update only succeeds if nobody changed the job since we read it
 *      (filter on status + version), otherwise 409 JOB_CHANGED.
 *
 * @param {object} job                  the job as read inside this transaction
 * @param {object} change
 * @param {string} change.to            new status
 * @param {object} change.actor         who is doing it
 * @param {string} change.eventType     history event type
 * @param {string} change.message       readable sentence for the history
 * @param {object} [change.set]         other fields to set at the same time
 * @param {object} [change.details]     extra facts for the history event
 * @param {*}      [change.assignmentId]
 * @param {*}      [change.riderId]
 * @param {import('mongoose').ClientSession} session
 * @returns the updated job
 */
export async function changeJobStatus(job, change, session) {
  assertTransition(job.status, change.to);

  const now = clock.now();
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: job.status, version: job.version },
    { $set: { ...change.set, status: change.to, statusChangedAt: now }, $inc: { version: 1 } },
    { new: true, session, runValidators: true },
  );
  if (!updated) {
    throw Errors.conflict('JOB_CHANGED', 'This job was just changed by another action. Refresh and try again.');
  }

  await recordJobEvent(
    {
      job: updated,
      type: change.eventType,
      actor: change.actor,
      message: change.message,
      fromStatus: job.status,
      toStatus: change.to,
      assignmentId: change.assignmentId,
      riderId: change.riderId,
      details: change.details,
      at: now,
    },
    session,
  );
  return updated;
}
