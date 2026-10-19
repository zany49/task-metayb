import { clock } from '../common/clock.js';
import { Errors } from '../common/errors.js';
import { escapeRegex, isDuplicateKeyError } from '../common/mongo.js';
import { withTransaction } from '../db/transaction.js';
import { MANUAL_QUEUE_REASONS } from '../domain/assignment.js';
import { actorSnapshot, SYSTEM_ACTOR } from '../domain/actor.js';
import { assertTransition, OPEN_STATUSES } from '../domain/jobLifecycle.js';
import { summariseNoEligibleRider } from '../domain/recommendation.js';
import { Job } from '../models/job.model.js';
import { cancelLiveAssignment, expireIfOverdue, sendToManualQueue } from './dispatch.service.js';
import { listJobEvents, recordJobEvent } from './jobEvent.service.js';
import { assertCanActOnJob, changeJobStatus, findJobOr404, toJobView } from './jobCore.js';
import { computeRecommendations } from './recommendation.service.js';

// Re-exported for callers (and tests) that use them through the job service.
export { changeJobStatus, toJobView };

// ---------------------------------------------------------------------------------------------
// Read

export async function getJob(jobRef, actor) {
  const job = await findJobOr404(jobRef);
  assertCanActOnJob(job, actor, 'view');
  return toJobView(job);
}

export async function getJobHistory(jobRef, actor) {
  const job = await findJobOr404(jobRef);
  assertCanActOnJob(job, actor, 'view');
  return { jobId: String(job._id), orderRef: job.orderRef, status: job.status, events: await listJobEvents(job._id) };
}

// ---------------------------------------------------------------------------------------------
// Create (duplicate-safe)

/** Fields that define "the same order". A resubmission must match these exactly. */
function differencesFrom(existing, input) {
  const same = {
    pickupZone: existing.pickupZone === input.pickupZone,
    dropZone: existing.dropZone === input.dropZone,
    load: existing.load === input.load,
    priority: existing.priority === input.priority,
    deadline: (existing.deadline?.getTime() ?? null) === (input.deadline?.getTime() ?? null),
    notes: (existing.notes || null) === (input.notes || null),
  };
  return Object.entries(same)
    .filter(([, isSame]) => !isSame)
    .map(([field]) => ({
      field,
      existing: field === 'deadline' ? existing.deadline ?? null : existing[field] ?? null,
      submitted: input[field] ?? null,
    }));
}

/**
 * Creates a job from a new order. The order reference is the duplicate guard:
 *   - new orderRef                    -> job created, 201  (returns { job, created: true })
 *   - same orderRef, same details     -> the existing job is returned, nothing new is created
 *                                        (a retry or double click), 200 (created: false)
 *   - same orderRef, different details -> 409 ORDER_REF_CONFLICT (a real mistake to look at)
 *
 * The unique index on orderRef makes this safe even when two identical requests arrive together.
 *
 * Intake, in the same transaction: the job is saved as NEW and moves to READY_FOR_ASSIGNMENT.
 * If no rider at all could take it right now (e.g. too heavy for everyone, nobody covers the zone),
 * it goes straight to the Manual Queue with the reason, so it is flagged instead of waiting unseen.
 */
export async function createJob(input, actor) {
  const now = clock.now();
  if (input.deadline && input.deadline <= now) {
    // A retry of an order we already have stays safe even after its deadline has passed.
    if (await Job.exists({ orderRef: input.orderRef })) return handleResubmission(input, actor);
    throw Errors.badRequest('DEADLINE_IN_PAST', 'The delivery deadline must be in the future', {
      deadline: input.deadline,
      now,
    });
  }

  try {
    const jobId = await withTransaction(async (session) => {
      const [job] = await Job.create(
        [
          {
            orderRef: input.orderRef,
            pickupZone: input.pickupZone,
            dropZone: input.dropZone,
            load: input.load,
            priority: input.priority,
            deadline: input.deadline ?? null,
            notes: input.notes || undefined,
            status: 'NEW',
            statusChangedAt: clock.now(),
            createdBy: actorSnapshot(actor),
          },
        ],
        { session },
      );

      await recordJobEvent(
        {
          job,
          type: 'JOB_CREATED',
          actor,
          message: `${actor.name} created job ${job.orderRef}`,
          toStatus: 'NEW',
          details: {
            pickupZone: job.pickupZone,
            dropZone: job.dropZone,
            load: job.load,
            priority: job.priority,
            deadline: job.deadline,
          },
        },
        session,
      );

      // NEW is kept as a separate state so a future intake step (e.g. address checks or
      // scheduled pickups) can hold jobs before dispatch without changing the lifecycle.
      const ready = await changeJobStatus(
        job,
        {
          to: 'READY_FOR_ASSIGNMENT',
          actor: SYSTEM_ACTOR,
          eventType: 'JOB_READY',
          message: 'Intake checks passed; job is ready for assignment',
        },
        session,
      );

      const { recommended, notEligible } = await computeRecommendations(ready, session);
      if (recommended.length === 0) {
        await sendToManualQueue(
          ready,
          {
            code: MANUAL_QUEUE_REASONS.NO_ELIGIBLE_RIDER,
            message: summariseNoEligibleRider(notEligible),
            actor: SYSTEM_ACTOR,
            details: { notEligible: notEligible.map(({ name, reasons }) => ({ name, reasons })) },
          },
          session,
        );
      }
      return job._id;
    });

    return { job: toJobView(await Job.findById(jobId)), created: true };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    return handleResubmission(input, actor);
  }
}

