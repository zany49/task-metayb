import { afterEach, describe, expect, it } from 'vitest';
import { clock } from '../../src/common/clock.js';

describe('app clock', () => {
  afterEach(() => clock.reset());

  it('follows real time by default', () => {
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(50);
    expect(clock.offsetMs()).toBe(0);
  });

  it('can be moved forward (e.g. to trigger a 2-hour timeout) and reset', () => {
    const twoHours = 2 * 60 * 60 * 1000;
    clock.advance(twoHours);
    expect(clock.offsetMs()).toBe(twoHours);
    expect(clock.now().getTime() - Date.now()).toBeGreaterThanOrEqual(twoHours - 50);

    clock.reset();
    expect(clock.offsetMs()).toBe(0);
  });

  it('never moves backwards', () => {
    expect(() => clock.advance(-1000)).toThrow();
    expect(() => clock.advance(Number.NaN)).toThrow();
  });
});
