import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One OTP login attempt. Stores only a hash of the code, never the code itself.
 * With the static demo OTP the code is always the same, but the flow is the real one:
 * request -> verify within the expiry window -> limited attempts -> single use.
 * Switching to a real SMS provider only changes the OTP provider, not this model.
 *
 * Fields:
 *   mobile     the number the OTP was requested for
 *   codeHash   HMAC of the code (never the code itself)
 *   expiresAt  the OTP is refused after this time
 *   attempts   verify attempts so far (limited by OTP_MAX_ATTEMPTS)
 *   consumedAt set when the OTP is used successfully; an OTP works only once
 */
const otpChallengeSchema = new Schema(
  {
    mobile: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

otpChallengeSchema.index({ mobile: 1, createdAt: -1 });
// TTL index: MongoDB deletes expired challenges automatically. This is cleanup only; it runs
// about once a minute, so the verify query also checks expiresAt itself.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpChallenge = model('OtpChallenge', otpChallengeSchema);
