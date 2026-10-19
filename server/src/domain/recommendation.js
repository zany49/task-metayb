/**
 * Rider recommendation: which riders can take a job, and in what order.
 * Pure function (no database), so the ranking rules can be tested and explained on their own.
 *
 * Step 1, eligibility (hard rules). A rider is NOT eligible when they:
 *   - are on break or off duty
 *   - do not cover the pickup zone or the drop zone
 *   - lack free capacity for the job's load
 *   - are already at their job limit
 *   - declined this job earlier, or accepted and then dropped it
 *
 * Step 2, ranking (0-100 score). Each eligible rider gets four sub-scores between 0 and 1:
 *   travel    how quickly they can reach the pickup (simulated zone-to-zone minutes)
 *   workload  how few jobs they already hold (spreads work across riders)
 *   deadline  how much time to spare between their estimated delivery and the deadline
 *   capacity  how much room they still have after taking this job
 * The weights depend on priority: for HIGH and URGENT jobs, getting there fast matters more than
 * spreading work evenly. A rider who did not respond to this same job earlier loses 20 points.
 *
 * Every rider comes back with readable reasons, and each ranked rider says why they are above
 * the next one, so a dispatcher can see why one rider was recommended over another.
 */
import { travelMatrix, travelMinutes, ZONE_LABELS } from './zones.js';

export const WEIGHTS = {
  standard: { travel: 0.4, workload: 0.25, deadline: 0.2, capacity: 0.15 },
  urgent: { travel: 0.55, workload: 0.1, deadline: 0.25, capacity: 0.1 },
};

/** Minutes assumed for loading at pickup when estimating delivery time. */
export const HANDLING_MINUTES = 5;
/** Slack at or above this many minutes before the deadline earns the full deadline score. */
export const COMFORTABLE_SLACK_MINUTES = 60;
/** Points taken off for a rider who let this same job time out before. */
export const NO_RESPONSE_PENALTY = 20;

const allTravelTimes = Object.values(travelMatrix()).flatMap((row) => Object.values(row));
const MIN_TRAVEL = Math.min(...allTravelTimes);
const MAX_TRAVEL = Math.max(...allTravelTimes);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const zone = (code) => ZONE_LABELS[code] ?? code;

/** Order in which a rider's first blocking reason is reported (used for summaries). */
const BLOCKER_ORDER = ['OFF_DUTY', 'ON_BREAK', 'DECLINED', 'DROPPED', 'PICKUP_ZONE', 'DROP_ZONE', 'CAPACITY', 'JOB_LIMIT'];

function blockersFor(rider, job, history) {
  const blockers = [];
  const add = (code, text) => blockers.push({ code, text });

  if (rider.availability === 'OFF_DUTY') add('OFF_DUTY', 'Off duty');
  if (rider.availability === 'ON_BREAK') add('ON_BREAK', 'On break');
  if (history.declined.has(rider.id)) add('DECLINED', 'Declined this job earlier');
  if (history.dropped.has(rider.id)) add('DROPPED', 'Accepted this job earlier, then dropped it');
  if (!rider.zones.includes(job.pickupZone)) add('PICKUP_ZONE', `Does not cover ${zone(job.pickupZone)} (pickup)`);
  if (job.dropZone !== job.pickupZone && !rider.zones.includes(job.dropZone)) {
    add('DROP_ZONE', `Does not cover ${zone(job.dropZone)} (drop)`);
  }
  const spare = rider.capacity - rider.reservedLoad;
  if (spare < job.load) add('CAPACITY', `Needs ${job.load} units free; has ${Math.max(0, spare)}`);
  if (rider.activeJobs >= rider.maxActiveJobs) add('JOB_LIMIT', `Already at job limit (${rider.activeJobs}/${rider.maxActiveJobs})`);

  return blockers.sort((a, b) => BLOCKER_ORDER.indexOf(a.code) - BLOCKER_ORDER.indexOf(b.code));
}

function scoreRider(rider, job, now, history) {
  const toPickup = travelMinutes(rider.currentZone, job.pickupZone);
  const etaMinutes = toPickup + HANDLING_MINUTES + travelMinutes(job.pickupZone, job.dropZone);
  const spareAfter = rider.capacity - rider.reservedLoad - job.load;

  let slack = null;
  if (job.deadline) {
    const minutesToDeadline = (new Date(job.deadline).getTime() - now.getTime()) / 60_000;
    slack = Math.round(minutesToDeadline - etaMinutes);
  }

  const parts = {
    travel: clamp01((MAX_TRAVEL - toPickup) / (MAX_TRAVEL - MIN_TRAVEL)),
    workload: clamp01(1 - rider.activeJobs / rider.maxActiveJobs),
    deadline: slack === null ? 1 : clamp01(slack / COMFORTABLE_SLACK_MINUTES),
    capacity: clamp01(spareAfter / rider.capacity),
  };
  const weights = job.priority === 'HIGH' || job.priority === 'URGENT' ? WEIGHTS.urgent : WEIGHTS.standard;
  const weighted = Object.keys(weights).reduce((sum, key) => sum + weights[key] * parts[key], 0);
  const missedBefore = history.noResponse.has(rider.id);
  const score = Math.max(0, Math.round(weighted * 100) - (missedBefore ? NO_RESPONSE_PENALTY : 0));

  const warnings = [];
  if (slack !== null && slack < 0) warnings.push(`May miss the deadline by about ${-slack} min`);
  if (missedBefore) warnings.push('Did not respond to this job earlier');

  return {
    riderId: rider.id,
    name: rider.name,
    score,
    travelToPickupMinutes: toPickup,
    etaMinutes,
    deadlineSlackMinutes: slack,
    activeJobs: rider.activeJobs,
    maxActiveJobs: rider.maxActiveJobs,
    capacity: rider.capacity,
    spareCapacityAfter: spareAfter,
    currentZone: rider.currentZone,
    breakdown: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 100)])),
    warnings,
    _weighted: Object.fromEntries(Object.keys(weights).map((k) => [k, weights[k] * parts[k] * 100])),
    _missedBefore: missedBefore,
  };
}

