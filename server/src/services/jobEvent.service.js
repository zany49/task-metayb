import { clock } from '../common/clock.js';
import { actorSnapshot } from '../domain/actor.js';
import { JobEvent } from '../models/jobEvent.model.js';

/**
 * Appends one event to a job's history.
 * Pass the same `session` as the change it describes, so both are saved together or not at all.
 *
 * @param {object} e
 * @param {object} e.job        the job document (needs _id and orderRef)
 * @param {string} e.type       one of JOB_EVENT_TYPES
 * @param {object} e.actor      who did it ({ type, id, name })
 * @param {string} e.message    one readable sentence
 * @param {string} [e.fromStatus]
 * @param {string} [e.toStatus]
 * @param {*}      [e.assignmentId]
 * @param {*}      [e.riderId]
 * @param {object} [e.details]  extra facts (reason, ranking, ...)
 * @param {Date}   [e.at]       defaults to clock.now()
 * @param {import('mongoose').ClientSession} [session]
 */
export async function recordJobEvent(e, session) {
  const [event] = await JobEvent.create(
    [
      {
        jobId: e.job._id,
        orderRef: e.job.orderRef,
        type: e.type,
        at: e.at ?? clock.now(),
        actor: actorSnapshot(e.actor),
        message: e.message,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        assignmentId: e.assignmentId ?? null,
        riderId: e.riderId ?? null,
        details: e.details,
      },
    ],
    { session },
  );
  return event;
}

export function toEventView(event) {
  return {
    id: String(event._id),
    type: event.type,
    at: event.at,
    actor: event.actor,
    message: event.message,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    assignmentId: event.assignmentId ? String(event.assignmentId) : null,
    riderId: event.riderId ? String(event.riderId) : null,
    ...(event.details !== undefined && { details: event.details }),
  };
}

/** A job's full history, oldest first. */
export async function listJobEvents(jobId) {
  const events = await JobEvent.find({ jobId }).sort({ at: 1, _id: 1 }).lean();
  return events.map(toEventView);
}
