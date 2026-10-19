import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/common/errors.js';
import { env } from '../../src/config/env.js';
import { signAccessToken, verifyAccessToken } from '../../src/services/token.service.js';

/** Runs fn and returns the AppError code it threw (or undefined if it did not throw). */
function errorCode(fn) {
  try {
    fn();
  } catch (err) {
    return err instanceof AppError ? err.code : 'NOT_APP_ERROR';
  }
  return undefined;
}

describe('access tokens', () => {
  it('round-trips the user id, role and rider id', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'RIDER', riderId: 'rider-1' });
    expect(verifyAccessToken(token)).toEqual({ sub: 'user-1', role: 'RIDER', riderId: 'rider-1' });
  });

  it('rejects a token signed with another secret', () => {
    const forged = jwt.sign({ role: 'DISPATCHER' }, 'some-other-secret-value', { subject: 'user-1' });
    expect(errorCode(() => verifyAccessToken(forged))).toBe('INVALID_TOKEN');
  });

  it('rejects a tampered token (rider trying to become a dispatcher)', () => {
    const token = signAccessToken({ sub: 'user-1', role: 'RIDER', riderId: 'rider-1' });
    const [header, , signature] = token.split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1', role: 'DISPATCHER' })).toString('base64url');
    expect(errorCode(() => verifyAccessToken(`${header}.${payload}.${signature}`))).toBe('INVALID_TOKEN');
  });

  it('reports an expired token separately so the client can ask the user to log in again', () => {
    const expired = jwt.sign({ role: 'DISPATCHER', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, {
      subject: 'user-1',
    });
    expect(errorCode(() => verifyAccessToken(expired))).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token with an unknown role', () => {
    const token = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, { subject: 'user-1' });
    expect(errorCode(() => verifyAccessToken(token))).toBe('INVALID_TOKEN');
  });
});
