import { describe, expect, it } from 'vitest';
import { riderWorkload } from '../../src/domain/rider.js';

const base = { availability: 'AVAILABLE', capacity: 10, reservedLoad: 4, maxActiveJobs: 3, activeJobs: 1 };

describe('riderWorkload', () => {
  it('an available rider with spare capacity and free job slots can take more jobs', () => {
    expect(riderWorkload(base)).toEqual({ spareCapacity: 6, slotsLeft: 2, canTakeMoreJobs: true, blockers: [] });
  });

  it('is blocked when off duty or on break', () => {
    expect(riderWorkload({ ...base, availability: 'OFF_DUTY' })).toMatchObject({
      canTakeMoreJobs: false,
      blockers: ['Rider is off duty'],
    });
    expect(riderWorkload({ ...base, availability: 'ON_BREAK' }).blockers).toEqual(['Rider is on break']);
  });

  it('is blocked at the job limit', () => {
    const w = riderWorkload({ ...base, activeJobs: 3 });
    expect(w.slotsLeft).toBe(0);
    expect(w.blockers).toEqual(['At job limit (3/3 active jobs)']);
  });

  it('is blocked when capacity is fully reserved, and lists every blocker', () => {
    const w = riderWorkload({ ...base, availability: 'OFF_DUTY', reservedLoad: 10, activeJobs: 3 });
    expect(w.spareCapacity).toBe(0);
    expect(w.blockers).toHaveLength(3);
    expect(w.canTakeMoreJobs).toBe(false);
  });
});
