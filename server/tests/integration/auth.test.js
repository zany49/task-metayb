import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { OtpChallenge } from '../../src/models/otpChallenge.model.js';
import { User } from '../../src/models/user.model.js';
import { bearer, createDispatcher, DEMO_OTP, login } from '../helpers/auth.js';
import { useTestDb } from '../helpers/db.js';

useTestDb();
const app = createApp();
const MOBILE = '9000000001';

const requestOtp = (mobile) => request(app).post('/api/auth/otp/request').send({ mobile });
const verifyOtp = (mobile, otp) => request(app).post('/api/auth/otp/verify').send({ mobile, otp });

describe('OTP login', () => {
  beforeEach(async () => {
    await createDispatcher({ name: 'Priya Raman', mobile: MOBILE });
  });

  it('logs a dispatcher in with mobile + static OTP and returns a working token', async () => {
    await requestOtp('+91 90000-00001').expect(200); // formatted input is normalised

    const res = await verifyOtp(MOBILE, DEMO_OTP).expect(200);
    expect(res.body).toMatchObject({
      token: expect.any(String),
      tokenType: 'Bearer',
      user: { name: 'Priya Raman', mobile: MOBILE, role: 'DISPATCHER' },
    });

    const me = await request(app).get('/api/auth/me').set(bearer(res.body.token)).expect(200);
    expect(me.body.user).toMatchObject({ mobile: MOBILE, role: 'DISPATCHER' });
    expect(me.body.rider).toBeUndefined();
  });

  it('rejects a wrong OTP and locks the challenge after the maximum attempts', async () => {
    await requestOtp(MOBILE).expect(200);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await verifyOtp(MOBILE, '0000').expect(401);
      expect(res.body.error.code).toBe('INVALID_OTP');
    }

    // Even the correct code is refused once the limit is reached
    const locked = await verifyOtp(MOBILE, DEMO_OTP).expect(429);
    expect(locked.body.error.code).toBe('OTP_ATTEMPTS_EXCEEDED');

    // Requesting a new OTP starts a fresh challenge
    await requestOtp(MOBILE).expect(200);
    await verifyOtp(MOBILE, DEMO_OTP).expect(200);
  });

  it('requires an OTP to be requested before it can be verified', async () => {
    const res = await verifyOtp(MOBILE, DEMO_OTP).expect(401);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('does not allow the same OTP to be used twice', async () => {
    await requestOtp(MOBILE).expect(200);
    await verifyOtp(MOBILE, DEMO_OTP).expect(200);

    const reused = await verifyOtp(MOBILE, DEMO_OTP).expect(401);
    expect(reused.body.error.code).toBe('OTP_EXPIRED');
  });

  it('lets only one of two simultaneous verify calls use the OTP', async () => {
    await requestOtp(MOBILE).expect(200);

    const results = await Promise.all([verifyOtp(MOBILE, DEMO_OTP), verifyOtp(MOBILE, DEMO_OTP)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('rejects an expired OTP', async () => {
    await requestOtp(MOBILE).expect(200);
    await OtpChallenge.updateMany({ mobile: MOBILE }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await verifyOtp(MOBILE, DEMO_OTP).expect(401);
    expect(res.body.error.code).toBe('OTP_EXPIRED');
  });

  it('gives the same response for unregistered numbers and creates no challenge', async () => {
    const registered = await requestOtp(MOBILE).expect(200);
    const unknown = await requestOtp('9999999999').expect(200);

    expect(unknown.body.message).toBe(registered.body.message);
    expect(await OtpChallenge.countDocuments({ mobile: '9999999999' })).toBe(0);
    await verifyOtp('9999999999', DEMO_OTP).expect(401);
  });

  it('locks out a deactivated user immediately, even with a valid token', async () => {
    const token = await login(app, MOBILE);
    await User.updateOne({ mobile: MOBILE }, { $set: { isActive: false } });

    const me = await request(app).get('/api/auth/me').set(bearer(token)).expect(401);
    expect(me.body.error.code).toBe('ACCOUNT_INACTIVE');

    await requestOtp(MOBILE).expect(200);
    await verifyOtp(MOBILE, DEMO_OTP).expect(401);
  });
});
