/** Words people see for the API's codes. One place, so every screen uses the same vocabulary. */

export const JOB_STATUS_ORDER = [
  'NEW',
  'READY_FOR_ASSIGNMENT',
  'AWAITING_CONFIRMATION',
  'ACCEPTED',
  'PICKED_UP',
  'DELIVERED',
  'MANUAL_QUEUE',
  'CANCELLED',
];

/** Short labels (pills, route line). */
export const STATUS_LABELS = {
  NEW: 'New',
  READY_FOR_ASSIGNMENT: 'Ready',
  AWAITING_CONFIRMATION: 'Awaiting rider',
  ACCEPTED: 'Accepted',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  MANUAL_QUEUE: 'Manual queue',
  CANCELLED: 'Cancelled',
};

/** Full names (filters, detail page). */
export const STATUS_LONG_LABELS = {
  NEW: 'New',
  READY_FOR_ASSIGNMENT: 'Ready for assignment',
  AWAITING_CONFIRMATION: 'Awaiting rider confirmation',
  ACCEPTED: 'Accepted by rider',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
  MANUAL_QUEUE: 'Manual queue',
  CANCELLED: 'Cancelled',
};

/** What each status means, for tooltips. */
export const STATUS_DESCRIPTIONS = {
  NEW: 'Just entered the system',
  READY_FOR_ASSIGNMENT: 'Ready for a rider to be assigned',
  AWAITING_CONFIRMATION: 'Assigned; waiting for the rider to confirm',
  ACCEPTED: 'Rider confirmed; heading to pickup',
  PICKED_UP: 'Collected; on the way to the drop zone',
  DELIVERED: 'Delivered',
  MANUAL_QUEUE: 'Needs a dispatcher: no rider confirmed or none was eligible',
  CANCELLED: 'Cancelled',
};

export const PRIORITY_ORDER = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
export const PRIORITY_LABELS = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

export const AVAILABILITY_ORDER = ['AVAILABLE', 'ON_BREAK', 'OFF_DUTY'];
export const AVAILABILITY_LABELS = { AVAILABLE: 'Available', ON_BREAK: 'On break', OFF_DUTY: 'Off duty' };

export const ZONE_ORDER = ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST'];
export const ZONE_LABELS = { CENTRAL: 'Central', NORTH: 'North', SOUTH: 'South', EAST: 'East', WEST: 'West' };

export const ROLE_LABELS = { DISPATCHER: 'Dispatcher', RIDER: 'Rider', SYSTEM: 'System' };

/** How an assignment attempt stands or ended. */
export const ASSIGNMENT_STATUS_LABELS = {
  PENDING: 'Waiting for rider',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  EXPIRED: 'No response',
  WITHDRAWN: 'Taken back',
  RELEASED: 'Dropped by rider',
  CANCELLED: 'Job cancelled',
  COMPLETED: 'Delivered',
};

/** Why a job is in the manual queue. */
export const MANUAL_QUEUE_REASON_LABELS = {
  NO_ELIGIBLE_RIDER: 'No eligible rider',
  RIDER_REJECTED: 'Rider declined',
  CONFIRMATION_TIMEOUT: 'Rider did not confirm in time',
  RIDER_RELEASED: 'Rider dropped the job',
  WITHDRAWN: 'Taken back by a dispatcher',
  DISPATCHER_FLAGGED: 'Flagged by a dispatcher',
};

export const zoneLabel = (code) => ZONE_LABELS[code] ?? code;
