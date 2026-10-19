import { z } from 'zod';
import { RIDER_AVAILABILITY } from '../domain/rider.js';
import { ZONES } from '../domain/zones.js';
import { mobileSchema } from './common.schemas.js';

const zoneSchema = z.enum(ZONES);
const zonesSchema = z
  .array(zoneSchema)
  .min(1, 'At least one service zone is required')
  .transform((zones) => [...new Set(zones)]); // drop duplicates

/** POST /api/riders: a dispatcher adds a rider. */
export const CreateRiderSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  mobile: mobileSchema,
  zones: zonesSchema,
  /** Load units the rider can carry at once (e.g. parcels, crates). */
  capacity: z.number().int().min(1).max(1000),
  maxActiveJobs: z.number().int().min(1).max(20).default(3),
  /** Simulated current location, used for travel-time estimates. */
  currentZone: zoneSchema,
  availability: z.enum(RIDER_AVAILABILITY).default('AVAILABLE'),
});

/**
 * PATCH /api/riders/:id: a dispatcher edits a rider.
 * The mobile number cannot be changed here: it is the login identity.
 */
export const UpdateRiderSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    zones: zonesSchema.optional(),
    capacity: z.number().int().min(1).max(1000).optional(),
    maxActiveJobs: z.number().int().min(1).max(20).optional(),
    currentZone: zoneSchema.optional(),
  })
  .refine((value) => Object.values(value).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

/** PATCH /api/riders/:id/availability */
export const SetAvailabilitySchema = z.object({
  availability: z.enum(RIDER_AVAILABILITY),
});

/** GET /api/riders?availability=&zone=&q= */
export const ListRidersQuerySchema = z.object({
  availability: z.enum(RIDER_AVAILABILITY).optional(),
  zone: zoneSchema.optional(),
  q: z.string().trim().min(1).max(50).optional(),
});
