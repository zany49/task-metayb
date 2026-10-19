import mongoose from 'mongoose';
import { RIDER_AVAILABILITY } from '../domain/rider.js';
import { ZONES } from '../domain/zones.js';

const { Schema, model } = mongoose;

/**
 * Operational rider profile, linked 1:1 to a login account in `users`.
 *
 * Fields:
 *   userId        the rider's login account
 *   zones         service zones the rider covers
 *   capacity      load units the rider can carry at once
 *   maxActiveJobs most jobs the rider may hold at the same time
 *   availability  AVAILABLE | ON_BREAK | OFF_DUTY
 *   currentZone   simulated location, used for travel-time estimates
 *   reservedLoad  load units held by the rider's current assignments
 *   activeJobs    number of current assignments
 *
 * `reservedLoad` and `activeJobs` are counters maintained by the assignment workflow:
 * they go up when a job is assigned and down when the assignment ends (rejected, timed out,
 * cancelled or delivered). They are changed only with atomic conditional updates, so two
 * assignments can never over-book the same rider.
 */
const riderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    zones: {
      type: [{ type: String, enum: ZONES }],
      required: true,
      validate: {
        validator: (zones) => zones.length > 0,
        message: 'At least one service zone is required',
      },
    },
    capacity: { type: Number, required: true, min: 1 },
    maxActiveJobs: { type: Number, required: true, min: 1, default: 3 },
    availability: { type: String, enum: RIDER_AVAILABILITY, required: true, default: 'AVAILABLE' },
    currentZone: { type: String, enum: ZONES, required: true },
    reservedLoad: { type: Number, required: true, min: 0, default: 0 },
    activeJobs: { type: Number, required: true, min: 0, default: 0 },
  },
  { timestamps: true },
);

// Exactly one rider profile per login account.
riderSchema.index({ userId: 1 }, { unique: true });
// Supports "available riders who cover zone X" (multikey index on zones).
riderSchema.index({ availability: 1, zones: 1 });

export const Rider = model('Rider', riderSchema);
