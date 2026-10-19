import mongoose from 'mongoose';
import { Errors } from '../common/errors.js';
import { escapeRegex, isDuplicateKeyError, withoutUndefined } from '../common/mongo.js';
import { withTransaction } from '../db/transaction.js';
import { riderWorkload } from '../domain/rider.js';
import { Rider } from '../models/rider.model.js';
import { User } from '../models/user.model.js';

const USER_FIELDS = 'name mobile isActive';

/**
 * What the API returns for a rider: profile + login details + live workload summary.
 * `r` is a rider document with `userId` populated (name, mobile, isActive).
 */
function toRiderView(r) {
  return {
    id: String(r._id),
    userId: r.userId ? String(r.userId._id) : '',
    name: r.userId?.name ?? 'Unknown',
    mobile: r.userId?.mobile ?? '',
    isActive: r.userId?.isActive ?? false,
    zones: r.zones,
    capacity: r.capacity,
    maxActiveJobs: r.maxActiveJobs,
    availability: r.availability,
    currentZone: r.currentZone,
    reservedLoad: r.reservedLoad,
    activeJobs: r.activeJobs,
    workload: riderWorkload(r),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function loadRiderView(id) {
  const rider = await Rider.findById(id).populate('userId', USER_FIELDS).lean();
  if (!rider) throw Errors.notFound('Rider');
  return toRiderView(rider);
}

/** Riders may only act on their own profile; dispatchers may act on any rider. */
function assertCanAccessRider(riderId, actor, action) {
  if (actor.type === 'RIDER' && actor.riderId !== riderId) {
    throw Errors.forbidden(`Riders can only ${action} their own profile`);
  }
}

/**
 * Dispatcher adds a rider. The login account (users) and the rider profile (riders) are
 * written in one transaction, so there is never a login without a profile or vice versa.
 * The unique index on users.mobile rejects duplicates, even if two requests race.
 */
export async function createRider(input, actor) {
  try {
    const riderId = await withTransaction(async (session) => {
      const [user] = await User.create(
        [
          {
            name: input.name,
            mobile: input.mobile,
            role: 'RIDER',
            createdBy: actor.type === 'DISPATCHER' ? new mongoose.Types.ObjectId(actor.id) : undefined,
          },
        ],
        { session },
      );
      const [rider] = await Rider.create(
        [
          {
            userId: user._id,
            zones: input.zones,
            capacity: input.capacity,
            maxActiveJobs: input.maxActiveJobs,
            availability: input.availability,
            currentZone: input.currentZone,
          },
        ],
        { session },
      );
      return rider._id;
    });
    return await loadRiderView(riderId);
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw Errors.conflict('MOBILE_ALREADY_REGISTERED', 'An account with this mobile number already exists');
    }
    throw err;
  }
}

/** Lists riders, optionally filtered by availability, zone, or a name/mobile search. */
export async function listRiders(filters) {
  const query = {};
  if (filters.availability) query.availability = filters.availability;
  if (filters.zone) query.zones = filters.zone;

  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    const users = await User.find({ role: 'RIDER', $or: [{ name: pattern }, { mobile: pattern }] }, { _id: 1 }).lean();
    query.userId = { $in: users.map((u) => u._id) };
  }

  const riders = await Rider.find(query).populate('userId', USER_FIELDS).lean();
  return riders.map(toRiderView).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRider(id, actor) {
  assertCanAccessRider(id, actor, 'view');
  return loadRiderView(id);
}

/**
 * Dispatcher edits a rider. Capacity and job limits can never be set below the rider's
 * current reserved load / active jobs: the check is part of the update filter, so it is
 * atomic with the write (no gap where an assignment could sneak in between check and update).
 */
export async function updateRider(id, patch) {
  const { name, ...profile } = patch;
  const changes = withoutUndefined(profile);

  await withTransaction(async (session) => {
    const filter = { _id: id };
    if (changes.capacity !== undefined) filter.reservedLoad = { $lte: changes.capacity };
    if (changes.maxActiveJobs !== undefined) filter.activeJobs = { $lte: changes.maxActiveJobs };

    const updated =
      Object.keys(changes).length > 0
        ? await Rider.findOneAndUpdate(filter, { $set: changes }, { new: true, session, runValidators: true })
        : await Rider.findOne(filter).session(session);

    if (!updated) {
      const current = await Rider.findById(id).session(session).lean();
      if (!current) throw Errors.notFound('Rider');
      throw Errors.conflict(
        'RIDER_LOAD_EXCEEDS_LIMIT',
        `Limits cannot be set below the rider's current workload ` +
          `(${current.reservedLoad} units reserved, ${current.activeJobs} active jobs)`,
        { reservedLoad: current.reservedLoad, activeJobs: current.activeJobs },
      );
    }

    if (name !== undefined) {
      await User.updateOne({ _id: updated.userId }, { $set: { name } }, { session });
    }
  });

  return loadRiderView(id);
}

/**
 * Dispatchers can change any rider's availability; riders can change only their own.
 * Availability affects new assignments only: jobs a rider already accepted stay with them.
 */
export async function setAvailability(id, availability, actor) {
  assertCanAccessRider(id, actor, 'change availability on');
  const updated = await Rider.findByIdAndUpdate(id, { $set: { availability } }, { new: true });
  if (!updated) throw Errors.notFound('Rider');
  return loadRiderView(id);
}
