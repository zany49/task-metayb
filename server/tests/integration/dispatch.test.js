/**
 * The dispatch workflow end to end, through the HTTP API.
 * Covers the assignment's required scenarios (marked [1]-[8]) plus the race conditions.
 */
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { clock } from '../../src/common/clock.js';
import { Assignment } from '../../src/models/assignment.model.js';
import { JobEvent } from '../../src/models/jobEvent.model.js';
import { Rider } from '../../src/models/rider.model.js';
import { expireOverdueAssignments } from '../../src/services/dispatch.service.js';
import { bearer, createDispatcher, login } from '../helpers/auth.js';
import { useTestDb } from '../helpers/db.js';
import { addRider, createJob } from '../helpers/fixtures.js';

useTestDb();
const app = createApp();
const MINUTE = 60_000;

let priya; // dispatcher token
let arjun; // second dispatcher token
let ravi; // rider (closest to the pickup)
let karthik; // rider (further away)
let vijay; // rider, off duty
let farhan; // rider, too little capacity

const order = { orderRef: 'ORD-1', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 3 };

const api = (token) => ({
  get: (url) => request(app).get(url).set(bearer(token)),
  post: (url, body = {}) => request(app).post(url).set(bearer(token)).send(body),
  patch: (url, body = {}) => request(app).patch(url).set(bearer(token)).send(body),
});

const recommendations = async (ref = 'ORD-1') => (await api(priya).get(`/api/jobs/${ref}/recommendations`).expect(200)).body;
const job = async (ref = 'ORD-1') => (await api(priya).get(`/api/jobs/${ref}`).expect(200)).body;
const events = async (ref = 'ORD-1') => (await api(priya).get(`/api/jobs/${ref}/events`).expect(200)).body.events;
const attempts = async (ref = 'ORD-1') => (await api(priya).get(`/api/jobs/${ref}/assignments`).expect(200)).body.items;
const riderDoc = (rider) => Rider.findById(rider.id).lean();
const assign = (riderId, extra = {}, token = priya, ref = 'ORD-1') => api(token).post(`/api/jobs/${ref}/assignments`, { riderId, ...extra });

