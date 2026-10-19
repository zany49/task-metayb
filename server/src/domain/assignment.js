/**
 * An assignment is one attempt to give a job to a rider. A job can have several attempts
 * (e.g. the first rider did not respond, then a second rider took it); only one can be live.
 *
 *   PENDING ──► ACCEPTED ──► COMPLETED (delivered)
 *      │            │
 *      │            └──► RELEASED  (rider dropped it before pickup)
 *      ├──► REJECTED  (rider declined)
 *      ├──► EXPIRED   (no answer within the confirmation timeout)
 *      ├──► WITHDRAWN (dispatcher took it back; also possible after ACCEPTED)
 *      └──► CANCELLED (the job was cancelled; also possible after ACCEPTED)
 */
export const ASSIGNMENT_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'RELEASED', 'CANCELLED', 'COMPLETED'];

/** Statuses in which the rider holds the job and its load is reserved. */
export const LIVE_ASSIGNMENT_STATUSES = ['PENDING', 'ACCEPTED'];

/** Why a job is waiting in the Manual Queue. */
export const MANUAL_QUEUE_REASONS = {
  NO_ELIGIBLE_RIDER: 'NO_ELIGIBLE_RIDER',
  RIDER_REJECTED: 'RIDER_REJECTED',
  CONFIRMATION_TIMEOUT: 'CONFIRMATION_TIMEOUT',
  RIDER_RELEASED: 'RIDER_RELEASED',
  WITHDRAWN: 'WITHDRAWN',
  DISPATCHER_FLAGGED: 'DISPATCHER_FLAGGED',
};
