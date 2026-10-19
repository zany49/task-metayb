/** Human roles that can log in. */
export const ROLES = ['DISPATCHER', 'RIDER'];

/**
 * An "actor" is whoever performed an action. Every audit event will carry one:
 *   { type: 'DISPATCHER' | 'RIDER' | 'SYSTEM', id, name, riderId? }
 *
 * `riderId` is set only for riders (it points to their rider profile).
 * SYSTEM is used for automatic actions (e.g. the confirmation-timeout sweeper, the seed script).
 */
export const SYSTEM_ACTOR = Object.freeze({ type: 'SYSTEM', id: 'system', name: 'System' });

/**
 * The part of an actor that is stored with a record (e.g. a history event).
 * The name is copied, so the history still reads correctly if the user is renamed later.
 */
export function actorSnapshot(actor) {
  return { type: actor.type, id: String(actor.id), name: actor.name };
}