describe('Dispatch workflow', () => {
  beforeEach(async () => {
    await createDispatcher({ name: 'Priya Raman', mobile: '9000000001' });
    await createDispatcher({ name: 'Arjun Mehta', mobile: '9000000002' });
    priya = await login(app, '9000000001');
    arjun = await login(app, '9000000002');

    ravi = await addRider(app, priya, { name: 'Ravi Kumar', mobile: '9100000001', zones: ['CENTRAL', 'NORTH'], capacity: 10, currentZone: 'CENTRAL' });
    karthik = await addRider(app, priya, { name: 'Karthik Srinivasan', mobile: '9100000002', zones: ['CENTRAL', 'NORTH', 'SOUTH'], capacity: 8, currentZone: 'SOUTH' });
    vijay = await addRider(app, priya, { name: 'Vijay Anand', mobile: '9100000006', zones: ['CENTRAL', 'NORTH'], capacity: 15, currentZone: 'CENTRAL', availability: 'OFF_DUTY' });
    farhan = await addRider(app, priya, { name: 'Farhan Ali', mobile: '9100000007', zones: ['CENTRAL', 'NORTH'], capacity: 2, currentZone: 'CENTRAL' });

    await createJob(app, priya, order);
  });

  afterEach(() => clock.reset());

  describe('recommendation and assignment', () => {
    it('[2] recommends only eligible riders, best first, and says why the others are excluded', async () => {
      const body = await recommendations();

      expect(body.recommended.map((r) => r.name)).toEqual(['Ravi Kumar', 'Karthik Srinivasan']);
      expect(body.recommended[0]).toMatchObject({ rank: 1, travelToPickupMinutes: 8 });
      expect(body.recommended[0].whyAboveNext).toContain('closer to the pickup');

      const excluded = Object.fromEntries(body.notEligible.map((r) => [r.name, r.reasons]));
      expect(excluded).toEqual({ 'Farhan Ali': ['Needs 3 units free; has 2'], 'Vijay Anand': ['Off duty'] });
    });

    it('[1] assigns an eligible rider: the job waits for confirmation and the load is reserved', async () => {
      const res = await assign(ravi.id).expect(201);

      expect(res.body.job).toMatchObject({ status: 'AWAITING_CONFIRMATION', riderId: ravi.id, riderName: 'Ravi Kumar', attemptCount: 1 });
      expect(res.body.assignment).toMatchObject({ status: 'PENDING', active: true, attempt: 1, load: 3, timeoutMinutes: 120, isOverride: false });
      const minutesToConfirm = (new Date(res.body.assignment.expiresAt) - new Date(res.body.assignment.assignedAt)) / MINUTE;
      expect(minutesToConfirm).toBe(120);
      expect(res.body.job.confirmationDueAt).toBe(res.body.assignment.expiresAt);

      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 });

      const last = (await events()).at(-1);
      expect(last).toMatchObject({
        type: 'RIDER_ASSIGNED',
        actor: { type: 'DISPATCHER', name: 'Priya Raman' },
        fromStatus: 'READY_FOR_ASSIGNMENT',
        toStatus: 'AWAITING_CONFIRMATION',
        details: { rank: 1, isOverride: false },
      });
    });

    it('choosing someone other than the top rider needs a reason, which is recorded', async () => {
      const missing = await assign(karthik.id).expect(422);
      expect(missing.body.error).toMatchObject({ code: 'OVERRIDE_REASON_REQUIRED', details: { recommendedRiderName: 'Ravi Kumar' } });

      const res = await assign(karthik.id, { overrideReason: 'Ravi is stuck in traffic' }).expect(201);
      expect(res.body.assignment).toMatchObject({ isOverride: true, overrideReason: 'Ravi is stuck in traffic', recommendation: { rank: 2 } });
      expect((await events()).at(-1).message).toContain('instead of the recommended Ravi Kumar: Ravi is stuck in traffic');
    });

    it('accepts a rider id typed in upper case', async () => {
      await assign(ravi.id.toUpperCase()).expect(201);
    });

    it('refuses a rider who is not eligible and explains why', async () => {
      const res = await assign(vijay.id, { overrideReason: 'Please take it' }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'RIDER_NOT_ELIGIBLE', details: { reasons: ['Off duty'] } });
      expect(await riderDoc(vijay)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
    });

    it('[3] a job nobody can take goes to the manual queue, unassigned, until a rider can take it', async () => {
      const big = await createJob(app, priya, { orderRef: 'ORD-BIG', pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 50 });
      expect(big).toMatchObject({ status: 'MANUAL_QUEUE', riderId: null, manualQueueReason: { code: 'NO_ELIGIBLE_RIDER' } });
      expect(big.manualQueueReason.message).toContain('No rider can take this job right now');
      expect((await recommendations('ORD-BIG')).recommended).toEqual([]);

      // A dispatcher makes room: Ravi now has a bigger vehicle.
      await api(priya).patch(`/api/riders/${ravi.id}`, { capacity: 60 }).expect(200);
      expect((await recommendations('ORD-BIG')).recommended.map((r) => r.name)).toEqual(['Ravi Kumar']);
      const res = await assign(ravi.id, {}, priya, 'ORD-BIG').expect(201);
      expect(res.body.job).toMatchObject({ status: 'AWAITING_CONFIRMATION', manualQueueReason: null });
    });
  });

  describe('rider confirmation and delivery', () => {
    it('[4] a rider who accepts goes through pickup and delivery; the load is released at the end', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const riderToken = await login(app, '9100000001');

      const accepted = await api(riderToken).post(`/api/assignments/${assignment.id}/accept`).expect(200);
      expect(accepted.body.job.status).toBe('ACCEPTED');

      // [8] cannot deliver before pickup
      const early = await api(riderToken).post('/api/jobs/ORD-1/deliver').expect(409);
      expect(early.body.error.code).toBe('INVALID_TRANSITION');

      await api(riderToken).post('/api/jobs/ORD-1/pickup').expect(200);
      const delivered = await api(riderToken).post('/api/jobs/ORD-1/deliver').expect(200);
      expect(delivered.body).toMatchObject({ status: 'DELIVERED', riderName: 'Ravi Kumar', nextStatuses: [] });

      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0, currentZone: 'NORTH' });
      expect((await attempts())[0]).toMatchObject({ status: 'COMPLETED', active: false });
      expect((await events()).map((e) => e.type)).toEqual([
        'JOB_CREATED',
        'JOB_READY',
        'RIDER_ASSIGNED',
        'ASSIGNMENT_ACCEPTED',
        'JOB_PICKED_UP',
        'JOB_DELIVERED',
      ]);
    });

    it('a dispatcher can record the rider\'s answer on their behalf', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      await api(arjun).post(`/api/assignments/${assignment.id}/accept`).expect(200);
      expect((await events()).at(-1)).toMatchObject({
        type: 'ASSIGNMENT_ACCEPTED',
        actor: { type: 'DISPATCHER', name: 'Arjun Mehta' },
        message: 'Arjun Mehta recorded that Ravi Kumar accepted the job',
      });
    });

    it('riders can only answer their own assignments', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const karthikToken = await login(app, '9100000002');
      await api(karthikToken).post(`/api/assignments/${assignment.id}/accept`).expect(403);
      await api(karthikToken).get('/api/jobs/ORD-1').expect(403);
    });

    it('a rider who declines sends the job to the manual queue and is not recommended for it again', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const riderToken = await login(app, '9100000001');

      await api(riderToken).post(`/api/assignments/${assignment.id}/reject`, {}).expect(400); // reason required
      const res = await api(riderToken).post(`/api/assignments/${assignment.id}/reject`, { reason: 'Bike has a flat tyre' }).expect(200);

      expect(res.body.job).toMatchObject({ status: 'MANUAL_QUEUE', riderId: null, manualQueueReason: { code: 'RIDER_REJECTED' } });
      expect(res.body.assignment).toMatchObject({ status: 'REJECTED', active: false });
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });

      const body = await recommendations();
      expect(body.recommended.map((r) => r.name)).toEqual(['Karthik Srinivasan']);
      expect(body.notEligible.find((r) => r.name === 'Ravi Kumar').reasons).toEqual(['Declined this job earlier']);
    });
  });

  describe('confirmation timeout and the manual queue', () => {
    it('[5] an assignment not confirmed within the threshold moves the job to the manual queue', async () => {
      await assign(ravi.id).expect(201);

      clock.advance(119 * MINUTE);
      expect(await expireOverdueAssignments()).toEqual({ checked: 0, expired: 0 });
      expect((await job()).status).toBe('AWAITING_CONFIRMATION');

      clock.advance(2 * MINUTE);
      expect(await expireOverdueAssignments()).toEqual({ checked: 1, expired: 1 });

      const j = await job();
      expect(j).toMatchObject({ status: 'MANUAL_QUEUE', riderId: null, currentAssignmentId: null, confirmationDueAt: null });
      expect(j.manualQueueReason).toMatchObject({ code: 'CONFIRMATION_TIMEOUT', message: 'Ravi Kumar did not confirm within 120 minutes' });
    });

    it('[6] a timed-out assignment releases capacity, keeps its history, and the job can be reassigned', async () => {
      await assign(ravi.id).expect(201);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 });

      clock.advance(121 * MINUTE);
      await expireOverdueAssignments();

      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
      expect(await attempts()).toMatchObject([{ status: 'EXPIRED', active: false, riderName: 'Ravi Kumar', endReason: { code: 'CONFIRMATION_TIMEOUT' } }]);
      const history = await events();
      expect(history.slice(-2)).toMatchObject([
        { type: 'ASSIGNMENT_EXPIRED', actor: { type: 'SYSTEM' } },
        { type: 'MOVED_TO_MANUAL_QUEUE', actor: { type: 'SYSTEM' }, fromStatus: 'AWAITING_CONFIRMATION', toStatus: 'MANUAL_QUEUE' },
      ]);

      // Ravi is still eligible, but ranked lower for not responding.
      const body = await recommendations();
      expect(body.recommended.map((r) => r.name)).toEqual(['Karthik Srinivasan', 'Ravi Kumar']);
      expect(body.recommended[1].warnings).toContain('Did not respond to this job earlier');

      const res = await assign(karthik.id).expect(201);
      expect(res.body.job).toMatchObject({ status: 'AWAITING_CONFIRMATION', attemptCount: 2, riderName: 'Karthik Srinivasan' });
      expect((await events()).at(-1).type).toBe('RIDER_REASSIGNED');
      expect((await attempts()).map((a) => a.status)).toEqual(['EXPIRED', 'PENDING']);
    });

    it('accepting after the time is up is refused and the job moves to the manual queue', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      clock.advance(121 * MINUTE); // the sweeper has not run yet

      const riderToken = await login(app, '9100000001');
      const res = await api(riderToken).post(`/api/assignments/${assignment.id}/accept`).expect(409);
      expect(res.body.error.code).toBe('ASSIGNMENT_EXPIRED');
      expect((await job()).status).toBe('MANUAL_QUEUE');
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
    });

    it('cancelling after the time to confirm ran out records the missed confirmation first', async () => {
      await assign(ravi.id).expect(201);
      clock.advance(121 * MINUTE); // the sweeper has not run yet

      await api(priya).post('/api/jobs/ORD-1/cancel', { reason: 'Customer cancelled' }).expect(200);
      expect((await attempts()).map((a) => a.status)).toEqual(['EXPIRED']);
      expect((await events()).slice(-3).map((e) => e.type)).toEqual(['ASSIGNMENT_EXPIRED', 'MOVED_TO_MANUAL_QUEUE', 'JOB_CANCELLED']);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
    });

    it('taking a job back after the time to confirm ran out reports the timeout instead', async () => {
      await assign(ravi.id).expect(201);
      clock.advance(121 * MINUTE);

      const res = await api(priya).post('/api/jobs/ORD-1/unassign', { reason: 'Rider not answering' }).expect(409);
      expect(res.body.error.code).toBe('ASSIGNMENT_EXPIRED');
      expect(await job()).toMatchObject({ status: 'MANUAL_QUEUE', manualQueueReason: { code: 'CONFIRMATION_TIMEOUT' } });
    });

    it('the confirmation timeout can be changed; it applies to new assignments', async () => {
      const settings = await api(priya).patch('/api/settings', { confirmationTimeoutMinutes: 5 }).expect(200);
      expect(settings.body.confirmationTimeoutMinutes).toBe(5);

      const { assignment } = (await assign(ravi.id).expect(201)).body;
      expect(assignment.timeoutMinutes).toBe(5);

      clock.advance(6 * MINUTE);
      expect((await expireOverdueAssignments()).expired).toBe(1);
      expect((await job()).manualQueueReason.message).toBe('Ravi Kumar did not confirm within 5 minutes');
    });

    it('the demo clock moves time forward and runs the timeout check straight away', async () => {
      await assign(ravi.id).expect(201);
      const res = await api(priya).post('/api/simulation/clock/advance', { minutes: 121 }).expect(200);
      expect(res.body).toMatchObject({ offsetMinutes: 121, expired: 1 });
      expect((await job()).status).toBe('MANUAL_QUEUE');

      await api(priya).post('/api/simulation/clock/reset').expect(200);
      expect((await api(priya).get('/api/simulation/clock').expect(200)).body.offsetMinutes).toBe(0);
    });
  });

  describe('taking a job back and cancelling', () => {
    it('a dispatcher can take a job back; a rider can drop a job they accepted', async () => {
      await assign(ravi.id).expect(201);
      const withdrawn = await api(priya).post('/api/jobs/ORD-1/unassign', { reason: 'Customer asked for a later slot' }).expect(200);
      expect(withdrawn.body).toMatchObject({ status: 'MANUAL_QUEUE', manualQueueReason: { code: 'WITHDRAWN' } });
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
      expect((await recommendations()).recommended[0].name).toBe('Ravi Kumar'); // not Ravi's fault: no penalty

      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const riderToken = await login(app, '9100000001');
      await api(riderToken).post(`/api/assignments/${assignment.id}/accept`).expect(200);
      const dropped = await api(riderToken).post('/api/jobs/ORD-1/unassign', { reason: 'Vehicle broke down' }).expect(200);
      expect(dropped.body.manualQueueReason.code).toBe('RIDER_RELEASED');
      expect((await recommendations()).notEligible.find((r) => r.name === 'Ravi Kumar').reasons).toEqual([
        'Accepted this job earlier, then dropped it',
      ]);
    });

    it('cancelling a job a rider holds ends the assignment and releases the load; not possible after pickup', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      await api(priya).post(`/api/assignments/${assignment.id}/accept`).expect(200);

      await api(priya).post('/api/jobs/ORD-1/cancel', { reason: 'Customer cancelled' }).expect(200);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 });
      expect((await attempts())[0]).toMatchObject({ status: 'CANCELLED', active: false });

      await createJob(app, priya, { ...order, orderRef: 'ORD-2' });
      const second = (await assign(ravi.id, {}, priya, 'ORD-2').expect(201)).body.assignment;
      await api(priya).post(`/api/assignments/${second.id}/accept`).expect(200);
      await api(priya).post('/api/jobs/ORD-2/pickup').expect(200);
      const late = await api(priya).post('/api/jobs/ORD-2/cancel', { reason: 'Too late' }).expect(409);
      expect(late.body.error.code).toBe('INVALID_TRANSITION');
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 }); // nothing half-done
    });

    it('shows a rider their offers and jobs in progress', async () => {
      await assign(ravi.id).expect(201);
      const riderToken = await login(app, '9100000001');
      const res = await api(riderToken).get('/api/assignments/mine').expect(200);
      expect(res.body.live).toMatchObject([{ assignment: { status: 'PENDING' }, job: { orderRef: 'ORD-1', status: 'AWAITING_CONFIRMATION' } }]);
      expect(res.body.recent).toEqual([]);
    });
  });

  describe('[8] conflicting actions', () => {
    it('two dispatchers assigning the same job at once: exactly one succeeds', async () => {
      const results = await Promise.all([assign(ravi.id, {}, priya), assign(ravi.id, {}, arjun)]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await Assignment.countDocuments({ active: true })).toBe(1);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 }); // reserved once
      expect(await JobEvent.countDocuments({ type: { $in: ['RIDER_ASSIGNED', 'RIDER_REASSIGNED'] } })).toBe(1);
    });

    it('two jobs competing for a rider\'s last free capacity: only one gets it', async () => {
      await api(priya).patch(`/api/riders/${ravi.id}`, { capacity: 4 }).expect(200);
      await api(priya).patch(`/api/riders/${karthik.id}/availability`, { availability: 'OFF_DUTY' }).expect(200);
      await createJob(app, priya, { ...order, orderRef: 'ORD-2' });

      const results = await Promise.all([assign(ravi.id, {}, priya, 'ORD-1'), assign(ravi.id, {}, arjun, 'ORD-2')]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.find((r) => r.status !== 201).status).toBeOneOf([409, 422]);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 });
    });

    it('a rider accepting while the timeout check runs: the attempt is expired exactly once', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const riderToken = await login(app, '9100000001');
      clock.advance(121 * MINUTE);

      await Promise.all([api(riderToken).post(`/api/assignments/${assignment.id}/accept`), expireOverdueAssignments(), expireOverdueAssignments()]);

      expect((await job()).status).toBe('MANUAL_QUEUE');
      expect(await JobEvent.countDocuments({ type: 'ASSIGNMENT_EXPIRED' })).toBe(1);
      expect(await JobEvent.countDocuments({ type: 'ASSIGNMENT_ACCEPTED' })).toBe(0);
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 0, activeJobs: 0 }); // released once, not twice
    });

    it('a rider accepting just in time wins over the timeout check', async () => {
      const { assignment } = (await assign(ravi.id).expect(201)).body;
      const riderToken = await login(app, '9100000001');
      clock.advance(119 * MINUTE);

      const [accepted] = await Promise.all([api(riderToken).post(`/api/assignments/${assignment.id}/accept`), expireOverdueAssignments()]);
      expect(accepted.status).toBe(200);
      expect((await job()).status).toBe('ACCEPTED');
      expect(await riderDoc(ravi)).toMatchObject({ reservedLoad: 3, activeJobs: 1 });
    });

    it('assigning a job that is already assigned is refused with a clear message', async () => {
      await assign(ravi.id).expect(201);
      const res = await assign(karthik.id, { overrideReason: 'Second try' }, arjun).expect(409);
      expect(res.body.error).toMatchObject({ code: 'JOB_NOT_ASSIGNABLE' });
      expect(res.body.error.message).toBe('ORD-1 is already assigned to Ravi Kumar and waiting for their confirmation.');
    });
  });
});
