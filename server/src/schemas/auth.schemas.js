import { z } from 'zod';
import { mobileSchema } from './common.schemas.js';

/** POST /api/auth/otp/request  { mobile } */
export const RequestOtpSchema = z.object({
  mobile: mobileSchema,
});

/** POST /api/auth/otp/verify  { mobile, otp } */
export const VerifyOtpSchema = z.object({
  mobile: mobileSchema,
  otp: z.string({ error: 'OTP is required' }).trim().regex(/^\d{4,6}$/, 'OTP must be 4-6 digits'),
});
