import { describe, expect, it } from 'vitest';
import { objectIdSchema } from '../../src/schemas/common.schemas.js';
import { CancelJobSchema, CreateJobSchema, JobRefParamsSchema, ListJobsQuerySchema } from '../../src/schemas/job.schemas.js';
import { jobFilter } from '../../src/services/jobCore.js';

const valid = { orderRef: 'ORD-1001', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3 };

describe('create job validation', () => {
  it('normalises the order reference and applies defaults', () => {
    expect(CreateJobSchema.parse({ ...valid, orderRef: '  ord-1001 ' })).toEqual({ ...valid, priority: 'NORMAL' });
  });

  it('accepts a deadline with a timezone and converts it to a date', () => {
    const { deadline } = CreateJobSchema.parse({ ...valid, deadline: '2026-12-01T10:00:00+05:30' });
    expect(deadline.toISOString()).toBe('2026-12-01T04:30:00.000Z');
  });

  it('rejects a deadline without a timezone or in a loose format', () => {
    for (const deadline of ['2026-12-01T10:00:00', '2026-12-01', 'tomorrow']) {
      expect(CreateJobSchema.safeParse({ ...valid, deadline }).success, deadline).toBe(false);
    }
  });

  it('reports every problem at once', () => {
    const result = CreateJobSchema.safeParse({ orderRef: 'a', pickupZone: 'MOON', load: 0, priority: 'ASAP' });
    const paths = result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['orderRef', 'pickupZone', 'dropZone', 'load', 'priority']));
  });

  it('rejects order references with spaces or symbols', () => {
    for (const orderRef of ['ORD 1001', 'ORD#1001', '../etc', '']) {
      expect(CreateJobSchema.safeParse({ ...valid, orderRef }).success, orderRef).toBe(false);
    }
  });
});

describe('list jobs query', () => {
  it('accepts several statuses, in any case, comma-separated or repeated', () => {
    expect(ListJobsQuerySchema.parse({ status: 'ready_for_assignment, MANUAL_QUEUE' }).status).toEqual([
      'READY_FOR_ASSIGNMENT',
      'MANUAL_QUEUE',
    ]);
    expect(ListJobsQuerySchema.parse({ status: ['ACCEPTED', 'PICKED_UP'] }).status).toEqual(['ACCEPTED', 'PICKED_UP']);
  });

  it('rejects unknown statuses and limits page size', () => {
    expect(ListJobsQuerySchema.safeParse({ status: 'LOST' }).success).toBe(false);
    expect(ListJobsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('defaults to newest first, page 1, 20 per page', () => {
    expect(ListJobsQuerySchema.parse({})).toEqual({ sort: 'newest', page: 1, limit: 20 });
  });
});

describe('other job inputs', () => {
  it('requires a cancellation reason', () => {
    expect(CancelJobSchema.safeParse({}).success).toBe(false);
    expect(CancelJobSchema.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(CancelJobSchema.parse({ reason: ' Customer cancelled ' })).toEqual({ reason: 'Customer cancelled' });
  });

  it('looks a URL value up as an id and as an order reference when it could be either', () => {
    expect(jobFilter('ORD-1001')).toEqual({ orderRef: 'ORD-1001' });
    expect(jobFilter('ord-1001')).toEqual({ orderRef: 'ORD-1001' });
    expect(jobFilter('64B7F0C2A1B2C3D4E5F60718')).toEqual({
      $or: [{ _id: '64b7f0c2a1b2c3d4e5f60718' }, { orderRef: '64B7F0C2A1B2C3D4E5F60718' }],
    });
  });

  it('normalises ids to lower case', () => {
    expect(objectIdSchema.parse('64B7F0C2A1B2C3D4E5F60718')).toBe('64b7f0c2a1b2c3d4e5f60718');
  });

  it('accepts a job id or an order reference in the URL', () => {
    expect(JobRefParamsSchema.safeParse({ jobRef: '64b7f0c2a1b2c3d4e5f60718' }).success).toBe(true);
    expect(JobRefParamsSchema.safeParse({ jobRef: 'ORD-1001' }).success).toBe(true);
    expect(JobRefParamsSchema.safeParse({ jobRef: 'ORD 1001' }).success).toBe(false);
  });
});
