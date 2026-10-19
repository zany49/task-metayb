import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/common/errors.js';
import {
  allowedNextStatuses,
  assertTransition,
  canTransition,
  isFinal,
  JOB_STATUSES,
  transitionMap,
} from '../../src/domain/jobLifecycle.js';

function transitionError(from, to) {
  try {
    assertTransition(from, to);
  } catch (err) {
    return err;
  }
  return undefined;
}

describe('job lifecycle (state machine)', () => {
  it('allows the normal delivery path', () => {
    const path = ['NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'PICKED_UP', 'DELIVERED'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`).toBe(true);
    }
  });

  it('allows the Manual Queue paths: timeout/reject, no eligible rider, rider drop-out, then reassignment', () => {
    expect(canTransition('AWAITING_CONFIRMATION', 'MANUAL_QUEUE')).toBe(true);
    expect(canTransition('READY_FOR_ASSIGNMENT', 'MANUAL_QUEUE')).toBe(true);
    expect(canTransition('ACCEPTED', 'MANUAL_QUEUE')).toBe(true);
    expect(canTransition('MANUAL_QUEUE', 'AWAITING_CONFIRMATION')).toBe(true);
  });

  it('does not allow delivering before pickup', () => {
    for (const from of ['NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'MANUAL_QUEUE']) {
      expect(canTransition(from, 'DELIVERED'), from).toBe(false);
    }
  });

  it('does not allow pickup before the rider accepted', () => {
    expect(canTransition('AWAITING_CONFIRMATION', 'PICKED_UP')).toBe(false);
    expect(canTransition('READY_FOR_ASSIGNMENT', 'PICKED_UP')).toBe(false);
  });

  it('allows cancelling before pickup, but not after', () => {
    for (const from of ['NEW', 'READY_FOR_ASSIGNMENT', 'AWAITING_CONFIRMATION', 'ACCEPTED', 'MANUAL_QUEUE']) {
      expect(canTransition(from, 'CANCELLED'), from).toBe(true);
    }
    expect(canTransition('PICKED_UP', 'CANCELLED')).toBe(false);
  });

  it('treats DELIVERED and CANCELLED as final', () => {
    expect(isFinal('DELIVERED')).toBe(true);
    expect(isFinal('CANCELLED')).toBe(true);
    for (const to of JOB_STATUSES) {
      expect(canTransition('CANCELLED', to)).toBe(false);
      expect(canTransition('DELIVERED', to)).toBe(false);
    }
  });

  it('every status can be reached from NEW', () => {
    const reached = new Set(['NEW']);
    const queue = ['NEW'];
    while (queue.length) {
      for (const next of allowedNextStatuses(queue.shift())) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
    expect([...reached].sort()).toEqual([...JOB_STATUSES].sort());
  });

  it('the transition map only mentions known statuses', () => {
    const map = transitionMap();
    expect(Object.keys(map).sort()).toEqual([...JOB_STATUSES].sort());
    for (const targets of Object.values(map)) for (const t of targets) expect(JOB_STATUSES).toContain(t);
  });

  it('explains an invalid move with a 409 INVALID_TRANSITION error', () => {
    const err = transitionError('ACCEPTED', 'DELIVERED');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
    expect(err.message).toContain('from ACCEPTED the job can only move to PICKED_UP, MANUAL_QUEUE, CANCELLED');
    expect(err.details).toEqual({ from: 'ACCEPTED', to: 'DELIVERED', allowed: ['PICKED_UP', 'MANUAL_QUEUE', 'CANCELLED'] });

    expect(transitionError('CANCELLED', 'READY_FOR_ASSIGNMENT').message).toContain('already CANCELLED');
    expect(transitionError('NEW', 'READY_FOR_ASSIGNMENT')).toBeUndefined();
  });
});
