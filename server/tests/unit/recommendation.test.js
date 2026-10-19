import { describe, expect, it } from 'vitest';
import { NO_RESPONSE_PENALTY, recommendRiders, summariseNoEligibleRider } from '../../src/domain/recommendation.js';

const now = new Date('2026-10-19T10:00:00Z');
const inMinutes = (m) => new Date(now.getTime() + m * 60_000);

const rider = (id, overrides = {}) => ({
  id,
  name: id,
  zones: ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST'],
  availability: 'AVAILABLE',
  capacity: 10,
  reservedLoad: 0,
  maxActiveJobs: 3,
  activeJobs: 0,
  currentZone: 'CENTRAL',
  ...overrides,
});

const job = (overrides = {}) => ({ pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3, priority: 'NORMAL', deadline: null, ...overrides });
const names = (list) => list.map((r) => r.name);

describe('rider eligibility', () => {
  it('excludes riders who are unavailable, lack capacity, are at their limit or do not cover the zones, with reasons', () => {
    const { recommended, notEligible } = recommendRiders({
      job: job({ load: 5 }),
      now,
      riders: [
        rider('ok'),
        rider('off', { availability: 'OFF_DUTY' }),
        rider('break', { availability: 'ON_BREAK' }),
        rider('full', { reservedLoad: 7 }),
        rider('busy', { activeJobs: 3 }),
        rider('south-only', { zones: ['SOUTH'] }),
        rider('no-drop', { zones: ['CENTRAL'] }),
      ],
    });

    expect(names(recommended)).toEqual(['ok']);
    const reasons = Object.fromEntries(notEligible.map((r) => [r.name, r.reasons]));
    expect(reasons).toEqual({
      off: ['Off duty'],
      break: ['On break'],
      full: ['Needs 5 units free; has 3'],
      busy: ['Already at job limit (3/3)'],
      'south-only': ['Does not cover Central (pickup)', 'Does not cover North (drop)'],
      'no-drop': ['Does not cover North (drop)'],
    });
  });

  it('a rider with exactly enough free capacity is eligible', () => {
    const { recommended } = recommendRiders({ job: job({ load: 4 }), now, riders: [rider('exact', { reservedLoad: 6 })] });
    expect(names(recommended)).toEqual(['exact']);
    expect(recommended[0].spareCapacityAfter).toBe(0);
  });

  it('excludes riders who declined or dropped this job, but only penalises one who did not respond', () => {
    const { recommended, notEligible } = recommendRiders({
      job: job(),
      now,
      riders: [rider('declined'), rider('dropped'), rider('slow'), rider('fresh')],
      history: { declined: new Set(['declined']), dropped: new Set(['dropped']), noResponse: new Set(['slow']) },
    });

    expect(names(notEligible)).toEqual(['declined', 'dropped']);
    expect(names(recommended)).toEqual(['fresh', 'slow']);
    expect(recommended[0].score - recommended[1].score).toBe(NO_RESPONSE_PENALTY);
    expect(recommended[1].warnings).toContain('Did not respond to this job earlier');
    expect(recommended[0].whyAboveNext).toBe('Ranked above slow, who did not respond to this job earlier');
  });

  it('returns nobody when no rider can take the job, and summarises why', () => {
    const { recommended, notEligible } = recommendRiders({
      job: job({ load: 20 }),
      now,
      riders: [rider('a'), rider('b'), rider('c', { availability: 'OFF_DUTY' })],
    });
    expect(recommended).toEqual([]);
    expect(summariseNoEligibleRider(notEligible)).toBe(
      'No rider can take this job right now. 3 checked: 2 lack free capacity, 1 off duty',
    );
    expect(summariseNoEligibleRider([])).toBe('No riders are registered yet');
  });
});

describe('rider ranking', () => {
  it('prefers the rider closest to the pickup and says so', () => {
    const { recommended } = recommendRiders({
      job: job({ pickupZone: 'EAST', dropZone: 'EAST' }),
      now,
      riders: [rider('far', { currentZone: 'WEST' }), rider('near', { currentZone: 'EAST' })],
    });
    expect(names(recommended)).toEqual(['near', 'far']);
    expect(recommended[0]).toMatchObject({ rank: 1, travelToPickupMinutes: 8 });
    expect(recommended[0].reasons[0]).toBe('8 min to pickup (closest)');
    expect(recommended[0].whyAboveNext).toBe('Ranked above far mainly because they are closer to the pickup (8 vs 25 min)');
    expect(recommended[1].whyAboveNext).toBeNull();
  });

  it('spreads work: with equal distance, the rider with fewer jobs ranks first', () => {
    const { recommended } = recommendRiders({
      job: job(),
      now,
      riders: [rider('busy', { activeJobs: 2, reservedLoad: 2 }), rider('free')],
    });
    expect(names(recommended)).toEqual(['free', 'busy']);
    expect(recommended[1].reasons).toContain('Already has 2 of 3 jobs');
  });

  it('for urgent jobs, distance outweighs workload', () => {
    const riders = [
      rider('near-busy', { currentZone: 'CENTRAL', activeJobs: 2 }),
      rider('far-free', { currentZone: 'SOUTH', activeJobs: 0 }),
    ];
    const normal = recommendRiders({ job: job({ priority: 'LOW' }), now, riders });
    const urgent = recommendRiders({ job: job({ priority: 'URGENT' }), now, riders });
    expect(names(normal.recommended)).toEqual(['far-free', 'near-busy']);
    expect(names(urgent.recommended)).toEqual(['near-busy', 'far-free']);
  });

  it('estimates delivery against the deadline and warns when it may be missed', () => {
    // CENTRAL -> NORTH: 8 min to pickup + 5 min handling + 15 min drive = 28 min
    const comfortable = recommendRiders({ job: job({ deadline: inMinutes(120) }), now, riders: [rider('r')] }).recommended[0];
    expect(comfortable).toMatchObject({ etaMinutes: 28, deadlineSlackMinutes: 92, warnings: [] });
    expect(comfortable.reasons).toContain('Can deliver about 92 min before the deadline');

    const tight = recommendRiders({ job: job({ deadline: inMinutes(20) }), now, riders: [rider('r')] }).recommended[0];
    expect(tight.deadlineSlackMinutes).toBe(-8);
    expect(tight.warnings).toEqual(['May miss the deadline by about 8 min']);
    expect(tight.breakdown.deadline).toBe(0);
  });

  it('scores stay between 0 and 100 and ties are broken predictably', () => {
    const { recommended } = recommendRiders({ job: job(), now, riders: [rider('b'), rider('a'), rider('c')] });
    expect(names(recommended)).toEqual(['a', 'b', 'c']);
    for (const r of recommended) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    expect(recommended[0].whyAboveNext).toBe('Ranked above b by a narrow margin');
  });

  it('does not leak internal scoring fields', () => {
    const [top] = recommendRiders({ job: job(), now, riders: [rider('a')] }).recommended;
    expect(Object.keys(top)).not.toContain('_weighted');
    expect(Object.keys(top)).not.toContain('_missedBefore');
  });
});
