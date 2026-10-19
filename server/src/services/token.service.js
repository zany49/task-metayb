import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError, Errors } from '../common/errors.js';
import { ROLES } from '../domain/actor.js';

/**
 * Creates a signed access token (JWT).
 * Claims: sub = user id, role = DISPATCHER | RIDER, riderId = rider profile id (riders only).
 */
export function signAccessToken({ sub, role, riderId }) {
  return jwt.sign({ role, riderId }, env.JWT_SECRET, {
    subject: sub,
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

/**
 * Verifies signature and expiry and returns { sub, role, riderId }.
 * Throws 401 TOKEN_EXPIRED (so the frontend can send the user back to login) or INVALID_TOKEN.
 */
export function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub || !ROLES.includes(decoded.role)) {
      throw Errors.unauthorized('Invalid access token', 'INVALID_TOKEN');
    }
    return {
      sub: decoded.sub,
      role: decoded.role,
      riderId: typeof decoded.riderId === 'string' ? decoded.riderId : undefined,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw Errors.unauthorized('Your session has expired, please log in again', 'TOKEN_EXPIRED');
    }
    throw Errors.unauthorized('Invalid access token', 'INVALID_TOKEN');
  }
}
