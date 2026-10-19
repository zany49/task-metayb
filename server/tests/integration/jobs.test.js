import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { clock } from '../../src/common/clock.js';
import { withTransaction } from '../../src/db/transaction.js';
import { Job } from '../../src/models/job.model.js';
import { JobEvent } from '../../src/models/jobEvent.model.js';
import { changeJobStatus } from '../../src/services/job.service.js';
import { bearer, createDispatcher, login } from '../helpers/auth.js';
import { useTestDb } from '../helpers/db.js';
import { addRider, anyJobRider } from '../helpers/fixtures.js';

useTestDb();
const app = createApp();

const order = { orderRef: 'ORD-1001', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3, priority: 'HIGH' };
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

let priya; // dispatcher token
let arjun; // second dispatcher token

const createJob = (body, token = priya) => request(app).post('/api/jobs').set(bearer(token)).send(body);
const getJob = (ref, token = priya) => request(app).get(`/api/jobs/${ref}`).set(bearer(token));
const history = async (ref) => (await request(app).get(`/api/jobs/${ref}/events`).set(bearer(priya)).expect(200)).body;
const cancel = (ref, reason = 'Customer cancelled the order', token = priya) =>
  request(app).post(`/api/jobs/${ref}/cancel`).set(bearer(token)).send({ reason });