function reasonsFor(candidate, closestMinutes) {
  const reasons = [
    `${candidate.travelToPickupMinutes} min to pickup${candidate.travelToPickupMinutes === closestMinutes ? ' (closest)' : ''}`,
    candidate.activeJobs === 0
      ? 'No other jobs right now'
      : `Already has ${candidate.activeJobs} of ${candidate.maxActiveJobs} jobs`,
    `${candidate.spareCapacityAfter} of ${candidate.capacity} units free after this job`,
  ];
  if (candidate.deadlineSlackMinutes !== null && candidate.deadlineSlackMinutes >= 0) {
    reasons.push(`Can deliver about ${candidate.deadlineSlackMinutes} min before the deadline`);
  }
  return reasons;
}

/** One sentence: the biggest reason `a` ranks above `b`. */
function whyAbove(a, b) {
  if (b._missedBefore && !a._missedBefore) return `Ranked above ${b.name}, who did not respond to this job earlier`;

  const advantages = Object.keys(a._weighted).map((key) => ({ key, gain: a._weighted[key] - b._weighted[key] }));
  const best = advantages.sort((x, y) => y.gain - x.gain)[0];
  if (!best || best.gain <= 0.5) return `Ranked above ${b.name} by a narrow margin`;

  switch (best.key) {
    case 'travel':
      return `Ranked above ${b.name} mainly because they are closer to the pickup (${a.travelToPickupMinutes} vs ${b.travelToPickupMinutes} min)`;
    case 'workload':
      return `Ranked above ${b.name} mainly because they have fewer jobs right now (${a.activeJobs} vs ${b.activeJobs})`;
    case 'deadline':
      return `Ranked above ${b.name} mainly because they can reach the drop with more time to spare before the deadline`;
    default:
      return `Ranked above ${b.name} mainly because they have more room left after this job (${a.spareCapacityAfter} vs ${b.spareCapacityAfter} units)`;
  }
}

/**
 * @param {object} input
 * @param {{ pickupZone, dropZone, load, priority, deadline }} input.job
 * @param {Array<{ id, name, zones, availability, capacity, reservedLoad, maxActiveJobs, activeJobs, currentZone }>} input.riders
 * @param {Date} input.now
 * @param {{ declined?: Set<string>, dropped?: Set<string>, noResponse?: Set<string> }} [input.history]
 *        rider ids with earlier attempts on this job, by how they ended
 * @returns {{ recommended: object[], notEligible: object[] }}
 */
export function recommendRiders({ job, riders, now, history = {} }) {
  const past = {
    declined: history.declined ?? new Set(),
    dropped: history.dropped ?? new Set(),
    noResponse: history.noResponse ?? new Set(),
  };

  const notEligible = [];
  const candidates = [];
  for (const rider of riders) {
    const blockers = blockersFor(rider, job, past);
    if (blockers.length > 0) {
      notEligible.push({ riderId: rider.id, name: rider.name, reasons: blockers.map((b) => b.text), codes: blockers.map((b) => b.code) });
    } else {
      candidates.push(scoreRider(rider, job, now, past));
    }
  }

  // Highest score first; ties go to the closer rider, then fewer jobs, then name (stable and predictable).
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      a.travelToPickupMinutes - b.travelToPickupMinutes ||
      a.activeJobs - b.activeJobs ||
      a.name.localeCompare(b.name),
  );

  const closest = Math.min(...candidates.map((c) => c.travelToPickupMinutes));
  const recommended = candidates.map((candidate, index) => {
    const next = candidates[index + 1];
    const { _weighted, _missedBefore, ...visible } = candidate;
    return {
      ...visible,
      rank: index + 1,
      reasons: reasonsFor(candidate, closest),
      whyAboveNext: next ? whyAbove(candidate, next) : null,
    };
  });

  notEligible.sort((a, b) => a.name.localeCompare(b.name));
  return { recommended, notEligible };
}

/**
 * Short summary of why nobody can take a job, e.g.
 * "8 riders checked: 6 lack free capacity, 1 is on break, 1 is off duty".
 */
export function summariseNoEligibleRider(notEligible) {
  if (notEligible.length === 0) return 'No riders are registered yet';

  const labels = {
    OFF_DUTY: 'off duty',
    ON_BREAK: 'on break',
    DECLINED: 'declined it earlier',
    DROPPED: 'dropped it earlier',
    PICKUP_ZONE: 'do not cover the pickup zone',
    DROP_ZONE: 'do not cover the drop zone',
    CAPACITY: 'lack free capacity',
    JOB_LIMIT: 'are at their job limit',
  };
  const counts = new Map();
  for (const rider of notEligible) {
    const code = rider.codes[0];
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n} ${labels[code]}`);
  return `No rider can take this job right now. ${notEligible.length} checked: ${parts.join(', ')}`;
}
