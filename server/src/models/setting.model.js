import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Operational settings a dispatcher can change while the app runs (one document, _id "dispatch").
 *   confirmationTimeoutMinutes  how long a rider has to accept an assignment (default from .env, 120)
 */
const settingSchema = new Schema(
  {
    _id: { type: String },
    confirmationTimeoutMinutes: { type: Number, required: true, min: 1, max: 1440 },
    updatedBy: { type: new Schema({ type: String, id: String, name: String }, { _id: false }), default: null },
  },
  { timestamps: true, versionKey: false },
);

export const Setting = model('Setting', settingSchema);
