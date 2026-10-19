import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';

/**
 * HTTP behaviour that is decided before any database access:
 * routing, JSON parsing, input validation and token checks. Runs without MongoDB.
 */
const app = createApp();

describe('HTTP layer (no database needed)', () => {
  it('reports health', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist').expect(404);
    expect(res.body).toEqual({ error: { code: 'ROUTE_NOT_FOUND', message: 'No route for GET /api/does-not-exist' } });
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/api/auth/otp/request')
      .set('Content-Type', 'application/json')
      .send('{"mobile": ')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('validates the mobile number before doing anything else', async () => {
    const res = await request(app).post('/api/auth/otp/request').send({ mobile: '123' }).expect(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'mobile', message: 'Enter a valid 10-digit mobile number' }],
    });
  });

  it('reports a missing mobile number clearly', async () => {
    const res = await request(app).post('/api/auth/otp/request').send({}).expect(400);
    expect(res.body.error.details).toEqual([{ path: 'mobile', message: 'Mobile number is required' }]);
  });

  it('validates the OTP format', async () => {
    const res = await request(app).post('/api/auth/otp/verify').send({ mobile: '9000000001', otp: 'abcd' }).expect(400);
    expect(res.body.error.details[0].path).toBe('otp');
  });

  it('requires a token for protected routes', async () => {
    const res = await request(app).get('/api/riders').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an invalid token', async () => {
    const res = await request(app).get('/api/riders').set('Authorization', 'Bearer not-a-real-token').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired token', async () => {
    const expired = jwt.sign({ role: 'DISPATCHER', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      subject: '64b7f0c2a1b2c3d4e5f60718',
    });
    const res = await request(app).get('/api/riders').set('Authorization', `Bearer ${expired}`).expect(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});
