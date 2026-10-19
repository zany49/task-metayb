import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Errors } from '../common/errors.js';
import { OtpChallenge } from '../models/otpChallenge.model.js';
import { Rider } from '../models/rider.model.js';
import { User } from '../models/user.model.js';
import { otpProvider } from './otp.provider.js';
import { getRider } from './rider.service.js';
import { signAccessToken } from './token.service.js';

/** The user fields the API returns (never internal fields). */
export function toUserView(user, riderId) {
  return {
    id: String(user._id),
    name: user.name,
    mobile: user.mobile,
    role: user.role,
    ...(riderId && { riderId }),
  };
}

function hashCode(mobile, code) {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`${mobile}:${code}`).digest('hex');
}

/** Constant-time comparison, so response timing does not leak how much of the code matched. */
function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Step 1 of login. Creates a fresh OTP challenge for an active user.
 * The response is identical whether or not the number is registered, so the endpoint
 * cannot be used to discover which mobile numbers belong to riders or dispatchers.
 */
export async function requestOtp(mobile) {
  const user = await User.exists({ mobile, isActive: true });

  if (user) {
    const code = otpProvider.generateCode();
    // A new request replaces any earlier unused code for this number.
    await OtpChallenge.deleteMany({ mobile, consumedAt: null });
    await OtpChallenge.create({
      mobile,
      codeHash: hashCode(mobile, code),
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
    });
    await otpProvider.deliver(mobile, code);
  }

  return { expiresInSeconds: env.OTP_TTL_SECONDS };
}

/**
 * Step 2 of login. Checks the OTP and returns an access token.
 * Each check is an atomic conditional update, so two parallel verify calls cannot both
 * use the same code, and the attempt limit cannot be bypassed.
 *
 * @returns {Promise<{ token: string, tokenType: 'Bearer', expiresIn: string, user: object }>}
 */
export async function verifyOtp(mobile, otp) {
  const challenge = await OtpChallenge.findOne({
    mobile,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!challenge) {
    throw Errors.unauthorized('OTP has expired or was not requested. Please request a new OTP.', 'OTP_EXPIRED');
  }

  // Count this attempt; refuse once the limit has been reached.
  const counted = await OtpChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, attempts: { $lt: env.OTP_MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { new: true },
  );
  if (!counted) {
    throw Errors.tooManyRequests('OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Please request a new OTP.');
  }

  if (!safeEqual(counted.codeHash, hashCode(mobile, otp))) {
    const left = env.OTP_MAX_ATTEMPTS - counted.attempts;
    throw Errors.unauthorized(
      left > 0 ? `Incorrect OTP. ${left} attempt(s) left.` : 'Incorrect OTP. Please request a new OTP.',
      'INVALID_OTP',
    );
  }

  // Single use: only one request can change consumedAt from null.
  const consumed = await OtpChallenge.findOneAndUpdate(
    { _id: counted._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (!consumed) {
    throw Errors.unauthorized('This OTP has already been used. Please request a new OTP.', 'OTP_EXPIRED');
  }

  const user = await User.findOneAndUpdate(
    { mobile, isActive: true },
    { $set: { lastLoginAt: new Date() } },
    { new: true },
  ).lean();
  if (!user) throw Errors.unauthorized('This account is not active', 'ACCOUNT_INACTIVE');

  let riderId;
  if (user.role === 'RIDER') {
    const rider = await Rider.findOne({ userId: user._id }, { _id: 1 }).lean();
    if (!rider) throw Errors.conflict('RIDER_PROFILE_MISSING', 'No rider profile is linked to this account');
    riderId = String(rider._id);
  }

  return {
    token: signAccessToken({ sub: String(user._id), role: user.role, riderId }),
    tokenType: 'Bearer',
    expiresIn: env.JWT_EXPIRES_IN,
    user: toUserView(user, riderId),
  };
}

/** GET /api/auth/me: the logged-in user, plus their rider profile if they are a rider. */
export async function getMe(actor) {
  const user = await User.findById(actor.id).lean();
  if (!user) throw Errors.unauthorized('This account is not active', 'ACCOUNT_INACTIVE');

  const view = { user: toUserView(user, actor.riderId) };
  if (actor.riderId) view.rider = await getRider(actor.riderId, actor);
  return view;
}
