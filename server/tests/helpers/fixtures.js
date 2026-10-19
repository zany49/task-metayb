import request from 'supertest';
import { expect } from 'vitest';
import { bearer } from './auth.js';

export const ALL_ZONES = ['CENTRAL', 'NORTH', 'SOUTH', 'EAST', 'WEST'];

/** Dispatcher adds a rider through the API; returns the rider as the API shows it. */
export async function addRider(app, token, body) {
  const res = await request(app).post('/api/riders').set(bearer(token)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** A rider who can take any job in these tests (all zones, plenty of capacity). */
export const anyJobRider = {
  name: 'Deepa Rajan',
  mobile: '9100000008',
  zones: ALL_ZONES,
  capacity: 100,
  maxActiveJobs: 20,
  currentZone: 'CENTRAL',
};

/** Dispatcher creates a job through the API; returns the job. */
export async function createJob(app, token, body) {
  const res = await request(app).post('/api/jobs').set(bearer(token)).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}
