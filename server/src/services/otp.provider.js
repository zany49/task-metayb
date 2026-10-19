import { env } from '../config/env.js';

/**
 * Where OTP codes come from and how they reach the user.
 *
 * Any provider must have two methods:
 *   generateCode()               -> string
 *   deliver(mobile, code)        -> Promise<void>
 *
 * The demo uses a fixed code and sends nothing. A real deployment would add an
 * SmsOtpProvider (random code + SMS gateway) without touching the auth service.
 */
export class StaticOtpProvider {
  constructor(code) {
    this.code = code;
  }

  generateCode() {
    return this.code;
  }

  async deliver(_mobile, _code) {
    // Demo mode: no SMS is sent. Every user logs in with the static code.
  }
}

export const otpProvider = new StaticOtpProvider(env.STATIC_OTP);