async function handleResubmission(input, actor) {
  const existing = await Job.findOne({ orderRef: input.orderRef });
  if (!existing) throw Errors.conflict('ORDER_REF_CONFLICT', 'This order reference is already in use');

  const differences = differencesFrom(existing, input);
  if (differences.length > 0) {
    throw Errors.conflict(
      'ORDER_REF_CONFLICT',
      `Order ${existing.orderRef} already exists with different details. Use a new order reference for a different job.`,
      { jobId: String(existing._id), differences },
    );
  }

  await recordJobEvent({
    job: existing,
    type: 'DUPLICATE_SUBMISSION_IGNORED',
    actor,
    message: `${actor.name} submitted order ${existing.orderRef} again; the existing job was returned and no duplicate was created`,
  });
  return { job: toJobView(existing), created: false };
}

// ---------------------------------------------------------------------------------------------
// List / search

const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  priority: { priorityRank: -1, createdAt: 1, _id: 1 },
};

/** Lists jobs with filters and pagination. */
export async function listJobs(query) {
  const filter = {};
  if (query.status) filter.status = { $in: query.status };
  if (query.priority) filter.priority = query.priority;
  if (query.riderId) filter.riderId = query.riderId;
  if (query.zone) filter.$or = [{ pickupZone: query.zone }, { dropZone: query.zone }];
  if (query.q) filter.orderRef = { $regex: escapeRegex(query.q.toUpperCase()) };
  if (query.overdue) {
    // Past the deadline and still open (delivered or cancelled jobs are never "overdue").
    const open = query.status ? query.status.filter((s) => OPEN_STATUSES.includes(s)) : OPEN_STATUSES;
    filter.status = { $in: open };
    filter.deadline = { $ne: null, $lt: clock.now() };
  }

  const [total, jobs] = await Promise.all([
    Job.countDocuments(filter),
    Job.find(filter)
      .sort(SORTS[query.sort])
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);

  const now = clock.now();
  return {
    items: jobs.map((job) => toJobView(job, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit),
  };
}

// ---------------------------------------------------------------------------------------------
// Cancel

/**
 * Dispatcher cancels a job. Allowed before pickup (the lifecycle rules decide). If a rider holds
 * the job, their assignment is ended and their capacity released in the same transaction.
 */
export async function cancelJob(jobRef, reason, actor) {
  const jobId = await withTransaction(async (session) => {
    const found = await findJobOr404(jobRef, session);
    assertTransition(found.status, 'CANCELLED'); // e.g. refuses a job that was already picked up

    // A rider whose time to confirm has run out is recorded as "no response" first.
    const { job } = await expireIfOverdue(found, session);
    const ended = await cancelLiveAssignment(job, reason, actor, session);
    const updated = await changeJobStatus(
      job,
      {
        to: 'CANCELLED',
        actor,
        eventType: 'JOB_CANCELLED',
        message: ended
          ? `${actor.name} cancelled the job: ${reason}. ${ended.riderName}'s assignment was ended and their capacity released.`
          : `${actor.name} cancelled the job: ${reason}`,
        set: {
          cancelReason: reason,
          manualQueueReason: null,
          riderId: null,
          riderName: null,
          currentAssignmentId: null,
          confirmationDueAt: null,
        },
        assignmentId: ended?._id,
        riderId: ended?.riderId,
        details: { reason },
      },
      session,
    );
    return updated._id;
  });
  return toJobView(await Job.findById(jobId));
}
