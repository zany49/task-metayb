import { Router } from 'express';
import { env, isProduction } from '../config/env.js';
import { parse } from '../common/validate.js';
import { actorOf, authenticate } from '../middleware/auth.js';
import { RequestOtpSchema, VerifyOtpSchema } from '../schemas/auth.schemas.js';
import { getMe, requestOtp, verifyOtp } from '../services/auth.service.js';

const router = Router();

// Route handlers stay thin: validate input -> call a service -> send the result.

/** Step 1: ask for an OTP. Same response for registered and unknown numbers. */
router.post('/otp/request', async (req, res) => {
  const { mobile } = parse(RequestOtpSchema, req.body);
  const { expiresInSeconds } = await requestOtp(mobile);
  res.json({
    message: 'If this mobile number is registered, an OTP has been sent.',
    expiresInSeconds,
    ...(!isProduction && { demoHint: `Demo mode: the OTP is ${env.STATIC_OTP}` }),
  });
});

/** Step 2: verify the OTP and receive an access token. */
router.post('/otp/verify', async (req, res) => {
  const { mobile, otp } = parse(VerifyOtpSchema, req.body);
  res.json(await verifyOtp(mobile, otp));
});

/** The logged-in user (and rider profile, for riders). */
router.get('/me', authenticate, async (req, res) => {
  res.json(await getMe(actorOf(req)));
});

export default router;
