import { clock } from '../common/clock.js';
import { JOB_STATUSES, OPEN_STATUSES } from '../domain/jobLifecycle.js';
import { RIDER_AVAILABILITY } from '../domain/rider.js';
import { Job } from '../models/job.model.js';
import { Rider } from '../models/rider.model.js';

/** A rider's confirmation counts as "due soon" within this many minutes. */
export const DUE_SOON_MINUTES = 15;

/**
 * Counts for the dispatcher's dashboard: jobs per status, open jobs past their deadline,
 * riders whose time to confirm runs out soon, and riders per availability. Every status is
 * always present (0 when empty), so the frontend never has to guess.
 */
export async function getDashboardSummary() {
  const now = clock.now();
  const soon = new Date(now.getTime() + DUE_SOON_MINUTES * 60_000);

  const [jobsByStatus, overdue, confirmationsDueSoon, ridersByAvailability] = await Promise.all([
    Job.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Job.countDocuments({ status: { $in: OPEN_STATUSES }, deadline: { $ne: null, $lt: now } }),
    Job.countDocuments({ status: 'AWAITING_CONFIRMATION', confirmationDueAt: { $lte: soon } }),
    Rider.aggregate([{ $group: { _id: '$availability', count: { $sum: 1 } } }]),
  ]);

  const byStatus = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0]));
  for (const { _id, count } of jobsByStatus) byStatus[_id] = count;

  const byAvailability = Object.fromEntries(RIDER_AVAILABILITY.map((a) => [a, 0]));
  for (const { _id, count } of ridersByAvailability) byAvailability[_id] = count;

  const sum = (values) => values.reduce((a, b) => a + b, 0);

  return {
    generatedAt: now,
    jobs: {
      total: sum(Object.values(byStatus)),
      open: sum(OPEN_STATUSES.map((s) => byStatus[s])),
      overdue,
      confirmationsDueSoon,
      byStatus,
    },
    riders: {
      total: sum(Object.values(byAvailability)),
      byAvailability,
    },
  };
}
