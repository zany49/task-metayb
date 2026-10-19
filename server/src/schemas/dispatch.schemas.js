import { z } from 'zod';
import { objectIdSchema } from './common.schemas.js';

/** POST /jobs/:jobRef/assignments */
export const AssignRiderSchema = z.object({
  riderId: objectIdSchema,
  /** Required when the chosen rider is not the top recommendation. */
  overrideReason: z
    .string()
    .trim()
    .min(5, 'Give a short reason (at least 5 characters)')
    .max(300)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

/** Bodies that only carry a reason: decline, take back, move to manual queue. */
export const ReasonSchema = z.object({
  reason: z.string({ error: 'A reason is required' }).trim().min(3, 'Give a short reason').max(300),
});

export const AssignmentIdParamsSchema = z.object({ id: objectIdSchema });

/** PATCH /settings */
export const UpdateSettingsSchema = z.object({
  confirmationTimeoutMinutes: z.number().int().min(1, 'At least 1 minute').max(1440, 'At most 24 hours (1440 minutes)'),
});

/** POST /simulation/clock/advance */
export const AdvanceClockSchema = z.object({
  minutes: z.number().int().min(1).max(7 * 24 * 60),
});
