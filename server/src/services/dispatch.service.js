/**
 * The dispatch workflow: assign a rider, the rider accepts or declines, pickup, delivery,
 * confirmation timeout, Manual Queue, reassignment, and taking a job back.
 *
 * Every function that changes state runs in ONE transaction that covers the job, the assignment
 * attempt, the rider's reserved capacity and the history events, so they always agree.
 *
 * Concurrency guards (each one would be enough on its own for its case):
 *   - job status + version check in changeJobStatus      -> two actions on the same job: one wins
 *   - unique index: one live assignment per job          -> no double assignment
 *   - conditional capacity update on the rider           -> a rider is never over-booked
 *   - conditional status update on the assignment        -> accept vs. timeout: exactly one wins
 */
import { clock } from '../common/clock.js';
import { Errors } from '../common/errors.js';
import { isDuplicateKeyError } from '../common/mongo.js';
import { withTransaction } from '../db/transaction.js';
import { MANUAL_QUEUE_REASONS as REASON } from '../domain/assignment.js';
import { actorSnapshot, SYSTEM_ACTOR } from '../domain/actor.js';
import { ZONE_LABELS } from '../domain/zones.js';
import { Assignment } from '../models/assignment.model.js';
import { Job } from '../models/job.model.js';
import { Rider } from '../models/rider.model.js';
import { recordJobEvent } from './jobEvent.service.js';
import { assertCanActOnJob, changeJobStatus, findJobOr404, toJobView } from './jobCore.js';
import { assertAssignable, computeRecommendations } from './recommendation.service.js';
import { getDispatchSettings } from './settings.service.js';

const zone = (code) => ZONE_LABELS[code] ?? code;

// ---------------------------------------------------------------------------------------------
// Views

