import mongoose from 'mongoose';
import { ROLES } from '../domain/actor.js';

const { Schema, model } = mongoose;

/**
 * Login identity for dispatchers and riders.
 * Operational rider data (zones, capacity, workload) lives in the separate `riders` collection,
 * so authentication concerns and dispatch concerns stay apart.
 *
 * Fields:
 *   name        display name
 *   mobile      normalised 10-digit mobile number; the login identifier
 *   role        DISPATCHER | RIDER
 *   isActive    false = cannot log in, and existing tokens stop working
 *   lastLoginAt last successful OTP login
 *   createdBy   dispatcher who created this account (absent for seeded users)
 */
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    mobile: { type: String, required: true, match: /^[6-9]\d{9}$/ },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, required: true, default: true },
    lastLoginAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// One account per mobile number, across all roles. This is the real guard against
// duplicate registrations (an application-level "check then insert" can race).
userSchema.index({ mobile: 1 }, { unique: true });
userSchema.index({ role: 1, name: 1 });

export const User = model('User', userSchema);
