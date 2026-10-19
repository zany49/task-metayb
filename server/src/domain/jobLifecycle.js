/**
 * Delivery job lifecycle: the statuses a job can be in and the moves allowed between them.
 * Pure rules, no database. Every status change in the app goes through assertTransition(),
 * so an invalid move (e.g. DELIVERED before PICKED_UP) is impossible from any code path.
 *
 *   NEW ──► READY_FOR_ASSIGNMENT ──► AWAITING_CONFIRMATION ──► ACCEPTED ──► PICKED_UP ──► DELIVERED
 *                 │                        │                      │
 *                 │ no eligible rider      │ timeout / reject     │ rider drops out
 *                 ▼                        ▼                      ▼
 *            MANUAL_QUEUE ◄────────────────┴──────────────────────┘
 *                 │
 *                 └── reassign ──► AWAITING_CONFIRMATION
 *
 *   CANCELLED: allowed from every status before PICKED_UP.
 *   DELIVERED and CANCELLED are final.
 */
import { AppError } from '../common/errors.js';

export const JOB_STATUSES = [
  'NEW',
  'READY_FOR_ASSIGNMENT',
  'AWAITING_CONFIRMATION',
  'ACCEPTED',
  'PICKED_UP',
  'DELIVERED',
  'MANUAL_QUEUE',
  'CANCELLED',
];

/** Allowed moves: from-status -> list of to-statuses. */
const TRANSITIONS = {
  NEW: ['READY_FOR_ASSIGNMENT', 'CANCELLED'],
  READY_FOR_ASSIGNMENT: ['AWAITING_CONFIRMATION', 'MANUAL_QUEUE', 'CANCELLED'],
  AWAITING_CONFIRMATION: ['ACCEPTED', 'MANUAL_QUEUE', 'CANCELLED'],
  ACCEPTED: ['PICKED_UP', 'MANUAL_QUEUE', 'CANCELLED'],
  PICKED_UP: ['DELIVERED'],
  MANUAL_QUEUE: ['AWAITING_CONFIRMATION', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/** Statuses where a job is still "open" (not delivered or cancelled). */
export const OPEN_STATUSES = JOB_STATUSES.filter((s) => TRANSITIONS[s].length > 0);

/** Statuses in which a rider holds the job (capacity is reserved for it). */
export const RIDER_HOLDING_STATUSES = ['AWAITING_CONFIRMATION', 'ACCEPTED', 'PICKED_UP'];

/** Statuses from which a dispatcher may assign (or reassign) a rider. */
export const ASSIGNABLE_STATUSES = ['READY_FOR_ASSIGNMENT', 'MANUAL_QUEUE'];

export function allowedNextStatuses(from) {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from, to) {
  return allowedNextStatuses(from).includes(to);
}

export function isFinal(status) {
  return allowedNextStatuses(status).length === 0;
}

/** Throws 409 INVALID_TRANSITION with a readable explanation if the move is not allowed. */
export function assertTransition(from, to) {
  if (canTransition(from, to)) return;

  const allowed = allowedNextStatuses(from);
  const reason = isFinal(from)
    ? `the job is already ${from} and cannot change any more`
    : `from ${from} the job can only move to ${allowed.join(', ')}`;
  throw new AppError(409, 'INVALID_TRANSITION', `Cannot move job from ${from} to ${to}: ${reason}`, {
    from,
    to,
    allowed,
  });
}

/** A copy of the transition map (for the frontend and API docs). */
export function transitionMap() {
  return Object.fromEntries(Object.entries(TRANSITIONS).map(([from, to]) => [from, [...to]]));
}

// ---------------------------------------------------------------------------------------------
// Priority

export const JOB_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/** Numeric rank used for sorting (higher = more urgent). */
export const PRIORITY_RANK = { LOW: 1, NORMAL: 2, HIGH: 3, URGENT: 4 };

// ---------------------------------------------------------------------------------------------
// History event types (the audit trail). Defined in one place so a typo cannot create a new type.

export const JOB_EVENT_TYPES = [
  'JOB_CREATED', // a dispatcher (or order system) created the job
  'JOB_READY', // intake checks passed; the job can be dispatched
  'DUPLICATE_SUBMISSION_IGNORED', // the same order was submitted again; no second job was created
  'RIDER_ASSIGNED', // a rider was assigned (first attempt); includes the recommendation shown
  'RIDER_REASSIGNED', // a rider was assigned after an earlier attempt ended
  'ASSIGNMENT_ACCEPTED', // the rider confirmed
  'ASSIGNMENT_REJECTED', // the rider declined
  'ASSIGNMENT_EXPIRED', // the rider did not respond in time
  'ASSIGNMENT_WITHDRAWN', // a dispatcher took the job back from the rider
  'ASSIGNMENT_RELEASED', // the rider dropped the job after accepting
  'MOVED_TO_MANUAL_QUEUE', // the job needs a dispatcher's attention
  'JOB_PICKED_UP',
  'JOB_DELIVERED',
  'JOB_CANCELLED',
];
