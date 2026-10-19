import mongoose from 'mongoose';
import { JOB_EVENT_TYPES, JOB_STATUSES } from '../domain/jobLifecycle.js';

const { Schema, model } = mongoose;

/**
 * Job history (audit trail). One record per important action, written in the same transaction
 * as the change it describes, so the history and the job can never disagree.
 *
 * Append-only: events are never edited. The history is a separate collection (not an array
 * inside the job) because it grows without limit and is only ever added to and read in order.
 *
 * Fields:
 *   jobId, orderRef   which job (orderRef copied for readability)
 *   type              what happened (see JOB_EVENT_TYPES)
 *   at                when (app clock)
 *   actor             who did it: { type: DISPATCHER | RIDER | SYSTEM, id, name }
 *   message           one readable sentence, e.g. "Priya Raman cancelled the job"
 *   fromStatus, toStatus  set when the job's status changed
 *   assignmentId, riderId set when the event concerns an assignment
 *   details           any extra facts (reason, recommendation ranking, ...)
 */
const jobEventSchema = new Schema(
  {
    jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    orderRef: { type: String, required: true },
    type: { type: String, enum: JOB_EVENT_TYPES, required: true },
    at: { type: Date, required: true },
    actor: {
      type: new Schema({ type: String, id: String, name: String }, { _id: false }),
      required: true,
    },
    message: { type: String, required: true },
    fromStatus: { type: String, enum: [...JOB_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...JOB_STATUSES, null], default: null },
    assignmentId: { type: Schema.Types.ObjectId, default: null },
    riderId: { type: Schema.Types.ObjectId, ref: 'Rider', default: null },
    details: { type: Schema.Types.Mixed, default: undefined },
  },
  { versionKey: false },
);

// A job's history in order.
jobEventSchema.index({ jobId: 1, at: 1, _id: 1 });

// Guard: history is never rewritten through the app.
function rejectChange() {
  throw new Error('Job events are append-only and cannot be modified');
}
jobEventSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], rejectChange);
jobEventSchema.pre('save', function blockEdits() {
  if (!this.isNew) rejectChange();
});

export const JobEvent = model('JobEvent', jobEventSchema);
