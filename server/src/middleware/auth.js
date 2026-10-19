import { Errors } from '../common/errors.js';
import { User } from '../models/user.model.js';
import { verifyAccessToken } from '../services/token.service.js';

/**
 * Reads the Bearer token, verifies it, and confirms the account is still active
 * (so a deactivated user is locked out immediately, not when the token expires).
 *
 * On success sets req.actor = { type: 'DISPATCHER' | 'RIDER', id, name, riderId? }.
 * Services receive this actor, so they never need to know how the user logged in.
 */
export async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw Errors.unauthorized('Missing access token. Log in and send "Authorization: Bearer <token>".');
  }

  const claims = verifyAccessToken(header.slice('Bearer '.length).trim());

  const user = await User.findById(claims.sub, { name: 1, role: 1, isActive: 1 }).lean();
  if (!user || !user.isActive) {
    throw Errors.unauthorized('This account is not active', 'ACCOUNT_INACTIVE');
  }

  req.actor = { type: user.role, id: String(user._id), name: user.name, riderId: claims.riderId };
  next();
}

/**
 * Allows the request only if the logged-in user has one of the given roles.
 * Usage: router.post('/', requireRole('DISPATCHER'), handler)
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    const actor = actorOf(req);
    if (!roles.includes(actor.type)) {
      const allowed = roles.map((role) => `${role.toLowerCase()}s`).join(' or ');
      throw Errors.forbidden(`Only ${allowed} can perform this action`);
    }
    next();
  };
}

/** Returns the authenticated actor (use only on routes behind `authenticate`). */
export function actorOf(req) {
  if (!req.actor) throw Errors.unauthorized();
  return req.actor;
}
