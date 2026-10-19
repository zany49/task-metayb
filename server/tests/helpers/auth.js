import request from 'supertest';
import { expect } from 'vitest';
import { User } from '../../src/models/user.model.js';

export const DEMO_OTP = '1234';

export async function createDispatcher(overrides = {}) {
  return User.create({ name: 'Priya Raman', mobile: '9000000001', role: 'DISPATCHER', ...overrides });
}

/** Full login flow (request OTP + verify) and returns the access token. */
export async function login(app, mobile) {
  await request(app).post('/api/auth/otp/request').send({ mobile }).expect(200);
  const res = await request(app).post('/api/auth/otp/verify').send({ mobile, otp: DEMO_OTP });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.token;
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });
