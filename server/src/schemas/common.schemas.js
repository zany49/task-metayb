import { z } from 'zod';

/**
 * Accepts common ways of typing an Indian mobile number and normalises it to 10 digits:
 * "9876543210", "98765 43210", "+91 98765-43210", "919876543210", "09876543210".
 */
export const mobileSchema = z
  .string({ error: 'Mobile number is required' })
  .trim()
  .transform((value) =>
    value
      .replace(/[\s-]/g, '')
      .replace(/^\+91/, '')
      .replace(/^0091/, '')
      .replace(/^91(?=\d{10}$)/, '')
      .replace(/^0(?=\d{10}$)/, ''),
  )
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

/** MongoDB ObjectId as a 24-character hex string (normalised to lower case, as MongoDB prints it). */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id')
  .transform((id) => id.toLowerCase());

export const IdParamsSchema = z.object({ id: objectIdSchema });
