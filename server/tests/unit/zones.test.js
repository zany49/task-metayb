import { describe, expect, it } from 'vitest';
import { travelMinutes, ZONES } from '../../src/domain/zones.js';

describe('travel-time matrix', () => {
  it('has a positive travel time for every pair of zones', () => {
    for (const from of ZONES) for (const to of ZONES) expect(travelMinutes(from, to)).toBeGreaterThan(0);
  });

  it('is symmetric (A to B takes as long as B to A)', () => {
    for (const from of ZONES) for (const to of ZONES) expect(travelMinutes(from, to)).toBe(travelMinutes(to, from));
  });

  it('is quickest within the same zone', () => {
    for (const from of ZONES) {
      const sameZone = travelMinutes(from, from);
      for (const to of ZONES) if (to !== from) expect(travelMinutes(from, to)).toBeGreaterThan(sameZone);
    }
  });
});
