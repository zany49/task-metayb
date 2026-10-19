import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { clock } from '../../src/common/clock.js';
import { bearer, createDispatcher, login } from '../helpers/auth.js';
import { useTestDb } from '../helpers/db.js';
import { addRider } from '../helpers/fixtures.js';

useTestDb();
const app = createApp();
let token;

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const summary = async () => (await request(app).get('/api/dashboard/summary').set(bearer(token)).expect(200)).body;

describe('Dashboard summary', () => {
  beforeEach(async () => {
    await createDispatcher();
    token = await login(app, '9000000001');
  });
  afterEach(() => clock.reset());

  it('lists every status with 0 when there are no jobs', async () => {
    const body = await summary();
    expect(body.jobs).toMatchObject({ total: 0, open: 0, overdue: 0, confirmationsDueSoon: 0 });
    expect(Object.values(body.jobs.byStatus).every((n) => n === 0)).toBe(true);
    expect(Object.keys(body.jobs.byStatus)).toHaveLength(8);
  });

  it('counts jobs per status, open jobs, overdue jobs and riders', async () => {
    await addRider(app, token, { name: 'Ravi Kumar', mobile: '9100000001', zones: ['CENTRAL', 'NORTH'], capacity: 5, currentZone: 'CENTRAL' });
    const create = (orderRef, extra = {}) =>
      request(app)
        .post('/api/jobs')
        .set(bearer(token))
        .send({ orderRef, pickupZone: 'CENTRAL', dropZone: 'NORTH', load: 2, ...extra })
        .expect(201);
    await create('ORD-1', { deadline: inMinutes(30) });
    await create('ORD-2');
    await create('ORD-3', { deadline: inMinutes(30) });
    await create('ORD-4', { pickupZone: 'WEST', dropZone: 'WEST' }); // nobody covers West
    await request(app).post('/api/jobs/ORD-3/cancel').set(bearer(token)).send({ reason: 'Customer cancelled' }).expect(200);

    clock.advance(45 * 60_000); // ORD-1 is now late; ORD-3 is cancelled so it does not count

    const body = await summary();
    expect(body.jobs).toMatchObject({ total: 4, open: 3, overdue: 1 });
    expect(body.jobs.byStatus).toMatchObject({ READY_FOR_ASSIGNMENT: 2, CANCELLED: 1, MANUAL_QUEUE: 1 });
    expect(body.riders).toEqual({ total: 1, byAvailability: { AVAILABLE: 1, ON_BREAK: 0, OFF_DUTY: 0 } });
  });

  it('counts riders whose time to confirm runs out within 15 minutes', async () => {
    const ravi = await addRider(app, token, { name: 'Ravi Kumar', mobile: '9100000001', zones: ['CENTRAL'], capacity: 5, currentZone: 'CENTRAL' });
    await request(app).post('/api/jobs').set(bearer(token)).send({ orderRef: 'ORD-1', pickupZone: 'CENTRAL', dropZone: 'CENTRAL', load: 1 }).expect(201);
    await request(app).post('/api/jobs/ORD-1/assignments').set(bearer(token)).send({ riderId: ravi.id }).expect(201);

    expect((await summary()).jobs.confirmationsDueSoon).toBe(0);
    clock.advance(110 * 60_000); // 10 minutes left of 120
    expect((await summary()).jobs.confirmationsDueSoon).toBe(1);
  });

  it('is only for dispatchers', async () => {
    await request(app).get('/api/dashboard/summary').expect(401);
  });
});
