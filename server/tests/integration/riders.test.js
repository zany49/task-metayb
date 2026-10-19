import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { Rider } from '../../src/models/rider.model.js';
import { User } from '../../src/models/user.model.js';
import { bearer, createDispatcher, login } from '../helpers/auth.js';
import { useTestDb } from '../helpers/db.js';

useTestDb();
const app = createApp();

const ravi = {
  name: 'Ravi Kumar',
  mobile: '9100000001',
  zones: ['CENTRAL', 'NORTH'],
  capacity: 10,
  maxActiveJobs: 3,
  currentZone: 'CENTRAL',
};
const karthik = {
  name: 'Karthik Srinivasan',
  mobile: '9100000002',
  zones: ['SOUTH', 'EAST'],
  capacity: 8,
  currentZone: 'SOUTH',
  availability: 'OFF_DUTY',
};

let dispatcherToken;

function addRider(body) {
  return request(app).post('/api/riders').set(bearer(dispatcherToken)).send(body);
}

describe('Rider management', () => {
  beforeEach(async () => {
    await createDispatcher();
    dispatcherToken = await login(app, '9000000001');
  });

  it('dispatcher adds a rider, who can then log in with mobile + OTP', async () => {
    const created = await addRider(ravi).expect(201);
    expect(created.body).toMatchObject({
      name: 'Ravi Kumar',
      mobile: '9100000001',
      zones: ['CENTRAL', 'NORTH'],
      capacity: 10,
      availability: 'AVAILABLE',
      reservedLoad: 0,
      activeJobs: 0,
      workload: { spareCapacity: 10, slotsLeft: 3, canTakeMoreJobs: true, blockers: [] },
    });

    // Login account and rider profile were created together
    const user = await User.findOne({ mobile: '9100000001' }).lean();
    const dispatcher = await User.findOne({ mobile: '9000000001' }).lean();
    expect(user.role).toBe('RIDER');
    expect(String(user.createdBy)).toBe(String(dispatcher._id));
    expect(created.body.userId).toBe(String(user._id));

    const riderToken = await login(app, '9100000001');
    const me = await request(app).get('/api/auth/me').set(bearer(riderToken)).expect(200);
    expect(me.body.user).toMatchObject({ role: 'RIDER', riderId: created.body.id });
    expect(me.body.rider).toMatchObject({ id: created.body.id, name: 'Ravi Kumar' });
  });

  it('rejects a mobile number that is already registered (rider or dispatcher)', async () => {
    await addRider(ravi).expect(201);

    const dupRider = await addRider({ ...ravi, name: 'Someone Else' }).expect(409);
    expect(dupRider.body.error.code).toBe('MOBILE_ALREADY_REGISTERED');

    const dupDispatcher = await addRider({ ...ravi, mobile: '9000000001' }).expect(409);
    expect(dupDispatcher.body.error.code).toBe('MOBILE_ALREADY_REGISTERED');

    // Nothing half-created by the failed attempts
    expect(await User.countDocuments({ role: 'RIDER' })).toBe(1);
    expect(await Rider.countDocuments()).toBe(1);
  });

  it('creates only one rider when the same request is sent twice at once', async () => {
    const results = await Promise.all([addRider(ravi), addRider(ravi)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await Rider.countDocuments()).toBe(1);
  });

  it('validates rider input and reports every problem', async () => {
    const res = await addRider({ ...ravi, mobile: '12345', zones: ['MOON'], capacity: 0 }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['mobile', 'zones.0', 'capacity']));
  });

  it('only dispatchers can add or list riders', async () => {
    await addRider(ravi).expect(201);
    const riderToken = await login(app, ravi.mobile);

    const add = await request(app).post('/api/riders').set(bearer(riderToken)).send(karthik).expect(403);
    expect(add.body.error.code).toBe('FORBIDDEN');
    await request(app).get('/api/riders').set(bearer(riderToken)).expect(403);
    await request(app).get('/api/riders').expect(401);
  });

  it('a rider can view their own profile but not another rider', async () => {
    const own = await addRider(ravi).expect(201);
    const other = await addRider(karthik).expect(201);
    const riderToken = await login(app, ravi.mobile);

    await request(app).get(`/api/riders/${own.body.id}`).set(bearer(riderToken)).expect(200);
    await request(app).get(`/api/riders/${other.body.id}`).set(bearer(riderToken)).expect(403);
    await request(app).get(`/api/riders/${other.body.id}`).set(bearer(dispatcherToken)).expect(200);
  });

  it('riders change their own availability; dispatchers can change anyone', async () => {
    const own = await addRider(ravi).expect(201);
    const other = await addRider(karthik).expect(201);
    const riderToken = await login(app, ravi.mobile);

    const onBreak = await request(app)
      .patch(`/api/riders/${own.body.id}/availability`)
      .set(bearer(riderToken))
      .send({ availability: 'ON_BREAK' })
      .expect(200);
    expect(onBreak.body.workload).toMatchObject({ canTakeMoreJobs: false, blockers: ['Rider is on break'] });

    await request(app)
      .patch(`/api/riders/${other.body.id}/availability`)
      .set(bearer(riderToken))
      .send({ availability: 'AVAILABLE' })
      .expect(403);

    await request(app)
      .patch(`/api/riders/${other.body.id}/availability`)
      .set(bearer(dispatcherToken))
      .send({ availability: 'AVAILABLE' })
      .expect(200);
  });

  it('lists riders with availability, zone and name filters', async () => {
    await addRider(ravi).expect(201);
    await addRider(karthik).expect(201);
    const list = (query) => request(app).get(`/api/riders${query}`).set(bearer(dispatcherToken)).expect(200);
    const names = (res) => res.body.items.map((r) => r.name);

    expect((await list('')).body.total).toBe(2);
    expect(names(await list('?availability=AVAILABLE'))).toEqual(['Ravi Kumar']);
    expect(names(await list('?zone=SOUTH'))).toEqual(['Karthik Srinivasan']);
    expect((await list('?q=ravi')).body.total).toBe(1);
    expect((await list('?q=9100000002')).body.total).toBe(1);

    await request(app).get('/api/riders?zone=MOON').set(bearer(dispatcherToken)).expect(400);
  });

  it('does not allow capacity or job limit below the current workload', async () => {
    const created = await addRider(ravi).expect(201);
    // Simulate a rider currently carrying 6 units across 2 jobs
    await Rider.updateOne({ _id: created.body.id }, { $set: { reservedLoad: 6, activeJobs: 2 } });
    const patch = (body) => request(app).patch(`/api/riders/${created.body.id}`).set(bearer(dispatcherToken)).send(body);

    const tooSmall = await patch({ capacity: 5 }).expect(409);
    expect(tooSmall.body.error.code).toBe('RIDER_LOAD_EXCEEDS_LIMIT');
    await patch({ maxActiveJobs: 1 }).expect(409);

    const ok = await patch({ capacity: 6, name: 'Ravi K' }).expect(200);
    expect(ok.body).toMatchObject({ capacity: 6, name: 'Ravi K', workload: { spareCapacity: 0, canTakeMoreJobs: false } });

    await patch({}).expect(400);
  });

  it('returns 404 for an unknown rider and 400 for a malformed id', async () => {
    await request(app).get('/api/riders/64b7f0c2a1b2c3d4e5f60718').set(bearer(dispatcherToken)).expect(404);
    await request(app).get('/api/riders/not-an-id').set(bearer(dispatcherToken)).expect(400);
  });
});
