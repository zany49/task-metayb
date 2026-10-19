import mongoose from 'mongoose';
import { clock } from '../common/clock.js';
import { JOB_PRIORITIES, JOB_STATUSES, PRIORITY_RANK } from '../domain/jobLifecycle.js';
import { ZONES } from '../domain/zones.js';

const { Schema, model } = mongoose;

const actorSchema = new Schema(
  { type: { type: String, required: true }, id: { type: String, required: true }, name: { type: String, required: true } },
  { _id: false },
);

/**
 * A delivery job: what needs to move, from where to where, how urgently, and where it is
 * in its lifecycle. Assignment attempts (which rider was asked, when, and how it ended) are
 * separate records, because one job can have several attempts (e.g. a timeout, then a reassignment).
 *
 * Fields:
 *   orderRef          the order's own reference (e.g. "ORD-1001"); unique, so the same order
 *                     can never become two jobs
 *   pickupZone, dropZone
 *   load              load units (same unit as rider capacity)
 *   priority          LOW | NORMAL | HIGH | URGENT  (priorityRank 1-4 is derived, for sorting)
 *   deadline          optional delivery deadline
 *   notes             optional free text for the rider / dispatcher
 *   status            current lifecycle status (see domain/jobLifecycle.js)
 *   statusChangedAt   when the current status began (shows how long a job has been waiting)
 *   riderId, riderName   rider currently holding the job (null when unassigned; name copied for lists)
 *   currentAssignmentId  the live assignment attempt (null when none)
 *   confirmationDueAt    while AWAITING_CONFIRMATION: when the rider's time to accept runs out
 *   attemptCount      how many assignment attempts so far
 *   manualQueueReason why the job is in the Manual Queue: { code, message, at }
 *   cancelReason      why it was cancelled
 *   version           +1 on every status change; lets an update say "only if nobody changed it since I read it"
 *   createdBy         who created it (copied actor)
 *
 * createdAt / updatedAt come from the app clock, so they follow simulated time too.
 */
const jobSchema = new Schema(
  {
    orderRef: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    pickupZone: { type: String, enum: ZONES, required: true },
    dropZone: { type: String, enum: ZONES, required: true },
    load: { type: Number, required: true, min: 1 },
    priority: { type: String, enum: JOB_PRIORITIES, required: true, default: 'NORMAL' },
    priorityRank: { type: Number, required: true, min: 1, max: 4 },
    deadline: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },

    status: { type: String, enum: JOB_STATUSES, required: true, default: 'NEW' },
    statusChangedAt: { type: Date, required: true },

    riderId: { type: Schema.Types.ObjectId, ref: 'Rider', default: null },
    riderName: { type: String, default: null },
    currentAssignmentId: { type: Schema.Types.ObjectId, ref: 'Assignment', default: null },
    confirmationDueAt: { type: Date, default: null },
    attemptCount: { type: Number, required: true, default: 0, min: 0 },

    manualQueueReason: {
      type: new Schema({ code: String, message: String, at: Date }, { _id: false }),
      default: null,
    },
    cancelReason: { type: String, trim: true, maxlength: 300 },

    version: { type: Number, required: true, default: 0 },
    createdBy: { type: actorSchema, required: true },
  },
  { timestamps: { currentTime: () => clock.now() }, versionKey: false },
);

// Keep the numeric sort rank in step with the priority name.
jobSchema.pre('validate', function setPriorityRank() {
  this.priorityRank = PRIORITY_RANK[this.priority];
});

// The real guard against duplicate jobs: the database refuses a second job with the same order
// reference, even if two identical requests arrive at the same moment.
jobSchema.index({ orderRef: 1 }, { unique: true });
// Operational queues: "jobs in status X, most urgent first, oldest first".
jobSchema.index({ status: 1, priorityRank: -1, createdAt: 1 });
// Dashboard list (newest first) and zone filters (a zone matches pickup OR drop).
jobSchema.index({ createdAt: -1 });
jobSchema.index({ pickupZone: 1, status: 1 });
jobSchema.index({ dropZone: 1, status: 1 });
// A rider's jobs.
jobSchema.index({ riderId: 1, status: 1 });

export const Job = model('Job', jobSchema);