export function toAssignmentView(a) {
  return {
    id: String(a._id),
    jobId: String(a.jobId),
    orderRef: a.orderRef,
    riderId: String(a.riderId),
    riderName: a.riderName,
    load: a.load,
    attempt: a.attempt,
    status: a.status,
    active: a.active,
    assignedAt: a.assignedAt,
    assignedBy: a.assignedBy,
    expiresAt: a.expiresAt,
    timeoutMinutes: a.timeoutMinutes,
    respondedAt: a.respondedAt ?? null,
    respondedBy: a.respondedBy ?? null,
    endedAt: a.endedAt ?? null,
    endedBy: a.endedBy ?? null,
    endReason: a.endReason ?? null,
    isOverride: a.isOverride,
    overrideReason: a.overrideReason ?? null,
    recommendation: a.recommendation ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Building blocks (always called inside a transaction)

/**
 * Reserves the job's load on the rider - only if, at this exact moment, the rider is available,
 * covers both zones, has the free capacity and a free job slot. Returns null if not.
 */
async function reserveCapacity(riderId, job, session) {
  return Rider.findOneAndUpdate(
    {
      _id: riderId,
      availability: 'AVAILABLE',
      zones: { $all: [job.pickupZone, job.dropZone] },
      $expr: {
        $and: [
          { $lte: [{ $add: ['$reservedLoad', job.load] }, '$capacity'] },
          { $lt: ['$activeJobs', '$maxActiveJobs'] },
        ],
      },
    },
    { $inc: { reservedLoad: job.load, activeJobs: 1 } },
    { new: true, session },
  );
}

/** Gives the load back. Never goes below zero. Optionally records where the rider now is. */
async function releaseCapacity(riderId, load, session, currentZone) {
  await Rider.updateOne(
    { _id: riderId },
    [
      {
        $set: {
          reservedLoad: { $max: [0, { $subtract: ['$reservedLoad', load] }] },
          activeJobs: { $max: [0, { $subtract: ['$activeJobs', 1] }] },
          ...(currentZone && { currentZone }),
        },
      },
    ],
    { session },
  );
}

/** Ends a live attempt (only if it is still in the state we read) and releases the capacity. */
async function endAssignment(assignment, { status, code, message, actor, extra = {}, currentZone }, session) {
  const now = clock.now();
  const ended = await Assignment.findOneAndUpdate(
    { _id: assignment._id, status: assignment.status, active: true },
    {
      $set: {
        status,
        active: false,
        endedAt: now,
        endedBy: actorSnapshot(actor),
        endReason: { code, message },
        ...extra,
      },
    },
    { new: true, session },
  );
  if (!ended) {
    throw Errors.conflict('ASSIGNMENT_CHANGED', 'This assignment was just changed by another action. Refresh and try again.');
  }
  await releaseCapacity(ended.riderId, ended.load, session, currentZone);
  return ended;
}

/** Moves a job to the Manual Queue with a recorded reason, and clears its rider. */
export async function sendToManualQueue(job, { code, message, actor, assignmentId, riderId, details }, session) {
  return changeJobStatus(
    job,
    {
      to: 'MANUAL_QUEUE',
      actor,
      eventType: 'MOVED_TO_MANUAL_QUEUE',
      message: `Moved to the manual queue: ${message}`,
      set: {
        manualQueueReason: { code, message, at: clock.now() },
        riderId: null,
        riderName: null,
        currentAssignmentId: null,
        confirmationDueAt: null,
      },
      assignmentId,
      riderId,
      details: { code, ...details },
    },
    session,
  );
}

async function loadLiveAssignment(job, session) {
  const assignment = job.currentAssignmentId ? await Assignment.findById(job.currentAssignmentId).session(session) : null;
  if (!assignment || !assignment.active) {
    throw Errors.conflict('NO_LIVE_ASSIGNMENT', `${job.orderRef} has no rider assigned right now.`);
  }
  return assignment;
}

const DESCRIBE_ENDED = {
  ACCEPTED: 'This assignment has already been accepted.',
  REJECTED: 'This assignment was already declined.',
  EXPIRED: 'This assignment has expired because the rider did not confirm in time.',
  WITHDRAWN: 'The dispatcher has withdrawn this assignment.',
  RELEASED: 'The rider has already dropped this job.',
  CANCELLED: 'The job was cancelled.',
  COMPLETED: 'This job has already been delivered.',
};

function assertCanRespond(assignment, actor) {
  if (actor.type === 'RIDER' && actor.riderId !== String(assignment.riderId)) {
    throw Errors.forbidden('You can only respond to jobs assigned to you');
  }
}

// ---------------------------------------------------------------------------------------------
// Assign / reassign

/**
 * Dispatcher assigns a rider to a job that is ready (or in the Manual Queue).
 *  - the rider must be eligible right now (same rules as the recommendation)
 *  - choosing anyone but the top recommendation needs a reason, which is recorded
 *  - the rider's capacity is reserved and the rider has `confirmationTimeoutMinutes` to accept
 */
export async function assignRider(jobRef, { riderId, overrideReason }, actor) {
  let result;
  try {
    result = await withTransaction(async (session) => {
      const job = await findJobOr404(jobRef, session);
      assertAssignable(job);

      const settings = await getDispatchSettings(session);
      const { recommended, notEligible } = await computeRecommendations(job, session);

      const chosen = recommended.find((r) => r.riderId === riderId);
      if (!chosen) {
        const blocked = notEligible.find((r) => r.riderId === riderId);
        if (!blocked) throw Errors.notFound('Rider');
        throw Errors.unprocessable('RIDER_NOT_ELIGIBLE', `${blocked.name} cannot take this job: ${blocked.reasons.join('; ')}`, {
          reasons: blocked.reasons,
        });
      }

      const top = recommended[0];
      const isOverride = chosen.riderId !== top.riderId;
      if (isOverride && !overrideReason) {
        throw Errors.unprocessable(
          'OVERRIDE_REASON_REQUIRED',
          `${top.name} is the recommended rider. Give a reason for choosing ${chosen.name} instead.`,
          { recommendedRiderId: top.riderId, recommendedRiderName: top.name },
        );
      }

      const reserved = await reserveCapacity(chosen.riderId, job, session);
      if (!reserved) {
        throw Errors.conflict(
          'RIDER_CAPACITY_CHANGED',
          `${chosen.name} can no longer take this job: their availability or capacity just changed. Refresh the recommendations.`,
        );
      }

      const now = clock.now();
      const timeoutMinutes = settings.confirmationTimeoutMinutes;
      const expiresAt = new Date(now.getTime() + timeoutMinutes * 60_000);
      const attempt = job.attemptCount + 1;
      const recommendation = {
        rank: chosen.rank,
        score: chosen.score,
        reasons: chosen.reasons,
        warnings: chosen.warnings,
        recommendedRider: { riderId: top.riderId, name: top.name, score: top.score },
        shortlist: recommended.slice(0, 3).map(({ riderId: id, name, rank, score }) => ({ riderId: id, name, rank, score })),
      };

      const [assignment] = await Assignment.create(
        [
          {
            jobId: job._id,
            orderRef: job.orderRef,
            riderId: chosen.riderId,
            riderName: chosen.name,
            load: job.load,
            attempt,
            status: 'PENDING',
            active: true,
            assignedAt: now,
            assignedBy: actorSnapshot(actor),
            expiresAt,
            timeoutMinutes,
            isOverride,
            overrideReason: isOverride ? overrideReason : null,
            recommendation,
          },
        ],
        { session },
      );

      const verb = attempt > 1 ? 'reassigned the job to' : 'assigned';
      const message = isOverride
        ? `${actor.name} ${verb} ${chosen.name} instead of the recommended ${top.name}: ${overrideReason}`
        : `${actor.name} ${verb} ${chosen.name} (recommended, ${chosen.travelToPickupMinutes} min from pickup)`;

      await changeJobStatus(
        job,
        {
          to: 'AWAITING_CONFIRMATION',
          actor,
          eventType: attempt > 1 ? 'RIDER_REASSIGNED' : 'RIDER_ASSIGNED',
          message: `${message}. ${chosen.name} has ${timeoutMinutes} min to confirm.`,
          set: {
            riderId: chosen.riderId,
            riderName: chosen.name,
            currentAssignmentId: assignment._id,
            confirmationDueAt: expiresAt,
            attemptCount: attempt,
            manualQueueReason: null,
          },
          assignmentId: assignment._id,
          riderId: chosen.riderId,
          details: { attempt, isOverride, overrideReason: isOverride ? overrideReason : null, expiresAt, timeoutMinutes, ...recommendation },
        },
        session,
      );

      return { jobId: job._id, assignmentId: assignment._id };
    });
  } catch (err) {
    // The unique "one live assignment per job" index caught a simultaneous assignment.
    if (isDuplicateKeyError(err)) {
      throw Errors.conflict('JOB_ALREADY_ASSIGNED', 'Another dispatcher assigned this job a moment ago. Refresh to see who.');
    }
    throw err;
  }

  return {
    job: toJobView(await Job.findById(result.jobId)),
    assignment: toAssignmentView(await Assignment.findById(result.assignmentId)),
  };
}

// ---------------------------------------------------------------------------------------------
// Rider answers: accept / decline

/** Expires one pending attempt whose time is up (job -> Manual Queue). Returns false if nothing to do. */
async function expireInSession(assignmentId, session) {
  const now = clock.now();
  const assignment = await Assignment.findOne({
    _id: assignmentId,
    status: 'PENDING',
    active: true,
    expiresAt: { $lte: now },
  }).session(session);
  if (!assignment) return false; // already accepted, declined or handled

  const message = `${assignment.riderName} did not confirm within ${assignment.timeoutMinutes} minutes`;
  const ended = await endAssignment(
    assignment,
    { status: 'EXPIRED', code: REASON.CONFIRMATION_TIMEOUT, message, actor: SYSTEM_ACTOR },
    session,
  );

  const job = await Job.findById(ended.jobId).session(session);
  await recordJobEvent(
    {
      job,
      type: 'ASSIGNMENT_EXPIRED',
      actor: SYSTEM_ACTOR,
      message: `${message}; the assignment expired and ${ended.load} units of their capacity were released`,
      assignmentId: ended._id,
      riderId: ended.riderId,
      details: { assignedAt: ended.assignedAt, expiresAt: ended.expiresAt, timeoutMinutes: ended.timeoutMinutes },
    },
    session,
  );
  await sendToManualQueue(
    job,
    { code: REASON.CONFIRMATION_TIMEOUT, message, actor: SYSTEM_ACTOR, assignmentId: ended._id, riderId: ended.riderId },
    session,
  );
  return true;
}

/**
 * The rider (or a dispatcher on the rider's behalf, e.g. after a phone call) accepts or declines.
 * A pending attempt whose time is already up is expired instead, and the answer is refused.
 */
export async function respondToAssignment(assignmentId, { accept, reason }, actor) {
  const outcome = await withTransaction(async (session) => {
    const assignment = await Assignment.findById(assignmentId).session(session);
    if (!assignment) throw Errors.notFound('Assignment');
    assertCanRespond(assignment, actor);
    if (assignment.status !== 'PENDING') {
      throw Errors.conflict('ASSIGNMENT_NOT_PENDING', DESCRIBE_ENDED[assignment.status] ?? 'This assignment is no longer waiting for an answer.', {
        status: assignment.status,
      });
    }

    const now = clock.now();
    if (assignment.expiresAt <= now) {
      await expireInSession(assignment._id, session);
      return { expired: true, timeoutMinutes: assignment.timeoutMinutes };
    }

    const job = await Job.findById(assignment.jobId).session(session);
    const byRider = actor.type === 'RIDER';
    const responded = { respondedAt: now, respondedBy: actorSnapshot(actor) };

    if (accept) {
      const accepted = await Assignment.findOneAndUpdate(
        { _id: assignment._id, status: 'PENDING', active: true },
        { $set: { status: 'ACCEPTED', ...responded } },
        { new: true, session },
      );
      if (!accepted) throw Errors.conflict('ASSIGNMENT_CHANGED', 'This assignment was just changed by another action. Refresh and try again.');

      await changeJobStatus(
        job,
        {
          to: 'ACCEPTED',
          actor,
          eventType: 'ASSIGNMENT_ACCEPTED',
          message: byRider
            ? `${assignment.riderName} accepted the job`
            : `${actor.name} recorded that ${assignment.riderName} accepted the job`,
          set: { confirmationDueAt: null },
          assignmentId: assignment._id,
          riderId: assignment.riderId,
        },
        session,
      );
    } else {
      const message = `${assignment.riderName} declined the job: ${reason}`;
      await endAssignment(
        assignment,
        { status: 'REJECTED', code: REASON.RIDER_REJECTED, message, actor, extra: responded },
        session,
      );
      await recordJobEvent(
        {
          job,
          type: 'ASSIGNMENT_REJECTED',
          actor,
          message: byRider ? message : `${actor.name} recorded that ${message}`,
          assignmentId: assignment._id,
          riderId: assignment.riderId,
          details: { reason },
        },
        session,
      );
      await sendToManualQueue(
        job,
        { code: REASON.RIDER_REJECTED, message, actor, assignmentId: assignment._id, riderId: assignment.riderId, details: { reason } },
        session,
      );
    }
    return { expired: false, jobId: job._id };
  });

  if (outcome.expired) {
    throw Errors.conflict(
      'ASSIGNMENT_EXPIRED',
      `Too late: the ${outcome.timeoutMinutes}-minute window to confirm has passed. The job has moved to the manual queue.`,
    );
  }
  return {
    assignment: toAssignmentView(await Assignment.findById(assignmentId)),
    job: toJobView(await Job.findById(outcome.jobId)),
  };
}

// ---------------------------------------------------------------------------------------------
// Confirmation timeout

/**
 * If the job's rider has run out of time to confirm but the sweeper has not caught it yet,
 * expire the attempt now (inside the caller's transaction), so a later action on the job
 * (take back, cancel) cannot hide the missed confirmation. Returns the job as it is now.
 */
export async function expireIfOverdue(job, session) {
  if (job.status !== 'AWAITING_CONFIRMATION' || !job.currentAssignmentId) return { job, expired: false };
  if (!(await expireInSession(job.currentAssignmentId, session))) return { job, expired: false };
  return { job: await Job.findById(job._id).session(session), expired: true };
}

export async function expireAssignment(assignmentId) {
  return withTransaction((session) => expireInSession(assignmentId, session));
}

/**
 * Finds every pending attempt whose confirmation time is up and expires it (each in its own
 * transaction, so one failure does not block the others). Called by the timeout sweeper every
 * few seconds, and on demand from the demo controls. Safe to run again or in parallel: an
 * attempt that was accepted or already expired is skipped.
 */
export async function expireOverdueAssignments({ limit = 100 } = {}) {
  const due = await Assignment.find({ status: 'PENDING', expiresAt: { $lte: clock.now() } }, { _id: 1 })
    .sort({ expiresAt: 1 })
    .limit(limit)
    .lean();

  let expired = 0;
  for (const { _id } of due) {
    try {
      if (await expireAssignment(_id)) expired += 1;
    } catch (err) {
      console.error(`Could not expire assignment ${_id}:`, err.message);
    }
  }
  return { checked: due.length, expired };
}

// ---------------------------------------------------------------------------------------------
// Pickup and delivery

export async function markPickedUp(jobRef, actor) {
  const jobId = await withTransaction(async (session) => {
    const job = await findJobOr404(jobRef, session);
    assertCanActOnJob(job, actor, 'update');
    const updated = await changeJobStatus(
      job,
      {
        to: 'PICKED_UP',
        actor,
        eventType: 'JOB_PICKED_UP',
        message:
          actor.type === 'RIDER'
            ? `${job.riderName} picked up the delivery in ${zone(job.pickupZone)}`
            : `${actor.name} recorded that ${job.riderName} picked up the delivery in ${zone(job.pickupZone)}`,
        assignmentId: job.currentAssignmentId,
        riderId: job.riderId,
      },
      session,
    );
    // Simulated location: the rider is now at the pickup zone.
    await Rider.updateOne({ _id: job.riderId }, { $set: { currentZone: job.pickupZone } }, { session });
    return updated._id;
  });
  return toJobView(await Job.findById(jobId));
}

export async function markDelivered(jobRef, actor) {
  const jobId = await withTransaction(async (session) => {
    const job = await findJobOr404(jobRef, session);
    assertCanActOnJob(job, actor, 'update');
    const updated = await changeJobStatus(
      job,
      {
        to: 'DELIVERED',
        actor,
        eventType: 'JOB_DELIVERED',
        message:
          actor.type === 'RIDER'
            ? `${job.riderName} delivered the job in ${zone(job.dropZone)}`
            : `${actor.name} recorded that ${job.riderName} delivered the job in ${zone(job.dropZone)}`,
        set: { currentAssignmentId: null }, // riderId / riderName stay: who delivered it
        assignmentId: job.currentAssignmentId,
        riderId: job.riderId,
      },
      session,
    );
    const assignment = await loadLiveAssignment(job, session);
    await endAssignment(
      assignment,
      { status: 'COMPLETED', code: 'DELIVERED', message: 'Delivered', actor, currentZone: job.dropZone },
      session,
    );
    return updated._id;
  });
  return toJobView(await Job.findById(jobId));
}

// ---------------------------------------------------------------------------------------------
// Taking a job back

/**
 * A dispatcher withdraws the rider (while waiting for confirmation, or after acceptance but
 * before pickup), or the rider drops a job they accepted. The job goes to the Manual Queue.
 * A rider who drops a job is not recommended for it again; a withdrawn rider is.
 */
export async function unassignJob(jobRef, reason, actor) {
  const outcome = await withTransaction(async (session) => {
    const found = await findJobOr404(jobRef, session);
    assertCanActOnJob(found, actor, 'release');
    const { job, expired } = await expireIfOverdue(found, session);
    if (expired) return { expired: true };
    const byRider = actor.type === 'RIDER';

    if (byRider && job.status === 'AWAITING_CONFIRMATION') {
      throw Errors.conflict('USE_DECLINE', 'You have not accepted this job yet. Decline it instead.');
    }
    if (!['AWAITING_CONFIRMATION', 'ACCEPTED'].includes(job.status)) {
      throw Errors.conflict(
        'CANNOT_UNASSIGN',
        job.status === 'PICKED_UP'
          ? `${job.orderRef} has already been picked up, so the rider must deliver it.`
          : `${job.orderRef} has no rider to take it back from.`,
      );
    }

    const assignment = await loadLiveAssignment(job, session);
    const message = byRider
      ? `${assignment.riderName} dropped the job: ${reason}`
      : `${actor.name} took the job back from ${assignment.riderName}: ${reason}`;

    await endAssignment(
      assignment,
      {
        status: byRider ? 'RELEASED' : 'WITHDRAWN',
        code: byRider ? REASON.RIDER_RELEASED : REASON.WITHDRAWN,
        message,
        actor,
      },
      session,
    );
    await recordJobEvent(
      {
        job,
        type: byRider ? 'ASSIGNMENT_RELEASED' : 'ASSIGNMENT_WITHDRAWN',
        actor,
        message,
        assignmentId: assignment._id,
        riderId: assignment.riderId,
        details: { reason },
      },
      session,
    );
    const updated = await sendToManualQueue(
      job,
      {
        code: byRider ? REASON.RIDER_RELEASED : REASON.WITHDRAWN,
        message,
        actor,
        assignmentId: assignment._id,
        riderId: assignment.riderId,
        details: { reason },
      },
      session,
    );
    return { expired: false, jobId: updated._id };
  });

  if (outcome.expired) {
    throw Errors.conflict(
      'ASSIGNMENT_EXPIRED',
      "The rider's time to confirm had already run out, so the job has moved to the manual queue.",
    );
  }
  return toJobView(await Job.findById(outcome.jobId));
}

/** Dispatcher parks a ready job in the Manual Queue (e.g. nobody suitable right now). */
export async function moveToManualQueue(jobRef, reason, actor) {
  const jobId = await withTransaction(async (session) => {
    const job = await findJobOr404(jobRef, session);
    if (job.status !== 'READY_FOR_ASSIGNMENT') {
      throw Errors.conflict(
        'CANNOT_MOVE_TO_MANUAL_QUEUE',
        job.status === 'MANUAL_QUEUE'
          ? `${job.orderRef} is already in the manual queue.`
          : `Only jobs that are ready for assignment can be moved to the manual queue. To take a job back from a rider, withdraw the assignment.`,
      );
    }
    const updated = await sendToManualQueue(
      job,
      { code: REASON.DISPATCHER_FLAGGED, message: `${actor.name}: ${reason}`, actor, details: { reason } },
      session,
    );
    return updated._id;
  });
  return toJobView(await Job.findById(jobId));
}

/**
 * Used when a job is cancelled: ends its live attempt (if any) and releases the rider's capacity,
 * inside the cancel transaction.
 */
export async function cancelLiveAssignment(job, reason, actor, session) {
  if (!job.currentAssignmentId) return null;
  const assignment = await Assignment.findById(job.currentAssignmentId).session(session);
  if (!assignment || !assignment.active) return null;
  return endAssignment(
    assignment,
    { status: 'CANCELLED', code: 'JOB_CANCELLED', message: `Job cancelled: ${reason}`, actor },
    session,
  );
}

// ---------------------------------------------------------------------------------------------
// Reading

/** Every attempt on a job, oldest first. */
export async function listJobAssignments(jobRef, actor) {
  const job = await findJobOr404(jobRef);
  assertCanActOnJob(job, actor, 'view');
  const attempts = await Assignment.find({ jobId: job._id }).sort({ assignedAt: 1, _id: 1 }).lean();
  return { jobId: String(job._id), orderRef: job.orderRef, items: attempts.map(toAssignmentView) };
}

/** A rider's live jobs (offers waiting for an answer, and jobs in progress) plus recent ones. */
export async function listMyAssignments(actor) {
  if (!actor.riderId) throw Errors.forbidden('Only riders have assignments');
  const [live, recent] = await Promise.all([
    Assignment.find({ riderId: actor.riderId, active: true }).sort({ assignedAt: 1 }).lean(),
    Assignment.find({ riderId: actor.riderId, active: false }).sort({ endedAt: -1 }).limit(10).lean(),
  ]);

  const jobs = await Job.find({ _id: { $in: [...live, ...recent].map((a) => a.jobId) } }).lean();
  const jobById = new Map(jobs.map((j) => [String(j._id), j]));
  const now = clock.now();
  const withJob = (a) => ({ assignment: toAssignmentView(a), job: jobById.has(String(a.jobId)) ? toJobView(jobById.get(String(a.jobId)), now) : null });

  return { live: live.map(withJob), recent: recent.map(withJob), serverTime: now };
}
