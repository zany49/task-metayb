import mongoose from 'mongoose';
import { clock } from '../common/clock.js';
import { ASSIGNMENT_STATUSES } from '../domain/assignment.js';

const { Schema, model } = mongoose;

const actorSchema = new Schema({ type: String, id: String, name: String }, { _id: false });

/**
 * One attempt to give a job to a rider (see domain/assignment.js for the statuses).
 * Kept separately from the job because a job can have several attempts, and every attempt,
 * including failed ones, stays on record.
 *
 * Fields:
 *   jobId, orderRef          the job (order reference copied for readability)
 *   riderId, riderName       the rider asked (name copied)
 *   load                     units reserved on the rider for this attempt
 *   attempt                  1 for the first attempt on the job, 2 for the next, ...
 *   status                   PENDING | ACCEPTED | REJECTED | EXPIRED | WITHDRAWN | RELEASED | CANCELLED | COMPLETED
 *   active                   true while PENDING or ACCEPTED (the rider holds the job)
 *   assignedAt, assignedBy   when and by whom
 *   expiresAt                PENDING attempts expire at this time if the rider has not answered
 *   respondedAt              when the rider accepted / declined
 *   endedAt, endedBy, endReason  when and why the attempt ended ({ code, message })
 *   isOverride, overrideReason   set when the dispatcher chose someone other than the top recommendation
 *   recommendation           what the dispatcher saw: chosen rider's rank, score and reasons, and the top rider
 */
const assignmentSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    orderRef: { type: String, required: true },
    riderId: { type: Schema.Types.ObjectId, ref: 'Rider', required: true },
    riderName: { type: String, required: true },
    load: { type: Number, required: true, min: 1 },
    attempt: { type: Number, required: true, min: 1 },

    status: { type: String, enum: ASSIGNMENT_STATUSES, required: true, default: 'PENDING' },
    active: { type: Boolean, required: true, default: true },

    assignedAt: { type: Date, required: true },
    assignedBy: { type: actorSchema, required: true },
    expiresAt: { type: Date, required: true },
    timeoutMinutes: { type: Number, required: true },
    respondedAt: { type: Date, default: null },
    respondedBy: { type: actorSchema, default: null },
    endedAt: { type: Date, default: null },
    endedBy: { type: actorSchema, default: null },
    endReason: { type: new Schema({ code: String, message: String }, { _id: false }), default: null },

    isOverride: { type: Boolean, required: true, default: false },
    overrideReason: { type: String, default: null },
    recommendation: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { currentTime: () => clock.now() }, versionKey: false },
);

// At most ONE live assignment per job, enforced by the database. Two dispatchers assigning the
// same job at the same moment cannot both succeed, whatever the application code does.
assignmentSchema.index({ jobId: 1 }, { unique: true, partialFilterExpression: { active: true } });
// The timeout sweeper: "pending attempts whose time is up".
assignmentSchema.index({ status: 1, expiresAt: 1 });
// A rider's current and recent attempts.
assignmentSchema.index({ riderId: 1, active: 1, assignedAt: -1 });
// A job's attempts in order.
assignmentSchema.index({ jobId: 1, assignedAt: 1 });

export const Assignment = model('Assignment', assignmentSchema);
