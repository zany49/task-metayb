import { z } from 'zod';
import { JOB_PRIORITIES, JOB_STATUSES } from '../domain/jobLifecycle.js';
import { ZONES } from '../domain/zones.js';
import { objectIdSchema } from './common.schemas.js';

const zoneSchema = z.enum(ZONES);

/** Order reference, e.g. "ORD-1001". Stored in upper case, so "ord-1001" is the same order. */
export const orderRefSchema = z
  .string({ error: 'orderRef is required' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,39}$/, 'orderRef must be 3-40 characters: letters, digits, "-" or "_"');

/** POST /api/jobs */
export const CreateJobSchema = z.object({
  orderRef: orderRefSchema,
  pickupZone: zoneSchema,
  dropZone: zoneSchema,
  /** Load units the job needs (same unit as rider capacity). */
  load: z.number().int().min(1).max(1000),
  priority: z.enum(JOB_PRIORITIES).default('NORMAL'),
  /** ISO date-time with timezone, e.g. "2026-10-19T18:30:00+05:30" or "2026-10-19T13:00:00Z". */
  deadline: z.iso
    .datetime({ offset: true, error: 'deadline must be an ISO date-time with timezone, e.g. 2026-10-19T18:30:00+05:30' })
    .transform((value) => new Date(value))
    .nullish(),
  notes: z.string().trim().max(500).optional(),
});

/** POST /api/jobs/:jobRef/cancel */
export const CancelJobSchema = z.object({
  reason: z.string({ error: 'A cancellation reason is required' }).trim().min(3, 'Give a short reason').max(300),
});

/** :jobRef in the URL accepts the job id or the order reference ("ORD-1001"). */
export const JobRefParamsSchema = z.object({
  jobRef: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,40}$/, 'Use a job id or an order reference'),
});

/** "status=READY_FOR_ASSIGNMENT,MANUAL_QUEUE" or repeated ?status=..&status=.. */
const statusListSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.join(',') : value),
  z
    .string()
    .transform((value) => value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))
    .pipe(z.array(z.enum(JOB_STATUSES)).min(1)),
);

/** GET /api/jobs */
export const ListJobsQuerySchema = z.object({
  status: statusListSchema.optional(),
  /** Matches jobs whose pickup OR drop zone is this zone. */
  zone: zoneSchema.optional(),
  priority: z.enum(JOB_PRIORITIES).optional(),
  /** Search by order reference (partial match, case-insensitive). */
  q: z.string().trim().min(1).max(40).optional(),
  riderId: objectIdSchema.optional(),
  /** overdue=true: only open jobs whose deadline has passed. */
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(['newest', 'oldest', 'priority']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