describe('Delivery jobs', () => {
  beforeEach(async () => {
    await createDispatcher({ name: 'Priya Raman', mobile: '9000000001' });
    await createDispatcher({ name: 'Arjun Mehta', mobile: '9000000002' });
    priya = await login(app, '9000000001');
    arjun = await login(app, '9000000002');
    // One rider who can take any of these jobs, so new jobs stay READY_FOR_ASSIGNMENT
    // (with nobody eligible, intake sends a job straight to the manual queue - see dispatch tests).
    await addRider(app, priya, anyJobRider);
  });

  afterEach(() => clock.reset());

  describe('creating a job', () => {
    it('creates the job, moves it to READY_FOR_ASSIGNMENT, and records both steps', async () => {
      const res = await createJob({ ...order, deadline: inMinutes(90), notes: 'Ring the bell' }).expect(201);
      expect(res.body).toMatchObject({
        orderRef: 'ORD-1001',
        status: 'READY_FOR_ASSIGNMENT',
        nextStatuses: ['AWAITING_CONFIRMATION', 'MANUAL_QUEUE', 'CANCELLED'],
        priority: 'HIGH',
        notes: 'Ring the bell',
        riderId: null,
        attemptCount: 0,
        version: 1,
        isOverdue: false,
        createdBy: { type: 'DISPATCHER', name: 'Priya Raman' },
      });

      const { events } = await history('ORD-1001');
      expect(events.map((e) => [e.type, e.actor.name, e.fromStatus, e.toStatus])).toEqual([
        ['JOB_CREATED', 'Priya Raman', null, 'NEW'],
        ['JOB_READY', 'System', 'NEW', 'READY_FOR_ASSIGNMENT'],
      ]);
      expect(events[0].message).toBe('Priya Raman created job ORD-1001');
    });

    it('a duplicate submission returns the existing job and does not create a second one', async () => {
      const first = await createJob(order).expect(201);
      const again = await createJob({ ...order, orderRef: 'ord-1001' }).expect(200); // same order, typed in lower case

      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
      expect(await Job.countDocuments()).toBe(1);

      const types = (await history('ORD-1001')).events.map((e) => e.type);
      expect(types).toEqual(['JOB_CREATED', 'JOB_READY', 'DUPLICATE_SUBMISSION_IGNORED']);
    });

    it('creates only one job when the same order arrives twice at the same moment', async () => {
      const results = await Promise.all([createJob(order), createJob(order, arjun)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0].body.id).toBe(results[1].body.id);
      expect(await Job.countDocuments()).toBe(1);
    });

    it('rejects the same order reference with different details', async () => {
      await createJob(order).expect(201);
      const res = await createJob({ ...order, load: 7 }).expect(409);

      expect(res.body.error.code).toBe('ORDER_REF_CONFLICT');
      expect(res.body.error.details.differences).toEqual([{ field: 'load', existing: 3, submitted: 7 }]);
      expect(await Job.countDocuments()).toBe(1);
    });

    it('a retry still returns the existing job after its deadline has passed', async () => {
      const withDeadline = { ...order, deadline: inMinutes(10) };
      const first = await createJob(withDeadline).expect(201);

      clock.advance(15 * 60_000);
      const retry = await createJob(withDeadline).expect(200);
      expect(retry.body.id).toBe(first.body.id);
    });

    it('opens a job whose order reference looks like an id', async () => {
      await createJob({ ...order, orderRef: '1234567890ABCDEF12345678' }).expect(201);
      expect((await getJob('1234567890abcdef12345678').expect(200)).body.orderRef).toBe('1234567890ABCDEF12345678');
    });

    it('rejects a deadline in the past and invalid input', async () => {
      const past = await createJob({ ...order, deadline: inMinutes(-5) }).expect(400);
      expect(past.body.error.code).toBe('DEADLINE_IN_PAST');

      const invalid = await createJob({ orderRef: 'ORD-1002', pickupZone: 'MOON', load: -1 }).expect(400);
      expect(invalid.body.error.details.map((d) => d.path)).toEqual(
        expect.arrayContaining(['pickupZone', 'dropZone', 'load']),
      );
      expect(await Job.countDocuments()).toBe(0);
    });
  });

  describe('viewing and searching', () => {
    beforeEach(async () => {
      await createJob({ orderRef: 'ORD-1001', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3, priority: 'NORMAL' }).expect(201);
      await createJob({ orderRef: 'ORD-1002', pickupZone: 'SOUTH', dropZone: 'CENTRAL', load: 5, priority: 'URGENT' }).expect(201);
      await createJob({ orderRef: 'ORD-2001', pickupZone: 'EAST', dropZone: 'EAST', load: 2, priority: 'LOW' }).expect(201);
      await cancel('ORD-2001').expect(200);
    });

    const list = async (query = '') => (await request(app).get(`/api/jobs${query}`).set(bearer(priya)).expect(200)).body;
    const refs = (body) => body.items.map((j) => j.orderRef);

    it('lists newest first with paging information', async () => {
      const body = await list();
      expect(refs(body)).toEqual(['ORD-2001', 'ORD-1002', 'ORD-1001']);
      expect(body).toMatchObject({ page: 1, limit: 20, total: 3, totalPages: 1 });

      const page2 = await list('?limit=2&page=2');
      expect(refs(page2)).toEqual(['ORD-1001']);
      expect(page2.totalPages).toBe(2);
    });

    it('filters by status, zone (pickup or drop), priority and order reference', async () => {
      expect(refs(await list('?status=READY_FOR_ASSIGNMENT'))).toEqual(['ORD-1002', 'ORD-1001']);
      expect(refs(await list('?status=cancelled'))).toEqual(['ORD-2001']);
      expect(refs(await list('?zone=CENTRAL'))).toEqual(['ORD-1002', 'ORD-1001']); // pickup and drop
      expect(refs(await list('?priority=URGENT'))).toEqual(['ORD-1002']);
      expect(refs(await list('?q=ord-10'))).toEqual(['ORD-1002', 'ORD-1001']);
      expect(refs(await list('?q=2001'))).toEqual(['ORD-2001']);
      expect((await list('?q=ORD-9')).total).toBe(0);
    });

    it('lists only open jobs past their deadline with overdue=true', async () => {
      await createJob({ orderRef: 'ORD-3001', pickupZone: 'WEST', dropZone: 'WEST', load: 1, deadline: inMinutes(20) }).expect(201);
      await createJob({ orderRef: 'ORD-3002', pickupZone: 'WEST', dropZone: 'WEST', load: 1, deadline: inMinutes(20) }).expect(201);
      await createJob({ orderRef: 'ORD-3003', pickupZone: 'WEST', dropZone: 'WEST', load: 1, deadline: inMinutes(300) }).expect(201);
      await cancel('ORD-3002').expect(200);

      clock.advance(30 * 60_000);
      expect(refs(await list('?overdue=true'))).toEqual(['ORD-3001']);
    });

    it('sorts by priority, most urgent first', async () => {
      expect(refs(await list('?sort=priority'))).toEqual(['ORD-1002', 'ORD-1001', 'ORD-2001']);
    });

    it('rejects invalid filters', async () => {
      await request(app).get('/api/jobs?status=LOST').set(bearer(priya)).expect(400);
      await request(app).get('/api/jobs?zone=MOON').set(bearer(priya)).expect(400);
    });

    it('opens a job by order reference or by id, and returns 404 for unknown jobs', async () => {
      const byRef = await getJob('ord-1002').expect(200);
      await getJob(byRef.body.id).expect(200);
      expect(byRef.body.orderRef).toBe('ORD-1002');

      expect((await getJob('ORD-9999').expect(404)).body.error.code).toBe('NOT_FOUND');
      await getJob('64b7f0c2a1b2c3d4e5f60718').expect(404);
    });
  });

  describe('cancelling and status rules', () => {
    it('cancels a job with a reason and records who did it', async () => {
      await createJob(order).expect(201);
      const res = await cancel('ORD-1001', 'Customer cancelled the order').expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer cancelled the order', nextStatuses: [] });

      const last = (await history('ORD-1001')).events.at(-1);
      expect(last).toMatchObject({
        type: 'JOB_CANCELLED',
        actor: { type: 'DISPATCHER', name: 'Priya Raman' },
        fromStatus: 'READY_FOR_ASSIGNMENT',
        toStatus: 'CANCELLED',
        details: { reason: 'Customer cancelled the order' },
      });
    });

    it('a cancelled job cannot be cancelled again or continue', async () => {
      await createJob(order).expect(201);
      await cancel('ORD-1001').expect(200);

      const again = await cancel('ORD-1001').expect(409);
      expect(again.body.error.code).toBe('INVALID_TRANSITION');

      const job = await Job.findOne({ orderRef: 'ORD-1001' });
      await expect(
        withTransaction((session) =>
          changeJobStatus(job, { to: 'READY_FOR_ASSIGNMENT', actor: { type: 'SYSTEM', id: 's', name: 'System' }, eventType: 'JOB_READY', message: 'x' }, session),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    });

    it('when two dispatchers cancel at the same time, exactly one succeeds', async () => {
      await createJob(order).expect(201);
      const results = await Promise.all([cancel('ORD-1001', 'Duplicate order', priya), cancel('ORD-1001', 'Wrong address', arjun)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await JobEvent.countDocuments({ type: 'JOB_CANCELLED' })).toBe(1);
    });

    it('refuses an invalid move (deliver before pickup) and changes nothing', async () => {
      await createJob(order).expect(201);
      const job = await Job.findOne({ orderRef: 'ORD-1001' });
      const eventsBefore = await JobEvent.countDocuments();

      await expect(
        withTransaction((session) =>
          changeJobStatus(job, { to: 'DELIVERED', actor: { type: 'SYSTEM', id: 's', name: 'System' }, eventType: 'JOB_DELIVERED', message: 'x' }, session),
        ),
      ).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });

      expect((await Job.findById(job._id)).status).toBe('READY_FOR_ASSIGNMENT');
      expect(await JobEvent.countDocuments()).toBe(eventsBefore);
    });

    it('refuses an update based on an out-of-date copy of the job', async () => {
      await createJob(order).expect(201);
      const stale = await Job.findOne({ orderRef: 'ORD-1001' });
      await cancel('ORD-1001').expect(200); // someone else changes the job

      await expect(
        withTransaction((session) =>
          changeJobStatus(stale, { to: 'MANUAL_QUEUE', actor: { type: 'SYSTEM', id: 's', name: 'System' }, eventType: 'MOVED_TO_MANUAL_QUEUE', message: 'x' }, session),
        ),
      ).rejects.toMatchObject({ code: 'JOB_CHANGED' });
      expect((await Job.findById(stale._id)).status).toBe('CANCELLED');
    });
  });

  describe('history and time', () => {
    it('uses the app clock, so simulated time shows up in the job and its history', async () => {
      await createJob({ ...order, deadline: inMinutes(60) }).expect(201);

      clock.advance(90 * 60_000); // 90 minutes later: past the deadline
      const late = await getJob('ORD-1001').expect(200);
      expect(late.body).toMatchObject({ isOverdue: true, minutesInStatus: 90 });

      await cancel('ORD-1001').expect(200);
      const [created, , cancelled] = (await history('ORD-1001')).events;
      const minutesApart = (new Date(cancelled.at) - new Date(created.at)) / 60_000;
      expect(Math.round(minutesApart)).toBe(90);
    });

    it('history is append-only', async () => {
      await createJob(order).expect(201);
      await expect(JobEvent.updateOne({}, { $set: { message: 'rewritten' } })).rejects.toThrow('append-only');
    });
  });

  describe('access', () => {
    it('riders cannot create, list, cancel or open jobs that are not theirs', async () => {
      await request(app)
        .post('/api/riders')
        .set(bearer(priya))
        .send({ name: 'Ravi Kumar', mobile: '9100000001', zones: ['CENTRAL'], capacity: 10, currentZone: 'CENTRAL' })
        .expect(201);
      const ravi = await login(app, '9100000001');
      await createJob(order).expect(201);

      await createJob({ ...order, orderRef: 'ORD-1002' }, ravi).expect(403);
      await request(app).get('/api/jobs').set(bearer(ravi)).expect(403);
      await cancel('ORD-1001', 'Not my job', ravi).expect(403);
      await getJob('ORD-1001', ravi).expect(403);
      await request(app).get('/api/jobs').expect(401);
    });
  });
});
