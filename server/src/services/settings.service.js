import { env, simulationEnabled } from '../config/env.js';
import { actorSnapshot } from '../domain/actor.js';
import { Setting } from '../models/setting.model.js';

const SETTINGS_ID = 'dispatch';

/** Current dispatch settings (stored values, falling back to .env defaults). */
export async function getDispatchSettings(session) {
  const stored = await Setting.findById(SETTINGS_ID).session(session ?? null).lean();
  return {
    confirmationTimeoutMinutes: stored?.confirmationTimeoutMinutes ?? env.CONFIRMATION_TIMEOUT_MINUTES,
    defaultConfirmationTimeoutMinutes: env.CONFIRMATION_TIMEOUT_MINUTES,
    sweepIntervalSeconds: env.SWEEP_INTERVAL_SECONDS,
    simulationEnabled,
    updatedBy: stored?.updatedBy ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

/**
 * Dispatcher changes a setting. A new confirmation timeout applies to assignments made from now
 * on; riders who were already asked keep the deadline they were given.
 */
export async function updateDispatchSettings(patch, actor) {
  await Setting.findByIdAndUpdate(
    SETTINGS_ID,
    { $set: { ...patch, updatedBy: actorSnapshot(actor) } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return getDispatchSettings();
}
