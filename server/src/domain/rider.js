/**
 * Pure rider rules (no database). Used by the API to tell a dispatcher whether a rider
 * can take another delivery, and later by the recommendation engine.
 */
export const RIDER_AVAILABILITY = ['AVAILABLE', 'ON_BREAK', 'OFF_DUTY'];

/**
 * Summarises a rider's current workload.
 *
 * @param {{ availability: string, capacity: number, reservedLoad: number,
 *           maxActiveJobs: number, activeJobs: number }} r
 * @returns {{ spareCapacity: number, slotsLeft: number, canTakeMoreJobs: boolean, blockers: string[] }}
 *   spareCapacity   load units still free (capacity - reserved)
 *   slotsLeft       how many more jobs before hitting maxActiveJobs
 *   canTakeMoreJobs true when nothing blocks a new assignment (zone and job size are checked per job later)
 *   blockers        human-readable reasons the rider cannot take more work right now
 */
export function riderWorkload(r) {
  const spareCapacity = Math.max(0, r.capacity - r.reservedLoad);
  const slotsLeft = Math.max(0, r.maxActiveJobs - r.activeJobs);
  const blockers = [];

  if (r.availability === 'OFF_DUTY') blockers.push('Rider is off duty');
  if (r.availability === 'ON_BREAK') blockers.push('Rider is on break');
  if (slotsLeft === 0) blockers.push(`At job limit (${r.activeJobs}/${r.maxActiveJobs} active jobs)`);
  if (spareCapacity === 0) blockers.push(`No spare capacity (${r.reservedLoad}/${r.capacity} units reserved)`);

  return { spareCapacity, slotsLeft, canTakeMoreJobs: blockers.length === 0, blockers };
}
